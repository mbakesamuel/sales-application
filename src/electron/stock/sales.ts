import type Database from "better-sqlite3";
import type { StockCondition } from "../../shared/stock.types.js";
import { formatDisplayDate } from "../../shared/formatDisplayDate.js";
import { getAvailableSellableForSaleAsOf } from "./pendingSaleReservations.js";
import { formatQty, parseQty } from "./decimal.js";
import { InsufficientStockError } from "./errors.js";
import { applyMovement } from "./post.js";
import {
  productRequiresSalesTankForLooseSale,
  productOmitsStorageLocationById,
  resolveStockProductId,
  loadStockIntakeOilGrouping,
} from "./productStorage.js";

export { getSellableBalanceAsOf } from "./asOfBalance.js";
export { getAvailableSellableForSaleAsOf } from "./pendingSaleReservations.js";
export { productOmitsStorageLocationById } from "./productStorage.js";

export function resolveSellableStorageLocation(
  db: Database.Database,
  salesPointId: number,
  preferredLocationId: number | null,
  isBottleMode: boolean,
  requireSalesTank = false,
): number {
  // Bottle oil is sold from Bottle Oil Store (a normal store location), not a sales tank.
  if (isBottleMode) {
    if (preferredLocationId != null) {
      const preferred = db
        .prepare(
          `SELECT id FROM StorageLocation
           WHERE id = ? AND salesPointId = ?
             AND COALESCE(isActive, 1) = 1`,
        )
        .get(preferredLocationId, salesPointId) as { id: number } | undefined;

      if (preferred) {
        return preferred.id;
      }
    }

    const bottleLocation = db
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

    if (bottleLocation) {
      return bottleLocation.id;
    }

    throw new Error(
      "No Bottle Oil Store is configured for this collection point.",
    );
  }

  const salesTankSql = requireSalesTank
    ? " AND COALESCE(isSalesTank, 0) = 1"
    : "";

  if (preferredLocationId != null) {
    const preferred = db
      .prepare(
        `SELECT id FROM StorageLocation
         WHERE id = ? AND salesPointId = ?
           AND COALESCE(isActive, 1) = 1${salesTankSql}`,
      )
      .get(preferredLocationId, salesPointId) as { id: number } | undefined;

    if (preferred) {
      return preferred.id;
    }
  }

  const fallback = db
    .prepare(
      `SELECT id FROM StorageLocation
       WHERE salesPointId = ?
         AND COALESCE(isActive, 1) = 1${salesTankSql}
       ORDER BY isDefault DESC, id ASC
       LIMIT 1`,
    )
    .get(salesPointId) as { id: number } | undefined;

  if (!fallback) {
    throw new Error(
      requireSalesTank
        ? "No active sales tank is configured for this collection point."
        : "No active storage location is configured for this collection point.",
    );
  }

  return fallback.id;
}

/** Resolve location for a loose/bottle sale line, applying LPO sales-tank setting. */
export function resolveSaleLineStorageLocation(
  db: Database.Database,
  salesPointId: number,
  productId: number,
  preferredLocationId: number | null,
  isBottleMode: boolean,
): number {
  const requireSalesTank =
    !isBottleMode && productRequiresSalesTankForLooseSale(db, productId);
  return resolveSellableStorageLocation(
    db,
    salesPointId,
    preferredLocationId,
    isBottleMode,
    requireSalesTank,
  );
}

export interface SaleStockLineInput {
  productId: number;
  qtyKg: string;
  qtyUnits?: string | null;
  storageLocationId?: number | null;
}

/**
 * Ensures each sale line is covered by sellable stock as of dateIssued
 * at the resolved storage location (running reservation within the sale).
 */
export function assertSaleLinesStockAsOf(
  db: Database.Database,
  args: {
    salesPointId: number;
    dateIssued: string;
    isBottleMode: boolean;
    lines: SaleStockLineInput[];
    excludeSaleId?: string | null;
  },
): void {
  const asOf = args.dateIssued.slice(0, 10);
  const reserved = new Map<string, number>();
  const groupingEnabled = loadStockIntakeOilGrouping(db);

  for (const line of args.lines) {
    const rawQty = args.isBottleMode ? (line.qtyUnits ?? line.qtyKg) : line.qtyKg;
    const qty = parseQty(rawQty);
    if (qty <= 0) {
      continue;
    }

    const stockProductId = resolveStockProductId(
      db,
      line.productId,
      groupingEnabled,
    );
    const omitsStorage = productOmitsStorageLocationById(db, stockProductId);
    const storageLocationId = omitsStorage
      ? null
      : resolveSaleLineStorageLocation(
          db,
          args.salesPointId,
          stockProductId,
          line.storageLocationId ?? null,
          args.isBottleMode,
        );

    const key = `${stockProductId}:${storageLocationId ?? "null"}`;
    const alreadyReserved = reserved.get(key) ?? 0;
    const available = getAvailableSellableForSaleAsOf(
      db,
      args.salesPointId,
      stockProductId,
      storageLocationId,
      asOf,
      args.excludeSaleId,
    );
    const remaining = available - alreadyReserved;

    if (remaining + 0.000001 < qty) {
      const product = db
        .prepare(`SELECT productName FROM Product WHERE productId = ?`)
        .get(line.productId) as { productName: string } | undefined;

      const productLabel = product?.productName ?? `product ${line.productId}`;
      let locationLabel: string;
      if (storageLocationId == null) {
        locationLabel = "this collection point";
      } else {
        const location = db
          .prepare(
            `SELECT l.locationName AS name
             FROM StorageLocation sl
             INNER JOIN Location l ON l.id = sl.locationId
             WHERE sl.id = ?`,
          )
          .get(storageLocationId) as { name: string } | undefined;
        locationLabel = location?.name ?? `location ${storageLocationId}`;
      }

      const asOfLabel = formatDisplayDate(asOf);
      const availableQty = Math.max(0, remaining);
      if (availableQty <= 0.000001) {
        throw new InsufficientStockError(
          `No stock for ${productLabel} at ${locationLabel} on ${asOfLabel}. ` +
            `Receive stock first, or choose another location.`,
        );
      }
      throw new InsufficientStockError(
        `Not enough stock for ${productLabel} at ${locationLabel} on ${asOfLabel}. ` +
          `Only ${formatQty(availableQty)} available, but ${formatQty(qty)} is required.`,
      );
    }

    reserved.set(key, alreadyReserved + qty);
  }
}

function noonOnDate(isoDate: string): string {
  return `${isoDate.slice(0, 10)}T12:00:00`;
}

export function deductStockForValidatedSale(
  db: Database.Database,
  saleId: string,
  userId: string,
  occurredAt: string,
): void {
  const sale = db
    .prepare(
      `SELECT salesPointId, saleProductMode, invoiceNo, dateIssued
       FROM Sale
       WHERE id = ?`,
    )
    .get(saleId) as
    | {
        salesPointId: number | null;
        saleProductMode: string | null;
        invoiceNo: string;
        dateIssued: string | null;
      }
    | undefined;

  if (!sale?.salesPointId) {
    return;
  }

  const existing = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM StockMovement
       WHERE sourceKind = 'SALE' AND sourceId = ?`,
    )
    .get(saleId) as { count: number };

  if (existing.count > 0) {
    return;
  }

  const isBottleMode = sale.saleProductMode === "BOTTLE";
  const movementAt = sale.dateIssued
    ? noonOnDate(String(sale.dateIssued))
    : occurredAt;
  const groupingEnabled = loadStockIntakeOilGrouping(db);

  const lines = db
    .prepare(
      `SELECT productId, qtyKg, qtyUnits, storageLocationId
       FROM SaleLine
       WHERE saleId = ?
       ORDER BY id ASC`,
    )
    .all(saleId) as Array<{
    productId: number;
    qtyKg: string;
    qtyUnits: string | null;
    storageLocationId: number | null;
  }>;

  for (const line of lines) {
    const rawQty = isBottleMode ? (line.qtyUnits ?? line.qtyKg) : line.qtyKg;
    const qty = parseQty(rawQty);
    if (qty <= 0) {
      continue;
    }

    const stockProductId = resolveStockProductId(
      db,
      line.productId,
      groupingEnabled,
    );
    const omitsStorage = productOmitsStorageLocationById(db, stockProductId);
    const storageLocationId = omitsStorage
      ? null
      : resolveSaleLineStorageLocation(
          db,
          sale.salesPointId,
          stockProductId,
          line.storageLocationId,
          isBottleMode,
        );

    applyMovement(db, {
      salesPointId: sale.salesPointId,
      productId: stockProductId,
      storageLocationId,
      qty: formatQty(qty),
      kind: "SALE",
      occurredAt: movementAt,
      userId,
      sourceKind: "SALE",
      sourceId: saleId,
      condition: "SELLABLE",
      notes: `Sale ${sale.invoiceNo}`,
    });
  }
}

export function reverseStockForValidatedSale(
  db: Database.Database,
  saleId: string,
  userId: string,
  occurredAt: string,
  notes?: string | null,
): void {
  const sale = db
    .prepare(
      `SELECT salesPointId, invoiceNo FROM Sale WHERE id = ?`,
    )
    .get(saleId) as
    | { salesPointId: number | null; invoiceNo: string }
    | undefined;

  // Check if already reversed
  const alreadyReversed = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM StockMovement
       WHERE sourceKind = 'SALE' AND sourceId = ? AND kind = 'SALE_REVERSAL'`,
    )
    .get(saleId) as { count: number };

  if (alreadyReversed.count > 0) {
    return;
  }

  // Find all SALE movements for this sale
  const saleMovements = db
    .prepare(
      `SELECT salesPointId, productId, storageLocationId, condition, qty, notes, occurredAt
       FROM StockMovement
       WHERE sourceKind = 'SALE' AND sourceId = ? AND kind = 'SALE'
       ORDER BY createdAt ASC`,
    )
    .all(saleId) as Array<{
      salesPointId: number;
      productId: number;
      storageLocationId: number | null;
      condition: StockCondition;
      qty: string;
      notes: string | null;
      occurredAt: string;
    }>;

  for (const mov of saleMovements) {
    // Date the reversal on the original sale movement date so period stock
    // reports (as-of open month) net the void in the same posting period.
    applyMovement(db, {
      salesPointId: mov.salesPointId,
      productId: mov.productId,
      storageLocationId: mov.storageLocationId,
      condition: mov.condition,
      qty: mov.qty,
      kind: "SALE_REVERSAL",
      occurredAt: mov.occurredAt || occurredAt,
      userId,
      sourceKind: "SALE",
      sourceId: saleId,
      notes: notes ?? `Cancellation of sale ${sale?.invoiceNo ?? saleId}`,
    });
  }
}
