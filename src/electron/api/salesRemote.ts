import type { CreateSaleInput, SaveSaleResult } from "../../shared/sales.types.js";
import { commandApiFetch, CommandApiError } from "./client.js";

export type RemoteCreateSalePayload = Omit<CreateSaleInput, "lines" | "payments"> & {
  financialYear: number;
  financialMonth: number;
  postingCalendarYear?: number;
  customerNameSnapshot: string;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  vatRateSnapshot?: string;
  taxRegimeId?: string | null;
  lines: Array<{
    productId: number;
    qtyKg: string;
    unitPricePerKg: string;
    lineNet: string;
    lineVat: string;
    lineGross: string;
    qtyUnits?: string | null;
    unitPricePerUnit?: string | null;
    storageLocationId?: number | null;
  }>;
  payments: Array<{
    paymentMethodId: string;
    amount: string;
    chequeNo?: string | null;
    bank?: string | null;
    traiteNo?: string | null;
    traiteIssuedOn?: string | null;
    traiteMaturityOn?: string | null;
  }>;
};

export async function createSaleRemote(
  payload: RemoteCreateSalePayload,
): Promise<SaveSaleResult> {
  try {
    const result = await commandApiFetch<SaveSaleResult>("/api/v1/sales", {
      method: "POST",
      body: JSON.stringify(payload),
    });
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
