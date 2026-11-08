import type { Prisma, PrismaClient } from "@prisma/client";
import { formatDisplayDate } from "./reports/reportShared.js";
import { resolveStockProductId } from "./stockIntakeGrouping.js";
import { getAvailableSellableForSaleAsOf } from "./pendingSaleReservations.js";
import { resolveSaleLineStorageLocationId } from "./saleStorageLocation.js";

type Tx = Prisma.TransactionClient | PrismaClient;

function parseQty(value: string | number | null | undefined): number {
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(rounded);
}

export type SaleStockLineInput = {
  productId: number;
  qtyKg: string;
  qtyUnits?: string | null;
  storageLocationId?: number | null;
};

/**
 * Ensures each sale line is covered by available sellable stock as of dateIssued
 * (movement balance minus PENDING reservations), with running reservation within
 * this invoice.
 */
export async function assertSaleLinesStockAsOf(
  tx: Tx,
  args: {
    salesPointId: number;
    dateIssued: string;
    isBottleMode: boolean;
    lines: SaleStockLineInput[];
    excludeSaleId?: string | null;
  },
): Promise<void> {
  const asOf = args.dateIssued.slice(0, 10);
  const reserved = new Map<string, number>();

  for (const line of args.lines) {
    const rawQty = args.isBottleMode ? (line.qtyUnits ?? line.qtyKg) : line.qtyKg;
    const qty = parseQty(rawQty);
    if (qty <= 0) continue;

    const stockProductId = await resolveStockProductId(tx, line.productId);
    const product = await tx.products.findUnique({
      where: { product_id: stockProductId },
      select: {
        product_name: true,
        omits_storage_location: true,
      },
    });
    const omitsStorage = Boolean(product?.omits_storage_location);
    const storageLocationId = omitsStorage
      ? null
      : await resolveSaleLineStorageLocationId(tx, {
          salesPointId: args.salesPointId,
          preferredLocationId: line.storageLocationId ?? null,
          isBottleMode: args.isBottleMode,
        });

    const key = `${stockProductId}:${storageLocationId ?? "null"}`;
    const alreadyReserved = reserved.get(key) ?? 0;
    const available = await getAvailableSellableForSaleAsOf(
      tx,
      args.salesPointId,
      stockProductId,
      storageLocationId,
      asOf,
      args.excludeSaleId,
    );
    const remaining = available - alreadyReserved;

    if (remaining + 0.000001 < qty) {
      const productLabel =
        product?.product_name ?? `product ${line.productId}`;
      let locationLabel = "this collection point";
      if (storageLocationId != null) {
        const loc = await tx.storage_locations.findUnique({
          where: { id: storageLocationId },
          include: { locations: { select: { location_name: true } } },
        });
        locationLabel =
          loc?.locations?.location_name ?? `location ${storageLocationId}`;
      }

      const asOfLabel = formatDisplayDate(asOf);
      const availableQty = Math.max(0, remaining);
      if (availableQty <= 0.000001) {
        throw new Error(
          `No stock for ${productLabel} at ${locationLabel} on ${asOfLabel}. ` +
            `Receive stock first, or choose another location.`,
        );
      }
      throw new Error(
        `Not enough stock for ${productLabel} at ${locationLabel} on ${asOfLabel}. ` +
          `Only ${formatQty(availableQty)} available, but ${formatQty(qty)} is required.`,
      );
    }

    reserved.set(key, alreadyReserved + qty);
  }
}
