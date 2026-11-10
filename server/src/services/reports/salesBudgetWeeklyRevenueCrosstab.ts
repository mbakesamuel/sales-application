import {
  buildSalesBudgetPhase,
  CAL_MONTHS,
  calendarMonthToFiscal,
  salesBudgetCrosstabCellKey,
  type SalesBudgetPhaseResult,
} from "../../shared/salesBudgetPhase.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  resolveReportAsAt,
} from "../reportCompany.js";
import { loadSalesBudgetCrosstabContext } from "./salesBudgetCrosstabShared.js";

export async function getSalesBudgetWeeklyRevenueCrosstabReport(
  userId?: string | null,
  reportYearRaw?: number | null,
) {
  const asAtIso = await resolveReportAsAt(undefined, userId);
  const settings = await loadReportCompanySettings(userId, asAtIso);
  const context = await loadSalesBudgetCrosstabContext(reportYearRaw);
  const phaseResultCache = new Map<string, SalesBudgetPhaseResult | null>();

  function getPhaseResult(
    productCatId: number,
    financialYear: number,
  ): SalesBudgetPhaseResult | null {
    const cacheKey = `${productCatId}:${financialYear}`;
    if (phaseResultCache.has(cacheKey)) {
      return phaseResultCache.get(cacheKey) ?? null;
    }

    const budget = context.budgetMap.get(`${productCatId}:${financialYear}`);
    const period = context.periodsByFy.get(financialYear);
    const pcts = context.phasePctByCatFy.get(`${productCatId}:${financialYear}`);
    if (!budget || !period || !pcts) {
      phaseResultCache.set(cacheKey, null);
      return null;
    }

    try {
      const result = buildSalesBudgetPhase({
        financialYear,
        fiscalYearStartMonth: context.fiscalYearStartMonth,
        fyStartIso: period.startDate,
        fyEndIso: period.endDate,
        annualQtyKg: budget.annualQtyKg,
        budgetUnitPricePerKg: budget.budgetUnitPricePerKg,
        fiscalMonthPercents: pcts,
      });
      phaseResultCache.set(cacheKey, result);
      return result;
    } catch {
      phaseResultCache.set(cacheKey, null);
      return null;
    }
  }

  const weekDedup = new Map<string, { label: string; wy: number; wk: number }>();
  const amountByCell: Array<{ key: string; amountFcfa: number }> = [];
  const amountMap = new Map<string, number>();

  for (const cat of context.categoriesInReport) {
    for (const month of CAL_MONTHS) {
      const { financialYear } = calendarMonthToFiscal(
        context.reportYear,
        month,
        context.fiscalYearStartMonth,
      );
      const phase = getPhaseResult(cat.productCatId, financialYear);
      if (!phase) continue;

      const phaseMonth = phase.months.find(
        (entry) =>
          entry.calendarYear === context.reportYear &&
          entry.calendarMonth === month,
      );
      if (!phaseMonth) continue;

      for (const week of phaseMonth.weeks) {
        const sortKey = `${String(week.isoWeekYear).padStart(4, "0")}-W${String(
          week.isoWeek,
        ).padStart(2, "0")}`;
        if (!weekDedup.has(sortKey)) {
          weekDedup.set(sortKey, {
            label: week.label,
            wy: week.isoWeekYear,
            wk: week.isoWeek,
          });
        }
        const key = salesBudgetCrosstabCellKey(
          week.label,
          cat.productCatId,
          month,
        );
        amountMap.set(key, week.amountFcfa);
        amountByCell.push({ key, amountFcfa: week.amountFcfa });
      }
    }
  }

  const sortedWeeks = [...weekDedup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, meta]) => meta);

  const cols: Array<{ productCatId: number; month: number }> = [];
  for (const cat of context.categoriesInReport) {
    for (const month of CAL_MONTHS) {
      cols.push({ productCatId: cat.productCatId, month });
    }
  }

  const rowTotals = sortedWeeks.map((week) => {
    let total = 0;
    for (const col of cols) {
      total +=
        amountMap.get(
          salesBudgetCrosstabCellKey(week.label, col.productCatId, col.month),
        ) ?? 0;
    }
    return total;
  });

  const colTotals = cols.map((col) => {
    let total = 0;
    for (const week of sortedWeeks) {
      total +=
        amountMap.get(
          salesBudgetCrosstabCellKey(week.label, col.productCatId, col.month),
        ) ?? 0;
    }
    return total;
  });

  const grandTotal = colTotals.reduce((sum, value) => sum + value, 0);

  return {
    settings,
    yearChoices: context.yearChoices,
    reportYear: context.reportYear,
    hasAnyBudget: context.hasAnyBudget,
    categoriesInReport: context.categoriesInReport.map((cat) => ({
      productCatId: cat.productCatId,
      label: cat.label,
    })),
    sortedWeeks,
    cols,
    amountByCell,
    rowTotals,
    colTotals,
    grandTotal,
    generatedAtIso: new Date().toISOString(),
    comments: await loadReportComments("sales-budget-weekly-revenue-crosstab"),
  };
}
