import { getOpenPostingPeriod } from "../financialYearsService.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  resolveReportAsAt,
} from "../reportCompany.js";
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
  formatDisplayDate,
  loadProducts,
  loadSalesPointsForUser,
  reportScopedSalesPointId,
} from "./reportShared.js";

const ROUTE_ID = "loose-lpo-stock-summary-report";

type ColumnPair = { thisMonth: number | null; toDate: number | null };
type SummaryRow = {
  id: string;
  label: string;
  kind: "data" | "subtotal" | "blank";
  values: ColumnPair;
};

function pair(thisMonth: number, toDate: number): ColumnPair {
  return { thisMonth, toDate };
}

function blankPair(): ColumnPair {
  return { thisMonth: null, toDate: null };
}

function makeSummaryRow(
  id: string,
  label: string,
  kind: SummaryRow["kind"],
  values: ColumnPair,
): SummaryRow {
  return { id, label, kind, values };
}

function resolveCalendarYear(
  financialYear: number,
  calendarMonth: number,
  fyStartMonth: number,
): number {
  return calendarMonth >= fyStartMonth ? financialYear : financialYear + 1;
}

function calendarMonthToFiscal(
  calendarYear: number,
  calendarMonth: number,
  fyStartMonth: number,
): { financialMonth: number } {
  if (calendarMonth >= fyStartMonth) {
    return { financialMonth: calendarMonth - fyStartMonth + 1 };
  }
  return { financialMonth: calendarMonth + 12 - fyStartMonth + 1 };
}

export async function getLooseLpoStockSummaryReport(userId: string) {
  const asAtIso = await resolveReportAsAt();
  const period = await getOpenPostingPeriod();
  if (!period) {
    throw new Error("No open posting period. Open a financial month first.");
  }

  const [settings, salesPoints, scopedSalesPointId, products, comments] =
    await Promise.all([
      loadReportCompanySettings(userId, asAtIso),
      loadSalesPointsForUser(userId),
      reportScopedSalesPointId(userId),
      loadProducts(),
      loadReportComments(ROUTE_ID),
    ]);

  const monthStartIso = period.startDate;
  const monthLabel =
    `${period.monthName} ${period.financialYear}`.toUpperCase();
  const reportTitle = `STOCK SUMMARY FOR ${monthLabel} (IN KGS)`;

  const [fyStartIso, fyStartMonth] = await Promise.all([
    loadFiscalYearStartIso(period.financialYearPeriodId),
    loadFiscalYearStartMonth(),
  ]);
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

  const [
    monthSaleLines,
    monthReceiptLines,
    ytdSaleLines,
    ytdReceiptLines,
    openingThisMonth,
    openingToDate,
  ] = await Promise.all([
    loadLpoSaleLines(monthStartIso, asAtIso, scopedSalesPointId),
    loadLpoReceiptLines(monthStartIso, asAtIso, scopedSalesPointId),
    loadLpoSaleLines(fyStartIso, asAtIso, scopedSalesPointId),
    loadLpoReceiptLines(fyStartIso, asAtIso, scopedSalesPointId),
    computeCompanyLpoOpening(salesPoints, products, monthStartIso, asAtIso),
    computeCompanyLpoOpening(salesPoints, products, fyStartIso, asAtIso),
  ]);

  const receptionThisMonth = computeCompanyLpoReceptionTotal(monthReceiptLines);
  const receptionToDate = computeCompanyLpoReceptionTotal(ytdReceiptLines);
  const totalStockThisMonth = openingThisMonth + receptionThisMonth;
  const totalStockToDate = openingToDate + receptionToDate;
  const issuesThisMonth = computeCompanyLpoIssuesTotal(monthSaleLines);
  const issuesToDate = computeCompanyLpoIssuesTotal(ytdSaleLines);
  const calculatedThisMonth = totalStockThisMonth - issuesThisMonth;
  const calculatedToDate = totalStockToDate - issuesToDate;

  const rows: SummaryRow[] = [
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
    comments,
    generatedAtIso: nowIso(),
  };
}
