/**
 * ADMIN-only audit trail period report (auth + RPC actions).
 */
import { prisma } from "../../db/prisma.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  type ReportCompanySettings,
} from "../reportCompany.js";
import { loadRpcActor } from "../rpcActor.js";

export type AuditTrailReportDto = {
  settings: ReportCompanySettings;
  fromIso: string;
  toIso: string;
  userIdFilter: string | null;
  generatedAtIso: string;
  users: Array<{ userId: string; username: string; role: string | null }>;
  events: Array<{
    id: string;
    occurredAtIso: string;
    userId: string | null;
    username: string;
    role: string | null;
    action: string;
    outcome: "SUCCESS" | "FAILURE";
    summary: string | null;
    entityKind: string | null;
    entityId: string | null;
    ip: string | null;
  }>;
  comments: string | null;
};

function normalizeIsoDate(value: string): string | null {
  const trimmed = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function dayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

function dayEndExclusive(isoDate: string): Date {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export async function getAuditTrailReport(
  userId: string,
  fromIsoRaw: string,
  toIsoRaw: string,
  filterUserId?: string | null,
): Promise<AuditTrailReportDto> {
  const actor = await loadRpcActor(userId);
  if (actor.role !== "ADMIN") {
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

  const from = dayStart(fromIso);
  const toExclusive = dayEndExclusive(toIso);

  const [rows, periodUsers, settings, comments] = await Promise.all([
    prisma.audit_logs.findMany({
      where: {
        occurred_at: { gte: from, lt: toExclusive },
        ...(userFilter ? { user_id: userFilter } : {}),
      },
      orderBy: [{ occurred_at: "asc" }, { id: "asc" }],
    }),
    prisma.audit_logs.findMany({
      where: {
        occurred_at: { gte: from, lt: toExclusive },
        user_id: { not: null },
      },
      select: { user_id: true, username: true, role: true },
      distinct: ["user_id"],
      orderBy: { username: "asc" },
    }),
    loadReportCompanySettings(userId, toIso),
    loadReportComments("audit-trail-report"),
  ]);

  const userMap = new Map<
    string,
    { userId: string; username: string; role: string | null }
  >();
  for (const row of periodUsers) {
    if (!row.user_id) continue;
    if (!userMap.has(row.user_id)) {
      userMap.set(row.user_id, {
        userId: row.user_id,
        username: row.username,
        role: row.role,
      });
    }
  }

  return {
    settings,
    fromIso,
    toIso,
    userIdFilter: userFilter,
    generatedAtIso: nowIso(),
    users: [...userMap.values()].sort((a, b) =>
      a.username.localeCompare(b.username),
    ),
    events: rows.map((row) => ({
      id: row.id,
      occurredAtIso: row.occurred_at.toISOString(),
      userId: row.user_id,
      username: row.username,
      role: row.role,
      action: row.action,
      outcome: row.outcome === "FAILURE" ? "FAILURE" : "SUCCESS",
      summary: row.summary,
      entityKind: row.entity_kind,
      entityId: row.entity_id,
      ip: row.ip,
    })),
    comments,
  };
}
