import { prisma } from "../../db/prisma.js";
import { getOpenPostingPeriod } from "../financialYearsService.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  resolveReportAsAt,
} from "../reportCompany.js";
import {
  loadSalesPointsForUser,
  parseQty,
  reportScopedSalesPointId,
  resolveReportSalesPointId,
} from "./reportShared.js";

export type RevenueTaxesPeriod = "month" | "year";

type RevenueTaxesTotals = {
  invoiceCount: number;
  netAmount: number;
  vatAmount: number;
  salesTaxAmount: number;
  grossAmount: number;
};

type RevenueTaxesBucketRow = {
  key: string;
  label: string;
  invoiceCount: number;
  netAmount: number;
  vatAmount: number;
  salesTaxAmount: number;
  grossAmount: number;
};

type SaleMoneyRow = {
  dateIso: string;
  salesPointId: number | null;
  salesPointName: string;
  netAmount: number;
  vatAmount: number;
  salesTaxAmount: number;
  grossAmount: number;
};

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

const ROUTE_ID = "revenue-taxes-report";

function emptyTotals(): RevenueTaxesTotals {
  return {
    invoiceCount: 0,
    netAmount: 0,
    vatAmount: 0,
    salesTaxAmount: 0,
    grossAmount: 0,
  };
}

function addToTotals(target: RevenueTaxesTotals, row: SaleMoneyRow): void {
  target.invoiceCount += 1;
  target.netAmount += row.netAmount;
  target.vatAmount += row.vatAmount;
  target.salesTaxAmount += row.salesTaxAmount;
  target.grossAmount += row.grossAmount;
}

async function loadSaleMoneyRows(
  fromIso: string,
  toIso: string,
  salesPointId: number | null,
): Promise<SaleMoneyRow[]> {
  const rows =
    salesPointId != null
      ? await prisma.$queryRaw<
          Array<{
            date_iso: string;
            sales_point_id: number | null;
            sales_point_name: string;
            net_amount: unknown;
            vat_amount: unknown;
            gross_amount: unknown;
            sales_tax_amount: unknown;
          }>
        >`
          SELECT LEFT(s.date_issued, 10) AS date_iso,
                 s.sales_point_id,
                 COALESCE(sp.name, 'Unassigned') AS sales_point_name,
                 REPLACE(s.net_amount, ',', '.')::numeric AS net_amount,
                 REPLACE(s.vat_amount, ',', '.')::numeric AS vat_amount,
                 REPLACE(s.gross_amount, ',', '.')::numeric AS gross_amount,
                 COALESCE(st.sales_tax_amount, 0) AS sales_tax_amount
          FROM sales s
          LEFT JOIN sales_points sp ON sp.id = s.sales_point_id
          LEFT JOIN (
            SELECT sale_id,
                   SUM(REPLACE(amount, ',', '.')::numeric) AS sales_tax_amount
            FROM sale_applied_taxes
            WHERE code_snapshot = 'SALES_TAX'
            GROUP BY sale_id
          ) st ON st.sale_id = s.id
          WHERE s.status = 'VALIDATED'
            AND LEFT(s.date_issued, 10) >= ${fromIso}
            AND LEFT(s.date_issued, 10) <= ${toIso}
            AND s.sales_point_id = ${salesPointId}
          ORDER BY date_iso ASC, s.invoice_no ASC
        `
      : await prisma.$queryRaw<
          Array<{
            date_iso: string;
            sales_point_id: number | null;
            sales_point_name: string;
            net_amount: unknown;
            vat_amount: unknown;
            gross_amount: unknown;
            sales_tax_amount: unknown;
          }>
        >`
          SELECT LEFT(s.date_issued, 10) AS date_iso,
                 s.sales_point_id,
                 COALESCE(sp.name, 'Unassigned') AS sales_point_name,
                 REPLACE(s.net_amount, ',', '.')::numeric AS net_amount,
                 REPLACE(s.vat_amount, ',', '.')::numeric AS vat_amount,
                 REPLACE(s.gross_amount, ',', '.')::numeric AS gross_amount,
                 COALESCE(st.sales_tax_amount, 0) AS sales_tax_amount
          FROM sales s
          LEFT JOIN sales_points sp ON sp.id = s.sales_point_id
          LEFT JOIN (
            SELECT sale_id,
                   SUM(REPLACE(amount, ',', '.')::numeric) AS sales_tax_amount
            FROM sale_applied_taxes
            WHERE code_snapshot = 'SALES_TAX'
            GROUP BY sale_id
          ) st ON st.sale_id = s.id
          WHERE s.status = 'VALIDATED'
            AND LEFT(s.date_issued, 10) >= ${fromIso}
            AND LEFT(s.date_issued, 10) <= ${toIso}
          ORDER BY date_iso ASC, s.invoice_no ASC
        `;

  return rows.map((row) => ({
    dateIso: String(row.date_iso).slice(0, 10),
    salesPointId: row.sales_point_id == null ? null : Number(row.sales_point_id),
    salesPointName: String(row.sales_point_name),
    netAmount: parseQty(row.net_amount as string | number),
    vatAmount: parseQty(row.vat_amount as string | number),
    salesTaxAmount: parseQty(row.sales_tax_amount as string | number),
    grossAmount: parseQty(row.gross_amount as string | number),
  }));
}

function bucketKeyForPeriod(period: RevenueTaxesPeriod, dateIso: string): string {
  return period === "year" ? dateIso.slice(0, 7) : dateIso;
}

function bucketLabelForPeriod(period: RevenueTaxesPeriod, key: string): string {
  if (period === "year") {
    const month = Number.parseInt(key.slice(5, 7), 10);
    const year = key.slice(0, 4);
    if (month >= 1 && month <= 12) {
      return `${MONTH_NAMES[month - 1]} ${year}`;
    }
  }
  return key;
}

function aggregateByPeriod(
  period: RevenueTaxesPeriod,
  rows: SaleMoneyRow[],
): RevenueTaxesBucketRow[] {
  const map = new Map<string, RevenueTaxesBucketRow>();
  for (const row of rows) {
    const key = bucketKeyForPeriod(period, row.dateIso);
    const existing = map.get(key);
    if (existing) {
      existing.invoiceCount += 1;
      existing.netAmount += row.netAmount;
      existing.vatAmount += row.vatAmount;
      existing.salesTaxAmount += row.salesTaxAmount;
      existing.grossAmount += row.grossAmount;
      continue;
    }
    map.set(key, {
      key,
      label: bucketLabelForPeriod(period, key),
      invoiceCount: 1,
      netAmount: row.netAmount,
      vatAmount: row.vatAmount,
      salesTaxAmount: row.salesTaxAmount,
      grossAmount: row.grossAmount,
    });
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function aggregateBySalesPoint(rows: SaleMoneyRow[]): RevenueTaxesBucketRow[] {
  const map = new Map<string, RevenueTaxesBucketRow>();
  for (const row of rows) {
    const key = row.salesPointId == null ? "none" : String(row.salesPointId);
    const existing = map.get(key);
    if (existing) {
      existing.invoiceCount += 1;
      existing.netAmount += row.netAmount;
      existing.vatAmount += row.vatAmount;
      existing.salesTaxAmount += row.salesTaxAmount;
      existing.grossAmount += row.grossAmount;
      continue;
    }
    map.set(key, {
      key,
      label: row.salesPointName,
      invoiceCount: 1,
      netAmount: row.netAmount,
      vatAmount: row.vatAmount,
      salesTaxAmount: row.salesTaxAmount,
      grossAmount: row.grossAmount,
    });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function getRevenueTaxesReport(
  userId: string,
  period: RevenueTaxesPeriod = "month",
  salesPointId?: number | null,
) {
  const asAtIso = await resolveReportAsAt();
  const posting = await getOpenPostingPeriod();
  if (!posting) {
    throw new Error("Open a financial month first.");
  }

  const selectedPeriod: RevenueTaxesPeriod =
    period === "year" ? "year" : "month";
  const [scopedSalesPointId, selectedSalesPointId, settings, comments, salesPointOptions] =
    await Promise.all([
      reportScopedSalesPointId(userId),
      resolveReportSalesPointId(userId, salesPointId),
      loadReportCompanySettings(userId, asAtIso),
      loadReportComments(ROUTE_ID),
      loadSalesPointsForUser(userId),
    ]);

  const fromIso =
    selectedPeriod === "year"
      ? `${posting.financialYear}-01-01`
      : posting.startDate;
  const toIso = asAtIso;
  const options = salesPointOptions.map((point) => ({
    id: point.id,
    name: point.name,
  }));
  const salesPointLabel =
    selectedSalesPointId == null
      ? "All collection points"
      : (options.find((point) => point.id === selectedSalesPointId)?.name ??
        "Unknown collection point");

  const rows = await loadSaleMoneyRows(fromIso, toIso, selectedSalesPointId);
  const totals = emptyTotals();
  for (const row of rows) addToTotals(totals, row);

  const periodLabel =
    selectedPeriod === "year"
      ? `FY ${posting.financialYear} through ${toIso}`
      : `${posting.monthName} ${posting.financialYear} (through ${toIso})`;

  return {
    settings,
    asAtIso,
    period: selectedPeriod,
    periodLabel,
    fromIso,
    toIso,
    monthName: posting.monthName,
    financialYear: posting.financialYear,
    salesPointId: selectedSalesPointId,
    scopedSalesPointId,
    salesPointLabel,
    salesPointOptions: options,
    reportTitle: `REVENUE & TAXES — ${periodLabel.toUpperCase()}`,
    generatedAtIso: nowIso(),
    totals,
    byPeriod: aggregateByPeriod(selectedPeriod, rows),
    bySalesPoint: aggregateBySalesPoint(rows),
    comments,
  };
}
