/**
 * Day-to-day sales details (monthly matrix by customer category).
 * Ports src/electron/reports/dailySalesMatrixReport.ts.
 */
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  todayIso,
} from "../reportCompany.js";
import {
  getOpenPostingPeriod,
  postingScopeForUser,
} from "../financialYearsService.js";
import {
  loadProducts,
  loadSalesPointsForUser,
  reportScopedSalesPointId,
  resolveReportSalesPointId,
} from "./reportShared.js";
import {
  dayOfMonthFromIso,
  daysInCalendarMonth,
  lineQuantity,
  loadRawSaleLinesForRange,
  loadTransferOutQtyByDate,
  mapCategoryToMatrixColumn,
  resolveDailyCustomerCategory,
} from "./dailySalesShared.js";

type DailySalesMatrixDayRow = {
  day: number;
  industry: number;
  wholeSale: number;
  retail: number;
  cdcWorker: number;
  staff: number;
  trnsfr: number;
  total: number;
};

const ROUTE_ID = "daily-sales-matrix-report";

function emptyMatrixRow(day: number): DailySalesMatrixDayRow {
  return {
    day,
    industry: 0,
    wholeSale: 0,
    retail: 0,
    cdcWorker: 0,
    staff: 0,
    trnsfr: 0,
    total: 0,
  };
}

function recomputeRowTotal(row: DailySalesMatrixDayRow): void {
  row.total =
    row.industry +
    row.wholeSale +
    row.retail +
    row.cdcWorker +
    row.staff +
    row.trnsfr;
}

function sumColumnTotals(
  rows: DailySalesMatrixDayRow[],
): Omit<DailySalesMatrixDayRow, "day"> {
  const totals = {
    industry: 0,
    wholeSale: 0,
    retail: 0,
    cdcWorker: 0,
    staff: 0,
    trnsfr: 0,
    total: 0,
  };
  for (const row of rows) {
    totals.industry += row.industry;
    totals.wholeSale += row.wholeSale;
    totals.retail += row.retail;
    totals.cdcWorker += row.cdcWorker;
    totals.staff += row.staff;
    totals.trnsfr += row.trnsfr;
    totals.total += row.total;
  }
  return totals;
}

function resolveSalesPointLabel(
  salesPointId: number | null,
  options: Array<{ id: number; name: string }>,
): string {
  if (salesPointId == null) {
    return "ALL COLLECTION POINTS";
  }
  return (
    options.find((point) => point.id === salesPointId)?.name ??
    "UNKNOWN COLLECTION POINT"
  );
}

function resolveProductLabel(
  productId: number | null,
  options: Array<{ id: number; name: string }>,
): string {
  if (productId == null) {
    return "ALL PRODUCTS";
  }
  return (
    options.find((product) => product.id === productId)?.name ??
    "UNKNOWN PRODUCT"
  );
}

export async function getDailySalesMatrixReport(
  userId: string,
  salesPointId?: number | null,
  productId?: number | null,
) {
  const scope = await postingScopeForUser(userId);
  const period = await getOpenPostingPeriod(scope);
  if (!period) {
    throw new Error("Open a financial month before running reports.");
  }

  const today = todayIso();
  const asAtIso = today < period.endDate ? today : period.endDate;
  const monthStartIso = period.startDate;
  const monthEndIso = period.endDate;
  const effectiveEndIso = asAtIso < monthEndIso ? asAtIso : monthEndIso;
  const daysInMonth = daysInCalendarMonth(monthStartIso);

  const selectedProductId =
    productId != null && Number.isFinite(Number(productId))
      ? Number(productId)
      : null;

  const [
    scopedSalesPointId,
    selectedSalesPointId,
    salesPointOptions,
    products,
    settings,
    comments,
  ] = await Promise.all([
    reportScopedSalesPointId(userId),
    resolveReportSalesPointId(userId, salesPointId),
    loadSalesPointsForUser(userId),
    loadProducts(),
    loadReportCompanySettings(userId, asAtIso),
    loadReportComments(ROUTE_ID),
  ]);

  const productOptions = products
    .map((product) => ({
      id: product.productId,
      name: product.productName,
      productCode: product.productCode ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const rows: DailySalesMatrixDayRow[] = Array.from(
    { length: daysInMonth },
    (_, index) => emptyMatrixRow(index + 1),
  );
  const rowByDay = new Map(rows.map((row) => [row.day, row]));

  const saleLines = await loadRawSaleLinesForRange(
    monthStartIso,
    effectiveEndIso,
    selectedSalesPointId,
    selectedProductId,
  );

  for (const line of saleLines) {
    const dateIso = line.dateIssued.slice(0, 10);
    const day = dayOfMonthFromIso(dateIso);
    const row = rowByDay.get(day);
    if (!row) {
      continue;
    }

    const category = resolveDailyCustomerCategory(
      line.saleDisposition,
      line.customerTypeCode,
      line.customerTypeName,
    );
    const matrixColumn = mapCategoryToMatrixColumn(category);
    if (!matrixColumn) {
      continue;
    }

    const qty = lineQuantity(line);
    row[matrixColumn] += qty;
    recomputeRowTotal(row);
  }

  const transferLines = await loadTransferOutQtyByDate(
    monthStartIso,
    effectiveEndIso,
    selectedSalesPointId,
    selectedProductId,
  );

  for (const transfer of transferLines) {
    const day = dayOfMonthFromIso(transfer.xferDate);
    const row = rowByDay.get(day);
    if (!row) {
      continue;
    }
    row.trnsfr += transfer.qtyKg;
    recomputeRowTotal(row);
  }

  const columnTotals = sumColumnTotals(rows);

  return {
    settings,
    monthStartIso,
    monthEndIso,
    asAtIso: effectiveEndIso,
    monthLabel: `${period.monthName} ${period.financialYear}`,
    selectedSalesPointId,
    scopedSalesPointId,
    salesPointLabel: resolveSalesPointLabel(
      selectedSalesPointId,
      salesPointOptions,
    ),
    salesPointOptions,
    selectedProductId,
    productLabel: resolveProductLabel(selectedProductId, productOptions),
    productOptions,
    daysInMonth,
    rows,
    columnTotals,
    grandTotal: columnTotals.total,
    generatedAtIso: nowIso(),
    comments,
  };
}
