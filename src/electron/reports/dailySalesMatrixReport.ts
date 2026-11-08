import type {
  DailySalesMatrixDayRow,
  DailySalesMatrixReport,
} from "../../shared/reports.types.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import {
  loadReportCompanySettings,
  loadReportComments,
} from "./companySettings.js";
import {
  dayOfMonthFromIso,
  daysInCalendarMonth,
  lineQuantity,
  loadRawSaleLinesForRange,
  loadTransferOutQtyByDate,
  mapCategoryToMatrixColumn,
  resolveDailyCustomerCategory,
} from "./dailySalesShared.js";
import {
  loadProducts,
  loadSalesPointsForUser,
  nowIso,
  reportScopedSalesPointId,
  resolveReportSalesPointId,
} from "./shared.js";

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

function sumColumnTotals(rows: DailySalesMatrixDayRow[]): Omit<DailySalesMatrixDayRow, "day"> {
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
  return options.find((point) => point.id === salesPointId)?.name ?? "UNKNOWN COLLECTION POINT";
}

function resolveProductLabel(
  productId: number | null,
  options: Array<{ id: number; name: string }>,
): string {
  if (productId == null) {
    return "ALL PRODUCTS";
  }
  return options.find((product) => product.id === productId)?.name ?? "UNKNOWN PRODUCT";
}

export function getDailySalesMatrixReport(
  userId: string,
  salesPointId?: number | null,
  productId?: number | null,
): DailySalesMatrixReport {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const monthStartIso = period.startDate;
  const monthEndIso = period.endDate;
  const effectiveEndIso = asAtIso < monthEndIso ? asAtIso : monthEndIso;
  const daysInMonth = daysInCalendarMonth(monthStartIso);

  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const selectedSalesPointId = resolveReportSalesPointId(userId, salesPointId);
  const selectedProductId =
    productId != null && Number.isFinite(Number(productId)) ? Number(productId) : null;

  const salesPointOptions = loadSalesPointsForUser(userId);
  const productOptions = loadProducts()
    .map((product) => ({
      id: product.productId,
      name: product.productName,
      productCode: product.productCode ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const rows: DailySalesMatrixDayRow[] = Array.from({ length: daysInMonth }, (_, index) =>
    emptyMatrixRow(index + 1),
  );
  const rowByDay = new Map(rows.map((row) => [row.day, row]));

  const saleLines = loadRawSaleLinesForRange(
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

  const transferLines = loadTransferOutQtyByDate(
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
    settings: loadReportCompanySettings(userId, asAtIso),
    monthStartIso,
    monthEndIso,
    asAtIso: effectiveEndIso,
    monthLabel: `${period.monthName} ${period.financialYear}`,
    selectedSalesPointId,
    scopedSalesPointId,
    salesPointLabel: resolveSalesPointLabel(selectedSalesPointId, salesPointOptions),
    salesPointOptions,
    selectedProductId,
    productLabel: resolveProductLabel(selectedProductId, productOptions),
    productOptions,
    daysInMonth,
    rows,
    columnTotals,
    grandTotal: columnTotals.total,
    generatedAtIso: nowIso(),
    comments: loadReportComments(ROUTE_ID),
  };
}
