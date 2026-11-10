/**
 * Ports src/electron/reports/salesBudgetCrosstabShared.ts for Neon/Prisma.
 */
import {
  CAL_MONTHS,
  calendarMonthToFiscal,
  normalizeFiscalMonthPercents,
} from "../../shared/salesBudgetPhase.js";
import {
  budgetCategoryLabels,
  type SalesBudgetCategoryRef,
} from "../../shared/salesBudgetCategories.js";
import { prisma } from "../../db/prisma.js";
import { parseQty } from "./reportShared.js";

export type FiscalYearPeriodRow = {
  financialYear: number;
  startDate: string;
  endDate: string;
};

export type BudgetCategoryRow = {
  productCatId: number;
  label: string;
};

export type BudgetRow = {
  financialYear: number;
  productCatId: number;
  annualQtyKg: number;
  budgetUnitPricePerKg: number;
};

export type SalesBudgetCrosstabContext = {
  fiscalYearStartMonth: number;
  periodsByFy: Map<number, FiscalYearPeriodRow>;
  yearChoices: number[];
  reportYear: number;
  categoriesInReport: BudgetCategoryRow[];
  budgetMap: Map<string, BudgetRow>;
  phasePctByCatFy: Map<string, number[]>;
  hasAnyBudget: boolean;
};

function profileRowToPercents(row: {
  pct_m01: string;
  pct_m02: string;
  pct_m03: string;
  pct_m04: string;
  pct_m05: string;
  pct_m06: string;
  pct_m07: string;
  pct_m08: string;
  pct_m09: string;
  pct_m10: string;
  pct_m11: string;
  pct_m12: string;
}): number[] {
  return normalizeFiscalMonthPercents([
    parseQty(row.pct_m01),
    parseQty(row.pct_m02),
    parseQty(row.pct_m03),
    parseQty(row.pct_m04),
    parseQty(row.pct_m05),
    parseQty(row.pct_m06),
    parseQty(row.pct_m07),
    parseQty(row.pct_m08),
    parseQty(row.pct_m09),
    parseQty(row.pct_m10),
    parseQty(row.pct_m11),
    parseQty(row.pct_m12),
  ]);
}

export async function loadSalesBudgetCrosstabContext(
  reportYearRaw?: number | null,
): Promise<SalesBudgetCrosstabContext> {
  const settingsRow = await prisma.company_settings.findFirst({
    where: { id: "default" },
    select: { fiscal_year_start_month: true },
  });
  const fiscalYearStartMonth = Number(settingsRow?.fiscal_year_start_month ?? 1);

  const periods = await prisma.financial_year_periods.findMany({
    orderBy: { financial_year: "desc" },
    select: {
      financial_year: true,
      start_date: true,
      end_date: true,
    },
  });

  const periodsByFy = new Map<number, FiscalYearPeriodRow>();
  function toIsoDate(value: Date | string): string {
    if (value instanceof Date) {
      const y = value.getUTCFullYear();
      const m = String(value.getUTCMonth() + 1).padStart(2, "0");
      const d = String(value.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return String(value).slice(0, 10);
  }

  for (const period of periods) {
    periodsByFy.set(period.financial_year, {
      financialYear: period.financial_year,
      startDate: toIsoDate(period.start_date),
      endDate: toIsoDate(period.end_date),
    });
  }

  const yearsSet = new Set<number>();
  const yNow = new Date().getFullYear();
  yearsSet.add(yNow);
  for (const period of periods) {
    const start = toIsoDate(period.start_date);
    const end = toIsoDate(period.end_date);
    const sy = Number.parseInt(start.slice(0, 4), 10);
    const ey = Number.parseInt(end.slice(0, 4), 10);
    for (let year = sy; year <= ey; year += 1) {
      yearsSet.add(year);
    }
  }
  const yearChoices = [...yearsSet].sort((a, b) => b - a);

  const reportYear =
    reportYearRaw != null &&
    Number.isFinite(reportYearRaw) &&
    yearChoices.includes(reportYearRaw)
      ? reportYearRaw
      : (yearChoices[0] ?? yNow);

  const categoryRows = await prisma.product_cats.findMany({
    orderBy: [
      { is_main: "desc" },
      { is_bottled: "asc" },
      { product_cat: "asc" },
    ],
  });
  const categories: SalesBudgetCategoryRef[] = categoryRows.map((c) => ({
    productCatId: c.product_cat_id,
    productCat: c.product_cat,
    isMain: c.is_main ? 1 : 0,
    isBottled: c.is_bottled ? 1 : 0,
  }));
  const categoryById = new Map(
    categories.map((c) => [c.productCatId, c] as const),
  );

  const budgets = await prisma.product_sales_budgets.findMany();
  const budgetMap = new Map<string, BudgetRow>();
  for (const budget of budgets) {
    budgetMap.set(`${budget.product_cat_id}:${budget.financial_year}`, {
      financialYear: budget.financial_year,
      productCatId: budget.product_cat_id,
      annualQtyKg: parseQty(budget.annual_qty_kg),
      budgetUnitPricePerKg: parseQty(budget.budget_unit_price_per_kg),
    });
  }

  const financialYearsForReport = new Set<number>();
  for (const month of CAL_MONTHS) {
    financialYearsForReport.add(
      calendarMonthToFiscal(reportYear, month, fiscalYearStartMonth)
        .financialYear,
    );
  }

  const categoriesInReport: BudgetCategoryRow[] = [];
  const seenCatIds = new Set<number>();
  for (const cat of categories) {
    let hasBudget = false;
    for (const fy of financialYearsForReport) {
      if (budgetMap.has(`${cat.productCatId}:${fy}`)) {
        hasBudget = true;
        break;
      }
    }
    if (!hasBudget || seenCatIds.has(cat.productCatId)) continue;
    seenCatIds.add(cat.productCatId);
    categoriesInReport.push({
      productCatId: cat.productCatId,
      label: budgetCategoryLabels(cat).label,
    });
  }

  for (const budget of budgets) {
    if (seenCatIds.has(budget.product_cat_id)) continue;
    let coversReport = false;
    for (const fy of financialYearsForReport) {
      if (budget.financial_year === fy) {
        coversReport = true;
        break;
      }
    }
    if (!coversReport) continue;
    seenCatIds.add(budget.product_cat_id);
    const cat = categoryById.get(budget.product_cat_id);
    categoriesInReport.push({
      productCatId: budget.product_cat_id,
      label: cat
        ? budgetCategoryLabels(cat).label
        : `Category ${budget.product_cat_id}`,
    });
  }

  const phasePctByCatFy = new Map<string, number[]>();
  const pairSeen = new Set<string>();
  const pairList: Array<{ productCatId: number; financialYear: number }> = [];

  for (const cat of categoriesInReport) {
    for (const month of CAL_MONTHS) {
      const { financialYear } = calendarMonthToFiscal(
        reportYear,
        month,
        fiscalYearStartMonth,
      );
      if (!budgetMap.has(`${cat.productCatId}:${financialYear}`)) continue;
      const pairKey = `${cat.productCatId}:${financialYear}`;
      if (pairSeen.has(pairKey)) continue;
      pairSeen.add(pairKey);
      pairList.push({ productCatId: cat.productCatId, financialYear });
    }
  }

  const profileRows =
    await prisma.product_sales_budget_month_phase_profiles.findMany();
  const profileByPair = new Map(
    profileRows.map((row) => [
      `${row.product_cat_id}:${row.financial_year}`,
      row,
    ]),
  );

  const equalSplit = Array.from({ length: 12 }, () => 1 / 12);
  for (const pair of pairList) {
    const pairKey = `${pair.productCatId}:${pair.financialYear}`;
    const row = profileByPair.get(pairKey);
    phasePctByCatFy.set(
      pairKey,
      row ? profileRowToPercents(row) : equalSplit,
    );
  }

  return {
    fiscalYearStartMonth,
    periodsByFy,
    yearChoices,
    reportYear,
    categoriesInReport,
    budgetMap,
    phasePctByCatFy,
    hasAnyBudget: budgets.length > 0,
  };
}
