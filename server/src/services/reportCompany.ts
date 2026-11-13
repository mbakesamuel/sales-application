import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { getOpenPostingPeriodForActor } from "./financialYearsService.js";
import { assertRouteWrite, loadRpcActor } from "./rpcActor.js";

const DEFAULT_SIGNATORY_NAME = "NYAKE VICTORINE Epse MBUA";
const DEFAULT_SIGNATORY_TITLE = "Manager, Palm Oil Sales";
const SIGNATORY_ROUTE_ID = "report-settings";

export type ReportSignatoryRow = {
  id: string;
  name: string;
  title: string;
  effectiveFrom: string;
  createdAt: string;
};

export type ReportCompanySettings = {
  companyName: string;
  department: string | null;
  serviceName: string | null;
  logoUrl: string | null;
  signatoryName: string | null;
  signatoryTitle: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function resolveReportAsAt(
  asAtIso?: string | null,
  userId?: string | null,
): Promise<string> {
  const raw = (asAtIso ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (userId) {
    const period = await getOpenPostingPeriodForActor(userId);
    if (period) {
      const today = todayIso();
      return today < period.endDate ? today : period.endDate;
    }
  }
  return todayIso();
}

export async function loadReportCompanySettings(
  userId?: string | null,
  asAtIso?: string | null,
): Promise<ReportCompanySettings> {
  const row = await prisma.company_settings.findFirst({
    where: { id: "default" },
  });

  let serviceName: string | null = null;
  if (userId) {
    const user = await prisma.users.findUnique({
      where: { id: userId },
      include: { commercial_services: { select: { name: true } } },
    });
    serviceName = user?.commercial_services?.name?.trim() || null;
  }

  const signatory = await getReportSignatory(asAtIso);

  return {
    companyName: row?.company_name?.trim() || "MPOS",
    department: row?.department?.trim() || null,
    serviceName,
    logoUrl: row?.logo_url?.trim() || null,
    signatoryName: signatory.name,
    signatoryTitle: signatory.title,
  };
}

function parseCommentsMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export async function loadReportComments(
  reportId: string,
): Promise<string | null> {
  const row = await prisma.company_settings.findFirst({
    where: { id: "default" },
  });
  const map = parseCommentsMap(row?.report_comments_json);
  if (reportId === "stock-commitment-report") {
    const legacy = row?.stock_commitment_report_comments?.trim() ?? "";
    if (legacy && !(map[reportId]?.trim())) {
      return legacy;
    }
  }
  const trimmed = map[reportId]?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function saveReportComments(
  reportId: string,
  text: string | null | undefined,
): Promise<{ ok: true; comments: string | null } | { ok: false; error: string }> {
  const id = reportId.trim();
  if (!id) return { ok: false, error: "Report id is required." };

  try {
    const row = await prisma.company_settings.findFirst({
      where: { id: "default" },
    });
    if (!row) return { ok: false, error: "Company settings row not found." };

    const map = parseCommentsMap(row.report_comments_json);
    const trimmed = (text ?? "").trim();
    if (trimmed) map[id] = trimmed;
    else delete map[id];

    await prisma.company_settings.update({
      where: { id: "default" },
      data: {
        report_comments_json: map,
        updated_at: new Date(),
      },
    });

    return { ok: true, comments: trimmed.length > 0 ? trimmed : null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save comments.",
    };
  }
}

function mapSignatoryRow(row: {
  id: string;
  name: string;
  title: string;
  effective_from: Date;
  created_at: Date;
}): ReportSignatoryRow {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    effectiveFrom: row.effective_from.toISOString().slice(0, 10),
    createdAt: row.created_at.toISOString(),
  };
}

export async function listReportSignatories(): Promise<ReportSignatoryRow[]> {
  const rows = await prisma.report_signatories.findMany({
    orderBy: { effective_from: "desc" },
  });
  return rows.map(mapSignatoryRow);
}

export async function getReportSignatory(asAtIso?: string | null) {
  const asAt = await resolveReportAsAt(asAtIso);
  const row = await prisma.report_signatories.findFirst({
    where: { effective_from: { lte: new Date(`${asAt}T00:00:00.000Z`) } },
    orderBy: { effective_from: "desc" },
  });
  if (!row) {
    return {
      name: DEFAULT_SIGNATORY_NAME,
      title: DEFAULT_SIGNATORY_TITLE,
    };
  }
  return { name: row.name, title: row.title };
}

export async function upsertReportSignatory(
  userId: string,
  input: {
    id?: string | null;
    name: string;
    title: string;
    effectiveFrom: string;
  },
): Promise<
  { ok: true; row: ReportSignatoryRow } | { ok: false; error: string }
> {
  try {
    const actor = await loadRpcActor(userId);
    assertRouteWrite(actor, SIGNATORY_ROUTE_ID);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const name = input.name.trim();
  const title = input.title.trim();
  const effectiveFrom = String(input.effectiveFrom ?? "").trim().slice(0, 10);
  if (!name) return { ok: false, error: "Signatory name is required." };
  if (!title) return { ok: false, error: "Signatory title is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return { ok: false, error: "Effective-from date must be YYYY-MM-DD." };
  }

  const effectiveDate = new Date(`${effectiveFrom}T00:00:00.000Z`);
  const existingId = input.id?.trim() || null;

  try {
    if (existingId) {
      const existing = await prisma.report_signatories.findUnique({
        where: { id: existingId },
      });
      if (!existing) return { ok: false, error: "Signatory entry not found." };
      const updated = await prisma.report_signatories.update({
        where: { id: existingId },
        data: {
          name,
          title,
          effective_from: effectiveDate,
        },
      });
      return { ok: true, row: mapSignatoryRow(updated) };
    }

    const created = await prisma.report_signatories.create({
      data: {
        id: randomUUID(),
        name,
        title,
        effective_from: effectiveDate,
      },
    });
    return { ok: true, row: mapSignatoryRow(created) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("unique")) {
      return {
        ok: false,
        error: "A signatory already exists for that effective-from date.",
      };
    }
    return { ok: false, error: message || "Failed to save signatory." };
  }
}

export async function deleteReportSignatory(
  userId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const actor = await loadRpcActor(userId);
    assertRouteWrite(actor, SIGNATORY_ROUTE_ID);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const signatoryId = id.trim();
  if (!signatoryId) return { ok: false, error: "Signatory id is required." };

  const count = await prisma.report_signatories.count();
  if (count <= 1) {
    return { ok: false, error: "Keep at least one signatory entry." };
  }

  try {
    await prisma.report_signatories.delete({ where: { id: signatoryId } });
    return { ok: true };
  } catch {
    return { ok: false, error: "Signatory entry not found." };
  }
}

export async function listSalesPointOptions(scopedSalesPointId: number | null) {
  const rows = await prisma.sales_points.findMany({
    where: {
      is_active: true,
      ...(scopedSalesPointId != null ? { id: scopedSalesPointId } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name }));
}
