import { getDatabase } from "../db/index.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "./companySettings.js";
import type { AuditTrailReport } from "../../shared/reports.types.js";

function normalizeIsoDate(value: string): string | null {
  const trimmed = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function dayStartIso(isoDate: string): string {
  return `${isoDate}T00:00:00.000Z`;
}

function dayEndExclusiveIso(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export function getAuditTrailReport(
  userId: string,
  fromIsoRaw: string,
  toIsoRaw: string,
  filterUserId?: string | null,
): AuditTrailReport {
  const db = getDatabase();
  const actor = db
    .prepare(`SELECT role FROM User WHERE id = ? AND isActive = 1 LIMIT 1`)
    .get(userId) as { role: string } | undefined;
  if (!actor || actor.role !== "ADMIN") {
    throw new Error("Audit trail report is available to administrators only.");
  }

  const fromIso = normalizeIsoDate(fromIsoRaw);
  const toIso = normalizeIsoDate(toIsoRaw);
  if (!fromIso || !toIso) {
    throw new Error("Invalid date range.");
  }
  if (fromIso > toIso) {
    throw new Error("From date must be on or before To date.");
  }

  const userFilter =
    typeof filterUserId === "string" && filterUserId.trim()
      ? filterUserId.trim()
      : null;

  const fromBound = dayStartIso(fromIso);
  const toBound = dayEndExclusiveIso(toIso);

  const rows = (
    userFilter
      ? db
          .prepare(
            `SELECT id, occurredAt, userId, username, role, action, outcome,
                    summary, entityKind, entityId, ip
             FROM AuditLog
             WHERE occurredAt >= ? AND occurredAt < ? AND userId = ?
             ORDER BY occurredAt ASC, id ASC`,
          )
          .all(fromBound, toBound, userFilter)
      : db
          .prepare(
            `SELECT id, occurredAt, userId, username, role, action, outcome,
                    summary, entityKind, entityId, ip
             FROM AuditLog
             WHERE occurredAt >= ? AND occurredAt < ?
             ORDER BY occurredAt ASC, id ASC`,
          )
          .all(fromBound, toBound)
  ) as Array<{
    id: string;
    occurredAt: string;
    userId: string | null;
    username: string;
    role: string | null;
    action: string;
    outcome: string;
    summary: string | null;
    entityKind: string | null;
    entityId: string | null;
    ip: string | null;
  }>;

  const periodUsers = db
    .prepare(
      `SELECT userId, MAX(username) AS username, MAX(role) AS role
       FROM AuditLog
       WHERE occurredAt >= ? AND occurredAt < ? AND userId IS NOT NULL
       GROUP BY userId
       ORDER BY username ASC`,
    )
    .all(fromBound, toBound) as Array<{
    userId: string;
    username: string;
    role: string | null;
  }>;

  const userMap = new Map<
    string,
    { userId: string; username: string; role: string | null }
  >();
  for (const row of periodUsers) {
    if (!userMap.has(row.userId)) {
      userMap.set(row.userId, {
        userId: row.userId,
        username: row.username,
        role: row.role,
      });
    }
  }

  return {
    settings: loadReportCompanySettings(userId, toIso),
    fromIso,
    toIso,
    userIdFilter: userFilter,
    generatedAtIso: new Date().toISOString(),
    users: [...userMap.values()].sort((a, b) =>
      a.username.localeCompare(b.username),
    ),
    events: rows.map((row) => ({
      id: row.id,
      occurredAtIso: new Date(row.occurredAt).toISOString(),
      userId: row.userId,
      username: row.username,
      role: row.role,
      action: row.action,
      outcome: row.outcome === "FAILURE" ? "FAILURE" : "SUCCESS",
      summary: row.summary,
      entityKind: row.entityKind,
      entityId: row.entityId,
      ip: row.ip,
    })),
    comments: loadReportComments("audit-trail-report"),
  };
}
