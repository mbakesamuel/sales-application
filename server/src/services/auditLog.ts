import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";

export type AuditOutcome = "SUCCESS" | "FAILURE";

export type WriteAuditLogInput = {
  userId?: string | null;
  username: string;
  role?: string | null;
  action: string;
  outcome: AuditOutcome;
  summary?: string | null;
  entityKind?: string | null;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  occurredAt?: Date;
};

/** High-frequency / heartbeat RPCs that should not fill the audit table. */
const AUDIT_ACTION_DENYLIST = new Set<string>([
  "financialYears.getOpenPostingPeriod",
  "permissions.getSnapshot",
]);

export function isAuditActionDenied(action: string): boolean {
  if (AUDIT_ACTION_DENYLIST.has(action)) return true;
  if (action.startsWith("sync.")) return true;
  return false;
}

const SECRET_KEY =
  /^(password|currentpassword|newpassword|token|authtoken|authorization|secret|apikey)$/i;

function truncate(value: string, max = 200): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function pickEntity(
  value: unknown,
): { entityKind: string | null; entityId: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { entityKind: null, entityId: null };
  }
  const record = value as Record<string, unknown>;
  const nested =
    record.row && typeof record.row === "object"
      ? (record.row as Record<string, unknown>)
      : record.sale && typeof record.sale === "object"
        ? (record.sale as Record<string, unknown>)
        : record.order && typeof record.order === "object"
          ? (record.order as Record<string, unknown>)
          : record;

  const idRaw =
    nested.id ??
    nested.saleId ??
    nested.orderId ??
    nested.receiptId ??
    nested.transferId ??
    nested.adjustmentId;
  const entityId =
    idRaw == null || idRaw === ""
      ? null
      : truncate(String(idRaw), 80);

  const kindHint =
    typeof nested.documentKind === "string"
      ? nested.documentKind
      : typeof nested.kind === "string"
        ? nested.kind
        : null;

  return {
    entityKind: kindHint ? truncate(kindHint, 64) : null,
    entityId,
  };
}

/** Build a short human label from RPC args/result. Never stores secrets. */
export function summarizeRpcAudit(input: {
  action: string;
  args: unknown[];
  result: unknown;
  errorMessage?: string | null;
}): { summary: string | null; entityKind: string | null; entityId: string | null } {
  if (input.errorMessage) {
    return {
      summary: truncate(input.errorMessage),
      entityKind: null,
      entityId: null,
    };
  }

  const fromResult = pickEntity(input.result);
  const parts: string[] = [];

  if (input.result && typeof input.result === "object" && !Array.isArray(input.result)) {
    const record = input.result as Record<string, unknown>;
    for (const key of [
      "invoiceNo",
      "deliveryOrderNo",
      "documentNo",
      "receiptNo",
      "transferNo",
      "adjustmentNo",
      "consignmentNo",
      "name",
      "username",
      "code",
    ] as const) {
      const value = record[key];
      if (value != null && value !== "") {
        parts.push(`${key}=${String(value)}`);
      }
    }
    if (record.ok === false && typeof record.error === "string") {
      parts.push(record.error);
    }
  }

  // Light arg hint: first primitive / id-like field only (skip secrets).
  const firstArg = input.args.find((arg) => arg != null && arg !== "");
  if (typeof firstArg === "string" || typeof firstArg === "number") {
    parts.push(`arg=${String(firstArg)}`);
  } else if (firstArg && typeof firstArg === "object" && !Array.isArray(firstArg)) {
    const record = firstArg as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (SECRET_KEY.test(key)) continue;
      if (value == null || value === "") continue;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        parts.push(`${key}=${String(value)}`);
        break;
      }
    }
  }

  const summary = parts.length > 0 ? truncate(parts.join("; ")) : null;
  return {
    summary,
    entityKind: fromResult.entityKind,
    entityId: fromResult.entityId,
  };
}

export function resolveAuditOutcome(result: unknown, threw: boolean): AuditOutcome {
  if (threw) return "FAILURE";
  if (
    result &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    (result as { ok?: unknown }).ok === false
  ) {
    return "FAILURE";
  }
  return "SUCCESS";
}

/**
 * Best-effort audit insert. Never throws to callers — logging must not break UX.
 */
export function writeAuditLog(input: WriteAuditLogInput): void {
  const username = String(input.username ?? "").trim() || "(unknown)";
  const action = String(input.action ?? "").trim();
  if (!action || isAuditActionDenied(action)) return;

  const outcome: AuditOutcome =
    input.outcome === "FAILURE" ? "FAILURE" : "SUCCESS";

  void prisma.audit_logs
    .create({
      data: {
        id: randomUUID(),
        occurred_at: input.occurredAt ?? new Date(),
        user_id: input.userId?.trim() || null,
        username,
        role: input.role?.trim() || null,
        action,
        outcome,
        summary: input.summary?.trim() ? truncate(input.summary) : null,
        entity_kind: input.entityKind?.trim() || null,
        entity_id: input.entityId?.trim() || null,
        ip: input.ip?.trim() || null,
        user_agent: input.userAgent?.trim()
          ? truncate(input.userAgent, 300)
          : null,
      },
    })
    .catch((err) => {
      console.error("[auditLog] write failed:", err);
    });
}

export function requestClientMeta(c: {
  req: {
    header: (name: string) => string | undefined;
  };
}): { ip: string | null; userAgent: string | null } {
  const forwarded = c.req.header("x-forwarded-for");
  const ip =
    (forwarded ? forwarded.split(",")[0]?.trim() : null) ||
    c.req.header("x-real-ip")?.trim() ||
    null;
  const userAgent = c.req.header("user-agent")?.trim() || null;
  return { ip, userAgent };
}
