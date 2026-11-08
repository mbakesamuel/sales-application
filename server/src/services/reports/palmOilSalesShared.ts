import { prisma } from "../../db/prisma.js";
import {
  PALM_OIL_KG_PER_LITRE,
  detectBottledPack,
  isLooseLpoReportProduct,
  parseQty,
  type ProductRow,
} from "./reportShared.js";

export const PALM_OIL_MONTH_ABBREVS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

export const LPO_DESTINATION_ROWS = [
  { id: "industries", label: "INDUSTRIES" },
  { id: "wholesales", label: "WHOLESALES" },
  { id: "retail", label: "RETAIL" },
  { id: "cdcWorkers", label: "CDC WORKERS" },
  { id: "makoko", label: "MAKOKO FARMS" },
] as const;

export type MonthlyPalmOilDestinationId =
  (typeof LPO_DESTINATION_ROWS)[number]["id"];

export const PALM_OIL_ACTIVITY_CUSTOMER_ROWS = [
  { id: "industry", label: "INDUSTRY" },
  { id: "wholesale", label: "WHOLESALE" },
  { id: "retail", label: "RETAIL" },
  { id: "others", label: "OTHERS" },
] as const;

export type PalmOilActivityCategoryId =
  | (typeof PALM_OIL_ACTIVITY_CUSTOMER_ROWS)[number]["id"]
  | "bpo";

export interface PalmOilSaleLineRecord {
  dateIssued: string;
  saleDisposition: string | null;
  customerName: string;
  customerTypeCode: string;
  customerTypeName: string;
  productId: number;
  productName: string;
  productCode: string | null;
  isLooseLpo: boolean;
  isBottled: number;
  qtyKg: number;
  qtyUnits: number | null;
  lineNet: number;
}

export function kgToTons(kg: number): number {
  return kg / 1000;
}

export function monthIndexFromIso(iso: string): number {
  return Number.parseInt(iso.slice(5, 7), 10) - 1;
}

export function calendarMonthFromIso(iso: string): number {
  return Number.parseInt(iso.slice(5, 7), 10);
}

export function resolveMonthlyPalmOilDestinationId(
  saleDisposition: string | null,
  customerName: string,
  customerTypeCode: string,
  customerTypeName: string,
): MonthlyPalmOilDestinationId {
  if (saleDisposition === "RATION") {
    return "cdcWorkers";
  }
  if (saleDisposition === "RETAIL") {
    return "retail";
  }

  const text =
    `${customerName} ${customerTypeCode} ${customerTypeName}`.toUpperCase();
  if (text.includes("MAKOKO")) {
    return "makoko";
  }
  if (
    text.includes("STAFF") ||
    text.includes("WORKER") ||
    text.includes("RATION")
  ) {
    return "cdcWorkers";
  }
  if (text.includes("WHOLESALE")) {
    return "wholesales";
  }
  if (text.includes("RETAIL")) {
    return "retail";
  }
  if (text.includes("INDUSTR")) {
    return "industries";
  }
  return "cdcWorkers";
}

export function resolvePalmOilActivityCategoryId(
  saleDisposition: string | null,
  customerTypeCode: string,
  customerTypeName: string,
): Exclude<PalmOilActivityCategoryId, "bpo"> {
  if (saleDisposition === "PUBLIC_RELATION" || saleDisposition === "RATION") {
    return "others";
  }
  if (saleDisposition === "RETAIL") {
    return "retail";
  }

  const text = `${customerTypeCode} ${customerTypeName}`.toUpperCase();
  if (text.includes("WHOLESALE")) {
    return "wholesale";
  }
  if (text.includes("RETAIL")) {
    return "retail";
  }
  if (text.includes("INDUSTR")) {
    return "industry";
  }
  return "others";
}

export async function loadPalmOilSaleLines(
  yearFromIso: string,
  yearToIso: string,
  salesPointId?: number | null,
): Promise<PalmOilSaleLineRecord[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      date_issued: string;
      sale_disposition: string | null;
      customer_name: string | null;
      customer_type_code: string | null;
      customer_type_name: string | null;
      product_id: number;
      product_name: string;
      product_code: string | null;
      is_bottled: boolean | null;
      qty_kg: string;
      qty_units: string | null;
      line_net: string;
    }>
  >`
    SELECT s.date_issued,
           s.sale_disposition,
           COALESCE(c.name, '') AS customer_name,
           COALESCE(pct.code, ct.code, '') AS customer_type_code,
           COALESCE(pct.name, ct.name, '') AS customer_type_name,
           sl.product_id,
           p.product_name,
           p.product_code,
           COALESCE(pc.is_bottled, false) AS is_bottled,
           sl.qty_kg,
           sl.qty_units,
           sl.line_net
    FROM sales s
    INNER JOIN sale_lines sl ON sl.sale_id = s.id
    INNER JOIN products p ON p.product_id = sl.product_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN customer_type_definitions ct ON ct.id = c.customer_type_id
    LEFT JOIN delivery_orders d
      ON d.delivery_order_no = s.delivery_order_no
     AND d.status = 'VALIDATED'
    LEFT JOIN delivery_order_details dd
      ON dd.delivery_order_id = d.id
     AND dd.product_id = sl.product_id
    LEFT JOIN customer_type_definitions pct ON pct.id = dd.pricing_customer_type_id
    WHERE s.status = 'VALIDATED'
      AND s.date_issued >= ${yearFromIso}
      AND s.date_issued <= ${yearToIso}
      AND (${salesPointId}::int IS NULL OR s.sales_point_id = ${salesPointId})
  `;

  return rows.map((row) => {
    const productName = String(row.product_name);
    const productCode = row.product_code;
    const isBottled = row.is_bottled ? 1 : 0;
    return {
      dateIssued: String(row.date_issued).slice(0, 10),
      saleDisposition: row.sale_disposition,
      customerName: String(row.customer_name ?? ""),
      customerTypeCode: String(row.customer_type_code ?? ""),
      customerTypeName: String(row.customer_type_name ?? ""),
      productId: row.product_id,
      productName,
      productCode,
      isLooseLpo: isLooseLpoReportProduct({
        productCode,
        productName,
        isBottled,
      }),
      isBottled,
      qtyKg: parseQty(row.qty_kg),
      qtyUnits: row.qty_units ? parseQty(row.qty_units) : null,
      lineNet: parseQty(row.line_net),
    };
  });
}

export function palmOilLineKg(
  line: PalmOilSaleLineRecord,
  products: ProductRow[],
): number {
  if (line.isBottled === 1) {
    const product = products.find((item) => item.productId === line.productId);
    if (!product) {
      return line.qtyUnits ?? line.qtyKg;
    }
    const pack = detectBottledPack(product);
    const units = line.qtyUnits ?? line.qtyKg;
    return units * pack.litresPerUnit * PALM_OIL_KG_PER_LITRE;
  }
  return line.qtyKg;
}

export async function loadBudgetUnitPricePerKg(
  financialYear: number,
  productCatId: number,
): Promise<number | null> {
  const row = await prisma.product_sales_budgets.findFirst({
    where: {
      financial_year: financialYear,
      product_cat_id: productCatId,
    },
    select: { budget_unit_price_per_kg: true },
  });
  if (!row) return null;
  const price = parseQty(row.budget_unit_price_per_kg);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export async function loadMainAndBottledCategoryIds(): Promise<{
  mainProductCatId: number | null;
  bottledProductCatId: number | null;
}> {
  const rows = await prisma.product_cats.findMany({
    select: {
      product_cat_id: true,
      is_main: true,
      is_bottled: true,
    },
  });
  const main = rows.find((row) => row.is_main);
  const bottled = rows.find((row) => row.is_bottled && !row.is_main);
  return {
    mainProductCatId: main?.product_cat_id ?? null,
    bottledProductCatId:
      bottled?.product_cat_id ?? main?.product_cat_id ?? null,
  };
}
