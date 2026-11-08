import type {
  MonthlyDeliveryBudgetMetric,
  MonthlyDeliveryBudgetSection,
  MonthlyDeliveryCell,
  MonthlyDeliveryMonthColumn,
  MonthlyDeliveryReport,
  MonthlyDeliveryRow,
  MonthlyDeliverySection,
} from "../../shared/reports.types.js";
import { loadReportCompanySettings, loadReportComments } from "./companySettings.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import {
  PALM_OIL_KG_PER_LITRE,
  detectBottledPack,
  loadProducts,
  nowIso,
  parseQty,
  reportScopedSalesPointId,
  salesPointFilterSql,
  sum,
  type ProductRow,
} from "./shared.js";
import { getDatabase } from "../db/index.js";

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

function emptyCell(): MonthlyDeliveryCell {
  return { tons: 0, value: 0 };
}

function kgToTons(kg: number): number {
  return kg / 1000;
}

function resolveLooseCategoryId(
  saleDisposition: string | null,
  customerTypeCode: string,
  customerTypeName: string,
): (typeof LOOSE_CUSTOMER_ROWS)[number]["id"] {
  // Ration disposition always maps to CDOWORKERS.
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
  // Staff/Worker, unnamed invoice customers, and other types → CDOWORKERS.
  return "ration";
}

function loadCategories(): CategoryRow[] {
  return getDatabase()
    .prepare(
      `SELECT productCatId, productCat, isMain, isBottled
       FROM ProductCat
       ORDER BY isMain DESC, isBottled ASC, productCat ASC`,
    )
    .all() as CategoryRow[];
}

function loadSaleLines(
  yearFromIso: string,
  yearToIso: string,
  salesPointId?: number | null,
): SaleLineRecord[] {
  const sp = salesPointFilterSql("s.salesPointId", salesPointId);
  return getDatabase()
    .prepare(
      `SELECT s.dateIssued, s.saleDisposition,
              COALESCE(pct.code, ct.code) AS customerTypeCode,
              COALESCE(pct.name, ct.name) AS customerTypeName,
              sl.productId, p.productName, p.productCatId,
              COALESCE(pc.isMain, 0) AS isMain, COALESCE(pc.isBottled, 0) AS isBottled,
              sl.qtyKg, sl.qtyUnits, sl.lineNet
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       INNER JOIN Product p ON p.productId = sl.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       LEFT JOIN Customer c ON c.id = s.customerId
       LEFT JOIN CustomerTypeDefinition ct ON ct.id = c.customerTypeId
       LEFT JOIN DeliveryOrder d
         ON d.deliveryOrderNo = s.deliveryOrderNo
        AND d.status = 'VALIDATED'
       LEFT JOIN DeliveryOrderDetails dd
         ON dd.deliveryOrderId = d.id
        AND dd.productId = sl.productId
       LEFT JOIN CustomerTypeDefinition pct ON pct.id = dd.pricingCustomerTypeId
       WHERE s.status = 'VALIDATED'
         AND s.dateIssued >= ?
         AND s.dateIssued <= ?${sp.clause}`,
    )
    .all(yearFromIso, yearToIso, ...sp.params)
    .map((row) => ({
      dateIssued: String((row as { dateIssued: string }).dateIssued),
      saleDisposition: (row as { saleDisposition: string | null })
        .saleDisposition,
      customerTypeCode: String(
        (row as { customerTypeCode: string | null }).customerTypeCode ?? "",
      ),
      customerTypeName: String(
        (row as { customerTypeName: string | null }).customerTypeName ?? "",
      ),
      productId: (row as { productId: number }).productId,
      productName: String((row as { productName: string }).productName),
      productCatId: (row as { productCatId: number }).productCatId,
      isMain: (row as { isMain: number }).isMain,
      isBottled: (row as { isBottled: number }).isBottled,
      qtyKg: parseQty((row as { qtyKg: string }).qtyKg),
      qtyUnits: (row as { qtyUnits: string | null }).qtyUnits
        ? parseQty((row as { qtyUnits: string }).qtyUnits)
        : null,
      lineNet: parseQty((row as { lineNet: string }).lineNet),
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

function loadBudgets(financialYear: number): BudgetRow[] {
  return getDatabase()
    .prepare(
      `SELECT productCatId, annualQtyKg, budgetUnitPricePerKg
       FROM ProductSalesBudget
       WHERE financialYear = ?`,
    )
    .all(financialYear)
    .map((row) => ({
      productCatId: (row as { productCatId: number }).productCatId,
      annualQtyKg: parseQty((row as { annualQtyKg: string }).annualQtyKg),
      budgetUnitPricePerKg: parseQty(
        (row as { budgetUnitPricePerKg: string }).budgetUnitPricePerKg,
      ),
    }));
}

function loadPhaseProfiles(financialYear: number): Map<number, number[]> {
  const rows = getDatabase()
    .prepare(
      `SELECT productCatId, pctM01, pctM02, pctM03, pctM04, pctM05, pctM06,
              pctM07, pctM08, pctM09, pctM10, pctM11, pctM12
       FROM ProductSalesBudgetMonthPhaseProfile
       WHERE financialYear = ?`,
    )
    .all(financialYear) as Array<Record<string, unknown>>;

  const map = new Map<number, number[]>();
  for (const row of rows) {
    const months = [
      parseQty(row.pctM01 as string),
      parseQty(row.pctM02 as string),
      parseQty(row.pctM03 as string),
      parseQty(row.pctM04 as string),
      parseQty(row.pctM05 as string),
      parseQty(row.pctM06 as string),
      parseQty(row.pctM07 as string),
      parseQty(row.pctM08 as string),
      parseQty(row.pctM09 as string),
      parseQty(row.pctM10 as string),
      parseQty(row.pctM11 as string),
      parseQty(row.pctM12 as string),
    ];
    const total = sum(months);
    // Profiles may be stored as 0-1 fractions or 0-100 percentages.
    const normalized =
      total > 1.5 ? months.map((value) => value / 100) : months;
    map.set(Number(row.productCatId), normalized);
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

function catIds(categories: CategoryRow[], pred: (c: CategoryRow) => boolean): number[] {
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
    prorateMonth != null
      ? { prorateMonth, dayFraction }
      : undefined,
  );

  const monthSet = new Set(estimateMonths);

  // Actuals match estimate window: months in scope and invoice date ≤ as-at day.
  const actualLines = lines.filter(
    (line) =>
      monthSet.has(monthIndexFromIso(line.dateIssued)) &&
      line.dateIssued <= asAtIso,
  );
  const actualColumns = monthColumns.filter((column) => monthSet.has(column.month));
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

function buildBudgetSections(input: {
  financialYear: number;
  asAtIso: string;
  categories: CategoryRow[];
  products: ProductRow[];
  /** Full-year validated lines (budget TO-DATE is year-to-date, not half-scoped). */
  lines: SaleLineRecord[];
}): {
  kernelPkBudgetSection: MonthlyDeliveryBudgetSection;
  budgetSection: MonthlyDeliveryBudgetSection;
} {
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

  const budgets = loadBudgets(financialYear);
  const profiles = loadPhaseProfiles(financialYear);

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
  const palmOilCatIds = [...new Set([...loosePalmCatIds, ...bottledPalmCatIds])];
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
    palmOil.estimateValue + pko.estimateValue + pkc.estimateValue + pKernel.estimateValue;
  const grandActualValue =
    palmOil.actualValue + pko.actualValue + pkc.actualValue + pKernel.actualValue;

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

export function getMonthlyDeliveryReport(
  half: 1 | 2,
  userId?: string | null,
): MonthlyDeliveryReport {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const settings = loadReportCompanySettings(userId, asAtIso);
  const financialYear = period.financialYear;
  const categories = loadCategories();
  const products = loadProducts();
  const monthColumns = buildMonthColumns(financialYear, half);

  const yearFromIso = `${financialYear}-01-01`;
  const yearToIso = `${financialYear}-12-31`;
  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const allLines = loadSaleLines(yearFromIso, yearToIso, scopedSalesPointId);

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
  const { kernelPkBudgetSection, budgetSection } = buildBudgetSections({
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
    comments: loadReportComments(
      half === 1 ? "monthly-delivery-report-h1" : "monthly-delivery-report-h2",
    ),
  };
}
