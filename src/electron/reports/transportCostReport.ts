import type {
  TransportCostReport,
  TransportCostReportRow,
  TransportCostReportTotals,
} from "../../shared/reports.types.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "../reports/companySettings.js";
import { nowIso, reportScopedSalesPointId } from "../reports/shared.js";
import { loadLiftedSaleLines } from "../transport/liftedQuantities.js";
import {
  assertTransportCostReportPolicyConfigured,
  filterLiftedLinesForTransportCostPolicy,
  loadTransportCostMoliweOnlyPolicy,
  resolveMoliweSalesPointId,
  resolveTransportCostCustomerId,
} from "../transport/policy.js";
import { resolveTransportRatePerKg } from "../transport/resolveTransportRate.js";

const ROUTE_ID = "transport-cost-report";

interface GroupKey {
  customerId: number;
  salesPointId: number;
  productId: number;
}

function groupKey(line: {
  customerId: number;
  salesPointId: number;
  productId: number;
}): string {
  return `${line.customerId}:${line.salesPointId}:${line.productId}`;
}

export function getTransportCostReport(userId?: string | null): TransportCostReport {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const settings = loadReportCompanySettings(userId, asAtIso);
  const comments = loadReportComments(ROUTE_ID);

  const transportCostMoliweOnlyPolicy = loadTransportCostMoliweOnlyPolicy();
  const moliweSalesPointId = resolveMoliweSalesPointId();
  const scrMayCustomerId = resolveTransportCostCustomerId();
  assertTransportCostReportPolicyConfigured(
    transportCostMoliweOnlyPolicy,
    moliweSalesPointId,
    scrMayCustomerId,
  );

  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const liftedLines = filterLiftedLinesForTransportCostPolicy(
    loadLiftedSaleLines(
      period.startDate,
      asAtIso,
      scopedSalesPointId != null ? { salesPointId: scopedSalesPointId } : {},
    ),
    transportCostMoliweOnlyPolicy,
    moliweSalesPointId,
    scrMayCustomerId,
  );

  const groups = new Map<
    string,
    GroupKey & {
      customerName: string;
      salesPointName: string;
      productName: string;
      qtyKg: number;
      transportCost: number;
      hasMissingRate: boolean;
      /** Ex-VAT schedule rate when all resolved lift rates match; otherwise mixed. */
      uniformBaseRate: number | null;
      rateMixed: boolean;
      displayRateWithVat: number | null;
    }
  >();

  for (const line of liftedLines) {
    const key = groupKey(line);
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
    const rateResult = resolveTransportRatePerKg(
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
          Math.abs(existing.uniformBaseRate - rateResult.ratePerKgNumeric) > 1e-9
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

  const dataRows: TransportCostReportRow[] = [...groups.values()]
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

  const totals = dataRows.reduce<TransportCostReportTotals>(
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

  const rows: TransportCostReportRow[] = [
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
      kind: "total",
    },
  ];

  return {
    settings,
    asAtIso,
    monthStartIso: period.startDate,
    monthEndIso: asAtIso,
    monthName: period.monthName,
    financialYear: period.financialYear,
    generatedAtIso: nowIso(),
    reportTitle: `TRANSPORTATION COST FOR ${period.monthName.toUpperCase()} ${period.financialYear}`,
    rows,
    totals,
    comments,
  };
}
