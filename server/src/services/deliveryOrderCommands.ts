import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { allocateDocumentSequence } from "./sequences.js";

export type CreateDeliveryOrderCommandInput = {
  userId: string;
  deliveryOrderNo?: string;
  dateIssued: string;
  customerId?: number | null;
  orderRef?: string | null;
  salesPointId: number;
  financialYear: number;
  financialMonth: number;
  postingCalendarYear?: number;
  sourceKind?: string;
  originDeviceId?: string;
  lines: Array<{
    productId: number;
    orderQty: number;
    orderUnit?: string | null;
    unitPrice?: string | null;
    amount?: string | null;
  }>;
};

export type CreateDeliveryOrderCommandResult =
  | { ok: true; deliveryOrderId: string; deliveryOrderNo: string }
  | { ok: false; error: string };

export async function createDeliveryOrderCommand(
  input: CreateDeliveryOrderCommandInput,
): Promise<CreateDeliveryOrderCommandResult> {
  if (!input.salesPointId || !Number.isFinite(input.salesPointId)) {
    return { ok: false, error: "Collection point is required." };
  }
  if (!input.dateIssued?.trim()) {
    return { ok: false, error: "Date issued is required." };
  }
  if (!input.lines?.length) {
    return { ok: false, error: "Add at least one line." };
  }

  try {
    const deliveryOrderId = randomUUID();
    let deliveryOrderNo = input.deliveryOrderNo?.trim() || "";

    if (deliveryOrderNo) {
      const existing = await prisma.delivery_orders.findUnique({
        where: { delivery_order_no: deliveryOrderNo },
        select: { id: true },
      });
      if (existing) {
        return {
          ok: false,
          error: `Delivery order ${deliveryOrderNo} already exists.`,
        };
      }
    } else {
      const allocated = await allocateDocumentSequence({
        salesPointId: input.salesPointId,
        documentKind: "DELIVERY_ORDER",
        financialYear: input.financialYear,
      });
      deliveryOrderNo = allocated.documentNo;
    }

    await prisma.$transaction(async (tx) => {
      await tx.delivery_orders.create({
        data: {
          id: deliveryOrderId,
          delivery_order_no: deliveryOrderNo,
          date_issued: input.dateIssued.trim().slice(0, 10),
          customer_id: input.customerId ?? null,
          order_ref: input.orderRef ?? null,
          sales_point_id: input.salesPointId,
          financial_year: input.financialYear,
          financial_month: input.financialMonth,
          created_by_user_id: input.userId,
          status: "PENDING",
          posting_calendar_year:
            input.postingCalendarYear ?? input.financialYear,
          source_kind: input.sourceKind ?? "NORMAL",
          origin_device_id: input.originDeviceId ?? null,
        },
      });

      for (const line of input.lines) {
        await tx.delivery_order_details.create({
          data: {
            delivery_order_id: deliveryOrderId,
            product_id: line.productId,
            order_qty: line.orderQty,
            order_unit: line.orderUnit ?? null,
            unit_price: line.unitPrice ?? null,
            amount: line.amount ?? null,
          },
        });
      }
    });

    return { ok: true, deliveryOrderId, deliveryOrderNo };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create delivery order.";
    if (/unique|duplicate/i.test(message)) {
      return { ok: false, error: "Delivery order number already in use." };
    }
    return { ok: false, error: message };
  }
}
