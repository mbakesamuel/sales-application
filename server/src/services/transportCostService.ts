/**
 * Thin-client transport cost form options + compute (ports Electron transport/service).
 */
import { prisma } from "../db/prisma.js";
import { getTaxRatesAsOf } from "./salesRpcExtras.js";
import { resolveOpenPeriodReportContext } from "./reports/openPeriodReportContext.js";
import { parseQty } from "./reports/reportShared.js";
import { canAccessRoute, loadRpcActor } from "./rpcActor.js";
import { getOpenPostingPeriod } from "./financialYearsService.js";

const COMPUTE_ROUTE_ID = "transport-cost-compute";
const MOLIWE_SALES_POINT_NAME = "Moliwe";
const TRANSPORT_COST_CUSTOMER_NAME = "SCR MAYA";

export type TransportCostComputeInput = {
  customerId: number;
  salesPointId: number;
  productId: number;
};

export type TransportCostComputeLine = {
  dateIssued: string;
  invoiceNo: string | null;
  deliveryOrderNo: string | null;
  qtyKg: number;
  ratePerKg: number | null;
  lineCost: number | null;
  rateMissing: boolean;
};

export type TransportCostFormOptions = {
  customers: Array<{ id: number; name: string }>;
  salesPoints: Array<{ id: number; name: string }>;
  products: Array<{
    productId: number;
    productName: string;
    productCode: string;
  }>;
  openPeriod: Awaited<ReturnType<typeof getOpenPostingPeriod>>;
  transportCostMoliweOnlyPolicy: boolean;
  policyNotice: string | null;
};

export type TransportCostComputeResult = {
  period: NonNullable<Awaited<ReturnType<typeof getOpenPostingPeriod>>>;
  asAtIso: string;
  customerId: number;
  customerName: string;
  salesPointId: number;
  salesPointName: string;
  productId: number;
  productName: string;
  lines: TransportCostComputeLine[];
  totalQtyKg: number;
  totalCost: number;
  warnings: string[];
};

async function loadTransportCostMoliweOnlyPolicy(): Promise<boolean> {
  const row = await prisma.company_settings.findFirst({
    where: { id: "default" },
    select: { transport_cost_moliwe_only_policy: true },
  });
  // Prefer on when unset — matches Electron policy helper.
  return row?.transport_cost_moliwe_only_policy !== false;
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

function buildTransportCostPolicyNotice(
  policyEnabled: boolean,
  moliweSalesPointId: number | null,
  scrMayCustomerId: number | null,
): string | null {
  if (!policyEnabled) return null;
  if (moliweSalesPointId == null) {
    return `Transport cost policy is enabled, but no active collection point named "${MOLIWE_SALES_POINT_NAME}" was found. Add or activate that collection point in Company Settings.`;
  }
  if (scrMayCustomerId == null) {
    return `Transport cost policy is enabled, but no customer named "${TRANSPORT_COST_CUSTOMER_NAME}" was found. Add that customer before computing transport cost.`;
  }
  return `Company policy: transportation cost is limited to ${MOLIWE_SALES_POINT_NAME} invoices for ${TRANSPORT_COST_CUSTOMER_NAME}.`;
}

function assertTransportCostSalesPointAllowed(
  salesPointId: number,
  policyEnabled: boolean,
  moliweSalesPointId: number | null,
): void {
  if (!policyEnabled) return;
  if (moliweSalesPointId == null) {
    throw new Error(
      `Transport cost policy is enabled, but no active collection point named "${MOLIWE_SALES_POINT_NAME}" was found.`,
    );
  }
  if (salesPointId !== moliweSalesPointId) {
    throw new Error(
      `Transportation cost is limited to the ${MOLIWE_SALES_POINT_NAME} collection point while the transport cost policy is enabled.`,
    );
  }
}

function assertTransportCostCustomerAllowed(
  customerId: number,
  policyEnabled: boolean,
  scrMayCustomerId: number | null,
): void {
  if (!policyEnabled) return;
  if (scrMayCustomerId == null) {
    throw new Error(
      `Transport cost policy is enabled, but no customer named "${TRANSPORT_COST_CUSTOMER_NAME}" was found.`,
    );
  }
  if (customerId !== scrMayCustomerId) {
    throw new Error(
      `Transportation cost is limited to customer ${TRANSPORT_COST_CUSTOMER_NAME} while the transport cost policy is enabled.`,
    );
  }
}

async function resolveTransportRatePerKg(
  salesPointId: number,
  productId: number,
  asOfDate: string,
): Promise<
  | { ok: true; ratePerKgWithVat: number }
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
    ratePerKgWithVat: ratePerKgNumeric * (1 + vatRate),
  };
}

type LiftedSaleLine = {
  dateIssued: string;
  invoiceNo: string | null;
  deliveryOrderNo: string | null;
  customerId: number;
  customerName: string;
  salesPointId: number;
  salesPointName: string;
  productId: number;
  productName: string;
  qtyKg: number;
};

async function loadLiftedSaleLines(
  fromIso: string,
  toIso: string,
  filters: {
    customerId: number;
    salesPointId: number;
    productId: number;
  },
): Promise<LiftedSaleLine[]> {
  const raw = await prisma.$queryRaw<
    Array<{
      date_issued: string;
      invoice_no: string | null;
      delivery_order_no: string | null;
      customer_id: number;
      customer_name: string | null;
      sales_point_id: number;
      sales_point_name: string | null;
      product_id: number;
      product_name: string | null;
      qty_kg: string;
    }>
  >`
    SELECT s.date_issued,
           s.invoice_no,
           s.delivery_order_no,
           s.customer_id,
           COALESCE(c.name, s.customer_name_snapshot, '') AS customer_name,
           s.sales_point_id,
           COALESCE(sp.name, '') AS sales_point_name,
           sl.product_id,
           COALESCE(p.product_name, '') AS product_name,
           sl.qty_kg
    FROM sales s
    INNER JOIN sale_lines sl ON sl.sale_id = s.id
    INNER JOIN products p ON p.product_id = sl.product_id
    LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sales_points sp ON sp.id = s.sales_point_id
    WHERE s.status = 'VALIDATED'
      AND s.date_issued >= ${fromIso}
      AND s.date_issued <= ${toIso}
      AND COALESCE(pc.is_bottled, false) = false
      AND COALESCE(p.exclude_from_sales, false) = false
      AND s.customer_id = ${filters.customerId}
      AND s.sales_point_id = ${filters.salesPointId}
      AND sl.product_id = ${filters.productId}
    ORDER BY s.date_issued ASC, s.invoice_no ASC
  `;

  return raw.map((row) => ({
    dateIssued: String(row.date_issued).slice(0, 10),
    invoiceNo: row.invoice_no,
    deliveryOrderNo: row.delivery_order_no,
    customerId: Number(row.customer_id),
    customerName: String(row.customer_name ?? ""),
    salesPointId: Number(row.sales_point_id),
    salesPointName: String(row.sales_point_name ?? ""),
    productId: Number(row.product_id),
    productName: String(row.product_name ?? ""),
    qtyKg: parseQty(row.qty_kg),
  }));
}

export async function getTransportCostFormOptions(): Promise<TransportCostFormOptions> {
  const [
    openPeriod,
    transportCostMoliweOnlyPolicy,
    moliweSalesPointId,
    scrMayCustomerId,
    customerRows,
    salesPointRows,
    productRows,
  ] = await Promise.all([
    getOpenPostingPeriod(),
    loadTransportCostMoliweOnlyPolicy(),
    resolveMoliweSalesPointId(),
    resolveTransportCostCustomerId(),
    prisma.$queryRaw<Array<{ id: number; name: string }>>`
      SELECT id, name FROM customers
      WHERE COALESCE(is_pos_placeholder, false) = false
      ORDER BY lower(name) ASC
    `,
    prisma.$queryRaw<Array<{ id: number; name: string }>>`
      SELECT id, name FROM sales_points
      WHERE is_active = true
      ORDER BY lower(name) ASC
    `,
    prisma.$queryRaw<
      Array<{ product_id: number; product_name: string; product_code: string | null }>
    >`
      SELECT p.product_id, p.product_name, COALESCE(p.product_code, '') AS product_code
      FROM products p
      LEFT JOIN product_cats pc ON pc.product_cat_id = p.product_cat_id
      WHERE COALESCE(pc.is_bottled, false) = false
        AND COALESCE(p.exclude_from_sales, false) = false
      ORDER BY lower(p.product_name) ASC
    `,
  ]);

  const policyNotice = buildTransportCostPolicyNotice(
    transportCostMoliweOnlyPolicy,
    moliweSalesPointId,
    scrMayCustomerId,
  );

  const customers = customerRows
    .map((row) => ({ id: Number(row.id), name: String(row.name) }))
    .filter((customer) => {
      if (!transportCostMoliweOnlyPolicy) return true;
      if (scrMayCustomerId == null) return false;
      return customer.id === scrMayCustomerId;
    });

  const salesPoints = salesPointRows
    .map((row) => ({ id: Number(row.id), name: String(row.name) }))
    .filter((point) => {
      if (!transportCostMoliweOnlyPolicy) return true;
      if (moliweSalesPointId == null) return false;
      return point.id === moliweSalesPointId;
    });

  const products = productRows.map((row) => ({
    productId: Number(row.product_id),
    productName: String(row.product_name),
    productCode: String(row.product_code ?? ""),
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

export async function computeTransportCost(
  input: TransportCostComputeInput,
  userId: string,
): Promise<TransportCostComputeResult> {
  const actor = await loadRpcActor(userId);
  if (
    actor.role !== "ADMIN" &&
    !canAccessRoute(actor, COMPUTE_ROUTE_ID)
  ) {
    throw new Error("You do not have access to transport cost compute.");
  }

  const customerId = Number(input.customerId);
  const salesPointId = Number(input.salesPointId);
  const productId = Number(input.productId);
  if (
    !Number.isFinite(customerId) ||
    !Number.isFinite(salesPointId) ||
    !Number.isFinite(productId)
  ) {
    throw new Error("Customer, collection point, and product are required.");
  }

  const [transportCostMoliweOnlyPolicy, moliweSalesPointId, scrMayCustomerId] =
    await Promise.all([
      loadTransportCostMoliweOnlyPolicy(),
      resolveMoliweSalesPointId(),
      resolveTransportCostCustomerId(),
    ]);

  assertTransportCostSalesPointAllowed(
    salesPointId,
    transportCostMoliweOnlyPolicy,
    moliweSalesPointId,
  );
  assertTransportCostCustomerAllowed(
    customerId,
    transportCostMoliweOnlyPolicy,
    scrMayCustomerId,
  );

  const { asAtIso, period } = await resolveOpenPeriodReportContext(userId);
  const liftedLines = await loadLiftedSaleLines(period.startDate, asAtIso, {
    customerId,
    salesPointId,
    productId,
  });

  const warnings: string[] = [];
  const lines: TransportCostComputeLine[] = [];
  for (const line of liftedLines) {
    const rateResult = await resolveTransportRatePerKg(
      line.salesPointId,
      line.productId,
      line.dateIssued,
    );
    if (!rateResult.ok) {
      lines.push({
        dateIssued: line.dateIssued,
        invoiceNo: line.invoiceNo,
        deliveryOrderNo: line.deliveryOrderNo,
        qtyKg: line.qtyKg,
        ratePerKg: null,
        lineCost: null,
        rateMissing: true,
      });
      continue;
    }
    lines.push({
      dateIssued: line.dateIssued,
      invoiceNo: line.invoiceNo,
      deliveryOrderNo: line.deliveryOrderNo,
      qtyKg: line.qtyKg,
      ratePerKg: rateResult.ratePerKgWithVat,
      lineCost: line.qtyKg * rateResult.ratePerKgWithVat,
      rateMissing: false,
    });
  }

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
  let customerName = first?.customerName ?? "";
  let salesPointName = first?.salesPointName ?? "";
  let productName = first?.productName ?? "";

  if (!customerName || !salesPointName || !productName) {
    const [customer, salesPoint, product] = await Promise.all([
      prisma.customers.findUnique({
        where: { id: customerId },
        select: { name: true },
      }),
      prisma.sales_points.findUnique({
        where: { id: salesPointId },
        select: { name: true },
      }),
      prisma.products.findUnique({
        where: { product_id: productId },
        select: { product_name: true },
      }),
    ]);
    customerName = customerName || customer?.name || "";
    salesPointName = salesPointName || salesPoint?.name || "";
    productName = productName || product?.product_name || "";
  }

  return {
    period,
    asAtIso,
    customerId,
    customerName,
    salesPointId,
    salesPointName,
    productId,
    productName,
    lines,
    totalQtyKg,
    totalCost,
    warnings: [...new Set(warnings)],
  };
}

export function parseTransportCostComputeArgs(
  args: unknown[],
): TransportCostComputeInput {
  const candidate =
    args.length >= 2 && args[1] != null && typeof args[1] === "object"
      ? args[1]
      : args[0];
  const input = (candidate ?? {}) as Record<string, unknown>;
  return {
    customerId: Number(input.customerId),
    salesPointId: Number(input.salesPointId),
    productId: Number(input.productId),
  };
}
