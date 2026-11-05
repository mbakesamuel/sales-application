import { prisma } from "../db/prisma.js";
import { getBalanceQty } from "./stockMovements.js";
import { previewUnitPrice } from "./salesRpcExtras.js";
import { getTaxRatesAsOf } from "./salesRpcExtras.js";
import { getCompanySettings } from "./mastersQueries.js";

function qtyStr(n: number): string {
  return String(Math.round(n * 1_000_000) / 1_000_000);
}

async function mapOrder(orderId: string) {
  const order = await prisma.delivery_orders.findUnique({
    where: { id: orderId },
    include: {
      delivery_order_details: true,
      delivery_order_payment_details: true,
      sales_points: { select: { name: true } },
    },
  });
  if (!order) return null;
  const customer =
    order.customer_id != null
      ? await prisma.customers.findUnique({ where: { id: order.customer_id } })
      : null;
  const products = await prisma.products.findMany({
    where: {
      product_id: { in: order.delivery_order_details.map((d) => d.product_id) },
    },
  });
  const productName = new Map(products.map((p) => [p.product_id, p.product_name]));
  return {
    id: order.id,
    deliveryOrderNo: order.delivery_order_no,
    dateIssued: order.date_issued,
    status: order.status,
    customerId: order.customer_id,
    customerName: customer?.name ?? null,
    salesPointId: order.sales_point_id,
    salesPointName: order.sales_points?.name ?? null,
    orderRef: order.order_ref,
    lines: order.delivery_order_details.map((d) => ({
      id: String(d.id),
      productId: d.product_id,
      productName: productName.get(d.product_id) ?? "",
      orderQty: String(d.order_qty),
      unitPrice: d.unit_price ?? "0",
      amount: d.amount ?? "0",
    })),
    payments: order.delivery_order_payment_details.map((p) => ({
      paymentMethodId: p.payment_method_id,
      paymentDate: p.payment_date,
      chequeNo: p.cheque_no,
      bank: p.bank,
    })),
  };
}

export async function loadByNo(deliveryOrderNo: string) {
  const no = String(deliveryOrderNo ?? "").trim();
  if (!no) return null;
  const order = await prisma.delivery_orders.findFirst({
    where: { delivery_order_no: no },
  });
  if (!order) return null;
  return mapOrder(order.id);
}

export async function loadPrintById(orderId: string) {
  const view = await mapOrder(String(orderId ?? ""));
  if (!view) return null;
  const company = await getCompanySettings();
  return {
    companyName: company?.companyName ?? "MPOS",
    department: company?.department ?? null,
    logoUrl: company?.logoUrl ?? null,
    order: view,
  };
}

export async function trackByNo(deliveryOrderNo: string) {
  return loadByNo(deliveryOrderNo);
}

export async function listPending(ctx: {
  salesPointId: number | null;
}) {
  const rows = await prisma.delivery_orders.findMany({
    where: {
      status: "PENDING",
      cancelled_at: null,
      ...(ctx.salesPointId != null ? { sales_point_id: ctx.salesPointId } : {}),
    },
    orderBy: { date_issued: "asc" },
    take: 200,
    include: { sales_points: { select: { name: true } } },
  });
  const customers = await prisma.customers.findMany({
    where: {
      id: {
        in: rows
          .map((r) => r.customer_id)
          .filter((id): id is number => id != null),
      },
    },
  });
  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  return rows.map((r) => ({
    id: r.id,
    deliveryOrderNo: r.delivery_order_no,
    dateIssued: r.date_issued,
    customerName: r.customer_id != null ? customerName.get(r.customer_id) ?? "" : "",
    salesPointName: r.sales_points?.name ?? null,
    status: r.status,
  }));
}

export async function listOrders(
  filters: Record<string, unknown> | undefined,
  ctx: { salesPointId: number | null },
) {
  const q = String(filters?.q ?? "").trim();
  const where: Record<string, unknown> = {
    cancelled_at: null,
  };
  if (ctx.salesPointId != null) where.sales_point_id = ctx.salesPointId;
  if (filters?.salesPointId != null) {
    where.sales_point_id = Number(filters.salesPointId);
  }
  if (q) {
    where.OR = [
      { delivery_order_no: { contains: q, mode: "insensitive" } },
      { order_ref: { contains: q, mode: "insensitive" } },
    ];
  }
  const rows = await prisma.delivery_orders.findMany({
    where,
    orderBy: { date_issued: "desc" },
    take: 300,
    include: { sales_points: { select: { name: true } } },
  });
  return {
    rows: rows.map((r) => ({
      id: r.id,
      deliveryOrderNo: r.delivery_order_no,
      dateIssued: r.date_issued,
      status: r.status,
      salesPointName: r.sales_points?.name ?? null,
      customerId: r.customer_id,
    })),
    total: rows.length,
  };
}

export async function deleteOrder(payload: { orderId?: string }) {
  const id = String(payload.orderId ?? "").trim();
  if (!id) return { ok: false as const, error: "Order id required." };
  const existing = await prisma.delivery_orders.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, error: "Delivery order not found." };
  if (existing.status === "VALIDATED") {
    return {
      ok: false as const,
      error: "Validated delivery orders cannot be deleted.",
    };
  }
  await prisma.delivery_orders.delete({ where: { id } });
  return { ok: true as const };
}

export async function cancelValidated(
  payload: { orderId?: string; reason?: string },
  userId: string,
) {
  const id = String(payload.orderId ?? "").trim();
  if (!id) return { ok: false as const, error: "Order id required." };
  const existing = await prisma.delivery_orders.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, error: "Delivery order not found." };
  if (existing.status !== "VALIDATED") {
    return {
      ok: false as const,
      error: `Cannot cancel a delivery order in status ${existing.status}.`,
    };
  }
  await prisma.delivery_orders.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelled_at: new Date(),
      cancelled_by_user_id: userId,
      cancel_reason: String(payload.reason ?? "").trim() || null,
    },
  });
  return { ok: true as const };
}

export async function validateMany(
  payload: { orderIds?: string[] },
  userId: string,
) {
  const ids = payload.orderIds ?? [];
  const errors: Array<{ id: string; error: string }> = [];
  let validated = 0;
  for (const id of ids) {
    const existing = await prisma.delivery_orders.findUnique({ where: { id } });
    if (!existing) {
      errors.push({ id, error: "Not found." });
      continue;
    }
    if (existing.status === "VALIDATED") {
      validated += 1;
      continue;
    }
    if (existing.status !== "PENDING") {
      errors.push({ id, error: `Status ${existing.status}` });
      continue;
    }
    await prisma.delivery_orders.update({
      where: { id },
      data: {
        status: "VALIDATED",
        validated_at: new Date(),
        validated_by_user_id: userId,
      },
    });
    validated += 1;
  }
  return { ok: errors.length === 0, validated, errors };
}

export async function previewTaxes(payload: {
  asOfDate?: string;
  netAmount?: string | number;
}) {
  const rates = await getTaxRatesAsOf(String(payload.asOfDate ?? ""));
  const net = Number.parseFloat(String(payload.netAmount ?? "0")) || 0;
  const vatAmount = net * rates.vatRate;
  return {
    ok: true as const,
    preview: {
      netAmount: qtyStr(net),
      vatRate: rates.vatRate,
      vatAmount: qtyStr(vatAmount),
      grossAmount: qtyStr(net + vatAmount),
      rates,
    },
  };
}

export async function previewUnitPriceDo(payload: Record<string, unknown>) {
  return previewUnitPrice({
    productId: Number(payload.productId),
    asOfDate: String(payload.asOfDate ?? ""),
    customerId:
      payload.customerId == null ? null : Number(payload.customerId),
  });
}

export async function previewStockOnHand(payload: {
  salesPointId?: number;
  productId?: number;
  storageLocationId?: number | null;
}) {
  const salesPointId = Number(payload.salesPointId);
  const productId = Number(payload.productId);
  if (!Number.isFinite(salesPointId) || !Number.isFinite(productId)) {
    return { ok: false as const, error: "Sales point and product required." };
  }
  const storageLocationId =
    payload.storageLocationId == null
      ? null
      : Number(payload.storageLocationId);
  const onHand = await getBalanceQty(
    prisma,
    salesPointId,
    productId,
    Number.isFinite(storageLocationId as number)
      ? (storageLocationId as number)
      : null,
    "SELLABLE",
  );
  return { ok: true as const, onHand: qtyStr(onHand) };
}

export async function transferBalance(_input: unknown) {
  return {
    ok: false as const,
    error: "DO balance transfer is not yet available on the shared API.",
  };
}
