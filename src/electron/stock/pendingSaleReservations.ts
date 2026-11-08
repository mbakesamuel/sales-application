import type Database from "better-sqlite3";
import { parseQty } from "./decimal.js";
import { getSellableBalanceAsOf } from "./asOfBalance.js";
import {
  loadStockIntakeOilGrouping,
  resolveStockProductId,
} from "./productStorage.js";

function findBottleStoreLocationId(
  db: Database.Database,
  salesPointId: number,
): number | null {
  const row = db
    .prepare(
      `SELECT sl.id
       FROM StorageLocation sl
       INNER JOIN Location l ON l.id = sl.locationId
       WHERE sl.salesPointId = ?
         AND COALESCE(sl.isActive, 1) = 1
         AND LOWER(l.locationName) LIKE '%bottle%'
       ORDER BY
         CASE WHEN COALESCE(sl.isSalesTank, 0) = 0 THEN 0 ELSE 1 END,
         sl.isDefault DESC,
         sl.id ASC
       LIMIT 1`,
    )
    .get(salesPointId) as { id: number } | undefined;
  return row?.id ?? null;
}

/**
 * Qty reserved by PENDING sale lines for a sellable stock key as of a date.
 * Bottle lines use qtyUnits (fallback qtyKg); loose uses qtyKg.
 * Bottle lines with null storage still count against Bottled Oil Store.
 */
export function pendingReservedQty(
  db: Database.Database,
  salesPointId: number,
  productId: number,
  storageLocationId: number | null,
  asOfDateIso: string,
  excludeSaleId?: string | null,
): number {
  const asOf = asOfDateIso.slice(0, 10);
  const groupingEnabled = loadStockIntakeOilGrouping(db);
  const stockProductId = resolveStockProductId(db, productId, groupingEnabled);

  const bottleStoreId =
    storageLocationId != null
      ? findBottleStoreLocationId(db, salesPointId)
      : null;

  const excludeClause = excludeSaleId ? " AND s.id != ?" : "";
  const excludeParams = excludeSaleId ? [excludeSaleId] : [];

  const rows = db
    .prepare(
      `SELECT s.saleProductMode AS saleProductMode,
              sl.productId AS productId,
              sl.qtyKg AS qtyKg,
              sl.qtyUnits AS qtyUnits,
              sl.storageLocationId AS storageLocationId
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       WHERE s.status = 'PENDING'
         AND s.salesPointId = ?
         AND substr(s.dateIssued, 1, 10) <= ?${excludeClause}`,
    )
    .all(salesPointId, asOf, ...excludeParams) as Array<{
    saleProductMode: string | null;
    productId: number;
    qtyKg: string;
    qtyUnits: string | null;
    storageLocationId: number | null;
  }>;

  let total = 0;
  for (const row of rows) {
    const isBottle =
      String(row.saleProductMode ?? "LOOSE").toUpperCase() === "BOTTLE";
    const lineLoc = row.storageLocationId;
    const matchesExact =
      storageLocationId == null
        ? lineLoc == null
        : lineLoc === storageLocationId;
    const matchesBottleNull =
      isBottle &&
      lineLoc == null &&
      storageLocationId != null &&
      bottleStoreId != null &&
      storageLocationId === bottleStoreId;
    if (!matchesExact && !matchesBottleNull) {
      continue;
    }

    const lineStockProductId = resolveStockProductId(
      db,
      row.productId,
      groupingEnabled,
    );
    if (lineStockProductId !== stockProductId) {
      continue;
    }
    const qty = parseQty(isBottle ? (row.qtyUnits ?? row.qtyKg) : row.qtyKg);
    if (qty > 0) {
      total += qty;
    }
  }
  return total;
}

/** Sellable as-of balance minus PENDING reservations (soft lock). */
export function getAvailableSellableForSaleAsOf(
  db: Database.Database,
  salesPointId: number,
  productId: number,
  storageLocationId: number | null,
  asOfDateIso: string,
  excludeSaleId?: string | null,
): number {
  const balance = getSellableBalanceAsOf(
    db,
    salesPointId,
    productId,
    storageLocationId,
    asOfDateIso,
    excludeSaleId,
  );
  const reserved = pendingReservedQty(
    db,
    salesPointId,
    productId,
    storageLocationId,
    asOfDateIso,
    excludeSaleId,
  );
  return balance - reserved;
}
