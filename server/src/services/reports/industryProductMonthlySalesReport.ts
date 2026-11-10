/**
 * Ports src/electron/reports/industryProductMonthlySalesReport.ts
 */
import { prisma } from "../../db/prisma.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
} from "../reportCompany.js";
import {
  isLooseLpoReportProduct,
  parseQty,
  reportScopedSalesPointId,
  sum,
} from "./reportShared.js";
import { resolveOpenPeriodReportContext } from "./openPeriodReportContext.js";

const ROUTE_ID = "industry-product-monthly-sales-report";

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const;

type Cell = { tons: number; value: number };

function emptyCell(): Cell {
  return { tons: 0, value: 0 };
}

function emptyMonthCells(): Cell[] {
  return Array.from({ length: 12 }, () => emptyCell());
}

function kgToTons(kg: number): number {
  return kg / 1000;
}

function addCell(target: Cell, tons: number, value: number): void {
  target.tons += tons;
  target.value += value;
}

function sumCells(cells: Cell[]): Cell {
  return {
    tons: sum(cells.map((cell) => cell.tons)),
    value: sum(cells.map((cell) => cell.value)),
  };
}

function isIndustryCustomer(
  saleDisposition: string | null,
  customerTypeCode: string,
  customerTypeName: string,
): boolean {
  if (saleDisposition === "RATION") return false;
  const text = `${customerTypeCode} ${customerTypeName}`.toUpperCase();
  return text.includes("INDUSTR");
}

function monthIndexFromIso(iso: string): number {
  return Number.parseInt(iso.slice(5, 7), 10) - 1;
}

function buildMonthColumns(
  financialYear: number,
  fromMonth: number,
  toMonth: number,
) {
  const columns: Array<{ month: number; label: string }> = [];
  for (let month = fromMonth; month <= toMonth; month += 1) {
    columns.push({
      month,
      label: `${MONTH_NAMES[month - 1]}, ${financialYear}`,
    });
  }
  return columns;
}

export async function getIndustryProductMonthlySalesReport(
  userId?: string | null,
) {
  const { asAtIso, period } = await resolveOpenPeriodReportContext(userId);
  const financialYear = period.financialYear;
  const yearFromIso = `${financialYear}-01-01`;
  const yearToIso = `${financialYear}-12-31`;
  const [settings, comments, scopedSalesPointId] = await Promise.all([
    loadReportCompanySettings(userId, asAtIso),
    loadReportComments(ROUTE_ID),
    reportScopedSalesPointId(userId),
  ]);

  const rows = await prisma.$queryRaw<
    Array<{
      date_issued: string;
      sale_disposition: string | null;
      customer_type_code: string | null;
      customer_type_name: string | null;
      product_id: number;
      product_name: string;
      product_code: string | null;
      is_bottled: boolean | null;
      qty_kg: string;
      line_net: string;
    }>
  >`
    SELECT s.date_issued, s.sale_disposition,
           COALESCE(ct.code, '') AS customer_type_code,
           COALESCE(ct.name, '') AS customer_type_name,
           sl.product_id, p.product_name, p.product_code,
           COALESCE(pc.is_bottled, false) AS is_bottled,
           sl.qty_kg, sl.line_net
    FROM sales s
    INNER JOIN sale_lines sl ON sl.sale_id = s.id
    INNER JOIN products p ON p.product_id = sl.product_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN customer_type_definitions ct ON ct.id = c.customer_type_id
    WHERE s.status = 'VALIDATED'
      AND s.date_issued >= ${yearFromIso}
      AND s.date_issued <= ${yearToIso}
      AND (${scopedSalesPointId}::int IS NULL OR s.sales_point_id = ${scopedSalesPointId})
  `;

  const lines = rows
    .map((row) => ({
      dateIssued: String(row.date_issued).slice(0, 10),
      saleDisposition: row.sale_disposition,
      customerTypeCode: String(row.customer_type_code ?? ""),
      customerTypeName: String(row.customer_type_name ?? ""),
      productId: row.product_id,
      productName: String(row.product_name),
      productCode: row.product_code,
      isBottled: row.is_bottled ? 1 : 0,
      qtyKg: parseQty(row.qty_kg),
      lineNet: parseQty(row.line_net),
    }))
    .filter(
      (line) =>
        line.dateIssued <= asAtIso &&
        line.isBottled !== 1 &&
        !isLooseLpoReportProduct({
          productCode: line.productCode,
          productName: line.productName,
          isBottled: line.isBottled,
        }) &&
        isIndustryCustomer(
          line.saleDisposition,
          line.customerTypeCode,
          line.customerTypeName,
        ),
    );

  const productMap = new Map<number, string>();
  for (const line of lines) {
    if (!productMap.has(line.productId)) {
      productMap.set(line.productId, line.productName);
    }
  }

  const products = [...productMap.entries()]
    .map(([productId, productName]) => ({ productId, productName }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  const sections = products.map((product) => {
    const months = emptyMonthCells();
    for (const line of lines) {
      if (line.productId !== product.productId) continue;
      const monthIndex = monthIndexFromIso(line.dateIssued);
      if (monthIndex < 0 || monthIndex > 11) continue;
      addCell(months[monthIndex], kgToTons(line.qtyKg), line.lineNet);
    }
    const ytd = sumCells(months);
    return {
      productId: product.productId,
      productName: product.productName,
      sectionTitle: `${product.productName.toUpperCase()} MONTHLY SALES FOR ${financialYear} ( IN TONS AND '000FRS ) TAXES EXCLUDED.`,
      productRow: {
        id: String(product.productId),
        label: product.productName.toUpperCase(),
        kind: "data" as const,
        months,
        ytd,
      },
    };
  });

  const grandMonths = Array.from({ length: 12 }, (_, monthIndex) => ({
    tons: sum(
      sections.map((section) => section.productRow.months[monthIndex].tons),
    ),
    value: sum(
      sections.map((section) => section.productRow.months[monthIndex].value),
    ),
  }));

  const monthName = period.monthName.toUpperCase();
  return {
    settings,
    asAtIso,
    monthName: period.monthName,
    financialYear,
    reportTitle: `MONTHLY INDUSTRY SALES FOR OTHER PRODUCTS FOR ${monthName} ${financialYear} (IN TONS AND '000 FRS) TAXES EXCLUDED`,
    customerCategoryLabel: "INDUSTRY",
    generatedAtIso: nowIso(),
    monthColumnsH1: buildMonthColumns(financialYear, 1, 6),
    monthColumnsH2: buildMonthColumns(financialYear, 7, 12),
    sections,
    grandTotalRow: {
      id: "grandTotal",
      label: "GRAND TOTAL",
      kind: "total" as const,
      months: grandMonths,
      ytd: sumCells(grandMonths),
    },
    comments,
  };
}
