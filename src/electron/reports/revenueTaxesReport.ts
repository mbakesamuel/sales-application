import type {
  RevenueTaxesBucketRow,
  RevenueTaxesPeriod,
  RevenueTaxesReport,
  RevenueTaxesSalesPointOption,
  RevenueTaxesTotals,
} from "../../shared/reports.types.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import { getDatabase } from "../db/index.js";
import { parseAmount } from "../sales/money.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "./companySettings.js";
import {
  loadSalesPointsForUser,
  nowIso,
  reportScopedSalesPointId,
  resolveReportSalesPointId,
} from "./shared.js";

const ROUTE_ID = "revenue-taxes-report";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

interface SaleMoneyRow {
  dateIso: string;
  salesPointId: number | null;
  salesPointName: string;
  netAmount: number;
  vatAmount: number;
  salesTaxAmount: number;
  grossAmount: number;
}

function emptyTotals(): RevenueTaxesTotals {
  return {
    invoiceCount: 0,
    netAmount: 0,
    vatAmount: 0,
    salesTaxAmount: 0,
    grossAmount: 0,
  };
}

function addToTotals(target: RevenueTaxesTotals, row: SaleMoneyRow): void {
  target.invoiceCount += 1;
  target.netAmount += row.netAmount;
  target.vatAmount += row.vatAmount;
  target.salesTaxAmount += row.salesTaxAmount;
  target.grossAmount += row.grossAmount;
}

function loadSaleMoneyRows(
  fromIso: string,
  toIso: string,
  salesPointId: number | null,
): SaleMoneyRow[] {
  const params: Array<string | number> = [fromIso, toIso];
  let salesPointClause = "";
  if (salesPointId != null && Number.isFinite(salesPointId)) {
    salesPointClause = " AND s.salesPointId = ?";
    params.push(salesPointId);
  }

  const rows = getDatabase()
    .prepare(
      `SELECT substr(s.dateIssued, 1, 10) AS dateIso,
              s.salesPointId,
              COALESCE(sp.name, 'Unassigned') AS salesPointName,
              CAST(s.netAmount AS REAL) AS netAmount,
              CAST(s.vatAmount AS REAL) AS vatAmount,
              CAST(s.grossAmount AS REAL) AS grossAmount,
              COALESCE(st.salesTaxAmount, 0) AS salesTaxAmount
       FROM Sale s
       LEFT JOIN SalesPoint sp ON sp.id = s.salesPointId
       LEFT JOIN (
         SELECT saleId, SUM(CAST(amount AS REAL)) AS salesTaxAmount
         FROM SaleAppliedTax
         WHERE codeSnapshot = 'SALES_TAX'
         GROUP BY saleId
       ) st ON st.saleId = s.id
       WHERE s.status = 'VALIDATED'
         AND substr(s.dateIssued, 1, 10) >= ?
         AND substr(s.dateIssued, 1, 10) <= ?
         ${salesPointClause}
       ORDER BY dateIso ASC, s.invoiceNo ASC`,
    )
    .all(...params) as Array<{
    dateIso: string;
    salesPointId: number | null;
    salesPointName: string;
    netAmount: number;
    vatAmount: number;
    grossAmount: number;
    salesTaxAmount: number;
  }>;

  return rows.map((row) => ({
    dateIso: String(row.dateIso).slice(0, 10),
    salesPointId: row.salesPointId == null ? null : Number(row.salesPointId),
    salesPointName: String(row.salesPointName),
    netAmount: Number.isFinite(row.netAmount)
      ? row.netAmount
      : parseAmount(String(row.netAmount)),
    vatAmount: Number.isFinite(row.vatAmount)
      ? row.vatAmount
      : parseAmount(String(row.vatAmount)),
    salesTaxAmount: Number.isFinite(row.salesTaxAmount)
      ? row.salesTaxAmount
      : parseAmount(String(row.salesTaxAmount)),
    grossAmount: Number.isFinite(row.grossAmount)
      ? row.grossAmount
      : parseAmount(String(row.grossAmount)),
  }));
}

function bucketKeyForPeriod(period: RevenueTaxesPeriod, dateIso: string): string {
  if (period === "year") {
    return dateIso.slice(0, 7);
  }
  return dateIso;
}

function bucketLabelForPeriod(period: RevenueTaxesPeriod, key: string): string {
  if (period === "year") {
    const month = Number.parseInt(key.slice(5, 7), 10);
    const year = key.slice(0, 4);
    if (month >= 1 && month <= 12) {
      return `${MONTH_NAMES[month - 1]} ${year}`;
    }
  }
  return key;
}

function aggregateByPeriod(
  period: RevenueTaxesPeriod,
  rows: SaleMoneyRow[],
): RevenueTaxesBucketRow[] {
  const map = new Map<string, RevenueTaxesBucketRow>();

  for (const row of rows) {
    const key = bucketKeyForPeriod(period, row.dateIso);
    const existing = map.get(key);
    if (existing) {
      existing.invoiceCount += 1;
      existing.netAmount += row.netAmount;
      existing.vatAmount += row.vatAmount;
      existing.salesTaxAmount += row.salesTaxAmount;
      existing.grossAmount += row.grossAmount;
      continue;
    }
    map.set(key, {
      key,
      label: bucketLabelForPeriod(period, key),
      invoiceCount: 1,
      netAmount: row.netAmount,
      vatAmount: row.vatAmount,
      salesTaxAmount: row.salesTaxAmount,
      grossAmount: row.grossAmount,
    });
  }

  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function aggregateBySalesPoint(rows: SaleMoneyRow[]): RevenueTaxesBucketRow[] {
  const map = new Map<string, RevenueTaxesBucketRow>();

  for (const row of rows) {
    const key =
      row.salesPointId == null ? "none" : String(row.salesPointId);
    const existing = map.get(key);
    if (existing) {
      existing.invoiceCount += 1;
      existing.netAmount += row.netAmount;
      existing.vatAmount += row.vatAmount;
      existing.salesTaxAmount += row.salesTaxAmount;
      existing.grossAmount += row.grossAmount;
      continue;
    }
    map.set(key, {
      key,
      label: row.salesPointName,
      invoiceCount: 1,
      netAmount: row.netAmount,
      vatAmount: row.vatAmount,
      salesTaxAmount: row.salesTaxAmount,
      grossAmount: row.grossAmount,
    });
  }

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function getRevenueTaxesReport(
  userId?: string,
  period: RevenueTaxesPeriod = "month",
  salesPointId?: number | null,
): RevenueTaxesReport {
  const { asAtIso, period: posting } = resolveReportAsAt(userId);
  const selectedPeriod: RevenueTaxesPeriod =
    period === "year" ? "year" : "month";
  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const selectedSalesPointId = resolveReportSalesPointId(userId, salesPointId);

  const fromIso =
    selectedPeriod === "year"
      ? `${posting.financialYear}-01-01`
      : posting.startDate;
  const toIso = asAtIso;

  const settings = loadReportCompanySettings(userId, asAtIso);
  const comments = loadReportComments(ROUTE_ID);
  const salesPointOptions: RevenueTaxesSalesPointOption[] = loadSalesPointsForUser(
    userId,
  ).map((point) => ({ id: point.id, name: point.name }));
  const salesPointLabel =
    selectedSalesPointId == null
      ? "All collection points"
      : (salesPointOptions.find((point) => point.id === selectedSalesPointId)
          ?.name ?? "Unknown collection point");

  const rows = loadSaleMoneyRows(fromIso, toIso, selectedSalesPointId);
  const totals = emptyTotals();
  for (const row of rows) {
    addToTotals(totals, row);
  }

  const periodLabel =
    selectedPeriod === "year"
      ? `FY ${posting.financialYear} through ${toIso}`
      : `${posting.monthName} ${posting.financialYear} (through ${toIso})`;

  const reportTitle = `REVENUE & TAXES — ${periodLabel.toUpperCase()}`;

  return {
    settings,
    asAtIso,
    period: selectedPeriod,
    periodLabel,
    fromIso,
    toIso,
    monthName: posting.monthName,
    financialYear: posting.financialYear,
    salesPointId: selectedSalesPointId,
    scopedSalesPointId,
    salesPointLabel,
    salesPointOptions,
    reportTitle,
    generatedAtIso: nowIso(),
    totals,
    byPeriod: aggregateByPeriod(selectedPeriod, rows),
    bySalesPoint: aggregateBySalesPoint(rows),
    comments,
  };
}
