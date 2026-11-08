import type {
  MonthlyPaymentDeliveryReport,
  MonthlyPaymentDeliveryTotals,
  MonthlyPaymentDeliveryWeekRow,
} from "../../shared/reports.types.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import { getDatabase } from "../db/index.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "./companySettings.js";
import {
  PALM_OIL_KG_PER_LITRE,
  detectBottledPack,
  loadProducts,
  nowIso,
  parseQty,
  reportScopedSalesPointId,
  salesPointFilterSql,
  type ProductRow,
} from "./shared.js";
import { buildWeekChoices } from "./weekChoices.js";

const ROUTE_ID = "monthly-payment-delivery-report";

interface SaleLineRecord {
  dateIssued: string;
  productId: number;
  isBottled: number;
  qtyKg: number;
  qtyUnits: number | null;
  lineNet: number;
}

function dayOfMonth(iso: string): number {
  return Number.parseInt(iso.slice(8, 10), 10);
}

function compactDatesLabel(weekFromIso: string, weekToIso: string): string {
  const fromDay = dayOfMonth(weekFromIso);
  const toDay = dayOfMonth(weekToIso);
  if (fromDay === toDay) {
    return String(fromDay);
  }
  return `${fromDay}-${toDay}`;
}

function bottledLineKg(
  qtyKg: number,
  qtyUnits: number | null,
  product: ProductRow | undefined,
): number {
  if (!product || product.isBottled !== 1) {
    return qtyKg;
  }
  const units = qtyUnits ?? qtyKg;
  return (
    units * detectBottledPack(product).litresPerUnit * PALM_OIL_KG_PER_LITRE
  );
}

function loadValidatedSaleLines(
  fromIso: string,
  toIso: string,
  salesPointId?: number | null,
): SaleLineRecord[] {
  const sp = salesPointFilterSql("s.salesPointId", salesPointId);
  return getDatabase()
    .prepare(
      `SELECT s.dateIssued, sl.productId,
              COALESCE(pc.isBottled, 0) AS isBottled,
              sl.qtyKg, sl.qtyUnits, sl.lineNet
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       INNER JOIN Product p ON p.productId = sl.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE s.status = 'VALIDATED'
         AND s.dateIssued >= ?
         AND s.dateIssued <= ?${sp.clause}`,
    )
    .all(fromIso, toIso, ...sp.params)
    .map((row) => ({
      dateIssued: String((row as { dateIssued: string }).dateIssued).slice(
        0,
        10,
      ),
      productId: (row as { productId: number }).productId,
      isBottled: (row as { isBottled: number }).isBottled,
      qtyKg: parseQty((row as { qtyKg: string }).qtyKg),
      qtyUnits: (row as { qtyUnits: string | null }).qtyUnits
        ? parseQty((row as { qtyUnits: string }).qtyUnits)
        : null,
      lineNet: parseQty((row as { lineNet: string }).lineNet),
    }));
}

function emptyTotals(): MonthlyPaymentDeliveryTotals {
  return {
    paymentsKg: 0,
    paymentsValue: 0,
    deliveriesKg: 0,
    deliveriesValue: 0,
  };
}

export function getMonthlyPaymentDeliveryReport(
  userId?: string,
): MonthlyPaymentDeliveryReport {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const monthStartIso = period.startDate;
  const monthEndIso = period.endDate;
  const settings = loadReportCompanySettings(userId, asAtIso);
  const comments = loadReportComments(ROUTE_ID);
  const products = loadProducts();
  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const productById = new Map(
    products.map((product) => [product.productId, product]),
  );

  const weekChoices = buildWeekChoices(monthStartIso, monthEndIso, asAtIso);
  const weeks: MonthlyPaymentDeliveryWeekRow[] = weekChoices.map(
    (week, index) => ({
      weekIndex: index + 1,
      weekFromIso: week.weekFromIso,
      weekToIso: week.weekToIso,
      datesLabel: compactDatesLabel(week.weekFromIso, week.weekToIso),
      paymentsKg: 0,
      paymentsValue: 0,
      deliveriesKg: 0,
      deliveriesValue: 0,
    }),
  );

  const lines = loadValidatedSaleLines(
    monthStartIso,
    asAtIso,
    scopedSalesPointId,
  );
  for (const line of lines) {
    const week = weeks.find(
      (row) =>
        line.dateIssued >= row.weekFromIso && line.dateIssued <= row.weekToIso,
    );
    if (!week) {
      continue;
    }
    const product = productById.get(line.productId);
    const kg =
      line.isBottled === 1
        ? bottledLineKg(line.qtyKg, line.qtyUnits, product)
        : line.qtyKg;
    if (line.isBottled === 1) {
      week.paymentsKg += kg;
      week.paymentsValue += line.lineNet;
    } else {
      week.deliveriesKg += kg;
      week.deliveriesValue += line.lineNet;
    }
  }

  const totals = weeks.reduce<MonthlyPaymentDeliveryTotals>((acc, week) => {
    acc.paymentsKg += week.paymentsKg;
    acc.paymentsValue += week.paymentsValue;
    acc.deliveriesKg += week.deliveriesKg;
    acc.deliveriesValue += week.deliveriesValue;
    return acc;
  }, emptyTotals());

  const monthLabel = period.monthName.toUpperCase();
  const reportTitle = `PALM OIL SALES AND DELIVERIES FOR ${monthLabel} ${period.financialYear}`;

  return {
    settings,
    asAtIso,
    monthStartIso,
    monthEndIso,
    monthName: period.monthName,
    financialYear: period.financialYear,
    reportTitle,
    generatedAtIso: nowIso(),
    weeks,
    totals,
    comments,
  };
}
