import { getDatabase } from "../db/index.js";
import { parseQty } from "./shared.js";

export const DAILY_SALES_SUMMARY_ROWS = [
  { id: "industries", label: "INDUSTRIES" },
  { id: "wholesales", label: "WHOLE SALE" },
  { id: "retail", label: "RETAIL" },
  { id: "cdcWorkers", label: "CDC WORKERS" },
  { id: "proSamples", label: "PRO/SAMPLES" },
] as const;

export type DailyCustomerCategory = (typeof DAILY_SALES_SUMMARY_ROWS)[number]["id"];

export type DailySalesMatrixSaleCategory =
  | "industry"
  | "wholeSale"
  | "retail"
  | "cdcWorker"
  | "staff";

export interface RawDailySaleLine {
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
}

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

export function lineQuantity(line: Pick<RawDailySaleLine, "isBottled" | "qtyKg" | "qtyUnits">): number {
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

export function loadRawSaleLinesForRange(
  fromIso: string,
  toIso: string,
  salesPointId: number | null,
  productId: number | null,
): RawDailySaleLine[] {
  const params: Array<string | number> = [fromIso, toIso];
  let salesPointClause = "";
  let productClause = "";

  if (salesPointId != null && Number.isFinite(salesPointId)) {
    salesPointClause = " AND s.salesPointId = ?";
    params.push(salesPointId);
  }
  if (productId != null && Number.isFinite(productId)) {
    productClause = " AND sl.productId = ?";
    params.push(productId);
  }

  return getDatabase()
    .prepare(
      `SELECT s.id AS saleId, s.soldAt, s.createdAt,
              s.customerNameSnapshot AS customerName, s.deliveryOrderNo, s.dateIssued,
              s.vehicleNumber, s.saleDisposition,
              sl.productId, p.productName,
              COALESCE(pc.isBottled, 0) AS isBottled,
              sl.qtyKg, sl.qtyUnits,
              COALESCE(pct.code, ct.code) AS customerTypeCode,
              COALESCE(pct.name, ct.name) AS customerTypeName
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       INNER JOIN Product p ON p.productId = sl.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       LEFT JOIN Customer c ON c.id = s.customerId
       LEFT JOIN CustomerTypeDefinition ct ON ct.id = c.customerTypeId
       LEFT JOIN DeliveryOrder d
         ON d.deliveryOrderNo = s.deliveryOrderNo
        AND d.status = 'VALIDATED'
       LEFT JOIN DeliveryOrderDetails dd
         ON dd.deliveryOrderId = d.id
        AND dd.productId = sl.productId
       LEFT JOIN CustomerTypeDefinition pct ON pct.id = dd.pricingCustomerTypeId
       WHERE s.status = 'VALIDATED'
         AND substr(s.dateIssued, 1, 10) >= ?
         AND substr(s.dateIssued, 1, 10) <= ?
         ${salesPointClause}
         ${productClause}
       ORDER BY p.productName ASC, s.soldAt ASC, s.createdAt ASC, s.id ASC, sl.id ASC`,
    )
    .all(...params)
    .map((row) => ({
      saleId: String((row as { saleId: string }).saleId),
      soldAt: String((row as { soldAt: string }).soldAt),
      createdAt: String((row as { createdAt: string }).createdAt),
      customerName: String((row as { customerName: string }).customerName),
      deliveryOrderNo: (row as { deliveryOrderNo: string | null }).deliveryOrderNo
        ? String((row as { deliveryOrderNo: string }).deliveryOrderNo)
        : null,
      dateIssued: String((row as { dateIssued: string }).dateIssued),
      vehicleNumber: String((row as { vehicleNumber: string }).vehicleNumber),
      saleDisposition: (row as { saleDisposition: string | null }).saleDisposition,
      productId: (row as { productId: number }).productId,
      productName: String((row as { productName: string }).productName),
      isBottled: (row as { isBottled: number }).isBottled,
      qtyKg: parseQty((row as { qtyKg: string }).qtyKg),
      qtyUnits: (row as { qtyUnits: string | null }).qtyUnits
        ? parseQty((row as { qtyUnits: string }).qtyUnits)
        : null,
      customerTypeCode: String(
        (row as { customerTypeCode: string | null }).customerTypeCode ?? "",
      ),
      customerTypeName: String(
        (row as { customerTypeName: string | null }).customerTypeName ?? "",
      ),
    }));
}

export interface TransferQtyByDate {
  xferDate: string;
  qtyKg: number;
}

export function loadTransferOutQtyByDate(
  fromIso: string,
  toIso: string,
  salesPointId: number | null,
  productId: number | null,
): TransferQtyByDate[] {
  const params: Array<string | number> = [fromIso, toIso];
  let salesPointClause = "";
  let productClause = "";

  if (salesPointId != null && Number.isFinite(salesPointId)) {
    salesPointClause = " AND t.fromSalesPointId = ?";
    params.push(salesPointId);
  }
  if (productId != null && Number.isFinite(productId)) {
    productClause = " AND tl.productId = ?";
    params.push(productId);
  }

  return getDatabase()
    .prepare(
      `SELECT substr(COALESCE(t.dispatchedAt, t.receivedAt), 1, 10) AS xferDate,
              SUM(CAST(tl.qty AS REAL)) AS qtyKg
       FROM StockTransfer t
       INNER JOIN StockTransferLine tl ON tl.transferId = t.id
       WHERE t.status IN ('DISPATCHED', 'RECEIVED')
         AND t.fromSalesPointId != t.toSalesPointId
         AND substr(COALESCE(t.dispatchedAt, t.receivedAt), 1, 10) >= ?
         AND substr(COALESCE(t.dispatchedAt, t.receivedAt), 1, 10) <= ?
         ${salesPointClause}
         ${productClause}
       GROUP BY xferDate
       HAVING xferDate IS NOT NULL AND xferDate != ''`,
    )
    .all(...params)
    .map((row) => ({
      xferDate: String((row as { xferDate: string }).xferDate),
      qtyKg: parseQty((row as { qtyKg: number }).qtyKg),
    }));
}
