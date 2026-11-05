import type {
  ReceiveTransferInput,
  SaveAdjustmentInput,
  SaveReceiptInput,
  SaveTransferInput,
  StockGenericResult,
  StockMutationResult,
} from "../../shared/stock.types.js";
import { commandApiFetch, CommandApiError } from "./client.js";

async function wrapMutation<T extends { ok: boolean }>(
  run: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    const result = await run();
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

export async function createStockReceiptRemote(
  payload: SaveReceiptInput,
): Promise<StockMutationResult> {
  return wrapMutation(() =>
    commandApiFetch<StockMutationResult>("/api/v1/stock/receipts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  ) as Promise<StockMutationResult>;
}

export async function postStockReceiptRemote(
  receiptId: string,
  userId: string,
): Promise<StockGenericResult> {
  return wrapMutation(() =>
    commandApiFetch<StockGenericResult>(
      `/api/v1/stock/receipts/${encodeURIComponent(receiptId)}/post`,
      {
        method: "POST",
        body: JSON.stringify({ userId }),
      },
    ),
  ) as Promise<StockGenericResult>;
}

export async function createStockTransferRemote(
  payload: SaveTransferInput,
): Promise<StockMutationResult> {
  return wrapMutation(() =>
    commandApiFetch<StockMutationResult>("/api/v1/stock/transfers", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  ) as Promise<StockMutationResult>;
}

export async function postStockTransferRemote(
  transferId: string,
  userId: string,
): Promise<StockGenericResult> {
  return wrapMutation(() =>
    commandApiFetch<StockGenericResult>(
      `/api/v1/stock/transfers/${encodeURIComponent(transferId)}/post`,
      {
        method: "POST",
        body: JSON.stringify({ userId }),
      },
    ),
  ) as Promise<StockGenericResult>;
}

export async function receiveStockTransferRemote(
  payload: ReceiveTransferInput,
): Promise<StockGenericResult> {
  return wrapMutation(() =>
    commandApiFetch<StockGenericResult>(
      `/api/v1/stock/transfers/${encodeURIComponent(payload.transferId)}/receive`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  ) as Promise<StockGenericResult>;
}

export async function createStockAdjustmentRemote(
  payload: SaveAdjustmentInput & { postImmediately?: boolean },
): Promise<StockMutationResult> {
  return wrapMutation(() =>
    commandApiFetch<StockMutationResult>("/api/v1/stock/adjustments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  ) as Promise<StockMutationResult>;
}

export async function postStockAdjustmentRemote(
  adjustmentId: string,
  userId: string,
): Promise<StockGenericResult> {
  return wrapMutation(() =>
    commandApiFetch<StockGenericResult>(
      `/api/v1/stock/adjustments/${encodeURIComponent(adjustmentId)}/post`,
      {
        method: "POST",
        body: JSON.stringify({ userId }),
      },
    ),
  ) as Promise<StockGenericResult>;
}
