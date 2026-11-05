import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import {
  canPerformAction,
  canWriteRoute,
  loadRpcActor,
  type RpcActor,
} from "./rpcActor.js";

/**
 * Document booklets (serial ranges for sales invoices / delivery orders)
 * against Postgres `document_booklets`. Mirrors src/electron/booklets/service.ts
 * and the DTOs in src/shared/documentBooklets.types.ts.
 *
 * NOTE: types and serial helpers are redeclared here because the server
 * tsconfig has rootDir ./src and cannot import from the Electron project.
 */

export type DocumentBookletKind = "SALES_INVOICE" | "DELIVERY_ORDER";
export type DocumentBookletStatus =
  | "PENDING"
  | "ACTIVE"
  | "CANCELLED"
  | "REJECTED";

export interface DocumentBookletRow {
  id: string;
  documentKind: DocumentBookletKind;
  bookletCode: string | null;
  startSerial: string;
  endSerial: string;
  salesPointId: number;
  salesPointName?: string;
  status: DocumentBookletStatus;
  issuedAt: string;
  issuedByUserId: string | null;
  issuedByUserName?: string | null;
  validatedAt?: string | null;
  validatedByUserId?: string | null;
  validatedByUserName?: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  totalPages: number;
  usedPages?: number;
}

export interface CreateDocumentBookletInput {
  documentKind: DocumentBookletKind;
  bookletCode?: string | null;
  startSerial: string;
  endSerial: string;
  salesPointId: number;
  notes?: string | null;
  activateImmediately?: boolean;
}

export interface DocumentBookletFilters {
  documentKind?: DocumentBookletKind | "ALL";
  salesPointId?: number | "ALL";
  status?: DocumentBookletStatus | "ALL";
}

export interface ValidateSerialForSalesPointInput {
  documentKind: DocumentBookletKind;
  serial: string;
  salesPointId: number;
}

export type ValidateSerialForSalesPointResult =
  | { ok: true; bookletId: string | null; bookletCode: string | null }
  | { ok: false; error: string };

export type ValidateDocumentBookletResult =
  | { ok: true; booklet: DocumentBookletRow }
  | { ok: false; error: string };

export type RejectDocumentBookletResult =
  | { ok: true }
  | { ok: false; error: string };

export interface ValidateManyBookletsResult {
  ok: boolean;
  validated: number;
  errors: Array<{ id: string; error: string; bookletCode?: string | null }>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Serial helpers (port of src/shared/bookletSerial.ts)
// ---------------------------------------------------------------------------

const BOOKLET_SERIAL_MAX_LENGTH = 20;
const BOOKLET_MAX_PAGES = 100000n;

type SerialResult = { ok: true; serial: string } | { ok: false; error: string };

function validateBookletSerial(raw: string | null | undefined): SerialResult {
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

type RangeResult =
  | { ok: true; startSerial: string; endSerial: string; totalPages: number }
  | { ok: false; error: string };

function validateBookletRange(
  startRaw: string | null | undefined,
  endRaw: string | null | undefined,
): RangeResult {
  const startRes = validateBookletSerial(startRaw);
  if (!startRes.ok) {
    return { ok: false, error: `Start serial: ${startRes.error}` };
  }
  const endRes = validateBookletSerial(endRaw);
  if (!endRes.ok) {
    return { ok: false, error: `End serial: ${endRes.error}` };
  }
  try {
    const startVal = BigInt(startRes.serial);
    const endVal = BigInt(endRes.serial);
    if (startVal > endVal) {
      return {
        ok: false,
        error: "Start serial must be less than or equal to end serial.",
      };
    }
    const diff = endVal - startVal + 1n;
    if (diff > BOOKLET_MAX_PAGES) {
      return {
        ok: false,
        error: "Booklet range is too large (maximum 100,000 pages per booklet).",
      };
    }
    return {
      ok: true,
      startSerial: startRes.serial,
      endSerial: endRes.serial,
      totalPages: Number(diff),
    };
  } catch {
    return { ok: false, error: "Invalid numeric range." };
  }
}

function isSerialInRange(serial: string, start: string, end: string): boolean {
  try {
    const s = BigInt(serial.trim());
    return s >= BigInt(start.trim()) && s <= BigInt(end.trim());
  } catch {
    return false;
  }
}

function doRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  try {
    const sA = BigInt(startA.trim());
    const eA = BigInt(endA.trim());
    const sB = BigInt(startB.trim());
    const eB = BigInt(endB.trim());
    return sA <= eB && sB <= eA;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

type BookletRecord = Prisma.document_bookletsGetPayload<{
  include: { sales_points: { select: { name: true } } };
}>;

function totalPagesOf(start: string, end: string): number {
  try {
    return Number(BigInt(end) - BigInt(start) + 1n);
  } catch {
    return 0;
  }
}

async function countUsedPages(b: BookletRecord): Promise<number> {
  try {
    // CASE guards the numeric cast so non-numeric document numbers never error.
    if (b.document_kind === "SALES_INVOICE") {
      const rows = await prisma.$queryRaw<Array<{ c: number }>>`
        SELECT COUNT(*)::int AS c
        FROM sales
        WHERE sales_point_id = ${b.sales_point_id}
          AND (CASE WHEN invoice_no ~ '^[0-9]{1,20}$' THEN CAST(invoice_no AS NUMERIC) END)
              BETWEEN CAST(CAST(${b.start_serial} AS TEXT) AS NUMERIC)
                  AND CAST(CAST(${b.end_serial} AS TEXT) AS NUMERIC)`;
      return Number(rows[0]?.c ?? 0);
    }
    const rows = await prisma.$queryRaw<Array<{ c: number }>>`
      SELECT COUNT(*)::int AS c
      FROM delivery_orders
      WHERE sales_point_id = ${b.sales_point_id}
        AND (CASE WHEN delivery_order_no ~ '^[0-9]{1,20}$' THEN CAST(delivery_order_no AS NUMERIC) END)
            BETWEEN CAST(CAST(${b.start_serial} AS TEXT) AS NUMERIC)
                AND CAST(CAST(${b.end_serial} AS TEXT) AS NUMERIC)`;
    return Number(rows[0]?.c ?? 0);
  } catch {
    return 0;
  }
}

async function loadUserNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const users = await prisma.users.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((u) => [u.id, u.name]));
}

async function mapBooklets(records: BookletRecord[]): Promise<DocumentBookletRow[]> {
  const names = await loadUserNames(
    records.flatMap((r) => [r.issued_by_user_id, r.validated_by_user_id]),
  );
  const usedPages = await Promise.all(records.map((r) => countUsedPages(r)));
  return records.map((r, idx) => ({
    id: r.id,
    documentKind: r.document_kind as DocumentBookletKind,
    bookletCode: r.booklet_code,
    startSerial: r.start_serial,
    endSerial: r.end_serial,
    salesPointId: r.sales_point_id,
    salesPointName: r.sales_points?.name ?? undefined,
    status: r.status as DocumentBookletStatus,
    issuedAt: r.issued_at.toISOString(),
    issuedByUserId: r.issued_by_user_id,
    issuedByUserName: r.issued_by_user_id
      ? (names.get(r.issued_by_user_id) ?? null)
      : null,
    validatedAt: r.validated_at ? r.validated_at.toISOString() : null,
    validatedByUserId: r.validated_by_user_id,
    validatedByUserName: r.validated_by_user_id
      ? (names.get(r.validated_by_user_id) ?? null)
      : null,
    notes: r.notes,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    totalPages: totalPagesOf(r.start_serial, r.end_serial),
    usedPages: usedPages[idx],
  }));
}

async function loadBookletRow(id: string): Promise<DocumentBookletRow | null> {
  const record = await prisma.document_booklets.findUnique({
    where: { id },
    include: { sales_points: { select: { name: true } } },
  });
  if (!record) return null;
  const [row] = await mapBooklets([record]);
  return row ?? null;
}

function describeBooklet(b: {
  booklet_code: string | null;
  start_serial: string;
  end_serial: string;
}): string {
  return b.booklet_code || `${b.start_serial} - ${b.end_serial}`;
}

/** Serialize booklet range checks so concurrent issue/validate cannot overlap. */
async function lockBookletRanges(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('document_booklets_ranges'))`;
}

async function findOverlap(
  tx: Prisma.TransactionClient,
  input: {
    documentKind: string;
    startSerial: string;
    endSerial: string;
    excludeId?: string;
  },
): Promise<string | null> {
  const active = await tx.document_booklets.findMany({
    where: {
      document_kind: input.documentKind,
      status: "ACTIVE",
      ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
    },
    include: { sales_points: { select: { name: true } } },
  });
  for (const existing of active) {
    if (
      doRangesOverlap(
        input.startSerial,
        input.endSerial,
        existing.start_serial,
        existing.end_serial,
      )
    ) {
      return `Serial range ${input.startSerial} - ${input.endSerial} overlaps with active booklet "${describeBooklet(existing)}" issued to ${existing.sales_points?.name ?? "another collection point"}.`;
    }
  }
  return null;
}

function requireBookletValidator(actor: RpcActor, verb: string): string | null {
  if (!canPerformAction(actor, "validate_document_booklets")) {
    return `You do not have permission to ${verb} document booklets.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// RPC operations
// ---------------------------------------------------------------------------

export async function listBooklets(
  _userId: string,
  filters?: DocumentBookletFilters | null,
): Promise<DocumentBookletRow[]> {
  const where: Prisma.document_bookletsWhereInput = {};
  if (filters?.documentKind && filters.documentKind !== "ALL") {
    where.document_kind = filters.documentKind;
  }
  if (filters?.salesPointId !== undefined && filters.salesPointId !== "ALL") {
    const sp = Number(filters.salesPointId);
    if (Number.isFinite(sp)) where.sales_point_id = sp;
  }
  if (filters?.status && filters.status !== "ALL") {
    where.status = filters.status;
  }

  const records = await prisma.document_booklets.findMany({
    where,
    include: { sales_points: { select: { name: true } } },
    orderBy: [{ issued_at: "desc" }, { created_at: "desc" }],
  });
  return mapBooklets(records);
}

export async function createBooklet(
  userId: string,
  input: CreateDocumentBookletInput,
): Promise<{ ok: true; booklet: DocumentBookletRow } | { ok: false; error: string }> {
  try {
    const actor = await loadRpcActor(userId);
    if (!canWriteRoute(actor, "document-booklets")) {
      return {
        ok: false,
        error: "You do not have permission to issue document booklets.",
      };
    }
    if (
      input?.documentKind !== "SALES_INVOICE" &&
      input?.documentKind !== "DELIVERY_ORDER"
    ) {
      return { ok: false, error: "Invalid document kind." };
    }
    const rangeRes = validateBookletRange(input.startSerial, input.endSerial);
    if (!rangeRes.ok) {
      return { ok: false, error: rangeRes.error };
    }

    const salesPointId = Number(input.salesPointId);
    const salesPoint = Number.isFinite(salesPointId)
      ? await prisma.sales_points.findUnique({ where: { id: salesPointId } })
      : null;
    if (!salesPoint) {
      return { ok: false, error: "Collection point not found." };
    }
    if (!salesPoint.is_active) {
      return {
        ok: false,
        error: "Cannot issue a booklet to an inactive collection point.",
      };
    }

    const canValidate = canPerformAction(actor, "validate_document_booklets");
    const shouldActivate = input.activateImmediately === true && canValidate;
    const now = new Date();
    const id = randomUUID();

    const overlapError = await prisma.$transaction(async (tx) => {
      await lockBookletRanges(tx);
      const overlap = await findOverlap(tx, {
        documentKind: input.documentKind,
        startSerial: rangeRes.startSerial,
        endSerial: rangeRes.endSerial,
      });
      if (overlap) return overlap;

      await tx.document_booklets.create({
        data: {
          id,
          document_kind: input.documentKind,
          booklet_code: input.bookletCode?.trim() || null,
          start_serial: rangeRes.startSerial,
          end_serial: rangeRes.endSerial,
          sales_point_id: salesPointId,
          status: shouldActivate ? "ACTIVE" : "PENDING",
          issued_at: now,
          issued_by_user_id: actor.id,
          validated_at: shouldActivate ? now : null,
          validated_by_user_id: shouldActivate ? actor.id : null,
          notes: input.notes?.trim() || null,
          created_at: now,
          updated_at: now,
        },
      });
      return null;
    });
    if (overlapError) {
      return { ok: false, error: overlapError };
    }

    const booklet = await loadBookletRow(id);
    if (!booklet) {
      return { ok: false, error: "Failed to reload issued booklet." };
    }
    return { ok: true, booklet };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to issue booklet.",
    };
  }
}

async function validateBookletForActor(
  actor: RpcActor,
  bookletId: string,
): Promise<ValidateDocumentBookletResult> {
  const denied = requireBookletValidator(actor, "validate");
  if (denied) return { ok: false, error: denied };

  const error = await prisma.$transaction(async (tx) => {
    await lockBookletRanges(tx);
    const existing = await tx.document_booklets.findUnique({
      where: { id: bookletId },
    });
    if (!existing) return "Booklet not found.";
    if (existing.status !== "PENDING") {
      return `Booklet cannot be validated because its current status is ${existing.status}.`;
    }
    const overlap = await findOverlap(tx, {
      documentKind: existing.document_kind,
      startSerial: existing.start_serial,
      endSerial: existing.end_serial,
      excludeId: bookletId,
    });
    if (overlap) return overlap;

    const now = new Date();
    await tx.document_booklets.update({
      where: { id: bookletId },
      data: {
        status: "ACTIVE",
        validated_at: now,
        validated_by_user_id: actor.id,
        updated_at: now,
      },
    });
    return null;
  });
  if (error) return { ok: false, error };

  const booklet = await loadBookletRow(bookletId);
  if (!booklet) {
    return { ok: false, error: "Failed to reload validated booklet." };
  }
  return { ok: true, booklet };
}

export async function validateBooklet(
  userId: string,
  bookletId: string,
): Promise<ValidateDocumentBookletResult> {
  try {
    const actor = await loadRpcActor(userId);
    return await validateBookletForActor(actor, String(bookletId ?? ""));
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to validate booklet.",
    };
  }
}

export async function rejectBooklet(
  userId: string,
  bookletId: string,
  reason?: string | null,
): Promise<RejectDocumentBookletResult> {
  try {
    const actor = await loadRpcActor(userId);
    const denied = requireBookletValidator(actor, "reject");
    if (denied) return { ok: false, error: denied };

    const existing = await prisma.document_booklets.findUnique({
      where: { id: String(bookletId ?? "") },
    });
    if (!existing) return { ok: false, error: "Booklet not found." };
    if (existing.status !== "PENDING") {
      return {
        ok: false,
        error: `Booklet cannot be rejected because its current status is ${existing.status}.`,
      };
    }

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const note = reason?.trim()
      ? `[Rejected on ${day}: ${reason.trim()}]`
      : `[Rejected on ${day}]`;
    await prisma.document_booklets.update({
      where: { id: existing.id },
      data: {
        status: "REJECTED",
        notes: existing.notes ? `${existing.notes}\n${note}` : note,
        updated_at: now,
      },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reject booklet.",
    };
  }
}

export async function validateManyBooklets(
  userId: string,
  bookletIds: string[],
): Promise<ValidateManyBookletsResult> {
  try {
    const actor = await loadRpcActor(userId);
    const denied = requireBookletValidator(actor, "validate");
    if (denied) {
      return { ok: false, validated: 0, errors: [], error: denied };
    }

    const ids = [...new Set((Array.isArray(bookletIds) ? bookletIds : []).map(String))];
    let validated = 0;
    const errors: ValidateManyBookletsResult["errors"] = [];
    for (const id of ids) {
      const res = await validateBookletForActor(actor, id);
      if (res.ok) {
        validated += 1;
      } else {
        errors.push({ id, error: res.error, bookletCode: null });
      }
    }
    return { ok: errors.length === 0, validated, errors };
  } catch (err) {
    return {
      ok: false,
      validated: 0,
      errors: [],
      error: err instanceof Error ? err.message : "Failed to validate booklets.",
    };
  }
}

export async function cancelBooklet(
  userId: string,
  bookletId: string,
  reason?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const actor = await loadRpcActor(userId);
    if (!canWriteRoute(actor, "document-booklets")) {
      return {
        ok: false,
        error: "You do not have permission to cancel document booklets.",
      };
    }
    const existing = await prisma.document_booklets.findUnique({
      where: { id: String(bookletId ?? "") },
    });
    if (!existing) return { ok: false, error: "Booklet not found." };
    if (existing.status === "CANCELLED") {
      return { ok: false, error: "Booklet is already cancelled." };
    }

    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const note = reason?.trim()
      ? `[Cancelled on ${day}: ${reason.trim()}]`
      : `[Cancelled on ${day}]`;
    await prisma.document_booklets.update({
      where: { id: existing.id },
      data: {
        status: "CANCELLED",
        notes: existing.notes ? `${existing.notes}\n${note}` : note,
        updated_at: now,
      },
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to cancel booklet.",
    };
  }
}

export async function validateSerial(
  input: ValidateSerialForSalesPointInput,
): Promise<ValidateSerialForSalesPointResult> {
  try {
    const serialRes = validateBookletSerial(input?.serial);
    if (!serialRes.ok) return { ok: false, error: serialRes.error };

    if (
      input.documentKind !== "SALES_INVOICE" &&
      input.documentKind !== "DELIVERY_ORDER"
    ) {
      return { ok: false, error: "Invalid document kind." };
    }
    const salesPointId = Number(input.salesPointId);
    const sp = Number.isFinite(salesPointId)
      ? await prisma.sales_points.findUnique({
          where: { id: salesPointId },
          select: { name: true },
        })
      : null;
    const currentSpName = sp?.name ?? `Collection point #${input.salesPointId}`;

    const active = await prisma.document_booklets.findMany({
      where: { document_kind: input.documentKind, status: "ACTIVE" },
      include: { sales_points: { select: { name: true } } },
    });

    const forCurrent = active.find(
      (b) =>
        b.sales_point_id === salesPointId &&
        isSerialInRange(serialRes.serial, b.start_serial, b.end_serial),
    );
    if (forCurrent) {
      return { ok: true, bookletId: forCurrent.id, bookletCode: forCurrent.booklet_code };
    }

    const other = active.find((b) =>
      isSerialInRange(serialRes.serial, b.start_serial, b.end_serial),
    );
    if (other) {
      const otherName =
        other.sales_points?.name ?? `Collection point #${other.sales_point_id}`;
      return {
        ok: false,
        error: `Serial ${serialRes.serial} belongs to booklet ${other.booklet_code || `${other.start_serial}–${other.end_serial}`} issued to ${otherName}, not ${currentSpName}.`,
      };
    }

    return {
      ok: false,
      error: `Serial ${serialRes.serial} does not belong to any active booklet issued to ${currentSpName}.`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to validate serial.",
    };
  }
}
