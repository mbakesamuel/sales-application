import { prisma } from "../db/prisma.js";
import { getBalanceQty } from "./stockMovements.js";

/**
 * Minimal stock-on-hand style report from stock_movements (shared DB).
 * Full report parity ports continue per-report after cutover.
 */
export async function getStockReportSummary(input?: {
  salesPointId?: number | null;
  asAtIso?: string;
}) {
  const salesPoints = await prisma.sales_points.findMany({
    where: {
      is_active: true,
      ...(input?.salesPointId != null
        ? { id: input.salesPointId }
        : {}),
    },
    orderBy: { name: "asc" },
  });

  const products = await prisma.products.findMany({
    select: { product_id: true, product_name: true, uom: true },
    take: 500,
  });

  const rows: Array<{
    salesPointId: number;
    salesPointName: string;
    productId: number;
    productName: string;
    uom: string;
    qty: string;
  }> = [];

  for (const sp of salesPoints) {
    for (const product of products) {
      const qty = await getBalanceQty(
        prisma,
        sp.id,
        product.product_id,
        null,
        "SELLABLE",
      );
      if (Math.abs(qty) < 0.000001) continue;
      rows.push({
        salesPointId: sp.id,
        salesPointName: sp.name,
        productId: product.product_id,
        productName: product.product_name,
        uom: product.uom,
        qty: String(qty),
      });
    }
  }

  return {
    asAtIso: input?.asAtIso ?? new Date().toISOString().slice(0, 10),
    rows,
    generatedAt: new Date().toISOString(),
  };
}

