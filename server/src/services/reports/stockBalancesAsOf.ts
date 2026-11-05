import { prisma } from "../../db/prisma.js";
import { signedDeltaForKind, type StockMovementKind } from "../stockMovements.js";

const QTY_EPS = 0.000001;

export type StockBalanceAsOfRow = {
  salesPointId: number;
  productId: number;
  storageLocationId: number | null;
  condition: "SELLABLE" | "UNSELLABLE";
  qty: number;
};

function balanceKey(
  salesPointId: number,
  productId: number,
  storageLocationId: number | null,
  condition: string,
): string {
  const loc = storageLocationId == null ? "null" : String(storageLocationId);
  return `${salesPointId}:${productId}:${loc}:${condition}`;
}

/**
 * Reconstruct on-hand balances from stock_movements through asOfDateIso (inclusive).
 */
export async function loadStockBalancesAsOf(
  asOfDateIso: string,
): Promise<StockBalanceAsOfRow[]> {
  const asOf = asOfDateIso.slice(0, 10);
  const rows = await prisma.$queryRaw<
    Array<{
      sales_point_id: number;
      product_id: number;
      storage_location_id: number | null;
      condition: string;
      kind: string;
      qty: string;
    }>
  >`
    SELECT sales_point_id, product_id, storage_location_id, condition, kind, qty
    FROM stock_movements
    WHERE occurred_at::date <= ${asOf}::date
  `;

  const totals = new Map<string, StockBalanceAsOfRow>();
  for (const row of rows) {
    const condition =
      row.condition === "UNSELLABLE" ? "UNSELLABLE" : "SELLABLE";
    const key = balanceKey(
      row.sales_point_id,
      row.product_id,
      row.storage_location_id,
      condition,
    );
    const signed = signedDeltaForKind(row.kind as StockMovementKind, row.qty);
    const existing = totals.get(key);
    if (existing) {
      existing.qty += signed;
    } else {
      totals.set(key, {
        salesPointId: row.sales_point_id,
        productId: row.product_id,
        storageLocationId: row.storage_location_id,
        condition,
        qty: signed,
      });
    }
  }

  return [...totals.values()].filter((row) => Math.abs(row.qty) > QTY_EPS);
}
