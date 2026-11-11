/**
 * Carry-forward commitments RPCs against Postgres.
 * Ports src/electron/commitments/carryForward.ts — CF rows are delivery_orders
 * with source_kind = 'CARRY_FORWARD' (no separate commitment tables).
 */
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { getOpenPostingPeriodForActor } from "./financialYearsService.js";
import {
  assertRouteWrite,
  canAccessRoute,
  canPerformAction,
  loadRpcActor,
  type RpcActor,
} from "./rpcActor.js";
import { getTaxRatesAsOf } from "./salesRpcExtras.js";
import { listSalesPoints } from "./mastersQueries.js";

const ROUTE_ID = "carry-forward-commitments";
const BOOKLET_SERIAL_MAX_LENGTH = 20;
const DO_RETAIL_WHOLESALE_THRESHOLD_KG = 3000;

type Tx = Prisma.TransactionClient;

export type CarryForwardCommitmentRow = {
  detailId: number;
  deliveryOrderId: string;
  deliveryOrderNo: string;
  customerId: number;
  customerName: string;
  salesPointId: number;
  salesPointName: string;
  productId: number;
  productName: string;
  orderQty: number;
  soldQty: number;
  outstandingQty: number;
  dateIssued: string;
  notes: string | null;
  sourceDocumentNo: string | null;
};

export type CarryForwardCommitmentPendingRow = {
  detailId: number;
  deliveryOrderId: string;
  deliveryOrderNo: string;
  customerId: number;
  customerName: string;
  salesPointId: number;
  salesPointName: string;
  productId: number;
  productName: string;
  orderQty: number;
  outstandingQty: number;
  dateIssued: string;
  sourceDocumentNo: string | null;
};

export type CarryForwardFormOptions = {
  customers: Array<{ id: number; name: string }>;
  products: Array<{ productId: number; productName: string }>;
  salesPoints: Array<{ id: number; name: string }>;
};

export type UpsertCarryForwardInput = {
  userId: string;
  customerId: number;
  salesPointId: number;
  productId: number;
  outstandingQty: number;
  sourceDocumentNo?: string | null;
  detailId?: number | null;
  notes?: string | null;
};

export type UpsertCarryForwardBatchInput = {
  userId: string;
  salesPointId: number;
  productId: number;
  notes?: string | null;
  lines: Array<{
    customerId: number;
    outstandingQty: number;
    sourceDocumentNo: string;
    detailId?: number | null;
  }>;
};

export type CarryForwardMutationResult =
  | {
      ok: true;
      deliveryOrderNo: string;
      detailId: number;
      pendingValidation?: boolean;
    }
  | { ok: false; error: string };

export type CarryForwardBatchResult =
  | { ok: true; saved: number; pendingValidation?: boolean }
  | { ok: false; error: string };

export type CarryForwardDeleteResult = { ok: true } | { ok: false; error: string };

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function roundMoney2(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function parseMoney(value: string | number | null | undefined): number {
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function validateBookletSerial(
  raw: string | null | undefined,
): { ok: true; serial: string } | { ok: false; error: string } {
  const serial = String(raw ?? "").trim();
  if (!serial) {
    return { ok: false, error: "Enter the booklet serial number." };
  }
  if (!/^\d+$/.test(serial)) {
    return { ok: false, error: "Serial must contain digits only." };
  }
  if (serial.length > BOOKLET_SERIAL_MAX_LENGTH) {
    return {
      ok: false,
      error: `Serial must be at most ${BOOKLET_SERIAL_MAX_LENGTH} digits.`,
    };
  }
  return { ok: true, serial };
}

function requiresValidation(actor: RpcActor): boolean {
  return !(
    canPerformAction(actor, "validate_stock_documents") ||
    canPerformAction(actor, "validate_delivery_orders")
  );
}

function isIndustryCustomerType(
  code: string | null | undefined,
  name: string | null | undefined,
): boolean {
  return `${code ?? ""} ${name ?? ""}`.toUpperCase().includes("INDUSTR");
}

function classifyDoPricingKind(input: {
  isIndustryCustomer: boolean;
  orderQtyKg: number;
}): "INDUSTRY" | "WHOLESALE" | "RETAIL" {
  if (input.isIndustryCustomer) return "INDUSTRY";
  if (input.orderQtyKg >= DO_RETAIL_WHOLESALE_THRESHOLD_KG) return "WHOLESALE";
  return "RETAIL";
}

async function soldQtyForDoProduct(
  deliveryOrderNo: string,
  productId: number,
): Promise<number> {
  const lines = await prisma.sale_lines.findMany({
    where: {
      product_id: productId,
      sales: {
        delivery_order_no: deliveryOrderNo,
        status: { in: ["VALIDATED", "PENDING"] },
        cancelled_at: null,
      },
    },
    select: { qty_kg: true },
  });
  return lines.reduce(
    (sum, line) => sum + (Number.parseFloat(line.qty_kg) || 0),
    0,
  );
}

async function findCustomerTypeIdByKind(
  kind: "INDUSTRY" | "WHOLESALE" | "RETAIL",
): Promise<string | null> {
  const needle =
    kind === "INDUSTRY"
      ? "INDUSTR"
      : kind === "WHOLESALE"
        ? "WHOLESALE"
        : "RETAIL";
  const rows = await prisma.customer_type_definitions.findMany({
    where: { is_active: true },
    orderBy: { sort_order: "asc" },
  });
  const hit = rows.find((row) =>
    `${row.code} ${row.name}`.toUpperCase().includes(needle),
  );
  return hit?.id ?? null;
}

async function resolveUnitPriceExTax(input: {
  productId: number;
  pricingCustomerTypeId: string | null;
  asOfDate: string;
}): Promise<{ unitPriceExTax: string; pricingCustomerTypeId: string | null }> {
  const asOf = input.asOfDate.slice(0, 10);
  const schedules = await prisma.product_unit_price_schedules.findMany({
    where: {
      product_id: input.productId,
      ...(asOf ? { effective_from: { lte: asOf } } : {}),
    },
    orderBy: { effective_from: "desc" },
  });
  const typed = input.pricingCustomerTypeId
    ? schedules.find((s) => s.customer_type_id === input.pricingCustomerTypeId)
    : null;
  const generic = schedules.find((s) => s.customer_type_id == null);
  const hit = typed ?? generic ?? null;
  if (hit) {
    return {
      unitPriceExTax: hit.unit_price_ex_tax,
      pricingCustomerTypeId: hit.customer_type_id,
    };
  }
  return {
    unitPriceExTax: "0",
    pricingCustomerTypeId: input.pricingCustomerTypeId,
  };
}

async function buildLineAmounts(
  customerId: number,
  productId: number,
  orderQty: number,
  dateIssued: string,
): Promise<{
  orderUnit: string | null;
  unitPrice: string;
  pricingCustomerTypeId: string | null;
  lineSubtotalExTax: string;
  vatRate: string;
  vatAmount: string;
  otherTaxLabel: string | null;
  otherTaxAmount: string;
  amount: string;
}> {
  const [customer, product, rates] = await Promise.all([
    prisma.customers.findUnique({
      where: { id: customerId },
      include: {
        tax_regimes: { select: { kind: true } },
        customer_type_definitions: {
          select: {
            id: true,
            code: true,
            name: true,
            exempt_from_sales_tax: true,
          },
        },
      },
    }),
    prisma.products.findUnique({
      where: { product_id: productId },
      select: { uom: true },
    }),
    getTaxRatesAsOf(dateIssued),
  ]);

  const vatApplies =
    String(customer?.residency ?? "LOCAL").toUpperCase() === "LOCAL";
  const vatRate = vatApplies ? rates.vatRate : 0;
  const hasTaxpayer = String(customer?.taxpayer_id ?? "").trim().length > 0;
  const regime = String(customer?.tax_regimes?.kind ?? "SIMPLIFIED").toUpperCase();
  const salesTaxRate = customer?.customer_type_definitions?.exempt_from_sales_tax
    ? 0
    : !hasTaxpayer
      ? rates.salesNoTaxpayer
      : regime === "REAL"
        ? rates.salesActual
        : rates.salesSimplified;

  const isIndustry = isIndustryCustomerType(
    customer?.customer_type_definitions?.code,
    customer?.customer_type_definitions?.name,
  );
  const pricingKind = classifyDoPricingKind({
    isIndustryCustomer: isIndustry,
    orderQtyKg: orderQty,
  });
  const pricingCustomerTypeId = await findCustomerTypeIdByKind(pricingKind);
  const resolved = await resolveUnitPriceExTax({
    productId,
    pricingCustomerTypeId,
    asOfDate: dateIssued,
  });

  const unit = parseMoney(resolved.unitPriceExTax);
  const lineSubtotal = unit * orderQty;
  const vatAmount = lineSubtotal * vatRate;
  const otherTaxAmount = lineSubtotal * salesTaxRate;
  const amount = lineSubtotal + vatAmount + otherTaxAmount;

  return {
    orderUnit: product?.uom ?? null,
    unitPrice: roundMoney2(unit),
    pricingCustomerTypeId: resolved.pricingCustomerTypeId,
    lineSubtotalExTax: roundMoney2(lineSubtotal),
    vatRate: String(vatRate),
    vatAmount: roundMoney2(vatAmount),
    otherTaxLabel:
      salesTaxRate > 0
        ? `Sales tax (${(salesTaxRate * 100).toFixed(2)}%)`
        : null,
    otherTaxAmount: roundMoney2(otherTaxAmount),
    amount: roundMoney2(amount),
  };
}

async function assertSourceDocumentAvailable(
  tx: Tx,
  sourceDocumentNo: string,
  excludeDeliveryOrderId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await tx.delivery_orders.findFirst({
    where: {
      source_kind: "CARRY_FORWARD",
      status: { in: ["PENDING", "VALIDATED"] },
      source_document_no: sourceDocumentNo,
      ...(excludeDeliveryOrderId
        ? { NOT: { id: excludeDeliveryOrderId } }
        : {}),
    },
    select: { id: true, delivery_order_no: true },
  });
  if (row) {
    return {
      ok: false,
      error: `Original DO # ${sourceDocumentNo} is already registered on ${row.delivery_order_no}.`,
    };
  }
  return { ok: true };
}

async function allocateCarryForwardDeliveryOrderNo(tx: Tx): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CF-${year}-`;
  const rows = await tx.delivery_orders.findMany({
    where: { delivery_order_no: { startsWith: prefix } },
    select: { delivery_order_no: true },
    orderBy: { delivery_order_no: "desc" },
    take: 50,
  });

  let next = 1;
  for (const row of rows) {
    const match = row.delivery_order_no.match(/-(\d+)$/);
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n >= next) {
      next = n + 1;
    }
  }
  return `${prefix}${String(next).padStart(6, "0")}`;
}

export async function getFormOptions(): Promise<CarryForwardFormOptions> {
  const [customers, products, salesPoints] = await Promise.all([
    prisma.customers.findMany({
      where: { is_pos_placeholder: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 2000,
    }),
    prisma.products.findMany({
      where: {
        exclude_from_delivery_orders: false,
        product_cats: { is_bottled: false },
      },
      orderBy: { product_name: "asc" },
      select: { product_id: true, product_name: true },
      take: 2000,
    }),
    listSalesPoints(),
  ]);

  return {
    customers: customers.map((c) => ({ id: c.id, name: c.name })),
    products: products.map((p) => ({
      productId: p.product_id,
      productName: p.product_name,
    })),
    salesPoints: salesPoints.map((sp) => ({ id: sp.id, name: sp.name })),
  };
}

export async function list(): Promise<CarryForwardCommitmentRow[]> {
  const orders = await prisma.delivery_orders.findMany({
    where: { source_kind: "CARRY_FORWARD", status: "VALIDATED" },
    include: {
      delivery_order_details: true,
      sales_points: { select: { name: true } },
    },
    orderBy: [{ date_issued: "asc" }, { delivery_order_no: "asc" }],
  });

  const customerIds = [
    ...new Set(
      orders
        .map((o) => o.customer_id)
        .filter((id): id is number => id != null),
    ),
  ];
  const productIds = [
    ...new Set(
      orders.flatMap((o) => o.delivery_order_details.map((d) => d.product_id)),
    ),
  ];
  const [customers, products] = await Promise.all([
    customerIds.length
      ? prisma.customers.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true },
        })
      : [],
    productIds.length
      ? prisma.products.findMany({
          where: { product_id: { in: productIds } },
          select: { product_id: true, product_name: true },
        })
      : [],
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const productName = new Map(
    products.map((p) => [p.product_id, p.product_name]),
  );

  const rows: CarryForwardCommitmentRow[] = [];
  for (const order of orders) {
    if (order.customer_id == null) continue;
    for (const detail of order.delivery_order_details) {
      const orderQty = Number(detail.order_qty) || 0;
      const soldQty = await soldQtyForDoProduct(
        order.delivery_order_no,
        detail.product_id,
      );
      rows.push({
        detailId: Number(detail.id),
        deliveryOrderId: order.id,
        deliveryOrderNo: order.delivery_order_no,
        customerId: order.customer_id,
        customerName: customerName.get(order.customer_id) ?? "",
        salesPointId: order.sales_point_id,
        salesPointName: order.sales_points.name,
        productId: detail.product_id,
        productName: productName.get(detail.product_id) ?? "",
        orderQty,
        soldQty,
        outstandingQty: Math.max(orderQty - soldQty, 0),
        dateIssued: String(order.date_issued).slice(0, 10),
        notes: order.order_ref,
        sourceDocumentNo: order.source_document_no?.trim() || null,
      });
    }
  }

  rows.sort(
    (a, b) =>
      a.customerName.localeCompare(b.customerName) ||
      a.salesPointName.localeCompare(b.salesPointName) ||
      a.productName.localeCompare(b.productName) ||
      a.deliveryOrderNo.localeCompare(b.deliveryOrderNo),
  );
  return rows;
}

export async function listPending(
  userId: string,
): Promise<CarryForwardCommitmentPendingRow[]> {
  const actor = await loadRpcActor(userId);
  if (!canAccessRoute(actor, ROUTE_ID)) {
    throw new Error("You do not have permission to view this module.");
  }

  const orders = await prisma.delivery_orders.findMany({
    where: {
      source_kind: "CARRY_FORWARD",
      status: "PENDING",
      created_by_user_id: userId,
    },
    include: {
      delivery_order_details: true,
      sales_points: { select: { name: true } },
    },
    orderBy: [{ date_issued: "desc" }, { delivery_order_no: "desc" }],
  });

  const customerIds = [
    ...new Set(
      orders
        .map((o) => o.customer_id)
        .filter((id): id is number => id != null),
    ),
  ];
  const productIds = [
    ...new Set(
      orders.flatMap((o) => o.delivery_order_details.map((d) => d.product_id)),
    ),
  ];
  const [customers, products] = await Promise.all([
    customerIds.length
      ? prisma.customers.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true },
        })
      : [],
    productIds.length
      ? prisma.products.findMany({
          where: { product_id: { in: productIds } },
          select: { product_id: true, product_name: true },
        })
      : [],
  ]);
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const productName = new Map(
    products.map((p) => [p.product_id, p.product_name]),
  );

  const rows: CarryForwardCommitmentPendingRow[] = [];
  for (const order of orders) {
    if (order.customer_id == null) continue;
    for (const detail of order.delivery_order_details) {
      const orderQty = Number(detail.order_qty) || 0;
      const soldQty = await soldQtyForDoProduct(
        order.delivery_order_no,
        detail.product_id,
      );
      rows.push({
        detailId: Number(detail.id),
        deliveryOrderId: order.id,
        deliveryOrderNo: order.delivery_order_no,
        customerId: order.customer_id,
        customerName: customerName.get(order.customer_id) ?? "",
        salesPointId: order.sales_point_id,
        salesPointName: order.sales_points.name,
        productId: detail.product_id,
        productName: productName.get(detail.product_id) ?? "",
        orderQty,
        outstandingQty: Math.max(orderQty - soldQty, 0),
        dateIssued: String(order.date_issued).slice(0, 10),
        sourceDocumentNo: order.source_document_no?.trim() || null,
      });
    }
  }

  rows.sort(
    (a, b) =>
      b.dateIssued.localeCompare(a.dateIssued) ||
      b.deliveryOrderNo.localeCompare(a.deliveryOrderNo) ||
      a.customerName.localeCompare(b.customerName) ||
      a.productName.localeCompare(b.productName),
  );
  return rows;
}

async function upsertCommitmentInTx(
  tx: Tx,
  input: UpsertCarryForwardInput,
  pendingValidation: boolean,
  dateIssued: string,
  postingPeriod: { financialYear: number; calendarMonth: number },
): Promise<CarryForwardMutationResult> {
  const outstandingQty = Math.round(Number(input.outstandingQty));
  if (!Number.isFinite(outstandingQty) || outstandingQty < 0) {
    return {
      ok: false,
      error: "Outstanding quantity must be zero or a positive whole number.",
    };
  }
  if (!Number.isFinite(input.customerId) || !Number.isFinite(input.salesPointId)) {
    return { ok: false, error: "Customer and collection point are required." };
  }
  if (!Number.isFinite(input.productId)) {
    return { ok: false, error: "Product is required." };
  }

  const detailId =
    input.detailId != null && Number.isFinite(input.detailId)
      ? Number(input.detailId)
      : null;

  let sourceDocumentNo: string | null = null;
  if (outstandingQty > 0 || input.sourceDocumentNo?.trim()) {
    const serial = validateBookletSerial(input.sourceDocumentNo);
    if (!serial.ok) {
      return { ok: false, error: `Original DO #: ${serial.error}` };
    }
    sourceDocumentNo = serial.serial;
  }

  const customer = await tx.customers.findUnique({
    where: { id: input.customerId },
    select: { id: true },
  });
  if (!customer) {
    return { ok: false, error: "Customer not found." };
  }

  const salesPoint = await tx.sales_points.findFirst({
    where: { id: input.salesPointId, is_active: true },
    select: { id: true },
  });
  if (!salesPoint) {
    return { ok: false, error: "Collection point not found or inactive." };
  }

  const product = await tx.products.findUnique({
    where: { product_id: input.productId },
    include: { product_cats: { select: { is_bottled: true } } },
  });
  if (!product) {
    return { ok: false, error: "Product not found." };
  }
  if (product.product_cats?.is_bottled) {
    return {
      ok: false,
      error: `${product.product_name} is bottled. Carry-forward commitments are for loose products only.`,
    };
  }
  if (product.exclude_from_delivery_orders) {
    return {
      ok: false,
      error: `${product.product_name} is excluded from delivery orders.`,
    };
  }

  const notes = input.notes?.trim() || "Carry-forward commitment";

  let order: {
    id: string;
    deliveryOrderNo: string;
    status: string;
  } | null = null;
  let existingLine: { id: number; orderQty: number } | null = null;

  if (detailId != null) {
    const existing = await tx.delivery_order_details.findUnique({
      where: { id: BigInt(detailId) },
      include: {
        delivery_orders: {
          select: {
            id: true,
            delivery_order_no: true,
            status: true,
            source_kind: true,
            customer_id: true,
            sales_point_id: true,
          },
        },
      },
    });
    if (
      !existing ||
      existing.delivery_orders.source_kind !== "CARRY_FORWARD"
    ) {
      return { ok: false, error: "Carry-forward line not found." };
    }
    if (existing.product_id !== input.productId) {
      return {
        ok: false,
        error: "Product does not match the selected carry-forward line.",
      };
    }
    if (existing.delivery_orders.sales_point_id !== input.salesPointId) {
      return {
        ok: false,
        error: "Collection point does not match the selected carry-forward line.",
      };
    }
    if (existing.delivery_orders.customer_id !== input.customerId) {
      return {
        ok: false,
        error: "Customer does not match the selected carry-forward line.",
      };
    }
    order = {
      id: existing.delivery_orders.id,
      deliveryOrderNo: existing.delivery_orders.delivery_order_no,
      status: existing.delivery_orders.status,
    };
    existingLine = {
      id: Number(existing.id),
      orderQty: Number(existing.order_qty) || 0,
    };
  }

  if (sourceDocumentNo) {
    const available = await assertSourceDocumentAvailable(
      tx,
      sourceDocumentNo,
      order?.id ?? null,
    );
    if (!available.ok) {
      return available;
    }
  }

  if (!order) {
    if (outstandingQty === 0) {
      return { ok: false, error: "Nothing to save for zero outstanding." };
    }
    if (!sourceDocumentNo) {
      return { ok: false, error: "Original DO # is required." };
    }

    const deliveryOrderNo = await allocateCarryForwardDeliveryOrderNo(tx);
    const id = randomUUID();
    const now = new Date();
    if (pendingValidation) {
      await tx.delivery_orders.create({
        data: {
          id,
          delivery_order_no: deliveryOrderNo,
          date_issued: dateIssued,
          customer_id: input.customerId,
          order_ref: notes,
          sales_point_id: input.salesPointId,
          financial_year: postingPeriod.financialYear,
          financial_month: postingPeriod.calendarMonth,
          posting_calendar_year: postingPeriod.financialYear,
          created_by_user_id: input.userId,
          status: "PENDING",
          source_kind: "CARRY_FORWARD",
          source_document_no: sourceDocumentNo,
        },
      });
      order = { id, deliveryOrderNo, status: "PENDING" };
    } else {
      await tx.delivery_orders.create({
        data: {
          id,
          delivery_order_no: deliveryOrderNo,
          date_issued: dateIssued,
          customer_id: input.customerId,
          order_ref: notes,
          sales_point_id: input.salesPointId,
          financial_year: postingPeriod.financialYear,
          financial_month: postingPeriod.calendarMonth,
          posting_calendar_year: postingPeriod.financialYear,
          created_by_user_id: input.userId,
          status: "VALIDATED",
          validated_at: now,
          validated_by_user_id: input.userId,
          source_kind: "CARRY_FORWARD",
          source_document_no: sourceDocumentNo,
        },
      });
      order = { id, deliveryOrderNo, status: "VALIDATED" };
    }
  } else {
    await tx.delivery_orders.update({
      where: { id: order.id },
      data: {
        order_ref: notes,
        ...(sourceDocumentNo
          ? { source_document_no: sourceDocumentNo }
          : {}),
      },
    });
  }

  const soldQty = await soldQtyForDoProduct(
    order.deliveryOrderNo,
    input.productId,
  );
  const orderQty = Math.round(soldQty + outstandingQty);

  if (outstandingQty === 0 && soldQty === 0 && existingLine) {
    await tx.delivery_order_details.delete({
      where: { id: BigInt(existingLine.id) },
    });
    const remaining = await tx.delivery_order_details.count({
      where: { delivery_order_id: order.id },
    });
    if (remaining === 0) {
      await tx.delivery_order_payment_details.deleteMany({
        where: { delivery_order_id: order.id },
      });
      await tx.delivery_orders.delete({ where: { id: order.id } });
    }
    return {
      ok: true,
      deliveryOrderNo: order.deliveryOrderNo,
      detailId: existingLine.id,
      pendingValidation,
    };
  }

  if (outstandingQty === 0 && soldQty === 0 && !existingLine) {
    return { ok: false, error: "Nothing to save for zero outstanding." };
  }

  if (outstandingQty > 0 && !sourceDocumentNo) {
    const current = await tx.delivery_orders.findUnique({
      where: { id: order.id },
      select: { source_document_no: true },
    });
    if (!current?.source_document_no?.trim()) {
      return { ok: false, error: "Original DO # is required." };
    }
  }

  const amounts = await buildLineAmounts(
    input.customerId,
    input.productId,
    orderQty,
    dateIssued,
  );

  const markPending = async () => {
    if (!pendingValidation) return;
    await tx.delivery_orders.update({
      where: { id: order!.id },
      data: {
        status: "PENDING",
        validated_at: null,
        validated_by_user_id: null,
      },
    });
  };

  if (existingLine) {
    await tx.delivery_order_details.update({
      where: { id: BigInt(existingLine.id) },
      data: {
        order_qty: orderQty,
        order_unit: amounts.orderUnit,
        unit_price: amounts.unitPrice,
        pricing_customer_type_id: amounts.pricingCustomerTypeId,
        line_subtotal_ex_tax: amounts.lineSubtotalExTax,
        vat_rate: amounts.vatRate,
        vat_amount: amounts.vatAmount,
        other_tax_label: amounts.otherTaxLabel,
        other_tax_amount: amounts.otherTaxAmount,
        amount: amounts.amount,
      },
    });
    await markPending();
    return {
      ok: true,
      deliveryOrderNo: order.deliveryOrderNo,
      detailId: existingLine.id,
      pendingValidation,
    };
  }

  const created = await tx.delivery_order_details.create({
    data: {
      delivery_order_id: order.id,
      product_id: input.productId,
      order_qty: orderQty,
      order_unit: amounts.orderUnit,
      unit_price: amounts.unitPrice,
      pricing_customer_type_id: amounts.pricingCustomerTypeId,
      line_subtotal_ex_tax: amounts.lineSubtotalExTax,
      vat_rate: amounts.vatRate,
      vat_amount: amounts.vatAmount,
      other_tax_label: amounts.otherTaxLabel,
      other_tax_amount: amounts.otherTaxAmount,
      amount: amounts.amount,
    },
    select: { id: true },
  });
  await markPending();
  return {
    ok: true,
    deliveryOrderNo: order.deliveryOrderNo,
    detailId: Number(created.id),
    pendingValidation,
  };
}

export async function upsert(
  input: UpsertCarryForwardInput,
): Promise<CarryForwardMutationResult> {
  try {
    const actor = await loadRpcActor(input.userId);
    assertRouteWrite(actor, ROUTE_ID);

    const openPeriod = await getOpenPostingPeriodForActor(input.userId);
    if (!openPeriod) {
      return {
        ok: false,
        error: "Open a financial month before posting carry-forward commitments.",
      };
    }

    const today = todayIsoDate();
    const dateIssued =
      today >= openPeriod.startDate && today <= openPeriod.endDate
        ? today
        : openPeriod.endDate;
    const pendingValidation = requiresValidation(actor);

    return await prisma.$transaction(
      (tx) =>
        upsertCommitmentInTx(
          tx,
          input,
          pendingValidation,
          dateIssued,
          {
            financialYear: openPeriod.financialYear,
            calendarMonth: openPeriod.calendarMonth,
          },
        ),
      { timeout: 60_000, maxWait: 10_000 },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not save carry-forward commitment.";
    if (/UNIQUE|constraint|P2002/i.test(message)) {
      return {
        ok: false,
        error:
          "Original DO # is already registered on another carry-forward commitment.",
      };
    }
    return { ok: false, error: message };
  }
}

export async function upsertBatch(
  input: UpsertCarryForwardBatchInput,
): Promise<CarryForwardBatchResult> {
  try {
    const actor = await loadRpcActor(input.userId);
    assertRouteWrite(actor, ROUTE_ID);

    if (!Number.isFinite(input.salesPointId) || !Number.isFinite(input.productId)) {
      return { ok: false, error: "Collection point and product are required." };
    }

    const prepared: Array<{
      customerId: number;
      outstandingQty: number;
      sourceDocumentNo: string;
      detailId: number | null;
    }> = [];
    const seenSourceNos = new Set<string>();

    for (const line of input.lines ?? []) {
      if (line == null || !Number.isFinite(line.customerId)) continue;
      if (
        line.outstandingQty === null ||
        line.outstandingQty === undefined ||
        Number.isNaN(Number(line.outstandingQty))
      ) {
        continue;
      }
      const outstandingQty = Math.round(Number(line.outstandingQty));
      if (!Number.isFinite(outstandingQty) || outstandingQty < 0) {
        return {
          ok: false,
          error: "Outstanding quantity must be zero or a positive whole number.",
        };
      }

      const detailId =
        line.detailId != null && Number.isFinite(line.detailId)
          ? Number(line.detailId)
          : null;

      if (outstandingQty === 0 && detailId == null) continue;

      let sourceDocumentNo = "";
      if (outstandingQty > 0 || String(line.sourceDocumentNo ?? "").trim()) {
        const serial = validateBookletSerial(line.sourceDocumentNo);
        if (!serial.ok) {
          return { ok: false, error: `Original DO #: ${serial.error}` };
        }
        sourceDocumentNo = serial.serial;
        if (seenSourceNos.has(sourceDocumentNo)) {
          return {
            ok: false,
            error: `Original DO # ${sourceDocumentNo} is duplicated in this batch.`,
          };
        }
        seenSourceNos.add(sourceDocumentNo);
      } else if (outstandingQty > 0) {
        return { ok: false, error: "Original DO # is required for each line." };
      }

      prepared.push({
        customerId: line.customerId,
        outstandingQty,
        sourceDocumentNo,
        detailId,
      });
    }

    if (prepared.length === 0) {
      return { ok: false, error: "Enter at least one outstanding quantity." };
    }

    const openPeriod = await getOpenPostingPeriodForActor(input.userId);
    if (!openPeriod) {
      return {
        ok: false,
        error: "Open a financial month before posting carry-forward commitments.",
      };
    }

    const today = todayIsoDate();
    const dateIssued =
      today >= openPeriod.startDate && today <= openPeriod.endDate
        ? today
        : openPeriod.endDate;
    const pendingValidation = requiresValidation(actor);

    const saved = await prisma.$transaction(
      async (tx) => {
        let count = 0;
        for (const line of prepared) {
          const result = await upsertCommitmentInTx(
            tx,
            {
              userId: input.userId,
              customerId: line.customerId,
              salesPointId: input.salesPointId,
              productId: input.productId,
              outstandingQty: line.outstandingQty,
              sourceDocumentNo: line.sourceDocumentNo || null,
              detailId: line.detailId,
              notes: input.notes,
            },
            pendingValidation,
            dateIssued,
            {
              financialYear: openPeriod.financialYear,
              calendarMonth: openPeriod.calendarMonth,
            },
          );
          if (!result.ok) {
            throw new Error(result.error);
          }
          count += 1;
        }
        return count;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    return { ok: true, saved, pendingValidation };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not save carry-forward batch.",
    };
  }
}

export async function deleteCommitment(
  input: { userId: string; detailId: number },
): Promise<CarryForwardDeleteResult> {
  try {
    const actor = await loadRpcActor(input.userId);
    assertRouteWrite(actor, ROUTE_ID);

    const line = await prisma.delivery_order_details.findUnique({
      where: { id: BigInt(input.detailId) },
      include: {
        delivery_orders: {
          select: {
            id: true,
            delivery_order_no: true,
            source_kind: true,
          },
        },
      },
    });

    if (!line || line.delivery_orders.source_kind !== "CARRY_FORWARD") {
      return { ok: false, error: "Carry-forward line not found." };
    }

    const soldQty = await soldQtyForDoProduct(
      line.delivery_orders.delivery_order_no,
      line.product_id,
    );
    if (soldQty > 0) {
      return {
        ok: false,
        error: `Cannot delete: ${Math.round(soldQty)} kg already sold against ${line.delivery_orders.delivery_order_no}. Set outstanding to 0 instead.`,
      };
    }

    await prisma.$transaction(async (tx) => {
      await tx.delivery_order_details.delete({
        where: { id: line.id },
      });
      const remaining = await tx.delivery_order_details.count({
        where: { delivery_order_id: line.delivery_orders.id },
      });
      if (remaining === 0) {
        await tx.delivery_order_payment_details.deleteMany({
          where: { delivery_order_id: line.delivery_orders.id },
        });
        await tx.delivery_orders.delete({
          where: { id: line.delivery_orders.id },
        });
      }
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not delete carry-forward commitment.",
    };
  }
}
