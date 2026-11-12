import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/index.js";

export type LocalAuditOutcome = "SUCCESS" | "FAILURE";

export type WriteLocalAuditLogInput = {
  userId?: string | null;
  username: string;
  role?: string | null;
  action: string;
  outcome: LocalAuditOutcome;
  summary?: string | null;
  entityKind?: string | null;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  occurredAt?: string;
};

/** Best-effort local SQLite audit insert (never throws). */
export function writeLocalAuditLog(input: WriteLocalAuditLogInput): void {
  try {
    const username = String(input.username ?? "").trim() || "(unknown)";
    const action = String(input.action ?? "").trim();
    if (!action) return;

    const outcome: LocalAuditOutcome =
      input.outcome === "FAILURE" ? "FAILURE" : "SUCCESS";
    const occurredAt =
      input.occurredAt?.trim() || new Date().toISOString();

    getDatabase()
      .prepare(
        `INSERT INTO AuditLog (
           id, occurredAt, userId, username, role, action, outcome,
           summary, entityKind, entityId, ip, userAgent
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        occurredAt,
        input.userId?.trim() || null,
        username,
        input.role?.trim() || null,
        action,
        outcome,
        input.summary?.trim() || null,
        input.entityKind?.trim() || null,
        input.entityId?.trim() || null,
        input.ip?.trim() || null,
        input.userAgent?.trim() || null,
      );
  } catch (err) {
    console.error("[auditLog] local write failed:", err);
  }
}
