import type { LooseLpoStockSummaryReport } from "../../shared/reports.types.js";
import { formatDisplayDate } from "../../shared/formatDisplayDate.js";
import { calendarMonthToFiscal } from "../../shared/salesBudgetPhase.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import {
  computeCompanyLpoIssuesTotal,
  computeCompanyLpoOpening,
  computeCompanyLpoReceptionTotal,
  loadFiscalYearStartIso,
  loadFiscalYearStartMonth,
  loadLpoReceiptLines,
  loadLpoSaleLines,
} from "./looseLpoReconciliationMetrics.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "./companySettings.js";
import {
  loadProducts,
  loadSalesPointsForUser,
  nowIso,
  reportScopedSalesPointId,
} from "./shared.js";
import type {
  LooseLpoStockSummaryColumnPair,
  LooseLpoStockSummaryRow,
} from "../../shared/reports.types.js";

const ROUTE_ID = "loose-lpo-stock-summary-report";

function pair(
  thisMonth: number,
  toDate: number,
): LooseLpoStockSummaryColumnPair {
  return { thisMonth, toDate };
}

function blankPair(): LooseLpoStockSummaryColumnPair {
  return { thisMonth: null, toDate: null };
}

function makeSummaryRow(
  id: string,
  label: string,
  kind: LooseLpoStockSummaryRow["kind"],
  values: LooseLpoStockSummaryColumnPair,
): LooseLpoStockSummaryRow {
  return { id, label, kind, values };
}

function resolveCalendarYear(
  financialYear: number,
  calendarMonth: number,
  fyStartMonth: number,
): number {
  return calendarMonth >= fyStartMonth ? financialYear : financialYear + 1;
}

export function getLooseLpoStockSummaryReport(
  userId?: string | null,
): LooseLpoStockSummaryReport {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const settings = loadReportCompanySettings(userId, asAtIso);
  const salesPoints = loadSalesPointsForUser(userId);
  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const products = loadProducts();
  const monthStartIso = period.startDate;
  const monthLabel =
    `${period.monthName} ${period.financialYear}`.toUpperCase();
  const reportTitle = `STOCK SUMMARY FOR ${monthLabel} (IN KGS)`;

  const fyStartIso = loadFiscalYearStartIso(period.financialYearPeriodId);
  const fyStartMonth = loadFiscalYearStartMonth();
  const calendarYear = resolveCalendarYear(
    period.financialYear,
    period.calendarMonth,
    fyStartMonth,
  );
  const monthIndexInFy = calendarMonthToFiscal(
    calendarYear,
    period.calendarMonth,
    fyStartMonth,
  ).financialMonth;
  const toDateColumnLabel = `TO DATE ${monthIndexInFy} MONTH`;

  const monthSaleLines = loadLpoSaleLines(monthStartIso, asAtIso, scopedSalesPointId);
  const monthReceiptLines = loadLpoReceiptLines(
    monthStartIso,
    asAtIso,
    scopedSalesPointId,
  );
  const ytdSaleLines = loadLpoSaleLines(fyStartIso, asAtIso, scopedSalesPointId);
  const ytdReceiptLines = loadLpoReceiptLines(fyStartIso, asAtIso, scopedSalesPointId);

  const openingThisMonth = computeCompanyLpoOpening(
    salesPoints,
    products,
    monthStartIso,
    asAtIso,
  );
  const openingToDate = computeCompanyLpoOpening(
    salesPoints,
    products,
    fyStartIso,
    asAtIso,
  );

  const receptionThisMonth = computeCompanyLpoReceptionTotal(monthReceiptLines);
  const receptionToDate = computeCompanyLpoReceptionTotal(ytdReceiptLines);

  const totalStockThisMonth = openingThisMonth + receptionThisMonth;
  const totalStockToDate = openingToDate + receptionToDate;

  const issuesThisMonth = computeCompanyLpoIssuesTotal(monthSaleLines);
  const issuesToDate = computeCompanyLpoIssuesTotal(ytdSaleLines);

  const calculatedThisMonth = totalStockThisMonth - issuesThisMonth;
  const calculatedToDate = totalStockToDate - issuesToDate;

  const rows: LooseLpoStockSummaryRow[] = [
    makeSummaryRow(
      "opening",
      `OPENING STOCK AS AT ${formatDisplayDate(monthStartIso)}`,
      "data",
      pair(openingThisMonth, openingToDate),
    ),
    makeSummaryRow(
      "reception",
      "ADD RECEPTION",
      "data",
      pair(receptionThisMonth, receptionToDate),
    ),
    makeSummaryRow(
      "total-stock",
      "TOTAL STOCK",
      "subtotal",
      pair(totalStockThisMonth, totalStockToDate),
    ),
    makeSummaryRow(
      "issues",
      "LESS ISSUES TO CUSTOMERS",
      "data",
      pair(issuesThisMonth, issuesToDate),
    ),
    makeSummaryRow(
      "calculated",
      "CALCULATED STOCK",
      "subtotal",
      pair(calculatedThisMonth, calculatedToDate),
    ),
    makeSummaryRow(
      "physical",
      `PHYSICAL STOCK AS AT ${formatDisplayDate(asAtIso)}`,
      "blank",
      blankPair(),
    ),
    makeSummaryRow("variance", "STOCK VARIANCE", "blank", blankPair()),
    makeSummaryRow("variance-pct", "% VARIANCE", "blank", blankPair()),
  ];

  return {
    settings,
    asAtIso,
    monthStartIso,
    monthLabel,
    monthIndexInFy,
    toDateColumnLabel,
    reportTitle,
    rows,
    comments: loadReportComments(ROUTE_ID),
    generatedAtIso: nowIso(),
  };
}
