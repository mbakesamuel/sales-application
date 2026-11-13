import type {
  TransportCostComputeInput,
  TransportCostComputeLine,
  TransportCostComputeResult,
  TransportCostFormOptions,
} from "../../shared/transportCost.types.js";
import { assertRouteRead } from "../auth/permissions/service.js";
import { getDatabase } from "../db/index.js";
import { listActiveSalesPoints } from "../salesPoints/active.js";
import {
  getOpenPostingPeriodForActor,
  resolveReportAsAt,
} from "../financialYears/service.js";
import { loadLiftedSaleLines } from "./liftedQuantities.js";
import {
  assertTransportCostCustomerAllowed,
  assertTransportCostSalesPointAllowed,
  buildTransportCostPolicyNotice,
  loadTransportCostMoliweOnlyPolicy,
  resolveMoliweSalesPointId,
  resolveTransportCostCustomerId,
} from "./policy.js";
import { resolveTransportRatePerKg } from "./resolveTransportRate.js";

const COMPUTE_ROUTE_ID = "transport-cost-compute";

function assertComputeRead(userId?: string | null): void {
  if (!userId) {
    throw new Error("Login required.");
  }
  const row = getDatabase()
    .prepare(`SELECT role FROM User WHERE id = ? AND isActive = 1`)
    .get(userId) as { role: string } | undefined;
  if (!row) {
    throw new Error("User not found.");
  }
  assertRouteRead(row.role, COMPUTE_ROUTE_ID);
}

function buildLineCost(
  salesPointId: number,
  productId: number,
  dateIssued: string,
  qtyKg: number,
): TransportCostComputeLine {
  const rateResult = resolveTransportRatePerKg(salesPointId, productId, dateIssued);
  if (!rateResult.ok) {
    return {
      dateIssued,
      invoiceNo: null,
      deliveryOrderNo: null,
      qtyKg,
      ratePerKg: null,
      lineCost: null,
      rateMissing: true,
    };
  }
  return {
    dateIssued,
    invoiceNo: null,
    deliveryOrderNo: null,
    qtyKg,
    ratePerKg: rateResult.ratePerKgWithVat,
    lineCost: qtyKg * rateResult.ratePerKgWithVat,
    rateMissing: false,
  };
}

export function getTransportCostFormOptions(
  userId?: string | null,
): TransportCostFormOptions {
  const db = getDatabase();
  const openPeriod = userId ? getOpenPostingPeriodForActor(userId) : null;
  const transportCostMoliweOnlyPolicy = loadTransportCostMoliweOnlyPolicy(db);
  const moliweSalesPointId = resolveMoliweSalesPointId(db);
  const scrMayCustomerId = resolveTransportCostCustomerId(db);
  const policyNotice = buildTransportCostPolicyNotice(
    transportCostMoliweOnlyPolicy,
    moliweSalesPointId,
    scrMayCustomerId,
  );

  const customers = db
    .prepare(
      `SELECT id, name FROM Customer
       WHERE COALESCE(isPosPlaceholder, 0) = 0
       ORDER BY name COLLATE NOCASE ASC`,
    )
    .all()
    .map((row) => ({
      id: (row as { id: number }).id,
      name: String((row as { name: string }).name),
    }))
    .filter((customer) => {
      if (!transportCostMoliweOnlyPolicy) {
        return true;
      }
      if (scrMayCustomerId == null) {
        return false;
      }
      return customer.id === scrMayCustomerId;
    });

  const salesPoints = listActiveSalesPoints(db).filter((point) => {
      if (!transportCostMoliweOnlyPolicy) {
        return true;
      }
      if (moliweSalesPointId == null) {
        return false;
      }
      return point.id === moliweSalesPointId;
    });

  const products = db
    .prepare(
      `SELECT p.productId, p.productName, p.productCode
       FROM Product p
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE COALESCE(pc.isBottled, 0) = 0
         AND COALESCE(p.excludeFromSales, 0) = 0
       ORDER BY p.productName COLLATE NOCASE ASC`,
    )
    .all()
    .map((row) => ({
      productId: (row as { productId: number }).productId,
      productName: String((row as { productName: string }).productName),
      productCode: String((row as { productCode: string }).productCode),
    }));

  return {
    customers,
    salesPoints,
    products,
    openPeriod,
    transportCostMoliweOnlyPolicy,
    policyNotice,
  };
}

export function computeTransportCost(
  input: TransportCostComputeInput,
  userId?: string | null,
): TransportCostComputeResult {
  assertComputeRead(userId);

  const db = getDatabase();
  const transportCostMoliweOnlyPolicy = loadTransportCostMoliweOnlyPolicy(db);
  const moliweSalesPointId = resolveMoliweSalesPointId(db);
  const scrMayCustomerId = resolveTransportCostCustomerId(db);
  assertTransportCostSalesPointAllowed(
    input.salesPointId,
    transportCostMoliweOnlyPolicy,
    moliweSalesPointId,
  );
  assertTransportCostCustomerAllowed(
    input.customerId,
    transportCostMoliweOnlyPolicy,
    scrMayCustomerId,
  );

  const { asAtIso, period } = resolveReportAsAt(userId ?? undefined);
  const liftedLines = loadLiftedSaleLines(period.startDate, asAtIso, {
    customerId: input.customerId,
    salesPointId: input.salesPointId,
    productId: input.productId,
  });

  const warnings: string[] = [];
  const lines: TransportCostComputeLine[] = liftedLines.map((line) => {
    const computed = buildLineCost(
      line.salesPointId,
      line.productId,
      line.dateIssued,
      line.qtyKg,
    );
    return {
      ...computed,
      invoiceNo: line.invoiceNo,
      deliveryOrderNo: line.deliveryOrderNo,
    };
  });

  let totalQtyKg = 0;
  let totalCost = 0;
  for (const line of lines) {
    totalQtyKg += line.qtyKg;
    if (line.rateMissing) {
      warnings.push(
        `No transport rate for ${line.dateIssued}; ${Math.round(line.qtyKg).toLocaleString("en-US")} kg excluded from cost total.`,
      );
    } else if (line.lineCost != null) {
      totalCost += line.lineCost;
    }
  }

  const first = liftedLines[0];
  const customerName =
    first?.customerName ??
    (
      getDatabase()
        .prepare(`SELECT name FROM Customer WHERE id = ?`)
        .get(input.customerId) as { name: string } | undefined
    )?.name ??
    "";
  const salesPointName =
    first?.salesPointName ??
    (
      getDatabase()
        .prepare(`SELECT name FROM SalesPoint WHERE id = ?`)
        .get(input.salesPointId) as { name: string } | undefined
    )?.name ??
    "";
  const productName =
    first?.productName ??
    (
      getDatabase()
        .prepare(`SELECT productName FROM Product WHERE productId = ?`)
        .get(input.productId) as { productName: string } | undefined
    )?.productName ??
    "";

  return {
    period,
    asAtIso,
    customerId: input.customerId,
    customerName,
    salesPointId: input.salesPointId,
    salesPointName,
    productId: input.productId,
    productName,
    lines,
    totalQtyKg,
    totalCost,
    warnings: [...new Set(warnings)],
  };
}

export function listTransportRateRows(): Array<Record<string, unknown>> {
  return getDatabase()
    .prepare(
      `SELECT trs.*,
              sp.name AS salesPointName,
              p.productName,
              p.productCode
       FROM TransportRateSchedule trs
       INNER JOIN SalesPoint sp ON sp.id = trs.salesPointId
       INNER JOIN Product p ON p.productId = trs.productId
       ORDER BY sp.name COLLATE NOCASE ASC,
                p.productName COLLATE NOCASE ASC,
                trs.effectiveFrom DESC`,
    )
    .all() as Array<Record<string, unknown>>;
}
