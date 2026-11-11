import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { allocateDocumentSequence } from "./sequences.js";
import {
  applyMovement,
  financialYearFromIsoDate,
  parseIsoDateTime,
  type StockCondition,
} from "./stockMovements.js";

export type StockCommandResult =
  | { ok: true; id: string; documentNo: string; posted?: boolean }
  | { ok: false; error: string };

export type StockPostResult = { ok: true } | { ok: false; error: string };

type ReceiptLineInput = {
  productId: number;
  qty: string;
  storageLocationId?: number | null;
};

type TransferLineInput = {
  productId: number;
  qty: string;
  fromStorageLocationId: number;
  toStorageLocationId?: number | null;
};

type AdjustmentLineInput = {
  productId: number;
  deltaQty: string;
  storageLocationId: number;
  fromCondition?: StockCondition | null;
  toCondition?: StockCondition | null;
};

function isPositiveQty(value: string): boolean {
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0;
}

function isNonZeroQty(value: string): boolean {
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) && Math.abs(n) > 0.000001;
}

function uniqueConflict(message: string, label: string): string {
  if (/unique|duplicate/i.test(message)) {
    return `${label} already in use.`;
  }
  return message;
}

const BOTTLE_TRANSFER_BLOCKED_MESSAGE =
  "Bottle products are received at Bota via Reception / consignment note; transfers are not used for bottle stock.";

async function assertBottleReceiptAtBota(
  salesPointId: number,
  productIds: number[],
): Promise<string | null> {
  const products = await prisma.products.findMany({
    where: { product_id: { in: productIds } },
    include: { product_cats: { select: { is_bottled: true } } },
  });
  if (products.length === 0) {
    return null;
  }
  const anyBottled = products.some((p) => Boolean(p.product_cats?.is_bottled));
  const anyLoose = products.some((p) => !p.product_cats?.is_bottled);
  if (anyBottled && anyLoose) {
    return "A receipt cannot mix bottled and loose products.";
  }
  if (!anyBottled) {
    return null;
  }
  const bota = await prisma.sales_points.findFirst({
    where: {
      is_active: true,
      name: { contains: "BOTA", mode: "insensitive" },
    },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  if (!bota || bota.id !== salesPointId) {
    return "Bottle Oil receipts must be posted at Bota.";
  }
  return null;
}

async function assertNoBottledTransferProducts(
  productIds: number[],
): Promise<string | null> {
  const products = await prisma.products.findMany({
    where: { product_id: { in: productIds } },
    include: { product_cats: { select: { is_bottled: true } } },
  });
  if (products.some((p) => Boolean(p.product_cats?.is_bottled))) {
    return BOTTLE_TRANSFER_BLOCKED_MESSAGE;
  }
  return null;
}

export type CreateReceiptCommandInput = {
  userId: string;
  receiptNo?: string;
  salesPointId: number;
  supplierLabel: string;
  receivedAt: string;
  notes?: string | null;
  consignmentNoteNo?: string | null;
  consignedBy?: string | null;
  consDesign?: string | null;
  consDate?: string | null;
  receiveBy?: string | null;
  receiveByDesign?: string | null;
  receiveDate?: string | null;
  lines: ReceiptLineInput[];
  postImmediately?: boolean;
  originDeviceId?: string;
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function assertBottledReceiptConsignmentFields(
  productIds: number[],
  input: CreateReceiptCommandInput,
): Promise<string | null> {
  const products = await prisma.products.findMany({
    where: { product_id: { in: productIds } },
    include: { product_cats: { select: { is_bottled: true } } },
  });
  const anyBottled = products.some((p) => Boolean(p.product_cats?.is_bottled));
  if (!anyBottled) {
    return null;
  }
  if (!normalizeOptionalText(input.consignmentNoteNo)) {
    return "Consignment # is required for Bottle Oil receipts.";
  }
  if (!normalizeOptionalText(input.consignedBy)) {
    return "Consigned by is required for Bottle Oil receipts.";
  }
  if (!normalizeOptionalText(input.receiveBy)) {
    return "Received by is required for Bottle Oil receipts.";
  }
  return null;
}

export async function createReceiptCommand(
  input: CreateReceiptCommandInput,
): Promise<StockCommandResult> {
  if (!input.salesPointId || !Number.isFinite(input.salesPointId)) {
    return { ok: false, error: "Collection point is required." };
  }
  if (!input.supplierLabel?.trim()) {
    return { ok: false, error: "Supplier label is required." };
  }
  if (!input.lines?.length) {
    return { ok: false, error: "Add at least one line." };
  }
  for (const line of input.lines) {
    if (!isPositiveQty(line.qty)) {
      return { ok: false, error: "Each line quantity must be greater than zero." };
    }
  }

  const bottleScopeError = await assertBottleReceiptAtBota(
    input.salesPointId,
    input.lines.map((line) => line.productId),
  );
  if (bottleScopeError) {
    return { ok: false, error: bottleScopeError };
  }

  const consignError = await assertBottledReceiptConsignmentFields(
    input.lines.map((line) => line.productId),
    input,
  );
  if (consignError) {
    return { ok: false, error: consignError };
  }

  try {
    const receivedAt = parseIsoDateTime(input.receivedAt);
    const financialYear = financialYearFromIsoDate(input.receivedAt);
    const id = randomUUID();
    let receiptNo = input.receiptNo?.trim() || "";
    const postImmediately = Boolean(input.postImmediately);
    const status = postImmediately ? "POSTED" : "DRAFT";
    const now = new Date();
    const consignmentNoteNo = normalizeOptionalText(input.consignmentNoteNo);
    if (consignmentNoteNo) {
      const duplicate = await prisma.$queryRaw<
        Array<{ id: string; receipt_no: string }>
      >`
        SELECT id, receipt_no
        FROM stock_receipts
        WHERE consignment_note_no IS NOT NULL
          AND lower(btrim(consignment_note_no)) = lower(btrim(${consignmentNoteNo}))
        LIMIT 1
      `;
      if (duplicate[0]) {
        return {
          ok: false,
          error: `Consignment # "${consignmentNoteNo}" is already used on receipt ${duplicate[0].receipt_no}.`,
        };
      }
    }

    if (receiptNo) {
      const existing = await prisma.stock_receipts.findUnique({
        where: { receipt_no: receiptNo },
        select: { id: true },
      });
      if (existing) {
        return { ok: false, error: `Receipt ${receiptNo} already exists.` };
      }
    } else {
      const allocated = await allocateDocumentSequence({
        salesPointId: input.salesPointId,
        documentKind: "STOCK_RECEIPT",
        financialYear,
      });
      receiptNo = allocated.documentNo;
    }

    await prisma.$transaction(async (tx) => {
      await tx.stock_receipts.create({
        data: {
          id,
          receipt_no: receiptNo,
          sales_point_id: input.salesPointId,
          received_at: receivedAt,
          supplier_label: input.supplierLabel.trim(),
          status,
          notes: input.notes?.trim() || null,
          consignment_note_no: consignmentNoteNo,
          consigned_by: normalizeOptionalText(input.consignedBy),
          cons_design: normalizeOptionalText(input.consDesign),
          cons_date: normalizeOptionalText(input.consDate),
          receive_by: normalizeOptionalText(input.receiveBy),
          receive_by_design: normalizeOptionalText(input.receiveByDesign),
          receive_date: normalizeOptionalText(input.receiveDate),
          created_by_user_id: input.userId,
          posted_by_user_id: postImmediately ? input.userId : null,
          posted_at: postImmediately ? now : null,
          origin_device_id: input.originDeviceId ?? null,
        },
      });

      for (const line of input.lines) {
        await tx.stock_receipt_lines.create({
          data: {
            id: randomUUID(),
            receipt_id: id,
            product_id: line.productId,
            qty: String(line.qty).trim(),
            storage_location_id: line.storageLocationId ?? null,
          },
        });
      }

      if (postImmediately) {
        for (const line of input.lines) {
          await applyMovement(tx, {
            salesPointId: input.salesPointId,
            productId: line.productId,
            storageLocationId: line.storageLocationId ?? null,
            qty: String(line.qty).trim(),
            kind: "RECEIPT",
            occurredAt: receivedAt,
            userId: input.userId,
            sourceKind: "RECEIPT",
            sourceId: id,
            originDeviceId: input.originDeviceId,
          });
        }
      }
    });

    return { ok: true, id, documentNo: receiptNo, posted: postImmediately };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create receipt.";
    return { ok: false, error: uniqueConflict(message, "Receipt number") };
  }
}

export async function postReceiptCommand(input: {
  receiptId: string;
  userId: string;
  originDeviceId?: string;
}): Promise<StockPostResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.stock_receipts.findUnique({
        where: { id: input.receiptId },
        include: { stock_receipt_lines: true },
      });
      if (!existing) {
        throw new Error("Receipt not found.");
      }
      if (existing.status === "POSTED") {
        return;
      }
      if (existing.status !== "DRAFT") {
        throw new Error(`Cannot post a receipt in status ${existing.status}.`);
      }
      if (existing.stock_receipt_lines.length === 0) {
        throw new Error("Add at least one line before posting.");
      }

      for (const line of existing.stock_receipt_lines) {
        await applyMovement(tx, {
          salesPointId: existing.sales_point_id,
          productId: line.product_id,
          storageLocationId: line.storage_location_id,
          qty: line.qty,
          kind: "RECEIPT",
          occurredAt: existing.received_at,
          userId: input.userId,
          sourceKind: "RECEIPT",
          sourceId: existing.id,
          originDeviceId: input.originDeviceId,
        });
      }

      await tx.stock_receipts.update({
        where: { id: existing.id },
        data: {
          status: "POSTED",
          posted_by_user_id: input.userId,
          posted_at: new Date(),
          updated_at: new Date(),
        },
      });
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to post receipt.",
    };
  }
}

export type CreateTransferCommandInput = {
  userId: string;
  transferNo?: string;
  fromSalesPointId: number;
  toSalesPointId: number;
  dispatchedAt: string;
  notes?: string | null;
  consignedBy?: string | null;
  consDesign?: string | null;
  consDate?: string | null;
  receiveBy?: string | null;
  receiveByDesign?: string | null;
  receiveDate?: string | null;
  lines: TransferLineInput[];
  postImmediately?: boolean;
  originDeviceId?: string;
};

export async function createTransferCommand(
  input: CreateTransferCommandInput,
): Promise<StockCommandResult> {
  if (!input.fromSalesPointId || !Number.isFinite(input.fromSalesPointId)) {
    return { ok: false, error: "Source collection point is required." };
  }
  if (!input.toSalesPointId || !Number.isFinite(input.toSalesPointId)) {
    return { ok: false, error: "Destination collection point is required." };
  }
  if (!input.lines?.length) {
    return { ok: false, error: "Add at least one line." };
  }

  const isIntra = input.fromSalesPointId === input.toSalesPointId;
  for (const line of input.lines) {
    if (!isPositiveQty(line.qty)) {
      return { ok: false, error: "Each line quantity must be greater than zero." };
    }
    if (!Number.isFinite(line.fromStorageLocationId)) {
      return { ok: false, error: "Each line needs a source storage location." };
    }
    if (isIntra) {
      if (line.toStorageLocationId == null) {
        return {
          ok: false,
          error: "Each line needs a destination storage location.",
        };
      }
      if (line.fromStorageLocationId === line.toStorageLocationId) {
        return {
          ok: false,
          error: "Source and destination locations must differ on each line.",
        };
      }
    }
  }

  const bottledTransferError = await assertNoBottledTransferProducts(
    input.lines.map((line) => line.productId),
  );
  if (bottledTransferError) {
    return { ok: false, error: bottledTransferError };
  }

  try {
    const dispatchedAt = parseIsoDateTime(input.dispatchedAt);
    const financialYear = financialYearFromIsoDate(input.dispatchedAt);
    const id = randomUUID();
    let transferNo = input.transferNo?.trim() || "";
    const postImmediately = Boolean(input.postImmediately);
    // Inter-SP direct post becomes DISPATCHED (awaiting receive); intra becomes POSTED.
    let status = "DRAFT";
    if (postImmediately) {
      status = isIntra ? "POSTED" : "DISPATCHED";
    }
    const now = new Date();

    if (transferNo) {
      const existing = await prisma.stock_transfers.findUnique({
        where: { transfer_no: transferNo },
        select: { id: true },
      });
      if (existing) {
        return { ok: false, error: `Transfer ${transferNo} already exists.` };
      }
    } else {
      const allocated = await allocateDocumentSequence({
        salesPointId: input.fromSalesPointId,
        documentKind: "STOCK_TRANSFER",
        financialYear,
      });
      transferNo = allocated.documentNo;
    }

    await prisma.$transaction(async (tx) => {
      await tx.stock_transfers.create({
        data: {
          id,
          transfer_no: transferNo,
          from_sales_point_id: input.fromSalesPointId,
          to_sales_point_id: input.toSalesPointId,
          dispatched_at: dispatchedAt,
          notes: input.notes?.trim() || null,
          status,
          created_by_user_id: input.userId,
          posted_by_user_id: postImmediately ? input.userId : null,
          posted_at: postImmediately ? now : null,
          consigned_by: input.consignedBy?.trim() || null,
          cons_design: input.consDesign?.trim() || null,
          cons_date: input.consDate?.trim() || null,
          receive_by: input.receiveBy?.trim() || null,
          receive_by_design: input.receiveByDesign?.trim() || null,
          receive_date: input.receiveDate?.trim() || null,
          origin_device_id: input.originDeviceId ?? null,
        },
      });

      for (const line of input.lines) {
        await tx.stock_transfer_lines.create({
          data: {
            id: randomUUID(),
            transfer_id: id,
            product_id: line.productId,
            qty: String(line.qty).trim(),
            from_storage_location_id: line.fromStorageLocationId,
            to_storage_location_id: line.toStorageLocationId ?? null,
          },
        });
      }

      if (postImmediately) {
        for (const line of input.lines) {
          await applyMovement(tx, {
            salesPointId: input.fromSalesPointId,
            productId: line.productId,
            storageLocationId: line.fromStorageLocationId,
            qty: String(line.qty).trim(),
            kind: "TRANSFER_OUT",
            occurredAt: dispatchedAt,
            userId: input.userId,
            sourceKind: "TRANSFER",
            sourceId: id,
            originDeviceId: input.originDeviceId,
          });
          if (isIntra && line.toStorageLocationId != null) {
            await applyMovement(tx, {
              salesPointId: input.toSalesPointId,
              productId: line.productId,
              storageLocationId: line.toStorageLocationId,
              qty: String(line.qty).trim(),
              kind: "TRANSFER_IN",
              occurredAt: dispatchedAt,
              userId: input.userId,
              sourceKind: "TRANSFER",
              sourceId: id,
              originDeviceId: input.originDeviceId,
            });
          }
        }
      }
    });

    return {
      ok: true,
      id,
      documentNo: transferNo,
      posted: postImmediately,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create transfer.";
    return { ok: false, error: uniqueConflict(message, "Transfer number") };
  }
}

export async function postTransferCommand(input: {
  transferId: string;
  userId: string;
  originDeviceId?: string;
}): Promise<StockPostResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.stock_transfers.findUnique({
        where: { id: input.transferId },
        include: { stock_transfer_lines: true },
      });
      if (!existing) {
        throw new Error("Transfer not found.");
      }

      const isIntra =
        existing.from_sales_point_id === existing.to_sales_point_id;
      if (!isIntra) {
        throw new Error(
          "Only location moves within a collection point can be posted. Use receive for inter-point transfers.",
        );
      }
      if (existing.status === "POSTED") {
        return;
      }
      if (existing.status !== "DRAFT") {
        throw new Error(`Cannot post a transfer in status ${existing.status}.`);
      }
      if (existing.stock_transfer_lines.length === 0) {
        throw new Error("Add at least one line before posting.");
      }

      const occurredAt = existing.dispatched_at ?? new Date();
      for (const line of existing.stock_transfer_lines) {
        if (line.to_storage_location_id == null) {
          throw new Error("Each line needs a destination storage location.");
        }
        await applyMovement(tx, {
          salesPointId: existing.from_sales_point_id,
          productId: line.product_id,
          storageLocationId: line.from_storage_location_id,
          qty: line.qty,
          kind: "TRANSFER_OUT",
          occurredAt,
          userId: input.userId,
          sourceKind: "TRANSFER",
          sourceId: existing.id,
          originDeviceId: input.originDeviceId,
        });
        await applyMovement(tx, {
          salesPointId: existing.to_sales_point_id,
          productId: line.product_id,
          storageLocationId: line.to_storage_location_id,
          qty: line.qty,
          kind: "TRANSFER_IN",
          occurredAt,
          userId: input.userId,
          sourceKind: "TRANSFER",
          sourceId: existing.id,
          originDeviceId: input.originDeviceId,
        });
      }

      await tx.stock_transfers.update({
        where: { id: existing.id },
        data: {
          status: "POSTED",
          posted_by_user_id: input.userId,
          posted_at: new Date(),
          updated_at: new Date(),
        },
      });
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to post transfer.",
    };
  }
}

export type ReceiveTransferCommandInput = {
  transferId: string;
  userId: string;
  lines: Array<{ lineId: string; toStorageLocationId: number }>;
  receiveBy?: string | null;
  receiveByDesign?: string | null;
  receiveDate?: string | null;
  originDeviceId?: string;
};

export async function receiveTransferCommand(
  input: ReceiveTransferCommandInput,
): Promise<StockPostResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.stock_transfers.findUnique({
        where: { id: input.transferId },
        include: { stock_transfer_lines: true },
      });
      if (!existing) {
        throw new Error("Transfer not found.");
      }
      if (existing.from_sales_point_id === existing.to_sales_point_id) {
        throw new Error("Use Post for location moves within a collection point.");
      }
      if (existing.status === "RECEIVED") {
        return;
      }
      if (existing.status !== "DRAFT" && existing.status !== "DISPATCHED") {
        throw new Error(`Cannot receive a transfer in status ${existing.status}.`);
      }
      if (existing.stock_transfer_lines.length === 0) {
        throw new Error("Transfer has no lines.");
      }

      const destByLineId = new Map(
        input.lines.map((l) => [l.lineId, l.toStorageLocationId]),
      );
      const now = new Date();
      const occurredAt = existing.dispatched_at ?? now;

      // If still DRAFT, dispatch (TRANSFER_OUT) first.
      if (existing.status === "DRAFT") {
        for (const line of existing.stock_transfer_lines) {
          await applyMovement(tx, {
            salesPointId: existing.from_sales_point_id,
            productId: line.product_id,
            storageLocationId: line.from_storage_location_id,
            qty: line.qty,
            kind: "TRANSFER_OUT",
            occurredAt,
            userId: input.userId,
            sourceKind: "TRANSFER",
            sourceId: existing.id,
            originDeviceId: input.originDeviceId,
          });
        }
      }

      for (const line of existing.stock_transfer_lines) {
        const toStorageLocationId =
          destByLineId.get(line.id) ?? line.to_storage_location_id;
        if (toStorageLocationId == null) {
          throw new Error("Each line needs a destination storage location.");
        }
        await applyMovement(tx, {
          salesPointId: existing.to_sales_point_id,
          productId: line.product_id,
          storageLocationId: toStorageLocationId,
          qty: line.qty,
          kind: "TRANSFER_IN",
          occurredAt: now,
          userId: input.userId,
          sourceKind: "TRANSFER",
          sourceId: existing.id,
          originDeviceId: input.originDeviceId,
        });
        await tx.stock_transfer_lines.update({
          where: { id: line.id },
          data: { to_storage_location_id: toStorageLocationId },
        });
      }

      await tx.stock_transfers.update({
        where: { id: existing.id },
        data: {
          status: "RECEIVED",
          posted_by_user_id: existing.posted_by_user_id ?? input.userId,
          posted_at: existing.posted_at ?? now,
          received_at: now,
          received_by_user_id: input.userId,
          receive_by: input.receiveBy?.trim() || existing.receive_by,
          receive_by_design:
            input.receiveByDesign?.trim() || existing.receive_by_design,
          receive_date: input.receiveDate?.trim() || existing.receive_date,
          updated_at: now,
        },
      });
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to receive transfer.",
    };
  }
}

export type CreateAdjustmentCommandInput = {
  userId: string;
  adjustmentNo?: string;
  salesPointId: number;
  reason: string;
  occurredAt: string;
  lines: AdjustmentLineInput[];
  postImmediately?: boolean;
  originDeviceId?: string;
};

export async function createAdjustmentCommand(
  input: CreateAdjustmentCommandInput,
): Promise<StockCommandResult> {
  if (!input.salesPointId || !Number.isFinite(input.salesPointId)) {
    return { ok: false, error: "Collection point is required." };
  }
  if (!input.reason?.trim()) {
    return { ok: false, error: "Reason is required." };
  }
  if (!input.lines?.length) {
    return { ok: false, error: "Add at least one adjustment line." };
  }
  for (const line of input.lines) {
    if (!isNonZeroQty(line.deltaQty)) {
      return { ok: false, error: "Each adjustment line must be non-zero." };
    }
  }

  try {
    const occurredAt = parseIsoDateTime(input.occurredAt);
    const financialYear = financialYearFromIsoDate(input.occurredAt);
    const id = randomUUID();
    let adjustmentNo = input.adjustmentNo?.trim() || "";
    const postImmediately = Boolean(input.postImmediately);
    const status = postImmediately ? "POSTED" : "DRAFT";
    const now = new Date();

    if (adjustmentNo) {
      const existing = await prisma.stock_adjustments.findUnique({
        where: { adjustment_no: adjustmentNo },
        select: { id: true },
      });
      if (existing) {
        return { ok: false, error: `Adjustment ${adjustmentNo} already exists.` };
      }
    } else {
      const allocated = await allocateDocumentSequence({
        salesPointId: input.salesPointId,
        documentKind: "STOCK_ADJUSTMENT",
        financialYear,
      });
      adjustmentNo = allocated.documentNo;
    }

    await prisma.$transaction(async (tx) => {
      await tx.stock_adjustments.create({
        data: {
          id,
          adjustment_no: adjustmentNo,
          sales_point_id: input.salesPointId,
          occurred_at: occurredAt,
          reason: input.reason.trim(),
          status,
          created_by_user_id: input.userId,
          posted_by_user_id: postImmediately ? input.userId : null,
          posted_at: postImmediately ? now : null,
          origin_device_id: input.originDeviceId ?? null,
        },
      });

      for (const line of input.lines) {
        await tx.stock_adjustment_lines.create({
          data: {
            id: randomUUID(),
            adjustment_id: id,
            product_id: line.productId,
            delta_qty: String(line.deltaQty).trim(),
            storage_location_id: line.storageLocationId,
            from_condition: line.fromCondition ?? null,
            to_condition: line.toCondition ?? null,
          },
        });
      }

      if (postImmediately) {
        await applyAdjustmentMovements(tx, {
          adjustmentId: id,
          salesPointId: input.salesPointId,
          occurredAt,
          userId: input.userId,
          lines: input.lines,
          originDeviceId: input.originDeviceId,
        });
      }
    });

    return {
      ok: true,
      id,
      documentNo: adjustmentNo,
      posted: postImmediately,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create adjustment.";
    return { ok: false, error: uniqueConflict(message, "Adjustment number") };
  }
}

export async function postAdjustmentCommand(input: {
  adjustmentId: string;
  userId: string;
  originDeviceId?: string;
}): Promise<StockPostResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.stock_adjustments.findUnique({
        where: { id: input.adjustmentId },
        include: { stock_adjustment_lines: true },
      });
      if (!existing) {
        throw new Error("Adjustment not found.");
      }
      if (existing.status === "POSTED") {
        return;
      }
      if (existing.status !== "DRAFT") {
        throw new Error(`Cannot post an adjustment in status ${existing.status}.`);
      }
      if (existing.stock_adjustment_lines.length === 0) {
        throw new Error("Add at least one line before posting.");
      }

      await applyAdjustmentMovements(tx, {
        adjustmentId: existing.id,
        salesPointId: existing.sales_point_id,
        occurredAt: existing.occurred_at,
        userId: input.userId,
        lines: existing.stock_adjustment_lines.map((line) => ({
          productId: line.product_id,
          deltaQty: line.delta_qty,
          storageLocationId: line.storage_location_id as number,
          fromCondition: (line.from_condition as StockCondition | null) ?? null,
          toCondition: (line.to_condition as StockCondition | null) ?? null,
        })),
        originDeviceId: input.originDeviceId,
      });

      await tx.stock_adjustments.update({
        where: { id: existing.id },
        data: {
          status: "POSTED",
          posted_by_user_id: input.userId,
          posted_at: new Date(),
          updated_at: new Date(),
        },
      });
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to post adjustment.",
    };
  }
}

async function applyAdjustmentMovements(
  tx: Prisma.TransactionClient,
  input: {
    adjustmentId: string;
    salesPointId: number;
    occurredAt: Date;
    userId: string;
    lines: AdjustmentLineInput[];
    originDeviceId?: string;
  },
): Promise<void> {
  for (const line of input.lines) {
    if (line.fromCondition && line.toCondition) {
      const qty = String(Math.abs(Number.parseFloat(line.deltaQty)));
      await applyMovement(tx, {
        salesPointId: input.salesPointId,
        productId: line.productId,
        storageLocationId: line.storageLocationId,
        condition: line.fromCondition,
        qty: String(-Math.abs(Number.parseFloat(qty))),
        kind: "ADJUSTMENT",
        occurredAt: input.occurredAt,
        userId: input.userId,
        sourceKind: "ADJUSTMENT",
        sourceId: input.adjustmentId,
        notes: `Reclassify ${line.fromCondition} -> ${line.toCondition}`,
        originDeviceId: input.originDeviceId,
      });
      await applyMovement(tx, {
        salesPointId: input.salesPointId,
        productId: line.productId,
        storageLocationId: line.storageLocationId,
        condition: line.toCondition,
        qty,
        kind: "ADJUSTMENT",
        occurredAt: input.occurredAt,
        userId: input.userId,
        sourceKind: "ADJUSTMENT",
        sourceId: input.adjustmentId,
        notes: `Reclassify ${line.fromCondition} -> ${line.toCondition}`,
        originDeviceId: input.originDeviceId,
      });
    } else {
      await applyMovement(tx, {
        salesPointId: input.salesPointId,
        productId: line.productId,
        storageLocationId: line.storageLocationId,
        qty: String(line.deltaQty).trim(),
        kind: "ADJUSTMENT",
        occurredAt: input.occurredAt,
        userId: input.userId,
        sourceKind: "ADJUSTMENT",
        sourceId: input.adjustmentId,
        originDeviceId: input.originDeviceId,
      });
    }
  }
}
