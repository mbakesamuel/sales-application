/**
 * Ports src/electron/reports/monthlyDeliveriesByDestinationReport.ts
 */
import { prisma } from "../../db/prisma.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
} from "../reportCompany.js";
import { parseQty, reportScopedSalesPointId } from "./reportShared.js";
import { buildWeekChoices } from "./weekChoices.js";
import { resolveOpenPeriodReportContext } from "./openPeriodReportContext.js";

const ROUTE_ID = "monthly-deliveries-by-destination-report";

type DestinationId =
  | "industries"
  | "wholesales"
  | "retail"
  | "cdcWorkers"
  | "makoko";

type KgRow = {
  industriesKg: number;
  wholesalesKg: number;
  retailKg: number;
  cdcWorkersKg: number;
  makokoKg: number;
  totalKg: number;
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

function resolveDestinationId(
  saleDisposition: string | null,
  customerName: string,
  customerTypeCode: string,
  customerTypeName: string,
): DestinationId {
  if (saleDisposition === "RATION") return "cdcWorkers";
  if (saleDisposition === "RETAIL") return "retail";

  const text =
    `${customerName} ${customerTypeCode} ${customerTypeName}`.toUpperCase();
  if (text.includes("MAKOKO")) return "makoko";
  if (
    text.includes("STAFF") ||
    text.includes("WORKER") ||
    text.includes("RATION")
  ) {
    return "cdcWorkers";
  }
  if (text.includes("WHOLESALE")) return "wholesales";
  if (text.includes("RETAIL")) return "retail";
  if (text.includes("INDUSTR")) return "industries";
  return "cdcWorkers";
}

function emptyKgRow(): KgRow {
  return {
    industriesKg: 0,
    wholesalesKg: 0,
    retailKg: 0,
    cdcWorkersKg: 0,
    makokoKg: 0,
    totalKg: 0,
  };
}

function addKg(row: KgRow, destination: DestinationId, kg: number): void {
  switch (destination) {
    case "industries":
      row.industriesKg += kg;
      break;
    case "wholesales":
      row.wholesalesKg += kg;
      break;
    case "retail":
      row.retailKg += kg;
      break;
    case "cdcWorkers":
      row.cdcWorkersKg += kg;
      break;
    case "makoko":
      row.makokoKg += kg;
      break;
  }
  row.totalKg += kg;
}

function pct(part: number, whole: number): number | null {
  if (Math.abs(whole) < 0.0005) return null;
  return (part / whole) * 100;
}

export async function getMonthlyDeliveriesByDestinationReport(
  userId?: string | null,
) {
  const { asAtIso, period } = await resolveOpenPeriodReportContext(userId);
  const monthStartIso = period.startDate;
  const monthEndIso = period.endDate;
  const [settings, comments, scopedSalesPointId] = await Promise.all([
    loadReportCompanySettings(userId, asAtIso),
    loadReportComments(ROUTE_ID),
    reportScopedSalesPointId(userId),
  ]);

  const weekChoices = buildWeekChoices(monthStartIso, monthEndIso, asAtIso);
  const weeks = weekChoices.map((week, index) => ({
    weekIndex: index + 1,
    weekFromIso: week.weekFromIso,
    weekToIso: week.weekToIso,
    datesLabel: compactDatesLabel(week.weekFromIso, week.weekToIso),
    ...emptyKgRow(),
  }));

  const rows = await prisma.$queryRaw<
    Array<{
      date_issued: string;
      sale_disposition: string | null;
      customer_name: string | null;
      customer_type_code: string | null;
      customer_type_name: string | null;
      qty_kg: string;
    }>
  >`
    SELECT s.date_issued, s.sale_disposition,
           COALESCE(c.name, '') AS customer_name,
           COALESCE(pct.code, ct.code, '') AS customer_type_code,
           COALESCE(pct.name, ct.name, '') AS customer_type_name,
           sl.qty_kg
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
      AND s.date_issued >= ${monthStartIso}
      AND s.date_issued <= ${asAtIso}
      AND COALESCE(pc.is_bottled, false) = false
      AND (${scopedSalesPointId}::int IS NULL OR s.sales_point_id = ${scopedSalesPointId})
  `;

  for (const row of rows) {
    const dateIssued = String(row.date_issued).slice(0, 10);
    const week = weeks.find(
      (w) => dateIssued >= w.weekFromIso && dateIssued <= w.weekToIso,
    );
    if (!week) continue;
    const destination = resolveDestinationId(
      row.sale_disposition,
      String(row.customer_name ?? ""),
      String(row.customer_type_code ?? ""),
      String(row.customer_type_name ?? ""),
    );
    addKg(week, destination, parseQty(row.qty_kg));
  }

  const totals = weeks.reduce<KgRow>((acc, week) => {
    acc.industriesKg += week.industriesKg;
    acc.wholesalesKg += week.wholesalesKg;
    acc.retailKg += week.retailKg;
    acc.cdcWorkersKg += week.cdcWorkersKg;
    acc.makokoKg += week.makokoKg;
    acc.totalKg += week.totalKg;
    return acc;
  }, emptyKgRow());

  const monthLabel = period.monthName.toUpperCase();
  return {
    settings,
    asAtIso,
    monthStartIso,
    monthEndIso,
    monthName: period.monthName,
    financialYear: period.financialYear,
    reportTitle: `PALM OIL DELIVERIES IN KGS BY DESTINATION FOR ${monthLabel} ${period.financialYear}`,
    generatedAtIso: nowIso(),
    weeks,
    totals,
    percentages: {
      industriesPct: pct(totals.industriesKg, totals.totalKg),
      wholesalesPct: pct(totals.wholesalesKg, totals.totalKg),
      retailPct: pct(totals.retailKg, totals.totalKg),
      cdcWorkersPct: pct(totals.cdcWorkersKg, totals.totalKg),
      makokoPct: pct(totals.makokoKg, totals.totalKg),
      totalPct: pct(totals.totalKg, totals.totalKg),
    },
    comments,
  };
}
