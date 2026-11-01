import type {
  BottleOilStockSalesReport,
  BottledPalmOilSalesReturnReport,
  BottledWeeklyIssuesReport,
  CommitmentReport,
  DailySalesReport,
  IndustryProductMonthlySalesReport,
  MonthlyBottledOilReport,
  MonthlyDeliveriesByDestinationReport,
  MonthlyDeliveryReport,
  MonthlyPalmOilSalesReport,
  PalmOilSalesActivityReport,
  MonthlyPaymentDeliveryReport,
  MonthlyStockReconciliationMatrixRow,
  MonthlyStockReconciliationReport,
  LooseLpoStockSummaryReport,
  OtherProductSalesDeliveriesReport,
  RevenueTaxesReport,
  SalesBudgetMonthlyCrosstabReport,
  SalesBudgetMonthlyRevenueCrosstabReport,
  SalesBudgetWeeklyCrosstabReport,
  SalesBudgetWeeklyRevenueCrosstabReport,
  StockCommitmentReport,
  StockReport,
  WeeklyDeliveriesReport,
} from "../../shared/reports.types.ts";
import type { BinCardReport } from "../../shared/stock.types.ts";

export const HIDE_ZERO_ROWS_HINT =
  "Turn off Hide zero / empty quantity rows above to see zero-balance rows.";

const EPS = 0.0001;

function isNonZero(value: number | null | undefined): boolean {
  return value != null && Math.abs(value) > EPS;
}

function sumAbs(values: number[]): number {
  return values.reduce((total, value) => total + Math.abs(value), 0);
}

export function isStockReportEmpty(report: StockReport): boolean {
  return report.sections.length === 0;
}

export function isStockCommitmentReportEmpty(report: StockCommitmentReport): boolean {
  if (report.sections.length > 0) {
    return false;
  }
  if (!report.bottledSection) {
    return true;
  }
  return (
    report.bottledSection.totalUnits === 0 &&
    report.bottledSection.totalKgs === 0 &&
    sumAbs(report.bottledSection.unitCounts) === 0
  );
}

export function isCommitmentReportEmpty(report: CommitmentReport): boolean {
  if (report.sections.length === 0) {
    return true;
  }
  return !report.sections.some((section) =>
    section.rows.some((row) => row.kind === "data"),
  );
}

export function isBottleOilStockSalesReportEmpty(
  report: BottleOilStockSalesReport,
): boolean {
  const hasStock = report.stockSection.rows.some(
    (row) =>
      row.kind === "data" &&
      (row.rowTotalUnits > EPS || row.rowTotalKg > EPS),
  );
  const hasSales = report.salesSection.rows.some(
    (row) =>
      row.kind === "month" &&
      (row.rowTotalKg > EPS || row.rowTotalValue > EPS),
  );
  return !hasStock && !hasSales;
}

function weeklyMatrixHasData(
  rows: WeeklyDeliveriesReport["looseSection"]["rows"],
): boolean {
  return rows.some(
    (row) =>
      row.kind === "data" &&
      (Math.abs(row.rowTotal) > EPS ||
        row.quantities.some((qty) => Math.abs(qty) > EPS)),
  );
}

export function isWeeklyDeliveriesReportEmpty(report: WeeklyDeliveriesReport): boolean {
  return (
    !weeklyMatrixHasData(report.looseSection.rows) &&
    !weeklyMatrixHasData(report.bottledSection.rows) &&
    !weeklyMatrixHasData(report.miscSection.rows)
  );
}

export function isDailySalesReportEmpty(report: DailySalesReport): boolean {
  return report.sections.length === 0;
}

function monthlyDeliveryRowHasData(
  rows: MonthlyDeliveryReport["sections"][number]["rows"],
): boolean {
  return rows.some(
    (row) =>
      row.kind === "data" &&
      (Math.abs(row.toDate.tons) > EPS ||
        Math.abs(row.toDate.value) > EPS ||
        row.months.some(
          (cell) => Math.abs(cell.tons) > EPS || Math.abs(cell.value) > EPS,
        )),
  );
}

export function isMonthlyDeliveryReportEmpty(report: MonthlyDeliveryReport): boolean {
  const hasSections = report.sections.some((section) =>
    monthlyDeliveryRowHasData(section.rows),
  );
  const hasBudget = report.budgetSection.metrics.some(
    (metric) =>
      Math.abs(metric.actualTons) > EPS ||
      Math.abs(metric.actualValue) > EPS ||
      Math.abs(metric.estimateTons) > EPS ||
      Math.abs(metric.estimateValue) > EPS,
  );
  const hasKernelBudget = report.kernelPkBudgetSection.metrics.some(
    (metric) =>
      Math.abs(metric.actualTons) > EPS ||
      Math.abs(metric.actualValue) > EPS ||
      Math.abs(metric.estimateTons) > EPS ||
      Math.abs(metric.estimateValue) > EPS,
  );
  return !hasSections && !hasBudget && !hasKernelBudget;
}

function matrixRowHasData(row: MonthlyStockReconciliationMatrixRow): boolean {
  if (row.kind === "blank") {
    return false;
  }
  return (
    isNonZero(row.total) ||
    Object.values(row.valuesBySalesPointId).some((value) => isNonZero(value))
  );
}

export function isMonthlyStockReconciliationReportEmpty(
  report: MonthlyStockReconciliationReport,
): boolean {
  const rows = [
    report.openingRow,
    ...report.receptionRows,
    report.totalReceptionRow,
    report.openingPlusReceptionRow,
    ...report.issueRows,
    report.totalIssuesRow,
    report.calculatedStockRow,
    report.physicalStockRow,
    report.varianceRow,
    ...report.bpoRows,
    ...report.otherRows,
  ];
  return !rows.some(matrixRowHasData);
}

export function isLooseLpoStockSummaryReportEmpty(
  report: LooseLpoStockSummaryReport,
): boolean {
  return !report.rows.some((row) => {
    if (row.kind === "blank") {
      return false;
    }
    return isNonZero(row.values.thisMonth) || isNonZero(row.values.toDate);
  });
}

export function isMonthlyPaymentDeliveryReportEmpty(
  report: MonthlyPaymentDeliveryReport,
): boolean {
  if (report.weeks.length === 0) {
    return true;
  }
  const totals = report.totals;
  return (
    Math.abs(totals.paymentsKg) <= EPS &&
    Math.abs(totals.paymentsValue) <= EPS &&
    Math.abs(totals.deliveriesKg) <= EPS &&
    Math.abs(totals.deliveriesValue) <= EPS
  );
}

export function isMonthlyDeliveriesByDestinationReportEmpty(
  report: MonthlyDeliveriesByDestinationReport,
): boolean {
  if (report.weeks.length === 0) {
    return true;
  }
  return Math.abs(report.totals.totalKg) <= EPS;
}

export function isMonthlyPalmOilSalesReportEmpty(
  report: MonthlyPalmOilSalesReport,
): boolean {
  return !report.rows.some(
    (row) =>
      row.kind === "data" &&
      (Math.abs(row.ytd.tons) > EPS ||
        Math.abs(row.ytd.value) > EPS ||
        row.months.some(
          (cell) => Math.abs(cell.tons) > EPS || Math.abs(cell.value) > EPS,
        )),
  );
}

function palmOilActivitySectionHasData(
  section: PalmOilSalesActivityReport["looseOilSection"],
): boolean {
  return section.rows.some(
    (row) =>
      row.kind === "data" &&
      (Math.abs(row.toDate.tons) > EPS ||
        Math.abs(row.toDate.value) > EPS ||
        row.months.some(
          (cell) => Math.abs(cell.tons) > EPS || Math.abs(cell.value) > EPS,
        )),
  );
}

export function isPalmOilSalesActivityReportEmpty(
  report: PalmOilSalesActivityReport,
): boolean {
  return (
    !palmOilActivitySectionHasData(report.looseOilSection) &&
    !palmOilActivitySectionHasData(report.looseAndBtldSection)
  );
}

export function isIndustryProductMonthlySalesReportEmpty(
  report: IndustryProductMonthlySalesReport,
): boolean {
  return report.sections.length === 0;
}

export function isBottledPalmOilSalesReturnReportEmpty(
  report: BottledPalmOilSalesReturnReport,
): boolean {
  return !report.rows.some(
    (row) =>
      row.kind !== "section" &&
      (Math.abs(row.totalKg) > EPS ||
        Math.abs(row.grandTotalFcfa) > EPS ||
        row.packs.some(
          (pack) => Math.abs(pack.qty) > EPS || Math.abs(pack.amount) > EPS,
        )),
  );
}

export function isMonthlyBottledOilReportEmpty(report: MonthlyBottledOilReport): boolean {
  return report.rows.length === 0;
}

export function isOtherProductSalesDeliveriesReportEmpty(
  report: OtherProductSalesDeliveriesReport,
): boolean {
  return report.sections.length === 0;
}

export function isBottledWeeklyIssuesReportEmpty(
  report: BottledWeeklyIssuesReport,
): boolean {
  const hasDetail =
    Math.abs(report.detail.totals.totalUnits) > EPS ||
    Math.abs(report.detail.totals.valueFcfa) > EPS ||
    Math.abs(report.detail.totals.monthToDateValue) > EPS ||
    report.detail.days.some((day) =>
      day.methods.some(
        (row) =>
          Math.abs(row.totalUnits) > EPS ||
          Math.abs(row.valueFcfa) > EPS ||
          row.packUnits.some((value) => Math.abs(value) > EPS),
      ),
    );
  const hasCompare = report.compare.rows.some((row) => Math.abs(row.currentKg) > EPS);
  return !hasDetail && !hasCompare;
}

export function isRevenueTaxesReportEmpty(report: RevenueTaxesReport): boolean {
  return (
    report.byPeriod.length === 0 &&
    report.bySalesPoint.length === 0 &&
    Math.abs(report.totals.grossAmount) <= EPS
  );
}

export function isSalesBudgetMonthlyCrosstabReportEmpty(
  report: SalesBudgetMonthlyCrosstabReport,
): boolean {
  return !report.hasAnyBudget || report.rows.length === 0;
}

export function isSalesBudgetWeeklyCrosstabReportEmpty(
  report: SalesBudgetWeeklyCrosstabReport,
): boolean {
  return (
    !report.hasAnyBudget ||
    report.categoriesInReport.length === 0 ||
    report.sortedWeeks.length === 0
  );
}

export function salesBudgetWeeklyCrosstabEmptyMessage(
  report: SalesBudgetWeeklyCrosstabReport,
): string | null {
  if (!report.hasAnyBudget) {
    return "No product sales budgets are defined yet. Use Sales budgets to add annual quantities.";
  }
  if (report.categoriesInReport.length === 0) {
    return "No category budgets for this year. Use Sales budgets to add annual quantities.";
  }
  if (report.sortedWeeks.length === 0) {
    return "No phased weeks fall in this calendar year for the loaded budgets (check financial year boundaries and budgets).";
  }
  if (report.grandTotal === 0) {
    return "No budget data to display for this year.";
  }
  return null;
}

export function salesBudgetMonthlyCrosstabEmptyMessage(
  report: SalesBudgetMonthlyCrosstabReport,
): string | null {
  if (!report.hasAnyBudget) {
    return "No product sales budgets are defined yet. Use Sales budgets to add annual quantities.";
  }
  if (report.categoriesInReportCount === 0) {
    return "No category budgets for this year. Use Sales budgets to add annual quantities.";
  }
  if (isSalesBudgetMonthlyCrosstabReportEmpty(report)) {
    return "No budget rows to display for this year.";
  }
  return null;
}

export function isSalesBudgetMonthlyRevenueCrosstabReportEmpty(
  report: SalesBudgetMonthlyRevenueCrosstabReport,
): boolean {
  return !report.hasAnyBudget || report.rows.length === 0;
}

export function isSalesBudgetWeeklyRevenueCrosstabReportEmpty(
  report: SalesBudgetWeeklyRevenueCrosstabReport,
): boolean {
  return (
    !report.hasAnyBudget ||
    report.categoriesInReport.length === 0 ||
    report.sortedWeeks.length === 0
  );
}

export function salesBudgetWeeklyRevenueCrosstabEmptyMessage(
  report: SalesBudgetWeeklyRevenueCrosstabReport,
): string | null {
  if (!report.hasAnyBudget) {
    return "No product sales budgets are defined yet. Use Sales budgets to add annual quantities and unit prices.";
  }
  if (report.categoriesInReport.length === 0) {
    return "No category budgets for this year. Use Sales budgets to add annual quantities and unit prices.";
  }
  if (report.sortedWeeks.length === 0) {
    return "No phased weeks fall in this calendar year for the loaded budgets (check financial year boundaries and budgets).";
  }
  if (report.grandTotal === 0) {
    return "No budget revenue to display for this year.";
  }
  return null;
}

export function salesBudgetMonthlyRevenueCrosstabEmptyMessage(
  report: SalesBudgetMonthlyRevenueCrosstabReport,
): string | null {
  if (!report.hasAnyBudget) {
    return "No product sales budgets are defined yet. Use Sales budgets to add annual quantities and unit prices.";
  }
  if (report.categoriesInReportCount === 0) {
    return "No category budgets for this year. Use Sales budgets to add annual quantities and unit prices.";
  }
  if (isSalesBudgetMonthlyRevenueCrosstabReportEmpty(report)) {
    return "No budget revenue rows to display for this year.";
  }
  return null;
}

export function isBinCardReportMovementsEmpty(report: BinCardReport): boolean {
  return report.lines.length === 0;
}
