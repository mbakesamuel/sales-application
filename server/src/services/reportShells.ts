/**
 * Valid empty report payloads so thin-client UI can render instead of 501.
 * Full Postgres query ports land per-report after cutover.
 */
import { getOpenPostingPeriodForActor } from "./financialYearsService.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  listSalesPointOptions,
  nowIso,
  resolveReportAsAt,
  todayIso,
  type ReportCompanySettings,
} from "./reportCompany.js";

type Ctx = { userId: string; salesPointId: number | null };

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

function emptyBudgetSection(title: string) {
  return {
    title,
    metrics: [] as Array<{
      id: string;
      tonsLabel: string;
      valueLabel: string;
      estimateTons: number;
      actualTons: number;
      estimateValue: number;
      actualValue: number;
    }>,
    grandEstimateValue: 0,
    grandActualValue: 0,
    variance: 0,
  };
}

function emptyWeeklyMatrix(title: string) {
  return {
    title,
    salesPointNames: [] as string[],
    rows: [] as Array<{
      label: string;
      quantities: number[];
      rowTotal: number;
      kind: "data" | "total";
    }>,
  };
}

function twelveMonthCells() {
  return Array.from({ length: 12 }, () => ({ tons: 0, value: 0 }));
}

async function baseMeta(
  ctx: Ctx,
  asAtIso?: string | null,
  commentsReportId?: string,
) {
  const asAt = await resolveReportAsAt(asAtIso, ctx.userId);
  const [settings, comments, period] = await Promise.all([
    loadReportCompanySettings(ctx.userId, asAt),
    commentsReportId ? loadReportComments(commentsReportId) : Promise.resolve(null),
    getOpenPostingPeriodForActor(ctx.userId),
  ]);
  return {
    settings,
    asAt,
    comments,
    period,
    generatedAtIso: nowIso(),
  };
}

export async function emptyStockReport(ctx: Ctx, asAtIso?: string | null) {
  const { settings, asAt, comments, generatedAtIso } = await baseMeta(
    ctx,
    asAtIso,
    "stock-report",
  );
  return {
    settings,
    asAtIso: asAt,
    generatedAtIso,
    sections: [],
    oilGrandTotalKg: 0,
    comments,
  };
}

export async function emptyStockCommitment(ctx: Ctx, asAtIso?: string | null) {
  const { settings, asAt, comments, generatedAtIso } = await baseMeta(
    ctx,
    asAtIso,
    "stock-commitment-report",
  );
  return {
    settings,
    asAtIso: asAt,
    generatedAtIso,
    sections: [],
    looseGrandTotal: null,
    bottledSection: null,
    comments,
  };
}

export async function emptyCommitmentReport(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso } = await baseMeta(
    ctx,
    null,
    "commitment-report",
  );
  return {
    settings,
    asAtIso: asAt,
    generatedAtIso,
    sections: [],
    salesPointNames: [],
    columnTotals: [],
    grandTotal: 0,
    comments,
  };
}

export async function emptyBottleOilStockSales(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso } = await baseMeta(
    ctx,
    null,
    "bottle-oil-stock-sales-report",
  );
  return {
    settings,
    asAtIso: asAt,
    generatedAtIso,
    stockSection: {
      title: "Bottled oil stock",
      columns: [],
      rows: [],
      unitColumnTotals: [],
      kgColumnTotals: [],
      grandTotalKg: 0,
    },
    salesSection: {
      title: "Bottled oil sales",
      salesFromIso: asAt,
      salesToIso: asAt,
      columns: [],
      rows: [],
    },
    comments,
  };
}

export async function emptyWeekChoices(ctx: Ctx) {
  const period = await getOpenPostingPeriodForActor(ctx.userId);
  const asAt = period?.endDate ?? todayIso();
  void asAt;
  return [] as Array<{
    weekMondayIso: string;
    weekFromIso: string;
    weekToIso: string;
    label: string;
  }>;
}

export async function emptyWeeklyDeliveries(ctx: Ctx, weekMondayIso?: string) {
  const { settings, asAt, comments, generatedAtIso } = await baseMeta(
    ctx,
    null,
    "weekly-deliveries-report",
  );
  const monday = weekMondayIso?.trim() || asAt;
  return {
    settings,
    asAtIso: asAt,
    weekMondayIso: monday,
    weekFromIso: monday,
    weekToIso: monday,
    weekChoices: [],
    generatedAtIso,
    looseSection: emptyWeeklyMatrix("Loose oil"),
    bottledSection: emptyWeeklyMatrix("Bottled oil"),
    miscSection: emptyWeeklyMatrix("Miscellaneous"),
    comments,
  };
}

export async function emptyBottledWeeklyIssues(
  ctx: Ctx,
  estimateBasis?: string,
  weekMondayIso?: string,
) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "bottled-weekly-issues-report",
  );
  const monday = weekMondayIso?.trim() || asAt;
  const basis =
    estimateBasis === "iso-week" ? "iso-week" : ("working-days" as const);
  return {
    settings,
    asAtIso: asAt,
    weekMondayIso: monday,
    weekFromIso: monday,
    weekToIso: monday,
    weekChoices: [],
    monthFromIso: period?.startDate ?? asAt.slice(0, 8) + "01",
    yearFromIso: `${period?.financialYear ?? asAt.slice(0, 4)}-01-01`,
    generatedAtIso,
    reportTitle: "Bottled Palm Oil Weekly Issues",
    estimateBasis: basis,
    estimateBasisLabel:
      basis === "iso-week" ? "Full ISO week" : "Working days (Mon–Fri)",
    estimateWeekDaysInMonth: 0,
    detail: {
      monthLabel: period?.monthName ?? "",
      packColumns: [
        { id: "jug20" as const, label: "20L", litresPerUnit: 20 },
        { id: "carton15" as const, label: "15L", litresPerUnit: 15 },
        { id: "carton5" as const, label: "3x5L", litresPerUnit: 15 },
      ],
      days: [],
      totals: {
        packUnits: [0, 0, 0],
        totalUnits: 0,
        valueFcfa: 0,
        monthToDateValue: 0,
      },
      footer: [],
    },
    summary: {
      title: "Summary",
      rows: [],
    },
    compare: {
      title: "Compare",
      currentColumn: { id: "current", label: "Current" },
      priorColumn: { id: "prior", label: "Prior" },
      rows: [],
    },
    comments,
  };
}

export async function emptyMonthlyDelivery(ctx: Ctx, half: 1 | 2) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "monthly-delivery-report",
  );
  const year = period?.financialYear ?? Number(asAt.slice(0, 4));
  const months =
    half === 1
      ? [1, 2, 3, 4, 5, 6]
      : [7, 8, 9, 10, 11, 12];
  return {
    settings,
    financialYear: year,
    half,
    asAtIso: asAt,
    generatedAtIso,
    reportTitle: `Monthly Delivery Report — H${half} ${year}`,
    monthColumns: months.map((month) => ({
      month,
      label: MONTH_NAMES[month - 1]!.slice(0, 3).toUpperCase(),
    })),
    sections: [],
    kernelPkBudgetSection: emptyBudgetSection("Kernel / PK"),
    budgetSection: emptyBudgetSection("Budget"),
    comments,
  };
}

function emptyMatrixRow(label: string, kind: string) {
  return {
    label,
    kind,
    valuesBySalesPointId: {} as Record<string, number | null>,
    total: null as number | null,
  };
}

export async function emptyMonthlyStockReconciliation(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "monthly-stock-reconciliation-report",
  );
  return {
    settings,
    asAtIso: asAt,
    monthStartIso: period?.startDate ?? asAt.slice(0, 8) + "01",
    monthLabel: period?.monthName ?? "",
    reportTitle: "Monthly Stock Reconciliation",
    generatedAtIso,
    salesPointIds: [],
    salesPointNames: [],
    openingRow: emptyMatrixRow("Opening stock", "data"),
    receptionSectionTitle: "Reception",
    receptionRows: [],
    totalReceptionRow: emptyMatrixRow("Total reception", "total"),
    openingPlusReceptionRow: emptyMatrixRow("Opening + reception", "subtotal"),
    issuesSectionTitle: "Issues",
    issueRows: [],
    totalIssuesRow: emptyMatrixRow("Total issues", "total"),
    calculatedStockRow: emptyMatrixRow("Calculated stock", "data"),
    physicalStockRow: emptyMatrixRow("Physical stock", "data"),
    varianceRow: emptyMatrixRow("Variance", "data"),
    bpoSectionTitle: "BPO",
    bpoRows: [],
    otherSectionTitle: "Other",
    otherRows: [],
    comments,
  };
}

export async function emptyLooseLpoStockSummary(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "loose-lpo-stock-summary-report",
  );
  return {
    settings,
    asAtIso: asAt,
    monthStartIso: period?.startDate ?? asAt.slice(0, 8) + "01",
    monthLabel: period?.monthName ?? "",
    monthIndexInFy: period?.calendarMonth ?? 1,
    toDateColumnLabel: "To date",
    reportTitle: "Loose LPO Stock Summary",
    rows: [],
    comments,
    generatedAtIso,
  };
}

export async function emptyMonthlyPaymentDelivery(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "monthly-payment-delivery-report",
  );
  return {
    settings,
    asAtIso: asAt,
    monthStartIso: period?.startDate ?? asAt.slice(0, 8) + "01",
    monthEndIso: period?.endDate ?? asAt,
    monthName: period?.monthName ?? "",
    financialYear: period?.financialYear ?? Number(asAt.slice(0, 4)),
    reportTitle: "Monthly Payment / Delivery",
    generatedAtIso,
    weeks: [],
    totals: {
      paymentsKg: 0,
      paymentsValue: 0,
      deliveriesKg: 0,
      deliveriesValue: 0,
    },
    comments,
  };
}

export async function emptyTransportCost(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "transport-cost-report",
  );
  return {
    settings,
    asAtIso: asAt,
    monthStartIso: period?.startDate ?? asAt.slice(0, 8) + "01",
    monthEndIso: period?.endDate ?? asAt,
    monthName: period?.monthName ?? "",
    financialYear: period?.financialYear ?? Number(asAt.slice(0, 4)),
    reportTitle: "Transport Cost",
    generatedAtIso,
    rows: [],
    totals: { qtyKg: 0, transportCost: 0, hasMissingRate: false },
    comments,
  };
}

export async function emptyMonthlyDeliveriesByDestination(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "monthly-deliveries-by-destination-report",
  );
  return {
    settings,
    asAtIso: asAt,
    monthStartIso: period?.startDate ?? asAt.slice(0, 8) + "01",
    monthEndIso: period?.endDate ?? asAt,
    monthName: period?.monthName ?? "",
    financialYear: period?.financialYear ?? Number(asAt.slice(0, 4)),
    reportTitle: "Monthly Deliveries by Destination",
    generatedAtIso,
    weeks: [],
    totals: {
      industriesKg: 0,
      wholesalesKg: 0,
      retailKg: 0,
      cdcWorkersKg: 0,
      makokoKg: 0,
      totalKg: 0,
    },
    percentages: {
      industriesPct: null,
      wholesalesPct: null,
      retailPct: null,
      cdcWorkersPct: null,
      makokoPct: null,
      totalPct: null,
    },
    comments,
  };
}

export async function emptyMonthlyPalmOilSales(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "monthly-palm-oil-sales-report",
  );
  const year = period?.financialYear ?? Number(asAt.slice(0, 4));
  return {
    settings,
    asAtIso: asAt,
    monthName: period?.monthName ?? "",
    financialYear: year,
    reportTitle: "Monthly Palm Oil Sales",
    generatedAtIso,
    monthColumnsH1: [1, 2, 3, 4, 5, 6].map((month) => ({
      month,
      label: MONTH_NAMES[month - 1]!.slice(0, 3).toUpperCase(),
    })),
    monthColumnsH2: [7, 8, 9, 10, 11, 12].map((month) => ({
      month,
      label: MONTH_NAMES[month - 1]!.slice(0, 3).toUpperCase(),
    })),
    rows: [],
    comments,
  };
}

export async function emptyPalmOilSalesActivity(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "palm-oil-sales-activity-report",
  );
  const year = period?.financialYear ?? Number(asAt.slice(0, 4));
  const monthColumns = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: MONTH_NAMES[i]!.slice(0, 3).toUpperCase(),
  }));
  const emptySection = (
    id: "looseOil" | "looseAndBtldOil",
    title: string,
  ) => ({
    id,
    title,
    monthColumns,
    rows: [],
  });
  return {
    settings,
    financialYear: year,
    asAtIso: asAt,
    reportTitle: "Palm Oil Sales Activity",
    generatedAtIso,
    looseOilSection: emptySection("looseOil", "Loose oil"),
    looseAndBtldSection: emptySection("looseAndBtldOil", "Loose + bottled"),
    comments,
  };
}

export async function emptyIndustryProductMonthlySales(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "industry-product-monthly-sales-report",
  );
  const year = period?.financialYear ?? Number(asAt.slice(0, 4));
  const emptyRow = {
    id: "grand",
    label: "Grand total",
    kind: "total" as const,
    months: twelveMonthCells(),
    ytd: { tons: 0, value: 0 },
  };
  return {
    settings,
    asAtIso: asAt,
    monthName: period?.monthName ?? "",
    financialYear: year,
    reportTitle: "Industry Product Monthly Sales",
    customerCategoryLabel: "Industry",
    generatedAtIso,
    monthColumnsH1: [1, 2, 3, 4, 5, 6].map((month) => ({
      month,
      label: MONTH_NAMES[month - 1]!.slice(0, 3).toUpperCase(),
    })),
    monthColumnsH2: [7, 8, 9, 10, 11, 12].map((month) => ({
      month,
      label: MONTH_NAMES[month - 1]!.slice(0, 3).toUpperCase(),
    })),
    sections: [],
    grandTotalRow: emptyRow,
    comments,
  };
}

export async function emptyBottledPalmOilSalesReturn(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "bottled-palm-oil-sales-return-report",
  );
  return {
    settings,
    asAtIso: asAt,
    monthStartIso: period?.startDate ?? asAt.slice(0, 8) + "01",
    monthName: period?.monthName ?? "",
    financialYear: period?.financialYear ?? Number(asAt.slice(0, 4)),
    reportTitle: "Bottled Palm Oil Sales Return",
    generatedAtIso,
    packColumns: [
      { id: "jug20" as const, label: "20L", litresPerUnit: 20 },
      { id: "carton5" as const, label: "3x5L", litresPerUnit: 15 },
      { id: "carton15" as const, label: "15L", litresPerUnit: 15 },
    ],
    rows: [],
    comments,
  };
}

export async function emptyOtherProductSalesDeliveries(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "other-product-sales-deliveries-report",
  );
  return {
    settings,
    asAtIso: asAt,
    monthStartIso: period?.startDate ?? asAt.slice(0, 8) + "01",
    monthName: period?.monthName ?? "",
    financialYear: period?.financialYear ?? Number(asAt.slice(0, 4)),
    reportTitle: "Other Product Sales / Deliveries",
    generatedAtIso,
    sections: [],
    grandTotal: {
      id: "grand",
      kind: "grandTotal" as const,
      salesPointLabel: "",
      productLabel: "Grand total",
      productId: null,
      paymentsKg: 0,
      paymentsValue: 0,
      deliveriesKg: 0,
      deliveriesValue: 0,
    },
    comments,
  };
}

export async function emptyMonthlyBottledOil(ctx: Ctx) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "monthly-bottled-oil-report",
  );
  return {
    settings,
    asAtIso: asAt,
    monthStartIso: period?.startDate ?? asAt.slice(0, 8) + "01",
    monthName: period?.monthName ?? "",
    financialYear: period?.financialYear ?? Number(asAt.slice(0, 4)),
    reportTitle: "Monthly Bottled Oil",
    generatedAtIso,
    packColumns: [
      { id: "jug20" as const, label: "20L" },
      { id: "carton5" as const, label: "3x5L" },
      { id: "carton15" as const, label: "15L" },
    ],
    rows: [],
    totals: { qty20L: 0, qty3x5L: 0, qty15L: 0, amount: 0 },
    comments,
  };
}

export async function emptyRevenueTaxes(
  ctx: Ctx,
  periodMode?: string,
  salesPointId?: number | null,
) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "revenue-taxes-report",
  );
  const mode = periodMode === "year" ? "year" : ("month" as const);
  const options = await listSalesPointOptions(ctx.salesPointId);
  const resolvedSp =
    ctx.salesPointId ??
    (salesPointId != null && Number.isFinite(salesPointId)
      ? Number(salesPointId)
      : null);
  const spLabel =
    options.find((o) => o.id === resolvedSp)?.name ??
    (resolvedSp == null ? "All sales points" : `SP #${resolvedSp}`);
  return {
    settings,
    asAtIso: asAt,
    period: mode,
    periodLabel: mode === "year" ? "Financial year" : "Open month",
    fromIso: mode === "year"
      ? `${period?.financialYear ?? asAt.slice(0, 4)}-01-01`
      : period?.startDate ?? asAt.slice(0, 8) + "01",
    toIso: asAt,
    monthName: period?.monthName ?? "",
    financialYear: period?.financialYear ?? Number(asAt.slice(0, 4)),
    salesPointId: resolvedSp,
    scopedSalesPointId: ctx.salesPointId,
    salesPointLabel: spLabel,
    salesPointOptions: options,
    reportTitle: "Revenue & Taxes",
    generatedAtIso,
    totals: {
      invoiceCount: 0,
      netAmount: 0,
      vatAmount: 0,
      salesTaxAmount: 0,
      grossAmount: 0,
    },
    byPeriod: [],
    bySalesPoint: [],
    comments,
  };
}

function emptyBudgetCrosstab(
  settings: ReportCompanySettings,
  year: number,
  comments: string | null,
  generatedAtIso: string,
) {
  return {
    settings,
    yearChoices: [year],
    reportYear: year,
    hasAnyBudget: false,
    categoriesInReportCount: 0,
    rows: [],
    colTotals: Array.from({ length: 12 }, () => 0),
    grandTotal: 0,
    generatedAtIso,
    comments,
  };
}

export async function emptySalesBudgetMonthlyCrosstab(
  ctx: Ctx,
  reportYear?: number,
) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "sales-budget-monthly-crosstab-report",
  );
  const year = reportYear ?? period?.financialYear ?? Number(asAt.slice(0, 4));
  return emptyBudgetCrosstab(settings, year, comments, generatedAtIso);
}

export async function emptySalesBudgetMonthlyRevenueCrosstab(
  ctx: Ctx,
  reportYear?: number,
) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "sales-budget-monthly-revenue-crosstab-report",
  );
  const year = reportYear ?? period?.financialYear ?? Number(asAt.slice(0, 4));
  return emptyBudgetCrosstab(settings, year, comments, generatedAtIso);
}

export async function emptySalesBudgetWeeklyCrosstab(
  ctx: Ctx,
  reportYear?: number,
) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "sales-budget-weekly-crosstab-report",
  );
  const year = reportYear ?? period?.financialYear ?? Number(asAt.slice(0, 4));
  return {
    settings,
    yearChoices: [year],
    reportYear: year,
    hasAnyBudget: false,
    categoriesInReport: [],
    sortedWeeks: [],
    cols: [],
    qtyByCell: [],
    rowTotals: [],
    colTotals: [],
    grandTotal: 0,
    generatedAtIso,
    comments,
  };
}

export async function emptySalesBudgetWeeklyRevenueCrosstab(
  ctx: Ctx,
  reportYear?: number,
) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "sales-budget-weekly-revenue-crosstab-report",
  );
  const year = reportYear ?? period?.financialYear ?? Number(asAt.slice(0, 4));
  return {
    settings,
    yearChoices: [year],
    reportYear: year,
    hasAnyBudget: false,
    categoriesInReport: [],
    sortedWeeks: [],
    cols: [],
    amountByCell: [],
    rowTotals: [],
    colTotals: [],
    grandTotal: 0,
    generatedAtIso,
    comments,
  };
}

export async function emptyDailySales(
  ctx: Ctx,
  reportDateIso: string,
  salesPointId?: number | null,
) {
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(reportDateIso?.trim?.() ?? "")
      ? reportDateIso.trim().slice(0, 10)
      : todayIso();
  const { settings, comments, generatedAtIso } = await baseMeta(
    ctx,
    date,
    "daily-sales-report",
  );
  const options = await listSalesPointOptions(ctx.salesPointId);
  const resolvedSp =
    ctx.salesPointId ??
    (salesPointId != null && Number.isFinite(Number(salesPointId))
      ? Number(salesPointId)
      : null);
  const spLabel =
    options.find((o) => o.id === resolvedSp)?.name ??
    (resolvedSp == null ? "All sales points" : `SP #${resolvedSp}`);
  return {
    settings,
    reportDateIso: date,
    selectedSalesPointId: resolvedSp,
    scopedSalesPointId: ctx.salesPointId,
    salesPointLabel: spLabel,
    generatedAtIso,
    sections: [],
    grandTotalQuantity: 0,
    grandTotalDoBalance: 0,
    summaryRows: [],
    summaryGrandTotal: 0,
    salesPointOptions: options,
    comments,
  };
}

export async function emptyDailySalesMatrix(
  ctx: Ctx,
  salesPointId?: number | null,
  _productId?: number | null,
) {
  const { settings, asAt, comments, generatedAtIso, period } = await baseMeta(
    ctx,
    null,
    "daily-sales-matrix-report",
  );
  const options = await listSalesPointOptions(ctx.salesPointId);
  const resolvedSp =
    ctx.salesPointId ??
    (salesPointId != null && Number.isFinite(Number(salesPointId))
      ? Number(salesPointId)
      : null);
  const spLabel =
    options.find((o) => o.id === resolvedSp)?.name ??
    (resolvedSp == null ? "All sales points" : `SP #${resolvedSp}`);
  const daysInMonth = period
    ? Number(period.endDate.slice(8, 10))
    : 31;
  return {
    settings,
    monthStartIso: period?.startDate ?? asAt.slice(0, 8) + "01",
    monthEndIso: period?.endDate ?? asAt,
    asAtIso: asAt,
    monthLabel: period?.monthName ?? "",
    selectedSalesPointId: resolvedSp,
    scopedSalesPointId: ctx.salesPointId,
    salesPointLabel: spLabel,
    salesPointOptions: options,
    selectedProductId: null,
    productLabel: "All products",
    productOptions: [],
    daysInMonth,
    rows: [],
    columnTotals: {
      industry: 0,
      wholeSale: 0,
      retail: 0,
      cdcWorker: 0,
      staff: 0,
      trnsfr: 0,
      total: 0,
    },
    grandTotal: 0,
    generatedAtIso,
    comments,
  };
}
