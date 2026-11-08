import { isLooseLpoReportProduct } from "../../shared/looseLpoProduct.js";
import type {
  IndustryProductMonthlySalesCell,
  IndustryProductMonthlySalesMonthColumn,
  IndustryProductMonthlySalesReport,
  IndustryProductMonthlySalesRow,
  IndustryProductMonthlySalesSection,
} from "../../shared/reports.types.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import { getDatabase } from "../db/index.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "./companySettings.js";
import {
  nowIso,
  parseQty,
  reportScopedSalesPointId,
  salesPointFilterSql,
  sum,
} from "./shared.js";

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

interface SaleLineRecord {
  dateIssued: string;
  saleDisposition: string | null;
  customerTypeCode: string;
  customerTypeName: string;
  productId: number;
  productName: string;
  productCode: string | null;
  isBottled: number;
  qtyKg: number;
  lineNet: number;
}

function emptyCell(): IndustryProductMonthlySalesCell {
  return { tons: 0, value: 0 };
}

function emptyMonthCells(): IndustryProductMonthlySalesCell[] {
  return Array.from({ length: 12 }, () => emptyCell());
}

function kgToTons(kg: number): number {
  return kg / 1000;
}

function addCell(
  target: IndustryProductMonthlySalesCell,
  tons: number,
  value: number,
): void {
  target.tons += tons;
  target.value += value;
}

function sumCells(
  cells: IndustryProductMonthlySalesCell[],
): IndustryProductMonthlySalesCell {
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
  if (saleDisposition === "RATION") {
    return false;
  }
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
): IndustryProductMonthlySalesMonthColumn[] {
  const columns: IndustryProductMonthlySalesMonthColumn[] = [];
  for (let month = fromMonth; month <= toMonth; month += 1) {
    columns.push({
      month,
      label: `${MONTH_NAMES[month - 1]}, ${financialYear}`,
    });
  }
  return columns;
}

function loadSaleLines(
  yearFromIso: string,
  yearToIso: string,
  salesPointId?: number | null,
): SaleLineRecord[] {
  const sp = salesPointFilterSql("s.salesPointId", salesPointId);
  return getDatabase()
    .prepare(
      `SELECT s.dateIssued, s.saleDisposition,
              COALESCE(ct.code, '') AS customerTypeCode,
              COALESCE(ct.name, '') AS customerTypeName,
              sl.productId, p.productName, p.productCode,
              COALESCE(pc.isBottled, 0) AS isBottled,
              sl.qtyKg, sl.lineNet
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       INNER JOIN Product p ON p.productId = sl.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       LEFT JOIN Customer c ON c.id = s.customerId
       LEFT JOIN CustomerTypeDefinition ct ON ct.id = c.customerTypeId
       WHERE s.status = 'VALIDATED'
         AND s.dateIssued >= ?
         AND s.dateIssued <= ?${sp.clause}`,
    )
    .all(yearFromIso, yearToIso, ...sp.params)
    .map((row) => ({
      dateIssued: String((row as { dateIssued: string }).dateIssued).slice(0, 10),
      saleDisposition: (row as { saleDisposition: string | null }).saleDisposition,
      customerTypeCode: String(
        (row as { customerTypeCode: string }).customerTypeCode ?? "",
      ),
      customerTypeName: String(
        (row as { customerTypeName: string }).customerTypeName ?? "",
      ),
      productId: (row as { productId: number }).productId,
      productName: String((row as { productName: string }).productName),
      productCode: (row as { productCode: string | null }).productCode,
      isBottled: (row as { isBottled: number }).isBottled,
      qtyKg: parseQty((row as { qtyKg: string }).qtyKg),
      lineNet: parseQty((row as { lineNet: string }).lineNet),
    }));
}

export function getIndustryProductMonthlySalesReport(
  userId?: string,
): IndustryProductMonthlySalesReport {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const financialYear = period.financialYear;
  const yearFromIso = `${financialYear}-01-01`;
  const yearToIso = `${financialYear}-12-31`;
  const settings = loadReportCompanySettings(userId, asAtIso);
  const comments = loadReportComments(ROUTE_ID);
  const scopedSalesPointId = reportScopedSalesPointId(userId);

  const lines = loadSaleLines(yearFromIso, yearToIso, scopedSalesPointId).filter(
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

  const sections: IndustryProductMonthlySalesSection[] = products.map(
    (product) => {
      const months = emptyMonthCells();

      for (const line of lines) {
        if (line.productId !== product.productId) {
          continue;
        }
        const monthIndex = monthIndexFromIso(line.dateIssued);
        if (monthIndex < 0 || monthIndex > 11) {
          continue;
        }
        addCell(
          months[monthIndex],
          kgToTons(line.qtyKg),
          line.lineNet,
        );
      }

      const ytd = sumCells(months);
      const productRow: IndustryProductMonthlySalesRow = {
        id: String(product.productId),
        label: product.productName.toUpperCase(),
        kind: "data",
        months,
        ytd,
      };

      return {
        productId: product.productId,
        productName: product.productName,
        sectionTitle: `${product.productName.toUpperCase()} MONTHLY SALES FOR ${financialYear} ( IN TONS AND '000FRS ) TAXES EXCLUDED.`,
        productRow,
      };
    },
  );

  const grandMonths = Array.from({ length: 12 }, (_, monthIndex) => ({
    tons: sum(sections.map((section) => section.productRow.months[monthIndex].tons)),
    value: sum(sections.map((section) => section.productRow.months[monthIndex].value)),
  }));
  const grandTotalRow: IndustryProductMonthlySalesRow = {
    id: "grandTotal",
    label: "GRAND TOTAL",
    kind: "total",
    months: grandMonths,
    ytd: sumCells(grandMonths),
  };

  const monthName = period.monthName.toUpperCase();
  const reportTitle = `MONTHLY INDUSTRY SALES FOR OTHER PRODUCTS FOR ${monthName} ${financialYear} (IN TONS AND '000 FRS) TAXES EXCLUDED`;

  return {
    settings,
    asAtIso,
    monthName: period.monthName,
    financialYear,
    reportTitle,
    customerCategoryLabel: "INDUSTRY",
    generatedAtIso: nowIso(),
    monthColumnsH1: buildMonthColumns(financialYear, 1, 6),
    monthColumnsH2: buildMonthColumns(financialYear, 7, 12),
    sections,
    grandTotalRow,
    comments,
  };
}
