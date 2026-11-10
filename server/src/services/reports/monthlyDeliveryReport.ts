/**
 * Monthly palm oil products deliveries (tons + value) by half-year.
 * Ports src/electron/reports/monthlyDeliveryReport.ts.
 */
import { prisma } from "../../db/prisma.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
} from "../reportCompany.js";
import { resolveOpenPeriodReportContext } from "./openPeriodReportContext.js";
import {
  PALM_OIL_KG_PER_LITRE,
  detectBottledPack,
  loadProducts,
  parseQty,
  reportScopedSalesPointId,
  sum,
  type ProductRow,
} from "./reportShared.js";

const MONTH_NAMES = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUNE",
  "JULY",
  "AUG",
  "SEPT",
  "OCT",
  "NOV",
  "DEC",
] as const;

const LOOSE_CUSTOMER_ROWS = [
  { id: "industries", label: "INDUSTRIES" },
  { id: "wholesales", label: "WHOLESALES" },
  { id: "retail", label: "RETAIL" },
  { id: "ration", label: "WORKERS/RATION/PR" },
] as const;

type MonthlyDeliveryCell = { tons: number; value: number };
type MonthlyDeliveryMonthColumn = { month: number; label: string };
type MonthlyDeliveryRow = {
  label: string;
  indent?: boolean;
  kind: "data" | "subtotal" | "total" | "avg_price";
  months: MonthlyDeliveryCell[];
  toDate: MonthlyDeliveryCell;
};
type MonthlyDeliverySection = {
  sectionNo: number;
  title: string;
  rows: MonthlyDeliveryRow[];
};
type MonthlyDeliveryBudgetMetric = {
  id: string;
  tonsLabel: string;
  valueLabel: string;
  estimateTons: number;
  actualTons: number;
  estimateValue: number;
  actualValue: number;
};
type MonthlyDeliveryBudgetSection = {
  title: string;
  metrics: MonthlyDeliveryBudgetMetric[];
  grandEstimateValue: number;
  grandActualValue: number;
  variance: number;
};

interface CategoryRow {
  productCatId: number;
  productCat: string;
  isMain: number;
  isBottled: number;
}

interface SaleLineRecord {
  dateIssued: string;
  saleDisposition: string | null;
  customerTypeCode: string;
  customerTypeName: string;
  productId: number;
  productName: string;
  productCatId: number;
  isMain: number;
  isBottled: number;
  qtyKg: number;
  qtyUnits: number | null;
  lineNet: number;
}

function kgToTons(kg: number): number {
  return kg / 1000;
}

function resolveLooseCategoryId(
  saleDisposition: string | null,
  customerTypeCode: string,
  customerTypeName: string,
): (typeof LOOSE_CUSTOMER_ROWS)[number]["id"] {
  if (saleDisposition === "RATION") {
    return "ration";
  }
  if (saleDisposition === "RETAIL") {
    return "retail";
  }
  const text = `${customerTypeCode} ${customerTypeName}`.toUpperCase();
  if (text.includes("WHOLESALE")) {
    return "wholesales";
  }
  if (text.includes("RETAIL")) {
    return "retail";
  }
  if (text.includes("INDUSTR")) {
    return "industries";
  }
  return "ration";
}

async function loadCategories(): Promise<CategoryRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      product_cat_id: number;
      product_cat: string;
      is_main: boolean | null;
      is_bottled: boolean | null;
    }>
  >`
    SELECT product_cat_id, product_cat, is_main, is_bottled
    FROM product_cats
    ORDER BY is_main DESC, is_bottled ASC, product_cat ASC
  `;
  return rows.map((row) => ({
    productCatId: row.product_cat_id,
    productCat: String(row.product_cat),
    isMain: row.is_main ? 1 : 0,
    isBottled: row.is_bottled ? 1 : 0,
  }));
}

async function loadSaleLines(
  yearFromIso: string,
  yearToIso: string,
  salesPointId?: number | null,
): Promise<SaleLineRecord[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      date_issued: string;
      sale_disposition: string | null;
      customer_type_code: string | null;
      customer_type_name: string | null;
      product_id: number;
      product_name: string;
      product_cat_id: number;
      is_main: boolean | null;
      is_bottled: boolean | null;
      qty_kg: string;
      qty_units: string | null;
      line_net: string;
    }>
  >`
    SELECT s.date_issued,
           s.sale_disposition,
           COALESCE(pct.code, ct.code, '') AS customer_type_code,
           COALESCE(pct.name, ct.name, '') AS customer_type_name,
           sl.product_id,
           p.product_name,
           p.product_cat_id,
           COALESCE(pc.is_main, false) AS is_main,
           COALESCE(pc.is_bottled, false) AS is_bottled,
           sl.qty_kg,
           sl.qty_units,
           sl.line_net
    FROM sales s
    INNER JOIN sale_lines sl ON sl.sale_id = s.id
    INNER JOIN products p ON p.product_id = sl.product_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN customer_type_definitions ct ON ct.id = c.customer_type_id
    LEFT JOIN delivery_orders d
      ON d.delivery_order_no = s.delivery_order_no
     AND d.status = 'VALIDATED'
    LEFT JOIN delivery_order_details dd
      ON dd.delivery_order_id = d.id
     AND dd.product_id = sl.product_id
    LEFT JOIN customer_type_definitions pct ON pct.id = dd.pricing_customer_type_id
    WHERE s.status = 'VALIDATED'
      AND s.date_issued >= ${yearFromIso}
      AND s.date_issued <= ${yearToIso}
      AND (${salesPointId}::int IS NULL OR s.sales_point_id = ${salesPointId})
  `;

  return rows.map((row) => ({
    dateIssued: String(row.date_issued).slice(0, 10),
    saleDisposition: row.sale_disposition,
    customerTypeCode: String(row.customer_type_code ?? ""),
    customerTypeName: String(row.customer_type_name ?? ""),
    productId: row.product_id,
    productName: String(row.product_name),
    productCatId: row.product_cat_id,
    isMain: row.is_main ? 1 : 0,
    isBottled: row.is_bottled ? 1 : 0,
    qtyKg: parseQty(row.qty_kg),
    qtyUnits: row.qty_units ? parseQty(row.qty_units) : null,
    lineNet: parseQty(row.line_net),
  }));
}

function lineKg(line: SaleLineRecord, products: ProductRow[]): number {
  if (line.isBottled === 1) {
    const product = products.find((item) => item.productId === line.productId);
    if (!product) {
      return line.qtyUnits ?? line.qtyKg;
    }
    const pack = detectBottledPack(product);
    const units = line.qtyUnits ?? line.qtyKg;
    return units * pack.litresPerUnit * PALM_OIL_KG_PER_LITRE;
  }
  return line.qtyKg;
}

function monthIndexFromIso(iso: string): number {
  return Number.parseInt(iso.slice(5, 7), 10);
}

function buildMonthColumns(
  financialYear: number,
  half: 1 | 2,
): MonthlyDeliveryMonthColumn[] {
  const startMonth = half === 1 ? 1 : 7;
  const endMonth = half === 1 ? 6 : 12;
  const columns: MonthlyDeliveryMonthColumn[] = [];

  for (let month = startMonth; month <= endMonth; month += 1) {
    columns.push({
      month,
      label: `${MONTH_NAMES[month - 1]}, ${financialYear}`,
    });
  }

  return columns;
}

function aggregateLines(
  lines: SaleLineRecord[],
  products: ProductRow[],
  monthColumns: MonthlyDeliveryMonthColumn[],
  predicate: (line: SaleLineRecord) => boolean,
): { months: MonthlyDeliveryCell[]; toDate: MonthlyDeliveryCell } {
  const months = monthColumns.map((column) => {
    const monthLines = lines.filter(
      (line) =>
        predicate(line) && monthIndexFromIso(line.dateIssued) === column.month,
    );
    const kg = sum(monthLines.map((line) => lineKg(line, products)));
    const value = sum(monthLines.map((line) => line.lineNet));
    return { tons: kgToTons(kg), value };
  });

  const allLines = lines.filter(predicate);
  const totalKg = sum(allLines.map((line) => lineKg(line, products)));
  const totalValue = sum(allLines.map((line) => line.lineNet));

  return {
    months,
    toDate: { tons: kgToTons(totalKg), value: totalValue },
  };
}

function sumCells(
  rows: MonthlyDeliveryRow[],
  monthCount: number,
): MonthlyDeliveryCell[] {
  return Array.from({ length: monthCount }, (_, monthIndex) => ({
    tons: sum(rows.map((row) => row.months[monthIndex]?.tons ?? 0)),
    value: sum(rows.map((row) => row.months[monthIndex]?.value ?? 0)),
  }));
}

function sumToDate(rows: MonthlyDeliveryRow[]): MonthlyDeliveryCell {
  return {
    tons: sum(rows.map((row) => row.toDate.tons)),
    value: sum(rows.map((row) => row.toDate.value)),
  };
}

function makeAvgPriceRow(
  label: string,
  totalRow: MonthlyDeliveryRow,
  monthCount: number,
): MonthlyDeliveryRow {
  const months = totalRow.months.map((cell) => ({
    tons: cell.tons,
    value: cell.tons > 0 ? cell.value / (cell.tons * 1000) : 0,
  }));
  const toDateValue =
    totalRow.toDate.tons > 0
      ? totalRow.toDate.value / (totalRow.toDate.tons * 1000)
      : 0;

  return {
    label,
    kind: "avg_price",
    months: months.slice(0, monthCount),
    toDate: { tons: totalRow.toDate.tons, value: toDateValue },
  };
}

function buildMainPalmOilSection(
  sectionNo: number,
  category: CategoryRow,
  lines: SaleLineRecord[],
  products: ProductRow[],
  monthColumns: MonthlyDeliveryMonthColumn[],
): MonthlyDeliverySection {
  const mainLines = lines.filter(
    (line) =>
      line.productCatId === category.productCatId && line.isBottled !== 1,
  );
  const bottledLines = lines.filter((line) => line.isBottled === 1);

  const customerRows: MonthlyDeliveryRow[] = LOOSE_CUSTOMER_ROWS.map((row) => {
    const aggregated = aggregateLines(
      mainLines,
      products,
      monthColumns,
      (line) =>
        resolveLooseCategoryId(
          line.saleDisposition,
          line.customerTypeCode,
          line.customerTypeName,
        ) === row.id,
    );
    return {
      label: row.label,
      kind: "data",
      months: aggregated.months,
      toDate: aggregated.toDate,
    };
  });

  const lpoMonths = sumCells(customerRows, monthColumns.length);
  const lpoToDate = sumToDate(customerRows);
  const lpoRow: MonthlyDeliveryRow = {
    label: "TOTAL L.P.O",
    kind: "subtotal",
    months: lpoMonths,
    toDate: lpoToDate,
  };

  const bpoAggregated = aggregateLines(
    bottledLines,
    products,
    monthColumns,
    () => true,
  );
  const bpoRow: MonthlyDeliveryRow = {
    label: "B.P.O",
    kind: "data",
    months: bpoAggregated.months,
    toDate: bpoAggregated.toDate,
  };

  const grandMonths = lpoMonths.map((cell, index) => ({
    tons: cell.tons + (bpoAggregated.months[index]?.tons ?? 0),
    value: cell.value + (bpoAggregated.months[index]?.value ?? 0),
  }));
  const grandRow: MonthlyDeliveryRow = {
    label: "G.TOTAL P.O",
    kind: "total",
    months: grandMonths,
    toDate: {
      tons: lpoToDate.tons + bpoAggregated.toDate.tons,
      value: lpoToDate.value + bpoAggregated.toDate.value,
    },
  };

  const avgRow = makeAvgPriceRow(
    "AV. SELLG Price / kg",
    grandRow,
    monthColumns.length,
  );

  return {
    sectionNo,
    title: `${sectionNo}. ${category.productCat.toUpperCase()}`,
    rows: [...customerRows, lpoRow, bpoRow, grandRow, avgRow],
  };
}

function buildProductCategorySection(
  sectionNo: number,
  category: CategoryRow,
  categoryProducts: ProductRow[],
  lines: SaleLineRecord[],
  products: ProductRow[],
  monthColumns: MonthlyDeliveryMonthColumn[],
): MonthlyDeliverySection {
  const categoryLines = lines.filter(
    (line) => line.productCatId === category.productCatId,
  );

  const productRows: MonthlyDeliveryRow[] = categoryProducts.map((product) => {
    const aggregated = aggregateLines(
      categoryLines,
      products,
      monthColumns,
      (line) => line.productId === product.productId,
    );
    return {
      label: product.productName.toUpperCase(),
      indent: true,
      kind: "data",
      months: aggregated.months,
      toDate: aggregated.toDate,
    };
  });

  const totalMonths = sumCells(productRows, monthColumns.length);
  const totalRow: MonthlyDeliveryRow = {
    label: "TOTAL",
    kind: "total",
    months: totalMonths,
    toDate: sumToDate(productRows),
  };

  const avgRow = makeAvgPriceRow(
    "AV. SELLG Price / kg",
    totalRow,
    monthColumns.length,
  );

  return {
    sectionNo,
    title: `${sectionNo}. ${category.productCat.toUpperCase()}`,
    rows: [...productRows, totalRow, avgRow],
  };
}

interface BudgetRow {
  productCatId: number;
  annualQtyKg: number;
  budgetUnitPricePerKg: number;
}

async function loadBudgets(financialYear: number): Promise<BudgetRow[]> {
  const rows = await prisma.product_sales_budgets.findMany({
    where: { financial_year: financialYear },
    select: {
      product_cat_id: true,
      annual_qty_kg: true,
      budget_unit_price_per_kg: true,
    },
  });
  return rows.map((row) => ({
    productCatId: row.product_cat_id,
    annualQtyKg: parseQty(row.annual_qty_kg),
    budgetUnitPricePerKg: parseQty(row.budget_unit_price_per_kg),
  }));
}

async function loadPhaseProfiles(
  financialYear: number,
): Promise<Map<number, number[]>> {
  const rows = await prisma.product_sales_budget_month_phase_profiles.findMany({
    where: { financial_year: financialYear },
  });

  const map = new Map<number, number[]>();
  for (const row of rows) {
    const months = [
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
    ];
    const total = sum(months);
    // Profiles may be stored as 0-1 fractions or 0-100 percentages.
    const normalized =
      total > 1.5 ? months.map((value) => value / 100) : months;
    map.set(row.product_cat_id, normalized);
  }
  return map;
}

function monthWeight(
  productCatId: number,
  month: number,
  profiles: Map<number, number[]>,
): number {
  const profile = profiles.get(productCatId);
  if (profile && profile[month - 1] != null) {
    return profile[month - 1]!;
  }
  return 1 / 12;
}

/** Calendar days in month (1–12). */
function daysInCalendarMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Day fraction of the as-at month already elapsed (inclusive of as-at day).
 * e.g. 2026-06-02 → 2/30.
 */
function asAtDayFraction(asAtIso: string): {
  asAtYear: number;
  asAtMonth: number;
  dayFraction: number;
} {
  const asAtYear = Number.parseInt(asAtIso.slice(0, 4), 10);
  const asAtMonth = Number.parseInt(asAtIso.slice(5, 7), 10);
  const asAtDay = Number.parseInt(asAtIso.slice(8, 10), 10);
  const days = daysInCalendarMonth(asAtYear, asAtMonth);
  const dayFraction =
    Number.isFinite(asAtDay) && days > 0
      ? Math.min(1, Math.max(0, asAtDay / days))
      : 1;
  return { asAtYear, asAtMonth, dayFraction };
}

function estimateForCategories(
  productCatIds: number[],
  months: number[],
  budgets: BudgetRow[],
  profiles: Map<number, number[]>,
  options?: {
    /** When set, this month's phase weight is multiplied by dayFraction. */
    prorateMonth?: number;
    dayFraction?: number;
  },
): { tons: number; value: number } {
  let kg = 0;
  let value = 0;
  const idSet = new Set(productCatIds);
  const prorateMonth = options?.prorateMonth;
  const dayFraction =
    options?.dayFraction != null && Number.isFinite(options.dayFraction)
      ? Math.min(1, Math.max(0, options.dayFraction))
      : 1;

  for (const budget of budgets) {
    if (!idSet.has(budget.productCatId)) {
      continue;
    }
    const weight = sum(
      months.map((month) => {
        let w = monthWeight(budget.productCatId, month, profiles);
        if (prorateMonth != null && month === prorateMonth) {
          w *= dayFraction;
        }
        return w;
      }),
    );
    const periodKg = budget.annualQtyKg * weight;
    kg += periodKg;
    value += periodKg * budget.budgetUnitPricePerKg;
  }

  return { tons: kgToTons(kg), value };
}

function categoryNameUpper(category: CategoryRow): string {
  return category.productCat.toUpperCase();
}

/** Loose / main palm oil category (not bottled, not kernel). */
function isLoosePalmOilCategory(category: CategoryRow): boolean {
  if (category.isMain === 1) {
    return true;
  }
  const text = categoryNameUpper(category);
  return (
    text.includes("PALM OIL") &&
    !text.includes("KERNEL") &&
    !text.includes("BOTTLED") &&
    category.isBottled !== 1
  );
}

function isBottledPalmOilCategory(category: CategoryRow): boolean {
  return category.isBottled === 1;
}

/** Palm Kernel (uncracked/cracked products) — not oil or cake. */
function isPalmKernelCategory(category: CategoryRow): boolean {
  const text = categoryNameUpper(category);
  if (text.includes("KERNEL OIL") || /\bPKO\b/.test(text)) {
    return false;
  }
  if (text.includes("KERNEL CAKE") || /\bPKC\b/.test(text)) {
    return false;
  }
  if (category.isMain === 1 || category.isBottled === 1) {
    return false;
  }
  return (
    text.includes("PALM KERNEL") ||
    (text.includes("KERNEL") && !text.includes("OIL") && !text.includes("CAKE"))
  );
}

function isPalmKernelOilCategory(category: CategoryRow): boolean {
  const text = categoryNameUpper(category);
  return text.includes("KERNEL OIL") || /\bPKO\b/.test(text);
}

function isPalmKernelCakeCategory(category: CategoryRow): boolean {
  const text = categoryNameUpper(category);
  return text.includes("KERNEL CAKE") || /\bPKC\b/.test(text);
}

function productNameUpper(product: ProductRow): string {
  return `${product.productName} ${product.productCode ?? ""}`.toUpperCase();
}

function isUncrackedPalmKernelProduct(product: ProductRow): boolean {
  return productNameUpper(product).includes("UNCRACKED");
}

function isCrackedPalmKernelProduct(product: ProductRow): boolean {
  const text = productNameUpper(product);
  return text.includes("CRACKED") && !text.includes("UNCRACKED");
}

function catIds(
  categories: CategoryRow[],
  pred: (c: CategoryRow) => boolean,
): number[] {
  return categories.filter(pred).map((c) => c.productCatId);
}

function buildBudgetMetric(input: {
  id: string;
  tonsLabel: string;
  valueLabel: string;
  estimateCatIds: number[];
  lineMatches: (line: SaleLineRecord) => boolean;
  estimateMonths: number[];
  monthColumns: MonthlyDeliveryMonthColumn[];
  budgets: BudgetRow[];
  profiles: Map<number, number[]>;
  products: ProductRow[];
  lines: SaleLineRecord[];
  asAtIso: string;
  prorateMonth: number | null;
  dayFraction: number;
}): MonthlyDeliveryBudgetMetric {
  const {
    id,
    tonsLabel,
    valueLabel,
    estimateCatIds,
    lineMatches,
    estimateMonths,
    monthColumns,
    budgets,
    profiles,
    products,
    lines,
    asAtIso,
    prorateMonth,
    dayFraction,
  } = input;

  const estimate = estimateForCategories(
    estimateCatIds,
    estimateMonths,
    budgets,
    profiles,
    prorateMonth != null ? { prorateMonth, dayFraction } : undefined,
  );

  const monthSet = new Set(estimateMonths);

  // Actuals match estimate window: months in scope and invoice date ≤ as-at day.
  const actualLines = lines.filter(
    (line) =>
      monthSet.has(monthIndexFromIso(line.dateIssued)) &&
      line.dateIssued <= asAtIso,
  );
  const actualColumns = monthColumns.filter((column) =>
    monthSet.has(column.month),
  );
  const actual = aggregateLines(
    actualLines,
    products,
    actualColumns.length > 0 ? actualColumns : monthColumns,
    lineMatches,
  ).toDate;

  return {
    id,
    tonsLabel,
    valueLabel,
    estimateTons: estimate.tons,
    actualTons: actual.tons,
    estimateValue: estimate.value,
    actualValue: actual.value,
  };
}

function sumBudgetMetrics(
  metrics: MonthlyDeliveryBudgetMetric[],
  id: string,
  tonsLabel: string,
  valueLabel: string,
): MonthlyDeliveryBudgetMetric {
  return {
    id,
    tonsLabel,
    valueLabel,
    estimateTons: sum(metrics.map((m) => m.estimateTons)),
    actualTons: sum(metrics.map((m) => m.actualTons)),
    estimateValue: sum(metrics.map((m) => m.estimateValue)),
    actualValue: sum(metrics.map((m) => m.actualValue)),
  };
}

async function buildBudgetSections(input: {
  financialYear: number;
  asAtIso: string;
  categories: CategoryRow[];
  products: ProductRow[];
  /** Full-year validated lines (budget TO-DATE is year-to-date, not half-scoped). */
  lines: SaleLineRecord[];
}): Promise<{
  kernelPkBudgetSection: MonthlyDeliveryBudgetSection;
  budgetSection: MonthlyDeliveryBudgetSection;
}> {
  const { financialYear, asAtIso, categories, products, lines } = input;
  const { asAtYear, asAtMonth, dayFraction } = asAtDayFraction(asAtIso);

  // Year-to-date calendar months in the financial year (Jan … as-at month).
  let estimateMonths: number[];
  if (asAtYear > financialYear) {
    estimateMonths = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  } else if (asAtYear < financialYear) {
    estimateMonths = [];
  } else {
    estimateMonths = Array.from({ length: asAtMonth }, (_, i) => i + 1);
  }

  if (estimateMonths.length === 0) {
    estimateMonths = [1];
  }

  const prorateMonth =
    asAtYear === financialYear && estimateMonths.includes(asAtMonth)
      ? asAtMonth
      : null;

  const ytdMonthColumns: MonthlyDeliveryMonthColumn[] = estimateMonths.map(
    (month) => ({
      label: MONTH_NAMES[month - 1] ?? String(month),
      month,
    }),
  );

  const [budgets, profiles] = await Promise.all([
    loadBudgets(financialYear),
    loadPhaseProfiles(financialYear),
  ]);

  const metricContext = {
    estimateMonths,
    monthColumns: ytdMonthColumns,
    budgets,
    profiles,
    products,
    lines,
    asAtIso,
    prorateMonth,
    dayFraction: prorateMonth != null ? dayFraction : 1,
  };

  const loosePalmCatIds = catIds(categories, isLoosePalmOilCategory);
  const bottledPalmCatIds = catIds(categories, isBottledPalmOilCategory);
  const palmOilCatIds = [
    ...new Set([...loosePalmCatIds, ...bottledPalmCatIds]),
  ];
  const palmKernelCatIds = catIds(categories, isPalmKernelCategory);
  const pkoCatIds = catIds(categories, isPalmKernelOilCategory);
  const pkcCatIds = catIds(categories, isPalmKernelCakeCategory);

  const palmKernelCatIdSet = new Set(palmKernelCatIds);
  const productById = new Map(products.map((p) => [p.productId, p] as const));

  const lineInCats =
    (catIdSet: Set<number>) =>
    (line: SaleLineRecord): boolean =>
      catIdSet.has(line.productCatId);

  const lineUncrackedPk = (line: SaleLineRecord): boolean => {
    if (!palmKernelCatIdSet.has(line.productCatId)) {
      return false;
    }
    const product = productById.get(line.productId);
    return product != null && isUncrackedPalmKernelProduct(product);
  };

  const lineCrackedPk = (line: SaleLineRecord): boolean => {
    if (!palmKernelCatIdSet.has(line.productCatId)) {
      return false;
    }
    const product = productById.get(line.productId);
    return product != null && isCrackedPalmKernelProduct(product);
  };

  // Uncracked / cracked share the Palm Kernel category budget. Show the YTD estimate
  // on cracked only (matches legacy spreadsheet); uncracked estimate stays blank.
  const uncracked = buildBudgetMetric({
    id: "uncracked",
    tonsLabel: "UNCRACKED P.K(TONS)",
    valueLabel: "UNCRACKED P.K(FCFA)",
    estimateCatIds: [],
    lineMatches: lineUncrackedPk,
    ...metricContext,
  });

  const cracked = buildBudgetMetric({
    id: "cracked",
    tonsLabel: "CRACKED P.K(TONS)",
    valueLabel: "CRACKED P.K(FCFA)",
    estimateCatIds: palmKernelCatIds,
    lineMatches: lineCrackedPk,
    ...metricContext,
  });

  const pKernel = sumBudgetMetrics(
    [uncracked, cracked],
    "p_kernel",
    "P. KERNEL (TONS)",
    "P. KERNEL (FCFA)",
  );

  const palmOil = buildBudgetMetric({
    id: "palm_oil",
    tonsLabel: "PALM OIL (TONS)",
    valueLabel: "PALM OIL (FCFA)",
    estimateCatIds: palmOilCatIds,
    lineMatches: lineInCats(new Set(palmOilCatIds)),
    ...metricContext,
  });

  const pko = buildBudgetMetric({
    id: "pko",
    tonsLabel: "P. KERNEL OIL (TONS)",
    valueLabel: "P. KERNEL OIL (FCFA)",
    estimateCatIds: pkoCatIds,
    lineMatches: lineInCats(new Set(pkoCatIds)),
    ...metricContext,
  });

  const pkc = buildBudgetMetric({
    id: "pkc",
    tonsLabel: "P. Kernel Cake(Tons)",
    valueLabel: "P. Kernel Cake (FCFA)",
    estimateCatIds: pkcCatIds,
    lineMatches: lineInCats(new Set(pkcCatIds)),
    ...metricContext,
  });

  // G.TOTAL includes main products + P. KERNEL (FCFA) from the kernel table.
  const grandEstimateValue =
    palmOil.estimateValue +
    pko.estimateValue +
    pkc.estimateValue +
    pKernel.estimateValue;
  const grandActualValue =
    palmOil.actualValue +
    pko.actualValue +
    pkc.actualValue +
    pKernel.actualValue;

  return {
    kernelPkBudgetSection: {
      title: `Budget ${financialYear}`,
      metrics: [uncracked, cracked, pKernel],
      grandEstimateValue: 0,
      grandActualValue: 0,
      variance: 0,
    },
    budgetSection: {
      title: `Budget ${financialYear}`,
      metrics: [palmOil, pko, pkc],
      grandEstimateValue,
      grandActualValue,
      variance: grandEstimateValue - grandActualValue,
    },
  };
}

export async function getMonthlyDeliveryReport(
  userId: string | null | undefined,
  half: 1 | 2,
) {
  const { asAtIso, period } = await resolveOpenPeriodReportContext(userId);
  const financialYear = period.financialYear;
  const monthColumns = buildMonthColumns(financialYear, half);
  const yearFromIso = `${financialYear}-01-01`;
  const yearToIso = `${financialYear}-12-31`;

  const [settings, categories, products, scopedSalesPointId, comments] =
    await Promise.all([
      loadReportCompanySettings(userId, asAtIso),
      loadCategories(),
      loadProducts(),
      reportScopedSalesPointId(userId),
      loadReportComments(
        half === 1 ? "monthly-delivery-report-h1" : "monthly-delivery-report-h2",
      ),
    ]);

  const allLines = await loadSaleLines(
    yearFromIso,
    yearToIso,
    scopedSalesPointId,
  );

  const halfMonths = new Set(monthColumns.map((column) => column.month));
  const lines = allLines.filter((line) =>
    halfMonths.has(monthIndexFromIso(line.dateIssued)),
  );

  const sections: MonthlyDeliverySection[] = [];
  let sectionNo = 1;

  for (const category of categories) {
    if (category.isBottled === 1) {
      continue;
    }

    if (category.isMain === 1) {
      sections.push(
        buildMainPalmOilSection(
          sectionNo,
          category,
          lines,
          products,
          monthColumns,
        ),
      );
      sectionNo += 1;
      continue;
    }

    const categoryProducts = products.filter(
      (product) => product.productCatId === category.productCatId,
    );
    if (categoryProducts.length === 0) {
      continue;
    }

    sections.push(
      buildProductCategorySection(
        sectionNo,
        category,
        categoryProducts,
        lines,
        products,
        monthColumns,
      ),
    );
    sectionNo += 1;
  }

  const halfLabel = half === 1 ? "JANUARY – JUNE" : "JULY – DECEMBER";
  // Budget TO-DATE is year-to-date through as-at (not limited to this half).
  const { kernelPkBudgetSection, budgetSection } = await buildBudgetSections({
    financialYear,
    asAtIso,
    categories,
    products,
    lines: allLines,
  });

  return {
    settings,
    financialYear,
    half,
    asAtIso,
    generatedAtIso: nowIso(),
    reportTitle: `${financialYear} MONTHLY PALM OIL PRODUCTS DELIVERIES IN TONS AND VALUE TAXES EXCLUDED (${halfLabel})`,
    monthColumns,
    sections,
    kernelPkBudgetSection,
    budgetSection,
    comments,
  };
}
