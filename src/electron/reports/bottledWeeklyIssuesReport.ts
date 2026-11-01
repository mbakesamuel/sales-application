import type {
  BottledWeeklyCompareSection,
  BottledWeeklyDayBlock,
  BottledWeeklyDetailFooterRow,
  BottledWeeklyDetailSection,
  BottledWeeklyDetailTotals,
  BottledWeeklyEstimateBasis,
  BottledWeeklyIssuesReport,
  BottledWeeklyPackColumn,
  BottledWeeklyPackId,
  BottledWeeklyPaymentMethod,
  BottledWeeklySummaryRow,
  BottledWeeklySummarySection,
} from "../../shared/reports.types.js";
import { getDatabase } from "../db/index.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import { loadReportCompanySettings, loadReportComments } from "./companySettings.js";
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
import {
  buildWeekChoices,
  maxIso,
  minIso,
  mondayOf,
  parseLocalIso,
  resolveSelectedWeek,
  startOfDay,
  toIsoDate,
} from "./weekChoices.js";

const METHOD_ORDER: BottledWeeklyPaymentMethod[] = ["CASH", "CREDIT", "PRO"];

const METHOD_LABELS: Record<BottledWeeklyPaymentMethod, string> = {
  CASH: "CASH",
  CREDIT: "CREDIT",
  PRO: "PRO",
};

const DAY_LABELS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;

const PACK_COLUMNS: Array<BottledWeeklyPackColumn & { packIds: readonly string[] }> = [
  { id: "jug20", label: "1 X 20 L JUGS", litresPerUnit: 20, packIds: ["jug20"] },
  {
    id: "carton15",
    label: "1L X 15 CARTONS",
    litresPerUnit: 15,
    packIds: ["carton15", "unit1"],
  },
  { id: "carton5", label: "3 X 5L CARTONS", litresPerUnit: 15, packIds: ["carton5"] },
];

function packColumnIndex(packId: string): number {
  return PACK_COLUMNS.findIndex((column) => column.packIds.includes(packId));
}

function formatSlashDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  if (!year || !month || !day) {
    return isoDate;
  }
  return `${day}/${month}/${year}`;
}

function buildFullWeekdayRows(
  weekMondayIso: string,
): Array<{ id: string; label: string; isoDate: string; displayDate: string }> {
  const monday = parseLocalIso(weekMondayIso);
  return DAY_LABELS.map((label, offset) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    const isoDate = toIsoDate(date);
    return {
      id: `d${offset}`,
      label,
      isoDate,
      displayDate: formatSlashDate(isoDate),
    };
  });
}

const ESTIMATE_BASIS_LABELS: Record<BottledWeeklyEstimateBasis, string> = {
  "working-days": "Working days (Mon–Fri)",
  "iso-week": "Full ISO week",
};

export function normalizeBottledWeeklyEstimateBasis(
  value: unknown,
): BottledWeeklyEstimateBasis {
  return value === "iso-week" ? "iso-week" : "working-days";
}

const MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
] as const;

interface SaleIssueLine {
  saleId: string;
  dateIssued: string;
  saleDisposition: string | null;
  productId: number;
  units: number;
  lineNet: number;
}

interface SalePaymentShare {
  saleId: string;
  method: BottledWeeklyPaymentMethod;
  share: number;
}

/** Inclusive calendar days in [fromIso, toIso] that fall in calendarYear/calendarMonth. */
function countDaysInCalendarMonth(
  fromIso: string,
  toIso: string,
  calendarYear: number,
  calendarMonth: number,
): number {
  const from = startOfDay(new Date(`${fromIso}T00:00:00`));
  const to = startOfDay(new Date(`${toIso}T00:00:00`));
  if (from > to) {
    return 0;
  }
  let count = 0;
  const cursor = new Date(from);
  while (cursor.getTime() <= to.getTime()) {
    if (cursor.getFullYear() === calendarYear && cursor.getMonth() + 1 === calendarMonth) {
      count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Week window for ESTM day-share (sales-budget weekly phasing style).
 * working-days: report Mon–Fri window; iso-week: true Monday–Sunday of that ISO week
 * (derive Monday via mondayOf — weekFromIso may be month-clipped, e.g. Jan 1).
 */
function estimateWeekWindow(
  weekFromIso: string,
  weekToIso: string,
  basis: BottledWeeklyEstimateBasis,
): { fromIso: string; toIso: string } {
  if (basis === "working-days") {
    return { fromIso: weekFromIso, toIso: weekToIso };
  }
  const monday = mondayOf(parseLocalIso(weekFromIso));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { fromIso: toIsoDate(monday), toIso: toIsoDate(sunday) };
}

function weekEstimateDayFraction(args: {
  weekFromIso: string;
  weekToIso: string;
  calendarYear: number;
  calendarMonth: number;
  basis: BottledWeeklyEstimateBasis;
}): { dayFraction: number; daysInMonth: number; daysInWeekInMonth: number } {
  const daysInMonth = new Date(args.calendarYear, args.calendarMonth, 0).getDate();
  const window = estimateWeekWindow(args.weekFromIso, args.weekToIso, args.basis);
  const daysInWeekInMonth = countDaysInCalendarMonth(
    window.fromIso,
    window.toIso,
    args.calendarYear,
    args.calendarMonth,
  );
  return {
    daysInMonth,
    daysInWeekInMonth,
    dayFraction: daysInMonth > 0 ? daysInWeekInMonth / daysInMonth : 0,
  };
}

function classifyMethod(
  disposition: string | null,
  paymentKind: string | null,
  paymentCode: string | null,
): BottledWeeklyPaymentMethod {
  const kind = (paymentKind ?? "").toUpperCase();
  const code = (paymentCode ?? "").toUpperCase();
  if (code === "PUBLIC_RELATION" || kind === "PUBLIC_RELATION") {
    return "PRO";
  }
  if (code === "RATION" || (kind === "CREDIT" && code.includes("RATION"))) {
    return "CREDIT";
  }
  if (disposition === "PUBLIC_RELATION") {
    return "PRO";
  }
  if (disposition === "RATION") {
    return "CREDIT";
  }
  if (kind === "CREDIT" || code.includes("CREDIT")) {
    return "CREDIT";
  }
  return "CASH";
}

function loadBottledIssueLines(
  fromIso: string,
  toIso: string,
  salesPointId?: number | null,
): SaleIssueLine[] {
  const sp = salesPointFilterSql("s.salesPointId", salesPointId);
  return getDatabase()
    .prepare(
      `SELECT s.id AS saleId, s.dateIssued, s.saleDisposition, sl.productId,
              COALESCE(sl.qtyUnits, sl.qtyKg) AS units, sl.lineNet
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       INNER JOIN Product p ON p.productId = sl.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE s.status = 'VALIDATED'
         AND COALESCE(pc.isBottled, 0) = 1
         AND s.dateIssued >= ?
         AND s.dateIssued <= ?${sp.clause}`,
    )
    .all(fromIso, toIso, ...sp.params)
    .map((row) => ({
      saleId: String((row as { saleId: string }).saleId),
      dateIssued: String((row as { dateIssued: string }).dateIssued).slice(0, 10),
      saleDisposition: (row as { saleDisposition: string | null }).saleDisposition,
      productId: (row as { productId: number }).productId,
      units: parseQty((row as { units: string | number }).units),
      lineNet: parseQty((row as { lineNet: string }).lineNet),
    }));
}

function loadPaymentShares(saleIds: string[]): Map<string, SalePaymentShare[]> {
  const result = new Map<string, SalePaymentShare[]>();
  if (saleIds.length === 0) {
    return result;
  }

  const placeholders = saleIds.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `SELECT pay.saleId, pay.amount, pm.kind, pm.code
       FROM Payment pay
       INNER JOIN PaymentMethodDefinition pm ON pm.id = pay.paymentMethodId
       WHERE pay.saleId IN (${placeholders})`,
    )
    .all(...saleIds) as Array<{
    saleId: string;
    amount: string;
    kind: string;
    code: string;
  }>;

  const bySale = new Map<string, Array<{ method: BottledWeeklyPaymentMethod; amount: number }>>();
  for (const row of rows) {
    const method = classifyMethod(null, row.kind, row.code);
    const list = bySale.get(row.saleId) ?? [];
    list.push({ method, amount: Math.abs(parseQty(row.amount)) });
    bySale.set(row.saleId, list);
  }

  for (const [saleId, payments] of bySale) {
    const total = sum(payments.map((payment) => payment.amount));
    if (total <= 0) {
      result.set(saleId, [{ saleId, method: "CASH", share: 1 }]);
      continue;
    }
    const merged = new Map<BottledWeeklyPaymentMethod, number>();
    for (const payment of payments) {
      merged.set(payment.method, (merged.get(payment.method) ?? 0) + payment.amount / total);
    }
    result.set(
      saleId,
      [...merged.entries()].map(([method, share]) => ({ saleId, method, share })),
    );
  }

  return result;
}

function unitsToKg(units: number, litresPerUnit: number): number {
  return units * litresPerUnit * PALM_OIL_KG_PER_LITRE;
}

function resolveLineShares(
  line: SaleIssueLine,
  paymentShares: Map<string, SalePaymentShare[]>,
): SalePaymentShare[] {
  const shares = paymentShares.get(line.saleId);
  if (shares && shares.length > 0) {
    return shares;
  }
  if (line.saleDisposition === "PUBLIC_RELATION") {
    return [{ saleId: line.saleId, method: "PRO", share: 1 }];
  }
  if (line.saleDisposition === "RATION") {
    return [{ saleId: line.saleId, method: "CREDIT", share: 1 }];
  }
  return [{ saleId: line.saleId, method: "CASH", share: 1 }];
}

function buildDetailSection(args: {
  monthLabel: string;
  monthFromIso: string;
  days: Array<{ id: string; label: string; isoDate: string; displayDate: string }>;
  weekLines: SaleIssueLine[];
  monthLines: SaleIssueLine[];
  products: ProductRow[];
  paymentShares: Map<string, SalePaymentShare[]>;
}): BottledWeeklyDetailSection {
  const packByProduct = new Map(
    args.products
      .filter((product) => product.isBottled === 1)
      .map((product) => [product.productId, detectBottledPack(product)]),
  );

  type Cell = { packUnits: number[]; packValues: number[]; valueFcfa: number };
  const cellKey = (isoDate: string, method: BottledWeeklyPaymentMethod) =>
    `${isoDate}|${method}`;
  const cells = new Map<string, Cell>();
  function cellFor(isoDate: string, method: BottledWeeklyPaymentMethod): Cell {
    const key = cellKey(isoDate, method);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        packUnits: PACK_COLUMNS.map(() => 0),
        packValues: PACK_COLUMNS.map(() => 0),
        valueFcfa: 0,
      };
      cells.set(key, cell);
    }
    return cell;
  }

  const dayIsoSet = new Set(args.days.map((day) => day.isoDate));
  for (const line of args.weekLines) {
    if (!dayIsoSet.has(line.dateIssued)) {
      continue;
    }
    const pack = packByProduct.get(line.productId);
    if (!pack) {
      continue;
    }
    const packIndex = packColumnIndex(pack.id);
    for (const share of resolveLineShares(line, args.paymentShares)) {
      const cell = cellFor(line.dateIssued, share.method);
      const sharedValue = line.lineNet * share.share;
      if (packIndex >= 0) {
        cell.packUnits[packIndex] += line.units * share.share;
        cell.packValues[packIndex] += sharedValue;
      }
      cell.valueFcfa += sharedValue;
    }
  }

  let runningMtd = 0;
  const firstDayIso = args.days[0]?.isoDate;
  if (firstDayIso) {
    for (const line of args.monthLines) {
      if (line.dateIssued >= firstDayIso) {
        continue;
      }
      const pack = packByProduct.get(line.productId);
      if (!pack) {
        continue;
      }
      for (const share of resolveLineShares(line, args.paymentShares)) {
        runningMtd += line.lineNet * share.share;
      }
    }
  }

  const packColumns: BottledWeeklyPackColumn[] = PACK_COLUMNS.map(
    ({ id, label, litresPerUnit }) => ({ id: id as BottledWeeklyPackId, label, litresPerUnit }),
  );

  const dayBlocks: BottledWeeklyDayBlock[] = args.days.map((day) => {
    const inOpenMonth = day.isoDate >= args.monthFromIso;
    const methods = METHOD_ORDER.map((method) => {
      const cell = cells.get(cellKey(day.isoDate, method));
      const packUnits = cell?.packUnits.slice() ?? PACK_COLUMNS.map(() => 0);
      const valueFcfa = cell?.valueFcfa ?? 0;
      const totalUnits = sum(packUnits);
      if (inOpenMonth) {
        runningMtd += valueFcfa;
      }
      return {
        method,
        label: METHOD_LABELS[method],
        packUnits,
        totalUnits,
        valueFcfa,
        monthToDateValue: runningMtd,
      };
    });
    return {
      id: day.id,
      label: day.label,
      isoDate: day.isoDate,
      displayDate: day.displayDate,
      methods,
    };
  });

  const totalsPack = PACK_COLUMNS.map(() => 0);
  const totalsPackValue = PACK_COLUMNS.map(() => 0);
  let totalsValue = 0;
  for (const day of dayBlocks) {
    for (const method of day.methods) {
      const cell = cells.get(cellKey(day.isoDate, method.method));
      for (let index = 0; index < totalsPack.length; index += 1) {
        totalsPack[index]! += method.packUnits[index] ?? 0;
        totalsPackValue[index]! += cell?.packValues[index] ?? 0;
      }
      totalsValue += method.valueFcfa;
    }
  }

  const totals: BottledWeeklyDetailTotals = {
    packUnits: totalsPack,
    totalUnits: sum(totalsPack),
    valueFcfa: totalsValue,
    monthToDateValue: runningMtd,
  };

  const litres = totalsPack.map(
    (units, index) => units * (PACK_COLUMNS[index]?.litresPerUnit ?? 0),
  );
  const kgs = litres.map((litre) => litre * PALM_OIL_KG_PER_LITRE);
  const footer: BottledWeeklyDetailFooterRow[] = [
    {
      id: "litres",
      label: "LITRES",
      packValues: litres,
      total: sum(litres),
      valueFcfa: 0,
      monthToDateValue: 0,
    },
    {
      id: "kgs",
      label: "KGS",
      packValues: kgs,
      total: sum(kgs),
      valueFcfa: 0,
      monthToDateValue: 0,
    },
    {
      id: "value",
      label: "VALUE FCFA",
      packValues: totalsPackValue,
      total: sum(totalsPackValue),
      valueFcfa: totals.valueFcfa,
      monthToDateValue: totals.monthToDateValue,
    },
  ];

  return {
    monthLabel: args.monthLabel,
    packColumns,
    days: dayBlocks,
    totals,
    footer,
  };
}

function loadBottledBudgetEstimate(args: {
  year: number;
  fromMonth: number;
  toMonth: number;
  dayFractionInMonth?: number;
}): { kg: number; value: number } {
  const budgets = getDatabase()
    .prepare(
      `SELECT b.productCatId, b.annualQtyKg, b.budgetUnitPricePerKg
       FROM ProductSalesBudget b
       INNER JOIN ProductCat pc ON pc.productCatId = b.productCatId
       WHERE b.financialYear = ?
         AND COALESCE(pc.isBottled, 0) = 1`,
    )
    .all(args.year) as Array<{
    productCatId: number;
    annualQtyKg: string;
    budgetUnitPricePerKg: string;
  }>;

  if (budgets.length === 0) {
    return { kg: 0, value: 0 };
  }

  const profiles = getDatabase()
    .prepare(
      `SELECT productCatId, pctM01, pctM02, pctM03, pctM04, pctM05, pctM06,
              pctM07, pctM08, pctM09, pctM10, pctM11, pctM12
       FROM ProductSalesBudgetMonthPhaseProfile
       WHERE financialYear = ?`,
    )
    .all(args.year) as Array<Record<string, string | number>>;

  const profileByCat = new Map<number, number[]>();
  for (const profile of profiles) {
    const months = [
      parseQty(profile.pctM01),
      parseQty(profile.pctM02),
      parseQty(profile.pctM03),
      parseQty(profile.pctM04),
      parseQty(profile.pctM05),
      parseQty(profile.pctM06),
      parseQty(profile.pctM07),
      parseQty(profile.pctM08),
      parseQty(profile.pctM09),
      parseQty(profile.pctM10),
      parseQty(profile.pctM11),
      parseQty(profile.pctM12),
    ];
    const total = sum(months);
    profileByCat.set(
      Number(profile.productCatId),
      total > 0 ? months.map((value) => value / total) : Array.from({ length: 12 }, () => 1 / 12),
    );
  }

  let kg = 0;
  let value = 0;
  for (const budget of budgets) {
    const weights =
      profileByCat.get(budget.productCatId) ?? Array.from({ length: 12 }, () => 1 / 12);
    let weight = 0;
    for (let month = args.fromMonth; month <= args.toMonth; month += 1) {
      let monthWeight = weights[month - 1] ?? 0;
      if (
        month === args.toMonth &&
        args.dayFractionInMonth != null &&
        Number.isFinite(args.dayFractionInMonth)
      ) {
        monthWeight *= Math.min(1, Math.max(0, args.dayFractionInMonth));
      }
      weight += monthWeight;
    }
    const annualKg = parseQty(budget.annualQtyKg);
    const unitPrice = parseQty(budget.budgetUnitPricePerKg);
    const periodKg = annualKg * weight;
    kg += periodKg;
    value += periodKg * unitPrice;
  }

  return { kg, value };
}

function metricFromLines(
  lines: SaleIssueLine[],
  products: ProductRow[],
  paymentShares: Map<string, SalePaymentShare[]>,
): { kg: number; value: number } {
  const packByProduct = new Map(
    products
      .filter((product) => product.isBottled === 1)
      .map((product) => [product.productId, detectBottledPack(product)]),
  );
  let kg = 0;
  let value = 0;
  for (const line of lines) {
    const pack = packByProduct.get(line.productId);
    if (!pack) {
      continue;
    }
    const lineKg = unitsToKg(line.units, pack.litresPerUnit);
    const shares =
      paymentShares.get(line.saleId) ??
      (line.saleDisposition === "PUBLIC_RELATION"
        ? [{ method: "PRO" as const, share: 1 }]
        : line.saleDisposition === "RATION"
          ? [{ method: "CREDIT" as const, share: 1 }]
          : [{ method: "CASH" as const, share: 1 }]);
    for (const share of shares) {
      kg += lineKg * share.share;
      value += line.lineNet * share.share;
    }
  }
  return { kg, value };
}

function pct(actual: number, estimate: number): number {
  if (estimate <= 0) {
    return actual > 0 ? 100 : 0;
  }
  return (actual / estimate) * 100;
}

function avgPrice(kg: number, value: number): number | null {
  if (kg <= 0) {
    return null;
  }
  return value / kg;
}

function buildSummary(args: {
  weekActual: { kg: number; value: number };
  monthActual: { kg: number; value: number };
  yearActual: { kg: number; value: number };
  weekEstimate: { kg: number; value: number };
  monthEstimate: { kg: number; value: number };
  yearEstimate: { kg: number; value: number };
}): BottledWeeklySummarySection {
  const rows: BottledWeeklySummaryRow[] = [
    {
      id: "estimate",
      label: "ESTM",
      week: { kgs: args.weekEstimate.kg, value: args.weekEstimate.value },
      monthToDate: { kgs: args.monthEstimate.kg, value: args.monthEstimate.value },
      yearToDate: { kgs: args.yearEstimate.kg, value: args.yearEstimate.value },
      averagePrice: avgPrice(args.weekEstimate.kg, args.weekEstimate.value),
    },
    {
      id: "actual",
      label: "ACTUAL",
      week: { kgs: args.weekActual.kg, value: args.weekActual.value },
      monthToDate: { kgs: args.monthActual.kg, value: args.monthActual.value },
      yearToDate: { kgs: args.yearActual.kg, value: args.yearActual.value },
      averagePrice: avgPrice(args.weekActual.kg, args.weekActual.value),
    },
    {
      id: "pct",
      label: "%TAGE ACHVD",
      week: {
        kgs: pct(args.weekActual.kg, args.weekEstimate.kg),
        value: pct(args.weekActual.value, args.weekEstimate.value),
      },
      monthToDate: {
        kgs: pct(args.monthActual.kg, args.monthEstimate.kg),
        value: pct(args.monthActual.value, args.monthEstimate.value),
      },
      yearToDate: {
        kgs: pct(args.yearActual.kg, args.yearEstimate.kg),
        value: pct(args.yearActual.value, args.yearEstimate.value),
      },
      averagePrice: null,
    },
  ];

  return { title: "SUMMARY", rows };
}

function kgByMethod(
  lines: SaleIssueLine[],
  products: ProductRow[],
  paymentShares: Map<string, SalePaymentShare[]>,
): Record<BottledWeeklyPaymentMethod, number> {
  const result: Record<BottledWeeklyPaymentMethod, number> = {
    CASH: 0,
    CREDIT: 0,
    PRO: 0,
  };
  const packByProduct = new Map(
    products
      .filter((product) => product.isBottled === 1)
      .map((product) => [product.productId, detectBottledPack(product)]),
  );
  for (const line of lines) {
    const pack = packByProduct.get(line.productId);
    if (!pack) {
      continue;
    }
    const lineKg = unitsToKg(line.units, pack.litresPerUnit);
    const shares =
      paymentShares.get(line.saleId) ??
      (line.saleDisposition === "PUBLIC_RELATION"
        ? [{ method: "PRO" as const, share: 1 }]
        : line.saleDisposition === "RATION"
          ? [{ method: "CREDIT" as const, share: 1 }]
          : [{ method: "CASH" as const, share: 1 }]);
    for (const share of shares) {
      result[share.method] += lineKg * share.share;
    }
  }
  return result;
}

function buildCompare(
  currentLabel: string,
  priorLabel: string,
  current: Record<BottledWeeklyPaymentMethod, number>,
  prior: Record<BottledWeeklyPaymentMethod, number>,
): BottledWeeklyCompareSection {
  const currentTotal = sum(METHOD_ORDER.map((method) => current[method]));
  const priorTotal = sum(METHOD_ORDER.map((method) => prior[method]));

  return {
    title: "Payment method mix",
    currentColumn: { id: "current", label: currentLabel },
    priorColumn: { id: "prior", label: priorLabel },
    rows: [
      ...METHOD_ORDER.map((method) => ({
        method,
        label: METHOD_LABELS[method],
        currentKg: current[method],
        currentPct: currentTotal > 0 ? (current[method] / currentTotal) * 100 : 0,
        priorKg: prior[method],
        priorPct: priorTotal > 0 ? (prior[method] / priorTotal) * 100 : 0,
      })),
      {
        method: "TOTAL" as const,
        label: "total KGS",
        currentKg: currentTotal,
        currentPct: currentTotal > 0 ? 100 : 0,
        priorKg: priorTotal,
        priorPct: priorTotal > 0 ? 100 : 0,
      },
    ],
  };
}

export function getBottledWeeklyIssuesReport(
  userId?: string | null,
  estimateBasisRaw?: unknown,
  weekMondayIso?: string | null,
): BottledWeeklyIssuesReport {
  const estimateBasis = normalizeBottledWeeklyEstimateBasis(estimateBasisRaw);
  const { asAtIso, period } = resolveReportAsAt();
  const settings = loadReportCompanySettings(userId, asAtIso);
  const asAt = startOfDay(new Date(`${asAtIso}T00:00:00`));

  const weekChoices = buildWeekChoices(period.startDate, period.endDate, asAtIso);
  const selected =
    resolveSelectedWeek(weekChoices, asAtIso, weekMondayIso) ??
    (() => {
      const monday = mondayOf(parseLocalIso(asAtIso));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const fromIso = toIsoDate(monday) < period.startDate ? period.startDate : toIsoDate(monday);
      const toIso = toIsoDate(sunday) > asAtIso ? asAtIso : toIsoDate(sunday);
      return {
        weekMondayIso: toIsoDate(monday),
        weekFromIso: fromIso,
        weekToIso: toIso,
        label: `${fromIso} – ${toIso}`,
      };
    })();

  const weekdayRows = buildFullWeekdayRows(selected.weekMondayIso);
  const weekMondayIsoResolved = weekdayRows[0]!.isoDate;
  const weekFridayIso = weekdayRows[weekdayRows.length - 1]!.isoDate;
  // Working-days ESTM still uses open-month Mon–Fri only (exclude prior-month dates).
  const monthWeekDays = weekdayRows.filter(
    (day) => day.isoDate >= period.startDate && day.isoDate <= asAtIso,
  );
  const clippedWeekFrom =
    monthWeekDays[0]?.isoDate ?? maxIso(weekMondayIsoResolved, period.startDate);
  const clippedWeekTo =
    monthWeekDays[monthWeekDays.length - 1]?.isoDate ??
    minIso(weekFridayIso, minIso(selected.weekToIso, asAtIso));

  // Cumulative MTD/YTD stop at the selected week end (not open-month as-at).
  const toDateIso = selected.weekToIso;
  const toDate = startOfDay(new Date(`${toDateIso}T00:00:00`));

  const monthFromIso = period.startDate;
  const yearFromIso = `${period.financialYear}-01-01`;
  const priorYear = period.financialYear - 1;
  const priorMonthFromIso = `${priorYear}-${String(period.calendarMonth).padStart(2, "0")}-01`;
  const lastDayPriorMonth = new Date(priorYear, period.calendarMonth, 0).getDate();
  const toDateDay = Number.parseInt(toDateIso.slice(8, 10), 10);
  const priorDay = Math.min(toDateDay, lastDayPriorMonth);
  const priorMonthToIso = `${priorYear}-${String(period.calendarMonth).padStart(2, "0")}-${String(priorDay).padStart(2, "0")}`;

  const products = loadProducts();
  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const rangeFromIso = yearFromIso < priorMonthFromIso ? yearFromIso : priorMonthFromIso;
  const allLines = loadBottledIssueLines(rangeFromIso, asAtIso, scopedSalesPointId);
  const saleIds = [...new Set(allLines.map((line) => line.saleId))];
  const paymentShares = loadPaymentShares(saleIds);

  const detailDayIsoSet = new Set(weekdayRows.map((day) => day.isoDate));
  const detailWeekLines = allLines.filter((line) => detailDayIsoSet.has(line.dateIssued));
  // Summary week actual stays month-clipped Mon–Fri (exclude prior-month weekday sales).
  const weekLines = detailWeekLines.filter(
    (line) => line.dateIssued >= clippedWeekFrom && line.dateIssued <= clippedWeekTo,
  );
  const monthLines = allLines.filter(
    (line) => line.dateIssued >= monthFromIso && line.dateIssued <= toDateIso,
  );
  const yearLines = allLines.filter(
    (line) => line.dateIssued >= yearFromIso && line.dateIssued <= toDateIso,
  );
  const priorMonthLines = allLines.filter(
    (line) => line.dateIssued >= priorMonthFromIso && line.dateIssued <= priorMonthToIso,
  );

  const detail = buildDetailSection({
    monthLabel: MONTH_NAMES[period.calendarMonth - 1],
    monthFromIso,
    days: weekdayRows,
    weekLines: detailWeekLines,
    monthLines,
    products,
    paymentShares,
  });

  const weekActual = metricFromLines(weekLines, products, paymentShares);
  const monthActual = metricFromLines(monthLines, products, paymentShares);
  const yearActual = metricFromLines(yearLines, products, paymentShares);

  const daysInMonth = new Date(toDate.getFullYear(), toDate.getMonth() + 1, 0).getDate();
  const dayFraction = toDate.getDate() / daysInMonth;
  const weekShare = weekEstimateDayFraction({
    // ISO week: true Monday (not month-clipped weekFrom). Working days: Mon–Fri in open month.
    weekFromIso: estimateBasis === "iso-week" ? selected.weekMondayIso : clippedWeekFrom,
    weekToIso: estimateBasis === "iso-week" ? selected.weekToIso : clippedWeekTo,
    calendarYear: period.financialYear,
    calendarMonth: period.calendarMonth,
    basis: estimateBasis,
  });

  const weekEstimate = loadBottledBudgetEstimate({
    year: period.financialYear,
    fromMonth: period.calendarMonth,
    toMonth: period.calendarMonth,
    dayFractionInMonth: weekShare.dayFraction,
  });
  const monthEstimate = loadBottledBudgetEstimate({
    year: period.financialYear,
    fromMonth: period.calendarMonth,
    toMonth: period.calendarMonth,
    dayFractionInMonth: dayFraction,
  });
  const yearEstimate = loadBottledBudgetEstimate({
    year: period.financialYear,
    fromMonth: 1,
    toMonth: period.calendarMonth,
    dayFractionInMonth: dayFraction,
  });

  const summary = buildSummary({
    weekActual,
    monthActual,
    yearActual,
    weekEstimate,
    monthEstimate,
    yearEstimate,
  });

  const currentMonthShort = `${MONTH_NAMES[period.calendarMonth - 1].slice(0, 3)} ${period.financialYear}`;
  const priorMonthShort = `${MONTH_NAMES[period.calendarMonth - 1].slice(0, 3)} ${priorYear}`;
  const compare = buildCompare(
    currentMonthShort,
    priorMonthShort,
    kgByMethod(monthLines, products, paymentShares),
    kgByMethod(priorMonthLines, products, paymentShares),
  );

  const monthShort = MONTH_NAMES[period.calendarMonth - 1].slice(0, 3);

  return {
    settings,
    asAtIso,
    weekMondayIso: selected.weekMondayIso,
    weekFromIso: weekMondayIsoResolved,
    weekToIso: minIso(weekFridayIso, asAtIso),
    weekChoices,
    monthFromIso,
    yearFromIso,
    generatedAtIso: nowIso(),
    reportTitle: `BOTTLED PALM OIL: WEEKLY ISSUES ${monthShort} ${period.financialYear}`,
    estimateBasis,
    estimateBasisLabel: ESTIMATE_BASIS_LABELS[estimateBasis],
    estimateWeekDaysInMonth: weekShare.daysInWeekInMonth,
    detail,
    summary,
    compare,
    comments: loadReportComments("bottled-weekly-issues-report"),
  };
}
