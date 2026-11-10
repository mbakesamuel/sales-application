/**
 * Shared helpers for daily sales detail + day-to-day matrix reports.
 * Ports src/electron/reports/dailySalesShared.ts.
 */
import { prisma } from "../../db/prisma.js";
import { parseQty } from "./reportShared.js";

export const DAILY_SALES_SUMMARY_ROWS = [
  { id: "industries", label: "INDUSTRIES" },
  { id: "wholesales", label: "WHOLE SALE" },
  { id: "retail", label: "RETAIL" },
  { id: "cdcWorkers", label: "CDC WORKERS" },
  { id: "proSamples", label: "PRO/SAMPLES" },
] as const;

export type DailyCustomerCategory =
  (typeof DAILY_SALES_SUMMARY_ROWS)[number]["id"];

export type DailySalesMatrixSaleCategory =
  | "industry"
  | "wholeSale"
  | "retail"
  | "cdcWorker"
  | "staff";

export type RawDailySaleLine = {
  saleId: string;
  soldAt: string;
  createdAt: string;
  customerName: string;
  deliveryOrderNo: string | null;
  dateIssued: string;
  vehicleNumber: string;
  saleDisposition: string | null;
  productId: number;
  productName: string;
  isBottled: number;
  qtyKg: number;
  qtyUnits: number | null;
  customerTypeCode: string;
  customerTypeName: string;
};

export type TransferQtyByDate = {
  xferDate: string;
  qtyKg: number;
};

export function resolveDailyCustomerCategory(
  saleDisposition: string | null,
  customerTypeCode: string,
  customerTypeName: string,
): DailyCustomerCategory {
  if (saleDisposition === "PUBLIC_RELATION") {
    return "proSamples";
  }
  if (saleDisposition === "RATION") {
    return "cdcWorkers";
  }
  if (saleDisposition === "RETAIL") {
    return "retail";
  }

  const text = `${customerTypeCode} ${customerTypeName}`.toUpperCase();
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

export function mapCategoryToMatrixColumn(
  category: DailyCustomerCategory,
): DailySalesMatrixSaleCategory | null {
  switch (category) {
    case "industries":
      return "industry";
    case "wholesales":
      return "wholeSale";
    case "retail":
      return "retail";
    case "cdcWorkers":
      return "cdcWorker";
    case "proSamples":
      return "staff";
    default:
      return null;
  }
}

export function lineQuantity(
  line: Pick<RawDailySaleLine, "isBottled" | "qtyKg" | "qtyUnits">,
): number {
  if (line.isBottled === 1) {
    return line.qtyUnits ?? line.qtyKg;
  }
  return line.qtyKg;
}

export function dayOfMonthFromIso(iso: string): number {
  return Number.parseInt(iso.slice(8, 10), 10);
}

export function daysInCalendarMonth(monthStartIso: string): number {
  const year = Number.parseInt(monthStartIso.slice(0, 4), 10);
  const month = Number.parseInt(monthStartIso.slice(5, 7), 10);
  return new Date(year, month, 0).getDate();
}

export async function loadRawSaleLinesForRange(
  fromIso: string,
  toIso: string,
  salesPointId: number | null,
  productId: number | null = null,
): Promise<RawDailySaleLine[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      sale_id: string;
      sold_at: Date;
      created_at: Date;
      customer_name: string | null;
      delivery_order_no: string | null;
      date_issued: string;
      vehicle_number: string | null;
      sale_disposition: string | null;
      product_id: number;
      product_name: string;
      is_bottled: boolean | null;
      qty_kg: string;
      qty_units: string | null;
      customer_type_code: string | null;
      customer_type_name: string | null;
    }>
  >`
    SELECT s.id AS sale_id,
           s.sold_at,
           s.created_at,
           s.customer_name_snapshot AS customer_name,
           s.delivery_order_no,
           s.date_issued,
           s.vehicle_number,
           s.sale_disposition,
           sl.product_id,
           p.product_name,
           COALESCE(pc.is_bottled, false) AS is_bottled,
           sl.qty_kg,
           sl.qty_units,
           COALESCE(pct.code, ct.code, '') AS customer_type_code,
           COALESCE(pct.name, ct.name, '') AS customer_type_name
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
      AND s.date_issued >= ${fromIso}
      AND s.date_issued <= ${toIso}
      AND (${salesPointId}::int IS NULL OR s.sales_point_id = ${salesPointId})
      AND (${productId}::int IS NULL OR sl.product_id = ${productId})
    ORDER BY p.product_name ASC, s.sold_at ASC, s.created_at ASC, s.id ASC, sl.id ASC
  `;

  return rows.map((row) => ({
    saleId: String(row.sale_id),
    soldAt: row.sold_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    customerName: String(row.customer_name ?? ""),
    deliveryOrderNo: row.delivery_order_no
      ? String(row.delivery_order_no)
      : null,
    dateIssued: String(row.date_issued).slice(0, 10),
    vehicleNumber: String(row.vehicle_number ?? ""),
    saleDisposition: row.sale_disposition,
    productId: row.product_id,
    productName: String(row.product_name),
    isBottled: row.is_bottled ? 1 : 0,
    qtyKg: parseQty(row.qty_kg),
    qtyUnits: row.qty_units ? parseQty(row.qty_units) : null,
    customerTypeCode: String(row.customer_type_code ?? ""),
    customerTypeName: String(row.customer_type_name ?? ""),
  }));
}

export async function loadTransferOutQtyByDate(
  fromIso: string,
  toIso: string,
  salesPointId: number | null,
  productId: number | null,
): Promise<TransferQtyByDate[]> {
  const rows = await prisma.$queryRaw<
    Array<{ xfer_date: string; qty_kg: number }>
  >`
    SELECT left(COALESCE(t.dispatched_at, t.received_at)::text, 10) AS xfer_date,
           SUM(CAST(tl.qty AS DOUBLE PRECISION)) AS qty_kg
    FROM stock_transfers t
    INNER JOIN stock_transfer_lines tl ON tl.transfer_id = t.id
    WHERE t.status IN ('DISPATCHED', 'RECEIVED')
      AND t.from_sales_point_id != t.to_sales_point_id
      AND left(COALESCE(t.dispatched_at, t.received_at)::text, 10) >= ${fromIso}
      AND left(COALESCE(t.dispatched_at, t.received_at)::text, 10) <= ${toIso}
      AND (${salesPointId}::int IS NULL OR t.from_sales_point_id = ${salesPointId})
      AND (${productId}::int IS NULL OR tl.product_id = ${productId})
    GROUP BY xfer_date
    HAVING left(COALESCE(t.dispatched_at, t.received_at)::text, 10) IS NOT NULL
       AND left(COALESCE(t.dispatched_at, t.received_at)::text, 10) != ''
  `;

  return rows.map((row) => ({
    xferDate: String(row.xfer_date),
    qtyKg: parseQty(row.qty_kg),
  }));
}
