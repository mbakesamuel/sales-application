import type { SalesBudgetMonthlyCrosstabReport } from "../../shared/reports.types.js";
import {
  CAL_MONTHS,
  calendarMonthToFiscal,
  computeMonthlyBudgetQtyKgByFiscalMonth,
} from "../../shared/salesBudgetPhase.js";
import { loadReportCompanySettings, loadReportComments } from "./companySettings.js";
import { loadSalesBudgetCrosstabContext } from "./salesBudgetCrosstabShared.js";
import { resolveReportAsAt } from "../financialYears/service.js";

export function getSalesBudgetMonthlyCrosstabReport(
  userId?: string | null,
  reportYearRaw?: number | null,
): SalesBudgetMonthlyCrosstabReport {
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
      line = computeMonthlyBudgetQtyKgByFiscalMonth({
        financialYear,
        fiscalYearStartMonth: context.fiscalYearStartMonth,
        fyStartIso: period.startDate,
        fyEndIso: period.endDate,
        annualQtyKg: budget.annualQtyKg,
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
      const kg = line ? (line[financialMonth - 1] ?? 0) : 0;
      cells.push(kg);
      rowTotal += kg;
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
    comments: loadReportComments("sales-budget-monthly-crosstab"),
  };
}
