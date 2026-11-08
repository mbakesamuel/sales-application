import type { SalesBudgetMonthlyRevenueCrosstabReport } from "../../shared/reports.types.js";
import {
  CAL_MONTHS,
  calendarMonthToFiscal,
  computeMonthlyBudgetAmountFcfaByFiscalMonth,
} from "../../shared/salesBudgetPhase.js";
import { loadReportCompanySettings, loadReportComments } from "./companySettings.js";
import { loadSalesBudgetCrosstabContext } from "./salesBudgetCrosstabShared.js";
import { resolveReportAsAt } from "../financialYears/service.js";

export function getSalesBudgetMonthlyRevenueCrosstabReport(
  userId?: string | null,
  reportYearRaw?: number | null,
): SalesBudgetMonthlyRevenueCrosstabReport {
  const { asAtIso } = resolveReportAsAt(userId);
  const settings = loadReportCompanySettings(userId, asAtIso);
  const context = loadSalesBudgetCrosstabContext(reportYearRaw);
  const monthlyCache = new Map<string, number[]>();

  function monthlyLine(productCatId: number, financialYear: number): number[] | null {
    const budget = context.budgetMap.get(`${productCatId}:${financialYear}`);
    const period = context.periodsByFy.get(financialYear);
    const pcts = context.phasePctByCatFy.get(`${productCatId}:${financialYear}`);
    if (!budget || !period || !pcts) {
      return null;
    }

    const cacheKey = `${productCatId}:${financialYear}`;
    let line = monthlyCache.get(cacheKey);
    if (!line) {
      line = computeMonthlyBudgetAmountFcfaByFiscalMonth({
        financialYear,
        fiscalYearStartMonth: context.fiscalYearStartMonth,
        fyStartIso: period.startDate,
        fyEndIso: period.endDate,
        annualQtyKg: budget.annualQtyKg,
        budgetUnitPricePerKg: budget.budgetUnitPricePerKg,
        fiscalMonthPercents: pcts,
      });
      monthlyCache.set(cacheKey, line);
    }
    return line;
  }

  const rows = context.categoriesInReport.map((cat) => {
    const cells: number[] = [];
    let rowTotal = 0;
    for (const month of CAL_MONTHS) {
      const { financialYear, financialMonth } = calendarMonthToFiscal(
        context.reportYear,
        month,
        context.fiscalYearStartMonth,
      );
      const line = monthlyLine(cat.productCatId, financialYear);
      const amount = line ? (line[financialMonth - 1] ?? 0) : 0;
      cells.push(amount);
      rowTotal += amount;
    }
    return {
      productCatId: cat.productCatId,
      label: cat.label,
      cells,
      rowTotal,
    };
  });

  const colTotals = CAL_MONTHS.map((_, index) =>
    rows.reduce((sum, row) => sum + (row.cells[index] ?? 0), 0),
  );
  const grandTotal = colTotals.reduce((sum, value) => sum + value, 0);

  return {
    settings,
    yearChoices: context.yearChoices,
    reportYear: context.reportYear,
    hasAnyBudget: context.hasAnyBudget,
    categoriesInReportCount: context.categoriesInReport.length,
    rows,
    colTotals,
    grandTotal,
    generatedAtIso: new Date().toISOString(),
    comments: loadReportComments("sales-budget-monthly-revenue-crosstab"),
  };
}
