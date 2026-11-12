import { commandApiFetch, CommandApiError } from "./client.js";

export type RemoteCreateDeliveryOrderPayload = {
  userId: string;
  deliveryOrderNo?: string;
  dateIssued: string;
  customerId?: number | null;
  orderRef?: string | null;
  salesPointId: number;
  destinationPending?: boolean;
  financialYear: number;
  financialMonth: number;
  postingCalendarYear?: number;
  sourceKind?: string;
  lines: Array<{
    productId: number;
    orderQty: number;
    orderUnit?: string | null;
    unitPrice?: string | null;
    amount?: string | null;
  }>;
};

export type RemoteCreateDeliveryOrderResult =
  | { ok: true; deliveryOrderId: string; deliveryOrderNo: string }
  | { ok: false; error: string };

export async function createDeliveryOrderRemote(
  payload: RemoteCreateDeliveryOrderPayload,
): Promise<RemoteCreateDeliveryOrderResult> {
  try {
    const result = await commandApiFetch<RemoteCreateDeliveryOrderResult>(
      "/api/v1/delivery-orders",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
    if (!result || typeof result !== "object" || !("ok" in result)) {
      return { ok: false, error: "Invalid response from command API." };
    }
    return result;
  } catch (err) {
    if (err instanceof CommandApiError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Server unreachable. Check the network and try again.",
    };
  }
}
