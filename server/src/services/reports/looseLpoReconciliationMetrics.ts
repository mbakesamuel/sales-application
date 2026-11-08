import { prisma } from "../../db/prisma.js";
import { loadStockBalancesAsOf } from "./stockBalancesAsOf.js";
import {
  isLooseLpoProduct,
  isLooseLpoReportProduct,
  isSludgePoolReportProduct,
  parseQty,
  type ProductRow,
  type SalesPointRow,
} from "./reportShared.js";
import { parseLocalIso, toIsoDate } from "./weekChoices.js";

export interface LpoSaleLineRecord {
  salesPointId: number | null;
  saleDisposition: string | null;
  customerTypeCode: string;
  customerTypeName: string;
  productId: number;
  productName: string;
  productCode: string | null;
  isBottled: number;
  qtyKg: number;
  qtyUnits: number | null;
}

export interface LpoReceiptLineRecord {
  salesPointId: number;
  supplierLabel: string;
  productId: number;
  productName: string;
  productCode: string | null;
  isBottled: number;
  qty: number;
}

export function dayBeforeIso(isoDate: string): string {
  const date = parseLocalIso(isoDate);
  date.setDate(date.getDate() - 1);
  return toIsoDate(date);
}

function spKey(salesPointId: number): string {
  return String(salesPointId);
}

function zeroValues(
  salesPoints: SalesPointRow[],
): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  for (const salesPoint of salesPoints) {
    values[spKey(salesPoint.id)] = 0;
  }
  return values;
}

export function sumCompanyTotal(
  values: Record<string, number | null>,
): number {
  let total = 0;
  for (const value of Object.values(values)) {
    total += value ?? 0;
  }
  return total;
}

export function isLooseLpo(product: {
  productCode?: string | null;
  productName?: string | null;
  isBottled: number;
}): boolean {
  return isLooseLpoReportProduct({
    productCode: product.productCode,
    productName: product.productName,
    isBottled: product.isBottled,
  });
}

async function buildLpoReportProductIds(
  products: ProductRow[],
): Promise<Set<number>> {
  const ids = new Set(
    products
      .filter((product) => isLooseLpo(product))
      .map((product) => product.productId),
  );
  const company = await prisma.company_settings.findFirst({
    where: { id: "default" },
    select: { stock_intake_oil_grouping: true },
  });
  if (company?.stock_intake_oil_grouping) {
    const pool = products.find((product) =>
      isSludgePoolReportProduct({
        productCode: product.productCode,
        productName: product.productName,
        isBottled: product.isBottled,
      }),
    );
    if (pool) {
      ids.add(pool.productId);
    }
  }
  return ids;
}

export async function loadLpoSaleLines(
  fromIso: string,
  toIso: string,
  salesPointId?: number | null,
): Promise<LpoSaleLineRecord[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      sales_point_id: number | null;
      sale_disposition: string | null;
      customer_type_code: string | null;
      customer_type_name: string | null;
      product_id: number;
      product_name: string;
      product_code: string | null;
      is_bottled: boolean | null;
      qty_kg: string;
      qty_units: string | null;
    }>
  >`
    SELECT s.sales_point_id,
           s.sale_disposition,
           ct.code AS customer_type_code,
           ct.name AS customer_type_name,
           sl.product_id,
           p.product_name,
           p.product_code,
           COALESCE(pc.is_bottled, false) AS is_bottled,
           sl.qty_kg,
           sl.qty_units
    FROM sales s
    INNER JOIN sale_lines sl ON sl.sale_id = s.id
    INNER JOIN products p ON p.product_id = sl.product_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN customer_type_definitions ct ON ct.id = c.customer_type_id
    WHERE s.status = 'VALIDATED'
      AND s.date_issued >= ${fromIso}
      AND s.date_issued <= ${toIso}
      AND (${salesPointId}::int IS NULL OR s.sales_point_id = ${salesPointId})
  `;

  return rows.map((row) => ({
    salesPointId: row.sales_point_id,
    saleDisposition: row.sale_disposition,
    customerTypeCode: String(row.customer_type_code ?? ""),
    customerTypeName: String(row.customer_type_name ?? ""),
    productId: row.product_id,
    productName: String(row.product_name),
    productCode: row.product_code,
    isBottled: row.is_bottled ? 1 : 0,
    qtyKg: parseQty(row.qty_kg),
    qtyUnits: row.qty_units ? parseQty(row.qty_units) : null,
  }));
}

export async function loadLpoReceiptLines(
  fromIso: string,
  toIso: string,
  salesPointId?: number | null,
): Promise<LpoReceiptLineRecord[]> {
  const from = new Date(`${fromIso}T00:00:00.000Z`);
  const to = new Date(`${toIso}T23:59:59.999Z`);
  const receipts = await prisma.stock_receipts.findMany({
    where: {
      status: "POSTED",
      received_at: { gte: from, lte: to },
      ...(salesPointId != null ? { sales_point_id: salesPointId } : {}),
    },
    include: { stock_receipt_lines: true },
  });

  const productIds = [
    ...new Set(
      receipts.flatMap((r) => r.stock_receipt_lines.map((l) => l.product_id)),
    ),
  ];
  const products = await prisma.products.findMany({
    where: { product_id: { in: productIds } },
    include: {
      product_cats: { select: { is_bottled: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.product_id, p]));

  const out: LpoReceiptLineRecord[] = [];
  for (const receipt of receipts) {
    for (const line of receipt.stock_receipt_lines) {
      const product = byId.get(line.product_id);
      if (!product) continue;
      out.push({
        salesPointId: receipt.sales_point_id,
        supplierLabel: receipt.supplier_label,
        productId: line.product_id,
        productName: product.product_name,
        productCode: product.product_code,
        isBottled: product.product_cats.is_bottled ? 1 : 0,
        qty: parseQty(line.qty),
      });
    }
  }
  return out;
}

/** As-of LPO qty by collection point (sellable + unsellable). */
export async function sumLpoBySalesPoint(
  salesPoints: SalesPointRow[],
  products: ProductRow[],
  asOfIso: string,
): Promise<Record<string, number | null>> {
  const lpoProductIds = await buildLpoReportProductIds(products);
  const values = zeroValues(salesPoints);
  for (const row of await loadStockBalancesAsOf(asOfIso)) {
    if (!lpoProductIds.has(row.productId)) continue;
    const key = spKey(row.salesPointId);
    if (key in values) {
      values[key] = (values[key] ?? 0) + row.qty;
    }
  }
  return values;
}

export async function sumCarryForwardLpoInRange(
  salesPoints: SalesPointRow[],
  products: ProductRow[],
  fromIso: string,
  toIso: string,
): Promise<Record<string, number | null>> {
  const lpoProductIds = await buildLpoReportProductIds(products);
  const values = zeroValues(salesPoints);
  const from = new Date(`${fromIso}T00:00:00.000Z`);
  const to = new Date(`${toIso}T23:59:59.999Z`);
  const rows = await prisma.stock_adjustments.findMany({
    where: {
      source_kind: "CARRY_FORWARD",
      status: "POSTED",
      occurred_at: { gte: from, lte: to },
    },
    include: { stock_adjustment_lines: true },
  });

  for (const adj of rows) {
    for (const line of adj.stock_adjustment_lines) {
      if (!lpoProductIds.has(line.product_id)) continue;
      const key = spKey(adj.sales_point_id);
      if (key in values) {
        values[key] = (values[key] ?? 0) + parseQty(line.delta_qty);
      }
    }
  }
  return values;
}

export function addVectors(
  salesPoints: SalesPointRow[],
  left: Record<string, number | null>,
  right: Record<string, number | null>,
): Record<string, number | null> {
  const values = zeroValues(salesPoints);
  for (const salesPoint of salesPoints) {
    const key = spKey(salesPoint.id);
    values[key] = (left[key] ?? 0) + (right[key] ?? 0);
  }
  return values;
}

export function subtractVectors(
  salesPoints: SalesPointRow[],
  left: Record<string, number | null>,
  right: Record<string, number | null>,
): Record<string, number | null> {
  const values = zeroValues(salesPoints);
  for (const salesPoint of salesPoints) {
    const key = spKey(salesPoint.id);
    values[key] = (left[key] ?? 0) - (right[key] ?? 0);
  }
  return values;
}

export async function computeCompanyLpoOpening(
  salesPoints: SalesPointRow[],
  products: ProductRow[],
  periodStartIso: string,
  carryForwardToIso: string,
): Promise<number> {
  const openingAsOfIso = dayBeforeIso(periodStartIso);
  const [priorOpening, carryForward] = await Promise.all([
    sumLpoBySalesPoint(salesPoints, products, openingAsOfIso),
    sumCarryForwardLpoInRange(
      salesPoints,
      products,
      periodStartIso,
      carryForwardToIso,
    ),
  ]);
  return sumCompanyTotal(addVectors(salesPoints, priorOpening, carryForward));
}

export function computeCompanyLpoReceptionTotal(
  receiptLines: LpoReceiptLineRecord[],
): number {
  return receiptLines
    .filter(
      (line) =>
        isLooseLpo(line) ||
        isSludgePoolReportProduct({
          productCode: line.productCode,
          productName: line.productName,
          isBottled: line.isBottled,
        }),
    )
    .reduce((sum, line) => sum + line.qty, 0);
}

export function computeCompanyLpoIssuesTotal(
  saleLines: LpoSaleLineRecord[],
): number {
  return saleLines
    .filter((line) => isLooseLpo(line))
    .reduce((sum, line) => sum + line.qtyKg, 0);
}

export async function loadFiscalYearStartIso(
  financialYearPeriodId: string,
): Promise<string> {
  const row = await prisma.financial_year_periods.findUnique({
    where: { id: financialYearPeriodId },
    select: { start_date: true },
  });
  if (!row?.start_date) {
    throw new Error("Financial year period not found.");
  }
  const value = row.start_date;
  if (value instanceof Date) {
    return toIsoDate(value);
  }
  return String(value).slice(0, 10);
}

export async function loadFiscalYearStartMonth(): Promise<number> {
  const row = await prisma.company_settings.findFirst({
    where: { id: "default" },
    select: { fiscal_year_start_month: true },
  });
  return Number(row?.fiscal_year_start_month ?? 1);
}

// Keep named export available for callers that only need the canonical SKU check.
export { isLooseLpoProduct };
