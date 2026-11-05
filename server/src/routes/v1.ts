import { Hono } from "hono";
import { deviceAuthMiddleware } from "../middleware/auth.js";
import { prisma } from "../db/prisma.js";
import {
  allocateDocumentSequence,
  type DocumentKind,
} from "../services/sequences.js";
import { createSaleCommand } from "../services/salesCommands.js";
import { createDeliveryOrderCommand } from "../services/deliveryOrderCommands.js";
import {
  createAdjustmentCommand,
  createReceiptCommand,
  createTransferCommand,
  postAdjustmentCommand,
  postReceiptCommand,
  postTransferCommand,
  receiveTransferCommand,
} from "../services/stockCommands.js";

function assertDeviceSalesPoint(
  device: { salesPointId?: number | bigint | null },
  salesPointId: number,
): string | null {
  if (
    device.salesPointId != null &&
    Number.isFinite(salesPointId) &&
    Number(device.salesPointId) !== salesPointId
  ) {
    return "Device is not allowed for this collection point.";
  }
  return null;
}

export const v1Route = new Hono();

v1Route.use("*", deviceAuthMiddleware);

const DOCUMENT_KINDS = new Set<DocumentKind>([
  "SALES_INVOICE",
  "DELIVERY_ORDER",
  "STOCK_RECEIPT",
  "STOCK_TRANSFER",
  "STOCK_ADJUSTMENT",
]);

v1Route.post("/sequences/allocate", async (c) => {
  const body = await c.req.json().catch(() => null);
  const salesPointId = Number(body?.salesPointId);
  const financialYear = Number(body?.financialYear);
  const documentKind = String(body?.documentKind ?? "") as DocumentKind;
  const prefix =
    typeof body?.prefix === "string" ? body.prefix : undefined;
  const pad =
    typeof body?.pad === "number" && Number.isFinite(body.pad)
      ? body.pad
      : undefined;

  if (!Number.isFinite(salesPointId) || salesPointId <= 0) {
    return c.json({ ok: false, error: "salesPointId is required." }, 400);
  }
  if (!Number.isFinite(financialYear)) {
    return c.json({ ok: false, error: "financialYear is required." }, 400);
  }
  if (!DOCUMENT_KINDS.has(documentKind)) {
    return c.json({ ok: false, error: "Invalid documentKind." }, 400);
  }

  const device = c.get("device");
  if (
    device.salesPointId != null &&
    Number(device.salesPointId) !== salesPointId
  ) {
    return c.json(
      { ok: false, error: "Device is not allowed for this collection point." },
      403,
    );
  }

  const result = await allocateDocumentSequence({
    salesPointId,
    documentKind,
    financialYear,
    prefix,
    pad,
  });
  return c.json({ ok: true, ...result });
});

v1Route.post("/sales", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const device = c.get("device");
  const salesPointId = Number(body.salesPointId);
  if (
    device.salesPointId != null &&
    Number.isFinite(salesPointId) &&
    Number(device.salesPointId) !== salesPointId
  ) {
    return c.json(
      { ok: false, error: "Device is not allowed for this collection point." },
      403,
    );
  }

  const result = await createSaleCommand({
    ...body,
    salesPointId,
    originDeviceId: device.id,
  });

  if (!result.ok) {
    return c.json(result, 400);
  }
  return c.json(result, 201);
});

v1Route.post("/delivery-orders", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const device = c.get("device");
  const salesPointId = Number(body.salesPointId);
  if (
    device.salesPointId != null &&
    Number.isFinite(salesPointId) &&
    Number(device.salesPointId) !== salesPointId
  ) {
    return c.json(
      { ok: false, error: "Device is not allowed for this collection point." },
      403,
    );
  }

  const result = await createDeliveryOrderCommand({
    ...body,
    salesPointId,
    originDeviceId: device.id,
  });

  if (!result.ok) {
    return c.json(result, 400);
  }
  return c.json(result, 201);
});

v1Route.post("/stock/receipts", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const device = c.get("device");
  const salesPointId = Number(body.salesPointId);
  const denied = assertDeviceSalesPoint(device, salesPointId);
  if (denied) {
    return c.json({ ok: false, error: denied }, 403);
  }
  const result = await createReceiptCommand({
    ...body,
    salesPointId,
    originDeviceId: device.id,
  });
  if (!result.ok) {
    return c.json(result, 400);
  }
  return c.json(result, 201);
});

v1Route.post("/stock/receipts/:id/post", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const device = c.get("device");
  const userId =
    typeof body?.userId === "string" ? body.userId : String(body?.userId ?? "");
  if (!userId) {
    return c.json({ ok: false, error: "userId is required." }, 400);
  }
  const result = await postReceiptCommand({
    receiptId: c.req.param("id"),
    userId,
    originDeviceId: device.id,
  });
  if (!result.ok) {
    return c.json(result, 400);
  }
  return c.json(result);
});

v1Route.post("/stock/transfers", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const device = c.get("device");
  const fromSalesPointId = Number(body.fromSalesPointId);
  const denied = assertDeviceSalesPoint(device, fromSalesPointId);
  if (denied) {
    return c.json({ ok: false, error: denied }, 403);
  }
  const result = await createTransferCommand({
    ...body,
    fromSalesPointId,
    toSalesPointId: Number(body.toSalesPointId),
    originDeviceId: device.id,
  });
  if (!result.ok) {
    return c.json(result, 400);
  }
  return c.json(result, 201);
});

v1Route.post("/stock/transfers/:id/post", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const device = c.get("device");
  const userId =
    typeof body?.userId === "string" ? body.userId : String(body?.userId ?? "");
  if (!userId) {
    return c.json({ ok: false, error: "userId is required." }, 400);
  }
  const result = await postTransferCommand({
    transferId: c.req.param("id"),
    userId,
    originDeviceId: device.id,
  });
  if (!result.ok) {
    return c.json(result, 400);
  }
  return c.json(result);
});

v1Route.post("/stock/transfers/:id/receive", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const device = c.get("device");
  const userId =
    typeof body.userId === "string" ? body.userId : String(body.userId ?? "");
  if (!userId) {
    return c.json({ ok: false, error: "userId is required." }, 400);
  }
  const result = await receiveTransferCommand({
    ...body,
    transferId: c.req.param("id"),
    userId,
    originDeviceId: device.id,
  });
  if (!result.ok) {
    return c.json(result, 400);
  }
  return c.json(result);
});

v1Route.post("/stock/adjustments", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const device = c.get("device");
  const salesPointId = Number(body.salesPointId);
  const denied = assertDeviceSalesPoint(device, salesPointId);
  if (denied) {
    return c.json({ ok: false, error: denied }, 403);
  }
  const result = await createAdjustmentCommand({
    ...body,
    salesPointId,
    originDeviceId: device.id,
  });
  if (!result.ok) {
    return c.json(result, 400);
  }
  return c.json(result, 201);
});

v1Route.post("/stock/adjustments/:id/post", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const device = c.get("device");
  const userId =
    typeof body?.userId === "string" ? body.userId : String(body?.userId ?? "");
  if (!userId) {
    return c.json({ ok: false, error: "userId is required." }, 400);
  }
  const result = await postAdjustmentCommand({
    adjustmentId: c.req.param("id"),
    userId,
    originDeviceId: device.id,
  });
  if (!result.ok) {
    return c.json(result, 400);
  }
  return c.json(result);
});

/**
 * Incremental operational pull for a device's sales point.
 * Returns sales / DOs / stock docs updated since `since` (ISO timestamp).
 */
v1Route.get("/ops/pull", async (c) => {
  const device = c.get("device");
  const sinceRaw = c.req.query("since")?.trim() || null;
  const salesPointIdRaw = c.req.query("salesPointId");
  const salesPointId =
    salesPointIdRaw != null && salesPointIdRaw !== ""
      ? Number.parseInt(salesPointIdRaw, 10)
      : device.salesPointId != null
        ? Number(device.salesPointId)
        : null;

  if (salesPointId == null || !Number.isFinite(salesPointId)) {
    return c.json(
      { ok: false, error: "salesPointId is required for ops pull." },
      400,
    );
  }
  if (
    device.salesPointId != null &&
    Number(device.salesPointId) !== salesPointId
  ) {
    return c.json(
      { ok: false, error: "Device is not allowed for this collection point." },
      403,
    );
  }

  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw))
    ? new Date(sinceRaw)
    : new Date(0);
  const serverTime = new Date().toISOString();

  const [sales, deliveryOrders, stockReceipts, stockTransfers, stockAdjustments] =
    await Promise.all([
      prisma.sales.findMany({
        where: {
          sales_point_id: salesPointId,
          updated_at: { gt: since },
        },
        orderBy: { updated_at: "asc" },
        take: 500,
      }),
      prisma.delivery_orders.findMany({
        where: {
          sales_point_id: salesPointId,
          synced_at: { gt: since },
        },
        orderBy: { synced_at: "asc" },
        take: 500,
      }),
      prisma.stock_receipts.findMany({
        where: {
          sales_point_id: salesPointId,
          updated_at: { gt: since },
        },
        orderBy: { updated_at: "asc" },
        take: 500,
      }),
      prisma.stock_transfers.findMany({
        where: {
          OR: [
            { from_sales_point_id: salesPointId },
            { to_sales_point_id: salesPointId },
          ],
          updated_at: { gt: since },
        },
        orderBy: { updated_at: "asc" },
        take: 500,
      }),
      prisma.stock_adjustments.findMany({
        where: {
          sales_point_id: salesPointId,
          updated_at: { gt: since },
        },
        orderBy: { updated_at: "asc" },
        take: 500,
      }),
    ]);

  return c.json({
    ok: true,
    serverTime,
    salesPointId,
    sales,
    deliveryOrders,
    stockReceipts,
    stockTransfers,
    stockAdjustments,
  });
});
