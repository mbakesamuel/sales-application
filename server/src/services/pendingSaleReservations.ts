import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveStockProductId } from "./stockIntakeGrouping.js";
import { getSellableBalanceAsOf, getBalanceQty } from "./stockMovements.js";
import { resolveSaleLineStorageLocationId } from "./saleStorageLocation.js";

type Tx = Prisma.TransactionClient | PrismaClient;

function parseQty(value: string | number | null | undefined): number {
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Qty reserved by PENDING sale lines for a sellable stock key as of a date.
 * Bottle lines use qty_units (fallback qty_kg); loose uses qty_kg.
 * Bottle lines with null storage still count against Bottled Oil Store.
 */
export async function pendingReservedQty(
  tx: Tx,
  salesPointId: number,
  productId: number,
  storageLocationId: number | null,
  asOfDateIso: string,
  excludeSaleId?: string | null,
): Promise<number> {
  const asOf = asOfDateIso.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return 0;
  }

  const stockProductId = await resolveStockProductId(tx, productId);
  let bottleStoreId: number | null = null;
  if (storageLocationId != null) {
    try {
      bottleStoreId = await resolveSaleLineStorageLocationId(tx, {
        salesPointId,
        preferredLocationId: null,
        isBottleMode: true,
      });
    } catch {
      bottleStoreId = null;
    }
  }

  const sales = await tx.sales.findMany({
    where: {
      status: "PENDING",
      sales_point_id: salesPointId,
      date_issued: { lte: asOf },
      ...(excludeSaleId ? { id: { not: excludeSaleId } } : {}),
    },
    select: {
      sale_product_mode: true,
      sale_lines: {
        select: {
          product_id: true,
          qty_kg: true,
          qty_units: true,
          storage_location_id: true,
        },
      },
    },
  });

  let total = 0;
  for (const sale of sales) {
    const isBottle =
      String(sale.sale_product_mode ?? "LOOSE").toUpperCase() === "BOTTLE";
    for (const line of sale.sale_lines) {
      const lineLoc = line.storage_location_id;
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

      const lineStockProductId = await resolveStockProductId(tx, line.product_id);
      if (lineStockProductId !== stockProductId) {
        continue;
      }
      const qty = parseQty(
        isBottle ? (line.qty_units ?? line.qty_kg) : line.qty_kg,
      );
      if (qty > 0) {
        total += qty;
      }
    }
  }
  return total;
}

/** Sellable as-of balance minus PENDING reservations (soft lock). */
export async function getAvailableSellableForSaleAsOf(
  tx: Tx,
  salesPointId: number,
  productId: number,
  storageLocationId: number | null,
  asOfDateIso: string,
  excludeSaleId?: string | null,
): Promise<number> {
  const asOf = asOfDateIso.trim().slice(0, 10);
  const balance = /^\d{4}-\d{2}-\d{2}$/.test(asOf)
    ? await getSellableBalanceAsOf(
        tx,
        salesPointId,
        productId,
        storageLocationId,
        asOf,
      )
    : await getBalanceQty(
        tx,
        salesPointId,
        productId,
        storageLocationId,
        "SELLABLE",
      );
  const reserved = await pendingReservedQty(
    tx,
    salesPointId,
    productId,
    storageLocationId,
    asOf,
    excludeSaleId,
  );
  return balance - reserved;
}
