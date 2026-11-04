import { isLooseLpoReportProduct } from "../../shared/looseLpoProduct.js";
import { getDatabase } from "../db/index.js";
import {
  PALM_OIL_KG_PER_LITRE,
  detectBottledPack,
  parseQty,
  salesPointFilterSql,
  type ProductRow,
} from "./shared.js";

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

export type MonthlyPalmOilDestinationId = (typeof LPO_DESTINATION_ROWS)[number]["id"];

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

  const text = `${customerName} ${customerTypeCode} ${customerTypeName}`.toUpperCase();
  if (text.includes("MAKOKO")) {
    return "makoko";
  }
  if (text.includes("STAFF") || text.includes("WORKER") || text.includes("RATION")) {
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

export function loadPalmOilSaleLines(
  yearFromIso: string,
  yearToIso: string,
  salesPointId?: number | null,
): PalmOilSaleLineRecord[] {
  const sp = salesPointFilterSql("s.salesPointId", salesPointId);
  return getDatabase()
    .prepare(
      `SELECT s.dateIssued, s.saleDisposition,
              COALESCE(c.name, '') AS customerName,
              COALESCE(pct.code, ct.code, '') AS customerTypeCode,
              COALESCE(pct.name, ct.name, '') AS customerTypeName,
              sl.productId, p.productName, p.productCode,
              COALESCE(pc.isBottled, 0) AS isBottled,
              sl.qtyKg, sl.qtyUnits, sl.lineNet
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
         AND s.dateIssued >= ?
         AND s.dateIssued <= ?${sp.clause}`,
    )
    .all(yearFromIso, yearToIso, ...sp.params)
    .map((row) => {
      const productName = String((row as { productName: string }).productName);
      const productCode = (row as { productCode: string | null }).productCode;
      const isBottled = (row as { isBottled: number }).isBottled;
      return {
      dateIssued: String((row as { dateIssued: string }).dateIssued).slice(0, 10),
      saleDisposition: (row as { saleDisposition: string | null }).saleDisposition,
      customerName: String((row as { customerName: string }).customerName ?? ""),
      customerTypeCode: String((row as { customerTypeCode: string }).customerTypeCode ?? ""),
      customerTypeName: String((row as { customerTypeName: string }).customerTypeName ?? ""),
      productId: (row as { productId: number }).productId,
      productName,
      productCode,
      isLooseLpo: isLooseLpoReportProduct({ productCode, productName, isBottled }),
      isBottled,
      qtyKg: parseQty((row as { qtyKg: string }).qtyKg),
      qtyUnits: (row as { qtyUnits: string | null }).qtyUnits
        ? parseQty((row as { qtyUnits: string }).qtyUnits)
        : null,
      lineNet: parseQty((row as { lineNet: string }).lineNet),
    };
    });
}

export function palmOilLineKg(line: PalmOilSaleLineRecord, products: ProductRow[]): number {
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

export function loadBudgetUnitPricePerKg(
  financialYear: number,
  productCatId: number,
): number | null {
  const row = getDatabase()
    .prepare(
      `SELECT budgetUnitPricePerKg
       FROM ProductSalesBudget
       WHERE financialYear = ?
         AND productCatId = ?
       LIMIT 1`,
    )
    .get(financialYear, productCatId) as { budgetUnitPricePerKg: string } | undefined;

  if (!row) {
    return null;
  }
  const price = parseQty(row.budgetUnitPricePerKg);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function loadMainAndBottledCategoryIds(): {
  mainProductCatId: number | null;
  bottledProductCatId: number | null;
} {
  const rows = getDatabase()
    .prepare(
      `SELECT productCatId, COALESCE(isMain, 0) AS isMain, COALESCE(isBottled, 0) AS isBottled
       FROM ProductCat`,
    )
    .all() as Array<{ productCatId: number; isMain: number; isBottled: number }>;

  const main = rows.find((row) => row.isMain === 1);
  const bottled = rows.find((row) => row.isBottled === 1 && row.isMain !== 1);
  return {
    mainProductCatId: main?.productCatId ?? null,
    bottledProductCatId: bottled?.productCatId ?? main?.productCatId ?? null,
  };
}
