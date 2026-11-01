import type { ReportCompanySettings } from "../../shared/reports.types.js";
import { getDatabase } from "../db/index.js";

const DEFAULT_SIGNATORY_NAME = "NYAKE VICTORINE Epse MBUA";
const DEFAULT_SIGNATORY_TITLE = "Manager, Palm Oil Sales";

export interface ReportSignatoryResolved {
  name: string;
  title: string;
}

function normalizeAsAtIso(asAtIso?: string | null): string {
  const raw = (asAtIso ?? "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Latest signatory with effectiveFrom <= as-at; falls back to seeded defaults. */
export function loadReportSignatory(asAtIso?: string | null): ReportSignatoryResolved {
  const asAt = normalizeAsAtIso(asAtIso);
  try {
    const row = getDatabase()
      .prepare(
        `SELECT name, title
         FROM ReportSignatory
         WHERE effectiveFrom <= ?
         ORDER BY effectiveFrom DESC
         LIMIT 1`,
      )
      .get(asAt) as { name: string; title: string } | undefined;

    if (row) {
      return {
        name: row.name.trim() || DEFAULT_SIGNATORY_NAME,
        title: row.title.trim() || DEFAULT_SIGNATORY_TITLE,
      };
    }
  } catch {
    // Table may not exist yet during early boot; use defaults.
  }

  return {
    name: DEFAULT_SIGNATORY_NAME,
    title: DEFAULT_SIGNATORY_TITLE,
  };
}

export function loadReportCompanySettings(
  userId?: string | null,
  asAtIso?: string | null,
): ReportCompanySettings {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT companyName, department, logoUrl
       FROM CompanySettings
       WHERE id = 'default'`,
    )
    .get() as
    | { companyName: string; department: string | null; logoUrl: string | null }
    | undefined;

  let serviceName: string | null = null;
  if (userId) {
    const service = db
      .prepare(
        `SELECT cs.name AS serviceName
         FROM User u
         LEFT JOIN CommercialService cs ON cs.id = u.commercialServiceId
         WHERE u.id = ?`,
      )
      .get(userId) as { serviceName: string | null } | undefined;
    serviceName = service?.serviceName?.trim() || null;
  }

  const signatory = loadReportSignatory(asAtIso);

  return {
    companyName: row?.companyName?.trim() || "MPOS",
    department: row?.department?.trim() || null,
    serviceName,
    logoUrl: row?.logoUrl?.trim() || null,
    signatoryName: signatory.name,
    signatoryTitle: signatory.title,
  };
}

export interface ReportDisplaySettings {
  /** When true, omit report rows whose quantities are zero or empty. */
  hideZeroReportRows: boolean;
}

export function loadReportDisplaySettings(): ReportDisplaySettings {
  try {
    const row = getDatabase()
      .prepare(
        `SELECT hideZeroReportRows
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as { hideZeroReportRows: number | null } | undefined;

    if (row == null || row.hideZeroReportRows == null) {
      return { hideZeroReportRows: true };
    }
    return { hideZeroReportRows: Number(row.hideZeroReportRows) !== 0 };
  } catch {
    return { hideZeroReportRows: true };
  }
}

function readReportCommentsMap(): Record<string, string> {
  try {
    const row = getDatabase()
      .prepare(
        `SELECT reportCommentsJson, stockCommitmentReportComments
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as
      | {
          reportCommentsJson: string | null;
          stockCommitmentReportComments: string | null;
        }
      | undefined;

    let map: Record<string, string> = {};
    try {
      const parsed = JSON.parse(row?.reportCommentsJson || "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        map = { ...(parsed as Record<string, string>) };
      }
    } catch {
      map = {};
    }

    // Legacy fallback for stock-commitment only.
    const legacy = row?.stockCommitmentReportComments?.trim() ?? "";
    if (legacy && !(map["stock-commitment-report"]?.trim())) {
      map["stock-commitment-report"] = legacy;
    }
    return map;
  } catch {
    return {};
  }
}

/** Trimmed comments for a report route id; null when empty. */
export function loadReportComments(reportId: string): string | null {
  const trimmed = readReportCommentsMap()[reportId]?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/** @deprecated Prefer loadReportComments("stock-commitment-report"). */
export function loadStockCommitmentReportComments(): string | null {
  return loadReportComments("stock-commitment-report");
}

export type SaveReportCommentsResult =
  | { ok: true; comments: string | null }
  | { ok: false; error: string };

export type CompanyUiThemePreset = "agro" | "dark";

export type SetCompanyUiThemeResult =
  | { ok: true; uiThemePreset: CompanyUiThemePreset }
  | { ok: false; error: string };

export function setCompanyUiTheme(preset: unknown): SetCompanyUiThemeResult {
  const resolved: CompanyUiThemePreset | null =
    preset === "dark" ? "dark" : preset === "agro" ? "agro" : null;
  if (!resolved) {
    return { ok: false, error: "Invalid theme preset." };
  }

  try {
    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE CompanySettings
         SET uiThemePreset = ?, updatedAt = datetime('now')
         WHERE id = 'default'`,
      )
      .run(resolved);

    if (result.changes < 1) {
      return { ok: false, error: "Company settings row not found." };
    }

    const row = db
      .prepare(`SELECT uiThemePreset FROM CompanySettings WHERE id = 'default'`)
      .get() as { uiThemePreset: string } | undefined;

    if (row?.uiThemePreset !== resolved) {
      return { ok: false, error: "Theme change did not persist." };
    }

    return { ok: true, uiThemePreset: resolved };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save theme.",
    };
  }
}

/** Atomically merge one report's comments into CompanySettings.reportCommentsJson. */
export function saveReportComments(
  reportId: string,
  text: string | null | undefined,
): SaveReportCommentsResult {
  const id = reportId.trim();
  if (!id) {
    return { ok: false, error: "Report id is required." };
  }

  try {
    const db = getDatabase();
    const map = readReportCommentsMap();
    const trimmed = (text ?? "").trim();
    if (trimmed) {
      map[id] = trimmed;
    } else {
      delete map[id];
    }

    db.prepare(
      `UPDATE CompanySettings
       SET reportCommentsJson = ?, updatedAt = datetime('now')
       WHERE id = 'default'`,
    ).run(JSON.stringify(map));

    return { ok: true, comments: trimmed.length > 0 ? trimmed : null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to save comments.",
    };
  }
}
