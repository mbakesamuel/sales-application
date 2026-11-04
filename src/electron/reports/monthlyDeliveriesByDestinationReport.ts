import type {
  MonthlyDeliveriesByDestinationKgRow,
  MonthlyDeliveriesByDestinationPercentages,
  MonthlyDeliveriesByDestinationReport,
  MonthlyDeliveriesByDestinationWeekRow,
} from "../../shared/reports.types.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import { getDatabase } from "../db/index.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "./companySettings.js";
import {
  nowIso,
  parseQty,
  reportScopedSalesPointId,
  salesPointFilterSql,
} from "./shared.js";
import { buildWeekChoices } from "./weekChoices.js";

const ROUTE_ID = "monthly-deliveries-by-destination-report";

type DestinationId =
  | "industries"
  | "wholesales"
  | "retail"
  | "cdcWorkers"
  | "makoko";

interface SaleLineRecord {
  dateIssued: string;
  saleDisposition: string | null;
  customerName: string;
  customerTypeCode: string;
  customerTypeName: string;
  isBottled: number;
  qtyKg: number;
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

function resolveDestinationId(
  saleDisposition: string | null,
  customerName: string,
  customerTypeCode: string,
  customerTypeName: string,
): DestinationId {
  if (saleDisposition === "RATION") {
    return "cdcWorkers";
  }
  if (saleDisposition === "RETAIL") {
    return "retail";
  }

  const text = `${customerName} ${customerTypeCode} ${customerTypeName}`.toUpperCase();
  if (text.includes("MAKOKO")) {
    return "makoko";
  }
  if (text.includes("STAFF") || text.includes("WORKER") || text.includes("RATION")) {
    return "cdcWorkers";
  }
  if (text.includes("WHOLESALE")) {
    return "wholesales";
  }
  if (text.includes("RETAIL")) {
    return "retail";
  }
  if (text.includes("INDUSTR")) {
    return "industries";
  }
  return "cdcWorkers";
}

function emptyKgRow(): MonthlyDeliveriesByDestinationKgRow {
  return {
    industriesKg: 0,
    wholesalesKg: 0,
    retailKg: 0,
    cdcWorkersKg: 0,
    makokoKg: 0,
    totalKg: 0,
  };
}

function addKg(
  row: MonthlyDeliveriesByDestinationKgRow,
  destination: DestinationId,
  kg: number,
): void {
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
  if (Math.abs(whole) < 0.0005) {
    return null;
  }
  return (part / whole) * 100;
}

function loadValidatedNonBottledSaleLines(
  fromIso: string,
  toIso: string,
  salesPointId?: number | null,
): SaleLineRecord[] {
  const sp = salesPointFilterSql("s.salesPointId", salesPointId);
  return getDatabase()
    .prepare(
      `SELECT s.dateIssued, s.saleDisposition,
              COALESCE(c.name, '') AS customerName,
              COALESCE(pct.code, ct.code, '') AS customerTypeCode,
              COALESCE(pct.name, ct.name, '') AS customerTypeName,
              COALESCE(pc.isBottled, 0) AS isBottled,
              sl.qtyKg
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
         AND s.dateIssued <= ?
         AND COALESCE(pc.isBottled, 0) = 0${sp.clause}`,
    )
    .all(fromIso, toIso, ...sp.params)
    .map((row) => ({
      dateIssued: String((row as { dateIssued: string }).dateIssued).slice(0, 10),
      saleDisposition: (row as { saleDisposition: string | null }).saleDisposition,
      customerName: String((row as { customerName: string }).customerName ?? ""),
      customerTypeCode: String((row as { customerTypeCode: string }).customerTypeCode ?? ""),
      customerTypeName: String((row as { customerTypeName: string }).customerTypeName ?? ""),
      isBottled: (row as { isBottled: number }).isBottled,
      qtyKg: parseQty((row as { qtyKg: string }).qtyKg),
    }));
}

export function getMonthlyDeliveriesByDestinationReport(
  userId?: string,
): MonthlyDeliveriesByDestinationReport {
  const { asAtIso, period } = resolveReportAsAt();
  const monthStartIso = period.startDate;
  const monthEndIso = period.endDate;
  const settings = loadReportCompanySettings(userId, asAtIso);
  const comments = loadReportComments(ROUTE_ID);
  const scopedSalesPointId = reportScopedSalesPointId(userId);

  const weekChoices = buildWeekChoices(monthStartIso, monthEndIso, asAtIso);
  const weeks: MonthlyDeliveriesByDestinationWeekRow[] = weekChoices.map((week, index) => ({
    weekIndex: index + 1,
    weekFromIso: week.weekFromIso,
    weekToIso: week.weekToIso,
    datesLabel: compactDatesLabel(week.weekFromIso, week.weekToIso),
    ...emptyKgRow(),
  }));

  const lines = loadValidatedNonBottledSaleLines(
    monthStartIso,
    asAtIso,
    scopedSalesPointId,
  );
  for (const line of lines) {
    const week = weeks.find(
      (row) => line.dateIssued >= row.weekFromIso && line.dateIssued <= row.weekToIso,
    );
    if (!week) {
      continue;
    }
    const destination = resolveDestinationId(
      line.saleDisposition,
      line.customerName,
      line.customerTypeCode,
      line.customerTypeName,
    );
    addKg(week, destination, line.qtyKg);
  }

  const totals = weeks.reduce<MonthlyDeliveriesByDestinationKgRow>((acc, week) => {
    acc.industriesKg += week.industriesKg;
    acc.wholesalesKg += week.wholesalesKg;
    acc.retailKg += week.retailKg;
    acc.cdcWorkersKg += week.cdcWorkersKg;
    acc.makokoKg += week.makokoKg;
    acc.totalKg += week.totalKg;
    return acc;
  }, emptyKgRow());

  const percentages: MonthlyDeliveriesByDestinationPercentages = {
    industriesPct: pct(totals.industriesKg, totals.totalKg),
    wholesalesPct: pct(totals.wholesalesKg, totals.totalKg),
    retailPct: pct(totals.retailKg, totals.totalKg),
    cdcWorkersPct: pct(totals.cdcWorkersKg, totals.totalKg),
    makokoPct: pct(totals.makokoKg, totals.totalKg),
    totalPct: pct(totals.totalKg, totals.totalKg),
  };

  const monthLabel = period.monthName.toUpperCase();
  const reportTitle = `PALM OIL DELIVERIES IN KGS BY DESTINATION FOR ${monthLabel} ${period.financialYear}`;

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
    percentages,
    comments,
  };
}
