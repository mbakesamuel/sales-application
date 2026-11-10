/**
 * Ports src/electron/reports/monthlyPaymentDeliveryReport.ts
 */
import { prisma } from "../../db/prisma.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
} from "../reportCompany.js";
import {
  detectBottledPack,
  loadProducts,
  PALM_OIL_KG_PER_LITRE,
  parseQty,
  reportScopedSalesPointId,
  type ProductRow,
} from "./reportShared.js";
import { buildWeekChoices } from "./weekChoices.js";
import { resolveOpenPeriodReportContext } from "./openPeriodReportContext.js";

const ROUTE_ID = "monthly-payment-delivery-report";

type Totals = {
  paymentsKg: number;
  paymentsValue: number;
  deliveriesKg: number;
  deliveriesValue: number;
};

function dayOfMonth(iso: string): number {
  return Number.parseInt(iso.slice(8, 10), 10);
}

function compactDatesLabel(weekFromIso: string, weekToIso: string): string {
  const fromDay = dayOfMonth(weekFromIso);
  const toDay = dayOfMonth(weekToIso);
  if (fromDay === toDay) return String(fromDay);
  return `${fromDay}-${toDay}`;
}

function bottledLineKg(
  qtyKg: number,
  qtyUnits: number | null,
  product: ProductRow | undefined,
): number {
  if (!product || product.isBottled !== 1) return qtyKg;
  const units = qtyUnits ?? qtyKg;
  return (
    units * detectBottledPack(product).litresPerUnit * PALM_OIL_KG_PER_LITRE
  );
}

function emptyTotals(): Totals {
  return {
    paymentsKg: 0,
    paymentsValue: 0,
    deliveriesKg: 0,
    deliveriesValue: 0,
  };
}

export async function getMonthlyPaymentDeliveryReport(
  userId?: string | null,
) {
  const { asAtIso, period } = await resolveOpenPeriodReportContext(userId);
  const monthStartIso = period.startDate;
  const monthEndIso = period.endDate;
  const [settings, comments, products, scopedSalesPointId] = await Promise.all([
    loadReportCompanySettings(userId, asAtIso),
    loadReportComments(ROUTE_ID),
    loadProducts(),
    reportScopedSalesPointId(userId),
  ]);
  const productById = new Map(
    products.map((product) => [product.productId, product]),
  );

  const weekChoices = buildWeekChoices(monthStartIso, monthEndIso, asAtIso);
  const weeks = weekChoices.map((week, index) => ({
    weekIndex: index + 1,
    weekFromIso: week.weekFromIso,
    weekToIso: week.weekToIso,
    datesLabel: compactDatesLabel(week.weekFromIso, week.weekToIso),
    paymentsKg: 0,
    paymentsValue: 0,
    deliveriesKg: 0,
    deliveriesValue: 0,
  }));

  const rows = await prisma.$queryRaw<
    Array<{
      date_issued: string;
      product_id: number;
      is_bottled: boolean | null;
      qty_kg: string;
      qty_units: string | null;
      line_net: string;
    }>
  >`
    SELECT s.date_issued, sl.product_id,
           COALESCE(pc.is_bottled, false) AS is_bottled,
           sl.qty_kg, sl.qty_units, sl.line_net
    FROM sales s
    INNER JOIN sale_lines sl ON sl.sale_id = s.id
    INNER JOIN products p ON p.product_id = sl.product_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    WHERE s.status = 'VALIDATED'
      AND s.date_issued >= ${monthStartIso}
      AND s.date_issued <= ${asAtIso}
      AND (${scopedSalesPointId}::int IS NULL OR s.sales_point_id = ${scopedSalesPointId})
  `;

  for (const row of rows) {
    const dateIssued = String(row.date_issued).slice(0, 10);
    const week = weeks.find(
      (w) => dateIssued >= w.weekFromIso && dateIssued <= w.weekToIso,
    );
    if (!week) continue;
    const isBottled = row.is_bottled ? 1 : 0;
    const product = productById.get(row.product_id);
    const qtyKg = parseQty(row.qty_kg);
    const qtyUnits = row.qty_units ? parseQty(row.qty_units) : null;
    const lineNet = parseQty(row.line_net);
    const kg =
      isBottled === 1
        ? bottledLineKg(qtyKg, qtyUnits, product)
        : qtyKg;
    if (isBottled === 1) {
      week.paymentsKg += kg;
      week.paymentsValue += lineNet;
    } else {
      week.deliveriesKg += kg;
      week.deliveriesValue += lineNet;
    }
  }

  const totals = weeks.reduce<Totals>((acc, week) => {
    acc.paymentsKg += week.paymentsKg;
    acc.paymentsValue += week.paymentsValue;
    acc.deliveriesKg += week.deliveriesKg;
    acc.deliveriesValue += week.deliveriesValue;
    return acc;
  }, emptyTotals());

  const monthLabel = period.monthName.toUpperCase();
  return {
    settings,
    asAtIso,
    monthStartIso,
    monthEndIso,
    monthName: period.monthName,
    financialYear: period.financialYear,
    reportTitle: `PALM OIL SALES AND DELIVERIES FOR ${monthLabel} ${period.financialYear}`,
    generatedAtIso: nowIso(),
    weeks,
    totals,
    comments,
  };
}
