import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

export type StockMovementKind =
  | "RECEIPT"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "ADJUSTMENT"
  | "SALE"
  | "SALE_REVERSAL";

export type StockCondition = "SELLABLE" | "UNSELLABLE";

type Tx = Prisma.TransactionClient | PrismaClient;

function parseQty(value: string): number {
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(rounded);
}

export function signedDeltaForKind(kind: StockMovementKind, qty: string): number {
  const amount = parseQty(qty);
  switch (kind) {
    case "RECEIPT":
    case "TRANSFER_IN":
    case "SALE_REVERSAL":
      return Math.abs(amount);
    case "TRANSFER_OUT":
    case "SALE":
      return -Math.abs(amount);
    case "ADJUSTMENT":
      return amount;
    default:
      return amount;
  }
}

export async function getBalanceQty(
  tx: Tx,
  salesPointId: number,
  productId: number,
  storageLocationId: number | null,
  condition: StockCondition = "SELLABLE",
): Promise<number> {
  const rows = await tx.stock_movements.findMany({
    where: {
      sales_point_id: salesPointId,
      product_id: productId,
      condition,
      ...(storageLocationId == null
        ? { storage_location_id: null }
        : { storage_location_id: storageLocationId }),
    },
    select: { kind: true, qty: true },
  });

  let total = 0;
  for (const row of rows) {
    total += signedDeltaForKind(row.kind as StockMovementKind, row.qty);
  }
  return total;
}

/** Sellable on-hand reconstructed from movements through asOfDate (inclusive). */
export async function getSellableBalanceAsOf(
  tx: Tx,
  salesPointId: number,
  productId: number,
  storageLocationId: number | null,
  asOfDateIso: string,
): Promise<number> {
  const asOf = asOfDateIso.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return getBalanceQty(tx, salesPointId, productId, storageLocationId, "SELLABLE");
  }

  const endExclusive = new Date(`${asOf}T23:59:59.999Z`);
  const rows = await tx.stock_movements.findMany({
    where: {
      sales_point_id: salesPointId,
      product_id: productId,
      condition: "SELLABLE",
      occurred_at: { lte: endExclusive },
      ...(storageLocationId == null
        ? { storage_location_id: null }
        : { storage_location_id: storageLocationId }),
    },
    select: { kind: true, qty: true },
  });

  let total = 0;
  for (const row of rows) {
    total += signedDeltaForKind(row.kind as StockMovementKind, row.qty);
  }
  return total;
}

export type ApplyMovementInput = {
  salesPointId: number;
  productId: number;
  storageLocationId: number | null;
  qty: string;
  kind: StockMovementKind;
  occurredAt: Date;
  userId: string;
  sourceKind: string;
  sourceId: string;
  condition?: StockCondition;
  notes?: string | null;
  originDeviceId?: string | null;
};

export async function applyMovement(
  tx: Tx,
  input: ApplyMovementInput,
): Promise<void> {
  const condition = input.condition ?? "SELLABLE";
  const signedDelta = signedDeltaForKind(input.kind, input.qty);

  if (Math.abs(signedDelta) < 0.000001) {
    throw new Error("Movement quantity must be non-zero.");
  }

  const current = await getBalanceQty(
    tx,
    input.salesPointId,
    input.productId,
    input.storageLocationId,
    condition,
  );
  const next = current + signedDelta;
  if (next < -0.000001) {
    throw new Error(
      `Insufficient stock for product ${input.productId} (available ${formatQty(current)}).`,
    );
  }

  const storedQty =
    input.kind === "ADJUSTMENT"
      ? formatQty(signedDelta)
      : formatQty(Math.abs(signedDelta));

  await tx.stock_movements.create({
    data: {
      id: randomUUID(),
      sales_point_id: input.salesPointId,
      product_id: input.productId,
      kind: input.kind,
      qty: storedQty,
      occurred_at: input.occurredAt,
      user_id: input.userId,
      source_kind: input.sourceKind,
      source_id: input.sourceId,
      notes: input.notes ?? null,
      storage_location_id: input.storageLocationId,
      condition,
      origin_device_id: input.originDeviceId ?? null,
    },
  });
}

export function financialYearFromIsoDate(isoDate: string): number {
  const year = Number.parseInt(isoDate.slice(0, 4), 10);
  return Number.isFinite(year) ? year : new Date().getFullYear();
}

export function parseIsoDateTime(value: string): Date {
  const trimmed = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T12:00:00.000Z`
    : trimmed;
  const d = new Date(dateOnly);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date.");
  }
  return d;
}
