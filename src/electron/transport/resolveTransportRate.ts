import { getDatabase } from "../db/index.js";
import { loadTaxRatesAsOf } from "../tax/resolveRates.js";

export type ResolveTransportRateResult =
  | {
      ok: true;
      ratePerKg: string;
      ratePerKgNumeric: number;
      /** Schedule rate with VAT applied (rate × (1 + vatRate)). */
      ratePerKgWithVat: number;
      vatRate: number;
    }
  | { ok: false; error: string };

function normalizeAsOfDay(asOfDate: string): string {
  const trimmed = asOfDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return trimmed.slice(0, 10);
}

/** Apply current VAT to an ex-VAT transport schedule rate. */
export function applyVatToTransportRate(
  ratePerKgExVat: number,
  asOfDate?: string | null,
): { ratePerKgWithVat: number; vatRate: number } {
  const vatRate = loadTaxRatesAsOf(asOfDate).vatRate;
  return {
    vatRate,
    ratePerKgWithVat: ratePerKgExVat * (1 + vatRate),
  };
}

export function resolveTransportRatePerKg(
  salesPointId: number,
  productId: number,
  asOfDate: string,
): ResolveTransportRateResult {
  const day = normalizeAsOfDay(asOfDate);
  const row = getDatabase()
    .prepare(
      `SELECT ratePerKg FROM TransportRateSchedule
       WHERE salesPointId = ? AND productId = ? AND effectiveFrom <= ?
       ORDER BY effectiveFrom DESC
       LIMIT 1`,
    )
    .get(salesPointId, productId, day) as { ratePerKg: string } | undefined;

  if (!row) {
    return {
      ok: false,
      error: `No transport rate for collection point and product on or before ${day}.`,
    };
  }

  const ratePerKgNumeric = Number.parseFloat(row.ratePerKg);
  if (!Number.isFinite(ratePerKgNumeric) || ratePerKgNumeric < 0) {
    return { ok: false, error: "Transport rate is invalid." };
  }

  const { ratePerKgWithVat, vatRate } = applyVatToTransportRate(
    ratePerKgNumeric,
    day,
  );

  return {
    ok: true,
    ratePerKg: row.ratePerKg,
    ratePerKgNumeric,
    ratePerKgWithVat,
    vatRate,
  };
}
