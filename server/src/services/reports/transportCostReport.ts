/**
 * Ports src/electron/reports/transportCostReport.ts + transport helpers.
 */
import { prisma } from "../../db/prisma.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
} from "../reportCompany.js";
import { parseQty, reportScopedSalesPointId } from "./reportShared.js";
import { getTaxRatesAsOf } from "../salesRpcExtras.js";
import { resolveOpenPeriodReportContext } from "./openPeriodReportContext.js";

const ROUTE_ID = "transport-cost-report";
const MOLIWE_SALES_POINT_NAME = "Moliwe";
const TRANSPORT_COST_CUSTOMER_NAME = "SCR MAYA";

type LiftedLine = {
  customerId: number;
  customerName: string;
  salesPointId: number;
  salesPointName: string;
  productId: number;
  productName: string;
  dateIssued: string;
  qtyKg: number;
};

async function loadTransportCostMoliweOnlyPolicy(): Promise<boolean> {
  const row = await prisma.company_settings.findFirst({
    where: { id: "default" },
    select: { transport_cost_moliwe_only_policy: true },
  });
  return Boolean(row?.transport_cost_moliwe_only_policy ?? false);
}

async function resolveMoliweSalesPointId(): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM sales_points
    WHERE is_active = true AND lower(trim(name)) = lower(${MOLIWE_SALES_POINT_NAME})
    ORDER BY id ASC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

async function resolveTransportCostCustomerId(): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM customers
    WHERE COALESCE(is_pos_placeholder, false) = false
      AND lower(trim(name)) = lower(${TRANSPORT_COST_CUSTOMER_NAME})
    ORDER BY id ASC
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

function assertTransportCostReportPolicyConfigured(
  policyEnabled: boolean,
  moliweSalesPointId: number | null,
  scrMayCustomerId: number | null,
): void {
  if (!policyEnabled) return;
  if (moliweSalesPointId == null) {
    throw new Error(
      `Transport cost policy is enabled, but no active collection point named "${MOLIWE_SALES_POINT_NAME}" was found.`,
    );
  }
  if (scrMayCustomerId == null) {
    throw new Error(
      `Transport cost policy is enabled, but no customer named "${TRANSPORT_COST_CUSTOMER_NAME}" was found.`,
    );
  }
}

async function resolveTransportRatePerKg(
  salesPointId: number,
  productId: number,
  asOfDate: string,
): Promise<
  | {
      ok: true;
      ratePerKgNumeric: number;
      ratePerKgWithVat: number;
    }
  | { ok: false }
> {
  const day = asOfDate.slice(0, 10);
  const rows = await prisma.$queryRaw<Array<{ rate_per_kg: string }>>`
    SELECT rate_per_kg
    FROM transport_rate_schedules
    WHERE sales_point_id = ${salesPointId}
      AND product_id = ${productId}
      AND effective_from <= ${day}::date
    ORDER BY effective_from DESC
    LIMIT 1
  `;
  const ratePerKgNumeric = Number.parseFloat(rows[0]?.rate_per_kg ?? "");
  if (!Number.isFinite(ratePerKgNumeric) || ratePerKgNumeric < 0) {
    return { ok: false };
  }
  const rates = await getTaxRatesAsOf(day);
  const vatRate = Number(rates.vatRate) || 0;
  return {
    ok: true,
    ratePerKgNumeric,
    ratePerKgWithVat: ratePerKgNumeric * (1 + vatRate),
  };
}

export async function getTransportCostReport(userId?: string | null) {
  const { asAtIso, period } = await resolveOpenPeriodReportContext(userId);
  const [settings, comments, scopedSalesPointId, policyEnabled, moliweId, customerId] =
    await Promise.all([
      loadReportCompanySettings(userId, asAtIso),
      loadReportComments(ROUTE_ID),
      reportScopedSalesPointId(userId),
      loadTransportCostMoliweOnlyPolicy(),
      resolveMoliweSalesPointId(),
      resolveTransportCostCustomerId(),
    ]);

  assertTransportCostReportPolicyConfigured(
    policyEnabled,
    moliweId,
    customerId,
  );

  const raw = await prisma.$queryRaw<
    Array<{
      customer_id: number | null;
      customer_name: string | null;
      sales_point_id: number | null;
      sales_point_name: string | null;
      product_id: number;
      product_name: string | null;
      date_issued: string;
      qty_kg: string;
    }>
  >`
    SELECT s.customer_id,
           COALESCE(c.name, s.customer_name_snapshot, '') AS customer_name,
           s.sales_point_id,
           COALESCE(sp.name, '') AS sales_point_name,
           sl.product_id,
           COALESCE(p.product_name, '') AS product_name,
           s.date_issued,
           sl.qty_kg
    FROM sales s
    INNER JOIN sale_lines sl ON sl.sale_id = s.id
    INNER JOIN products p ON p.product_id = sl.product_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sales_points sp ON sp.id = s.sales_point_id
    WHERE s.status = 'VALIDATED'
      AND s.date_issued >= ${period.startDate}
      AND s.date_issued <= ${asAtIso}
      AND COALESCE(pc.is_bottled, false) = false
      AND COALESCE(p.exclude_from_sales, false) = false
      AND s.customer_id IS NOT NULL
      AND s.sales_point_id IS NOT NULL
      AND (${scopedSalesPointId}::int IS NULL OR s.sales_point_id = ${scopedSalesPointId})
    ORDER BY s.date_issued ASC, s.invoice_no ASC
  `;

  let lifted: LiftedLine[] = raw.map((row) => ({
    customerId: Number(row.customer_id),
    customerName: String(row.customer_name ?? ""),
    salesPointId: Number(row.sales_point_id),
    salesPointName: String(row.sales_point_name ?? ""),
    productId: row.product_id,
    productName: String(row.product_name ?? ""),
    dateIssued: String(row.date_issued).slice(0, 10),
    qtyKg: parseQty(row.qty_kg),
  }));

  if (policyEnabled) {
    if (moliweId == null || customerId == null) {
      lifted = [];
    } else {
      lifted = lifted.filter(
        (line) =>
          line.salesPointId === moliweId && line.customerId === customerId,
      );
    }
  }

  const groups = new Map<
    string,
    {
      customerId: number;
      customerName: string;
      salesPointId: number;
      salesPointName: string;
      productId: number;
      productName: string;
      qtyKg: number;
      transportCost: number;
      hasMissingRate: boolean;
      uniformBaseRate: number | null;
      rateMixed: boolean;
      displayRateWithVat: number | null;
    }
  >();

  for (const line of lifted) {
    const key = `${line.customerId}:${line.salesPointId}:${line.productId}`;
    const existing = groups.get(key) ?? {
      customerId: line.customerId,
      customerName: line.customerName,
      salesPointId: line.salesPointId,
      salesPointName: line.salesPointName,
      productId: line.productId,
      productName: line.productName,
      qtyKg: 0,
      transportCost: 0,
      hasMissingRate: false,
      uniformBaseRate: null,
      rateMixed: false,
      displayRateWithVat: null,
    };

    existing.qtyKg += line.qtyKg;
    const rateResult = await resolveTransportRatePerKg(
      line.salesPointId,
      line.productId,
      line.dateIssued,
    );
    if (rateResult.ok) {
      existing.transportCost += line.qtyKg * rateResult.ratePerKgWithVat;
      if (!existing.rateMixed) {
        if (existing.uniformBaseRate == null) {
          existing.uniformBaseRate = rateResult.ratePerKgNumeric;
          existing.displayRateWithVat = rateResult.ratePerKgWithVat;
        } else if (
          Math.abs(existing.uniformBaseRate - rateResult.ratePerKgNumeric) >
          1e-9
        ) {
          existing.rateMixed = true;
          existing.displayRateWithVat = null;
        }
      }
    } else {
      existing.hasMissingRate = true;
    }
    groups.set(key, existing);
  }

  const dataRows = [...groups.values()]
    .filter((group) => group.qtyKg > 0.0005)
    .sort((left, right) => {
      const byCustomer = left.customerName.localeCompare(right.customerName);
      if (byCustomer !== 0) return byCustomer;
      const byPoint = left.salesPointName.localeCompare(right.salesPointName);
      if (byPoint !== 0) return byPoint;
      return left.productName.localeCompare(right.productName);
    })
    .map((group) => ({
      customerId: group.customerId,
      customerName: group.customerName,
      salesPointId: group.salesPointId,
      salesPointName: group.salesPointName,
      productId: group.productId,
      productName: group.productName,
      qtyKg: group.qtyKg,
      ratePerKg:
        group.hasMissingRate || group.rateMixed
          ? null
          : group.displayRateWithVat,
      transportCost: group.hasMissingRate ? null : group.transportCost,
      rateMissing: group.hasMissingRate,
      kind: "data" as const,
    }));

  const totals = dataRows.reduce(
    (acc, row) => {
      acc.qtyKg += row.qtyKg;
      if (row.transportCost != null) {
        acc.transportCost += row.transportCost;
      } else {
        acc.hasMissingRate = true;
      }
      return acc;
    },
    { qtyKg: 0, transportCost: 0, hasMissingRate: false },
  );

  return {
    settings,
    asAtIso,
    monthStartIso: period.startDate,
    monthEndIso: asAtIso,
    monthName: period.monthName,
    financialYear: period.financialYear,
    generatedAtIso: nowIso(),
    reportTitle: `TRANSPORTATION COST FOR ${period.monthName.toUpperCase()} ${period.financialYear}`,
    rows: [
      ...dataRows,
      {
        customerId: 0,
        customerName: "TOTAL",
        salesPointId: 0,
        salesPointName: "",
        productId: 0,
        productName: "",
        qtyKg: totals.qtyKg,
        ratePerKg: null,
        transportCost: totals.hasMissingRate ? null : totals.transportCost,
        rateMissing: totals.hasMissingRate,
        kind: "total" as const,
      },
    ],
    totals,
    comments,
  };
}
