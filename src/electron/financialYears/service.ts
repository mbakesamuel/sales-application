import type {
  FinancialMonthRow,
  FinancialPeriodStatus,
  FinancialYearRow,
  OpenPostingPeriod,
  OpenYearResult,
} from "../../shared/financialYears.types.js";
import { getUserCollectionPointId } from "../auth/collectionPointScope.js";
import { getDatabase } from "../db/index.js";
import { createTextPrimaryKey } from "../db/tableMeta.js";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** null = central / head-office posting month. */
export type PostingScopeId = number | null;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function nowIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthStartDate(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

function monthEndDate(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${pad2(month)}-${pad2(lastDay)}`;
}

function yearStartDate(year: number): string {
  return `${year}-01-01`;
}

function yearEndDate(year: number): string {
  return `${year}-12-31`;
}

function isLiteralSqlNowExpression(value: unknown): boolean {
  if (value == null) return false;
  const trimmed = String(value).trim().replace(/^\(+|\)+$/g, "").trim();
  return (
    /^(datetime|date|time)\s*\(\s*'now'\s*\)$/i.test(trimmed) ||
    /^current_(time|date|timestamp)$/i.test(trimmed)
  );
}

function sanitizeStoredTimestamp(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (isLiteralSqlNowExpression(value)) return null;
  return String(value);
}

function repairLiteralSqlTimestamps(): void {
  const db = getDatabase();
  const timestamp = nowIso();
  const bad =
    `openedAt GLOB 'datetime(*' OR openedAt GLOB 'date(*' OR openedAt GLOB 'time(*' ` +
    `OR upper(openedAt) IN ('CURRENT_TIMESTAMP','CURRENT_TIME','CURRENT_DATE')`;
  const badClosed =
    `closedAt GLOB 'datetime(*' OR closedAt GLOB 'date(*' OR closedAt GLOB 'time(*' ` +
    `OR upper(closedAt) IN ('CURRENT_TIMESTAMP','CURRENT_TIME','CURRENT_DATE')`;

  db.prepare(`UPDATE FinancialYearPeriod SET openedAt = ? WHERE ${bad}`).run(
    timestamp,
  );
  db.prepare(`UPDATE FinancialYearPeriod SET closedAt = ? WHERE ${badClosed}`).run(
    timestamp,
  );
  db.prepare(`UPDATE FinancialMonth SET openedAt = ? WHERE ${bad}`).run(timestamp);
  db.prepare(`UPDATE FinancialMonth SET closedAt = ? WHERE ${badClosed}`).run(
    timestamp,
  );
  db.prepare(
    `UPDATE SalesPointPostingMonth SET openedAt = ? WHERE ${bad}`,
  ).run(timestamp);
  db.prepare(
    `UPDATE SalesPointPostingMonth SET closedAt = ? WHERE ${badClosed}`,
  ).run(timestamp);
}

function mapYearRow(row: Record<string, unknown>): FinancialYearRow {
  return {
    id: String(row.id),
    financialYear: Number(row.financialYear),
    status: String(row.status).toUpperCase() === "OPEN" ? "OPEN" : "CLOSED",
    openedAt: sanitizeStoredTimestamp(row.openedAt),
    closedAt: sanitizeStoredTimestamp(row.closedAt),
    startDate: String(row.startDate).slice(0, 10),
    endDate: String(row.endDate).slice(0, 10),
    openMonthCount: Number(row.openMonthCount ?? 0),
    monthCount: Number(row.monthCount ?? 0),
  };
}

function mapMonthRow(row: Record<string, unknown>): FinancialMonthRow {
  return {
    id: String(row.id),
    financialYearPeriodId: String(row.financialYearPeriodId),
    financialYear: Number(row.financialYear),
    calendarMonth: Number(row.calendarMonth),
    name: String(row.name),
    status: String(row.status).toUpperCase() === "OPEN" ? "OPEN" : "CLOSED",
    openedAt: sanitizeStoredTimestamp(row.openedAt),
    closedAt: sanitizeStoredTimestamp(row.closedAt),
  };
}

function normalizeScope(salesPointId?: number | null): PostingScopeId {
  if (salesPointId == null || !Number.isFinite(Number(salesPointId))) {
    return null;
  }
  return Number(salesPointId);
}

/** Actor's posting scope: attached collection point, or central when unscoped. */
export function postingScopeForUser(userId?: string | null): PostingScopeId {
  if (!userId) return null;
  return getUserCollectionPointId(userId);
}

function ensureTwelveMonths(periodId: string, financialYear: number): void {
  const db = getDatabase();
  const existing = db
    .prepare(
      `SELECT calendarMonth FROM FinancialMonth WHERE financialYearPeriodId = ?`,
    )
    .all(periodId) as Array<{ calendarMonth: number }>;
  const have = new Set(existing.map((row) => row.calendarMonth));
  const insert = db.prepare(
    `INSERT INTO FinancialMonth (
      id, financialYearPeriodId, financialYear, calendarMonth, name, status, openedAt, closedAt
    ) VALUES (?, ?, ?, ?, ?, 'CLOSED', NULL, NULL)`,
  );

  for (let month = 1; month <= 12; month += 1) {
    if (have.has(month)) continue;
    insert.run(
      createTextPrimaryKey(),
      periodId,
      financialYear,
      month,
      MONTH_NAMES[month - 1],
    );
  }
}

function listActiveSalesPointIds(): number[] {
  return (
    getDatabase()
      .prepare(
        `SELECT id FROM SalesPoint WHERE COALESCE(isActive, 1) = 1 ORDER BY id ASC`,
      )
      .all() as Array<{ id: number }>
  ).map((row) => row.id);
}

function closeAllOpenYearsAndPostingMonths(): void {
  const db = getDatabase();
  const timestamp = nowIso();
  db.prepare(
    `UPDATE FinancialYearPeriod
     SET status = 'CLOSED', closedAt = ?
     WHERE status = 'OPEN'`,
  ).run(timestamp);
  db.prepare(
    `UPDATE FinancialMonth
     SET status = 'CLOSED', closedAt = ?
     WHERE status = 'OPEN'`,
  ).run(timestamp);
  db.prepare(
    `UPDATE SalesPointPostingMonth
     SET status = 'CLOSED', closedAt = ?
     WHERE status = 'OPEN'`,
  ).run(timestamp);
}

function closeOpenPostingForScope(salesPointId: PostingScopeId): void {
  const db = getDatabase();
  const timestamp = nowIso();
  if (salesPointId == null) {
    db.prepare(
      `UPDATE SalesPointPostingMonth
       SET status = 'CLOSED', closedAt = ?
       WHERE salesPointId IS NULL AND status = 'OPEN'`,
    ).run(timestamp);
  } else {
    db.prepare(
      `UPDATE SalesPointPostingMonth
       SET status = 'CLOSED', closedAt = ?
       WHERE salesPointId = ? AND status = 'OPEN'`,
    ).run(timestamp, salesPointId);
  }
}

function upsertOpenPostingMonth(
  periodId: string,
  calendarMonth: number,
  salesPointId: PostingScopeId,
): void {
  const db = getDatabase();
  const timestamp = nowIso();
  closeOpenPostingForScope(salesPointId);

  if (salesPointId == null) {
    const existing = db
      .prepare(
        `SELECT id, openedAt FROM SalesPointPostingMonth
         WHERE salesPointId IS NULL
           AND financialYearPeriodId = ?
           AND calendarMonth = ?`,
      )
      .get(periodId, calendarMonth) as
      | { id: string; openedAt: string | null }
      | undefined;
    if (existing) {
      db.prepare(
        `UPDATE SalesPointPostingMonth
         SET status = 'OPEN',
             openedAt = COALESCE(?, openedAt, ?),
             closedAt = NULL
         WHERE id = ?`,
      ).run(
        sanitizeStoredTimestamp(existing.openedAt),
        timestamp,
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO SalesPointPostingMonth (
          id, salesPointId, financialYearPeriodId, calendarMonth, status, openedAt, closedAt
        ) VALUES (?, NULL, ?, ?, 'OPEN', ?, NULL)`,
      ).run(createTextPrimaryKey(), periodId, calendarMonth, timestamp);
    }
  } else {
    const existing = db
      .prepare(
        `SELECT id, openedAt FROM SalesPointPostingMonth
         WHERE salesPointId = ?
           AND financialYearPeriodId = ?
           AND calendarMonth = ?`,
      )
      .get(salesPointId, periodId, calendarMonth) as
      | { id: string; openedAt: string | null }
      | undefined;
    if (existing) {
      db.prepare(
        `UPDATE SalesPointPostingMonth
         SET status = 'OPEN',
             openedAt = COALESCE(?, openedAt, ?),
             closedAt = NULL
         WHERE id = ?`,
      ).run(
        sanitizeStoredTimestamp(existing.openedAt),
        timestamp,
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO SalesPointPostingMonth (
          id, salesPointId, financialYearPeriodId, calendarMonth, status, openedAt, closedAt
        ) VALUES (?, ?, ?, ?, 'OPEN', ?, NULL)`,
      ).run(
        createTextPrimaryKey(),
        salesPointId,
        periodId,
        calendarMonth,
        timestamp,
      );
    }
  }

  // Keep catalog row in sync for legacy readers / openMonthCount fallbacks.
  db.prepare(
    `UPDATE FinancialMonth
     SET status = 'CLOSED', closedAt = ?
     WHERE financialYearPeriodId = ? AND status = 'OPEN' AND calendarMonth != ?`,
  ).run(timestamp, periodId, calendarMonth);
  db.prepare(
    `UPDATE FinancialMonth
     SET status = 'OPEN', openedAt = COALESCE(openedAt, ?), closedAt = NULL
     WHERE financialYearPeriodId = ? AND calendarMonth = ?`,
  ).run(timestamp, periodId, calendarMonth);
}

function seedOpenMonthForAllScopes(
  periodId: string,
  calendarMonth: number,
): void {
  upsertOpenPostingMonth(periodId, calendarMonth, null);
  for (const salesPointId of listActiveSalesPointIds()) {
    upsertOpenPostingMonth(periodId, calendarMonth, salesPointId);
  }
}

function pickInitialMonth(financialYear: number): number {
  const today = new Date();
  if (today.getFullYear() === financialYear) {
    return today.getMonth() + 1;
  }
  return 1;
}

function getYearById(id: string): FinancialYearRow | null {
  const row = getDatabase()
    .prepare(
      `SELECT y.*,
              (SELECT COUNT(*) FROM FinancialMonth m WHERE m.financialYearPeriodId = y.id) AS monthCount,
              (SELECT COUNT(DISTINCT COALESCE(CAST(spm.salesPointId AS TEXT), 'central'))
               FROM SalesPointPostingMonth spm
               WHERE spm.financialYearPeriodId = y.id AND spm.status = 'OPEN') AS openMonthCount
       FROM FinancialYearPeriod y
       WHERE y.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapYearRow(row) : null;
}

export function listYears(): FinancialYearRow[] {
  repairLiteralSqlTimestamps();
  const rows = getDatabase()
    .prepare(
      `SELECT y.*,
              (SELECT COUNT(*) FROM FinancialMonth m WHERE m.financialYearPeriodId = y.id) AS monthCount,
              (SELECT COUNT(DISTINCT COALESCE(CAST(spm.salesPointId AS TEXT), 'central'))
               FROM SalesPointPostingMonth spm
               WHERE spm.financialYearPeriodId = y.id AND spm.status = 'OPEN') AS openMonthCount
       FROM FinancialYearPeriod y
       ORDER BY y.financialYear DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(mapYearRow);
}

function listMonthsForPeriodScoped(
  periodId: string,
  salesPointId: PostingScopeId,
): FinancialMonthRow[] {
  const db = getDatabase();
  const catalog = db
    .prepare(
      `SELECT * FROM FinancialMonth
       WHERE financialYearPeriodId = ?
       ORDER BY calendarMonth ASC`,
    )
    .all(periodId) as Array<Record<string, unknown>>;

  const postingRows =
    salesPointId == null
      ? (db
          .prepare(
            `SELECT calendarMonth, status, openedAt, closedAt
             FROM SalesPointPostingMonth
             WHERE financialYearPeriodId = ? AND salesPointId IS NULL`,
          )
          .all(periodId) as Array<{
            calendarMonth: number;
            status: string;
            openedAt: string | null;
            closedAt: string | null;
          }>)
      : (db
          .prepare(
            `SELECT calendarMonth, status, openedAt, closedAt
             FROM SalesPointPostingMonth
             WHERE financialYearPeriodId = ? AND salesPointId = ?`,
          )
          .all(periodId, salesPointId) as Array<{
            calendarMonth: number;
            status: string;
            openedAt: string | null;
            closedAt: string | null;
          }>);

  const byMonth = new Map(
    postingRows.map((row) => [row.calendarMonth, row] as const),
  );

  return catalog.map((row) => {
    const posting = byMonth.get(Number(row.calendarMonth));
    return mapMonthRow({
      ...row,
      status: posting?.status ?? "CLOSED",
      openedAt: posting?.openedAt ?? null,
      closedAt: posting?.closedAt ?? null,
    });
  });
}

/** @deprecated Prefer listMonthsForPeriod(periodId, salesPointId). */
export function listMonthsForPeriod(
  periodId: string,
  salesPointId?: number | null,
): FinancialMonthRow[] {
  return listMonthsForPeriodScoped(periodId, normalizeScope(salesPointId));
}

export function listMonthsForOpenYear(salesPointId?: number | null): {
  year: FinancialYearRow | null;
  months: FinancialMonthRow[];
} {
  const scope = normalizeScope(salesPointId);
  const openYear = getDatabase()
    .prepare(
      `SELECT y.*,
              (SELECT COUNT(*) FROM FinancialMonth m WHERE m.financialYearPeriodId = y.id) AS monthCount,
              (SELECT COUNT(DISTINCT COALESCE(CAST(spm.salesPointId AS TEXT), 'central'))
               FROM SalesPointPostingMonth spm
               WHERE spm.financialYearPeriodId = y.id AND spm.status = 'OPEN') AS openMonthCount
       FROM FinancialYearPeriod y
       WHERE y.status = 'OPEN'
       ORDER BY y.financialYear DESC
       LIMIT 1`,
    )
    .get() as Record<string, unknown> | undefined;

  if (!openYear) {
    return { year: null, months: [] };
  }

  const year = mapYearRow(openYear);
  ensureTwelveMonths(year.id, year.financialYear);
  return { year, months: listMonthsForPeriodScoped(year.id, scope) };
}

/**
 * Open posting period for a collection point, or central when salesPointId is null.
 */
export function getOpenPostingPeriod(
  salesPointId?: number | null,
): OpenPostingPeriod | null {
  const scope = normalizeScope(salesPointId);
  const db = getDatabase();

  const row =
    scope == null
      ? (db
          .prepare(
            `SELECT y.id AS financialYearPeriodId, y.financialYear,
                    m.id AS monthId, spm.calendarMonth, m.name AS monthName
             FROM FinancialYearPeriod y
             INNER JOIN SalesPointPostingMonth spm
               ON spm.financialYearPeriodId = y.id
              AND spm.salesPointId IS NULL
              AND spm.status = 'OPEN'
             INNER JOIN FinancialMonth m
               ON m.financialYearPeriodId = y.id
              AND m.calendarMonth = spm.calendarMonth
             WHERE y.status = 'OPEN'
             ORDER BY y.financialYear DESC, spm.calendarMonth DESC
             LIMIT 1`,
          )
          .get() as
          | {
              financialYearPeriodId: string;
              financialYear: number;
              monthId: string;
              calendarMonth: number;
              monthName: string;
            }
          | undefined)
      : (db
          .prepare(
            `SELECT y.id AS financialYearPeriodId, y.financialYear,
                    m.id AS monthId, spm.calendarMonth, m.name AS monthName
             FROM FinancialYearPeriod y
             INNER JOIN SalesPointPostingMonth spm
               ON spm.financialYearPeriodId = y.id
              AND spm.salesPointId = ?
              AND spm.status = 'OPEN'
             INNER JOIN FinancialMonth m
               ON m.financialYearPeriodId = y.id
              AND m.calendarMonth = spm.calendarMonth
             WHERE y.status = 'OPEN'
             ORDER BY y.financialYear DESC, spm.calendarMonth DESC
             LIMIT 1`,
          )
          .get(scope) as
          | {
              financialYearPeriodId: string;
              financialYear: number;
              monthId: string;
              calendarMonth: number;
              monthName: string;
            }
          | undefined);

  if (!row) return null;

  return {
    financialYearPeriodId: row.financialYearPeriodId,
    financialYear: row.financialYear,
    monthId: row.monthId,
    calendarMonth: row.calendarMonth,
    monthName: row.monthName,
    startDate: monthStartDate(row.financialYear, row.calendarMonth),
    endDate: monthEndDate(row.financialYear, row.calendarMonth),
  };
}

export function assertDateInOpenMonth(
  isoDate: string,
  salesPointId?: number | null,
): OpenPostingPeriod {
  const period = getOpenPostingPeriod(normalizeScope(salesPointId));
  if (!period) {
    throw new Error("Open a financial month before posting.");
  }
  const date = isoDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Invalid transaction date.");
  }
  if (date < period.startDate || date > period.endDate) {
    throw new Error(
      `Transaction date must fall in the open financial month (${period.monthName} ${period.financialYear}).`,
    );
  }
  return period;
}

export function assertBudgetYear(financialYear: unknown): void {
  // Budgets are year-scoped; any open scope in the open year is enough.
  const period =
    getOpenPostingPeriod(null) ??
    listActiveSalesPointIds()
      .map((id) => getOpenPostingPeriod(id))
      .find(Boolean) ??
    null;
  if (!period) {
    throw new Error("Open a financial month before editing budgets.");
  }
  const year = Number(financialYear);
  if (!Number.isFinite(year) || year !== period.financialYear) {
    throw new Error(
      `Budget financial year must match the open year (${period.financialYear}).`,
    );
  }
}

/**
 * As-at for reports: viewer scope (user → point or central).
 * Pass userId when available; otherwise salesPointId; otherwise central.
 */
export function resolveReportAsAt(userIdOrScope?: string | number | null): {
  asAtIso: string;
  period: OpenPostingPeriod;
} {
  let scope: PostingScopeId = null;
  if (typeof userIdOrScope === "number") {
    scope = normalizeScope(userIdOrScope);
  } else if (typeof userIdOrScope === "string" && userIdOrScope) {
    scope = postingScopeForUser(userIdOrScope);
  }

  const period = getOpenPostingPeriod(scope);
  if (!period) {
    throw new Error("Open a financial month before running reports.");
  }
  const today = localTodayIso();
  const asAtIso = today < period.endDate ? today : period.endDate;
  return { asAtIso, period };
}

export type ListPeriodFilter = "month" | "year" | "all";

export function resolveListDateRange(
  period: ListPeriodFilter = "month",
  salesPointId?: number | null,
): {
  fromIso: string | null;
  toIso: string | null;
  periodLabel: string;
} {
  if (period === "all") {
    return { fromIso: null, toIso: null, periodLabel: "All time" };
  }

  const open = getOpenPostingPeriod(normalizeScope(salesPointId));
  if (!open) {
    throw new Error("Open a financial month before listing documents.");
  }

  const today = localTodayIso();
  const asAtIso = today < open.endDate ? today : open.endDate;

  if (period === "month") {
    return {
      fromIso: open.startDate,
      toIso: asAtIso,
      periodLabel: `${open.monthName} ${open.financialYear}`,
    };
  }

  const yearStart = `${open.financialYear}-01-01`;
  const yearEnd = `${open.financialYear}-12-31`;
  const toIso = asAtIso < yearEnd ? asAtIso : yearEnd;
  return {
    fromIso: yearStart,
    toIso,
    periodLabel: `FY ${open.financialYear} (through ${toIso})`,
  };
}

export function openYear(financialYear: number): OpenYearResult {
  if (
    !Number.isInteger(financialYear) ||
    financialYear < 2000 ||
    financialYear > 2100
  ) {
    throw new Error("Enter a valid financial year (2000–2100).");
  }

  const calendarYear = Number.parseInt(localTodayIso().slice(0, 4), 10);
  if (financialYear > calendarYear) {
    throw new Error(
      `Cannot open financial year ${financialYear} while the calendar year is still ${calendarYear}. Open ${calendarYear} (or an earlier year) instead.`,
    );
  }

  const db = getDatabase();
  const timestamp = nowIso();

  const tx = db.transaction(() => {
    closeAllOpenYearsAndPostingMonths();

    const existing = db
      .prepare(`SELECT id FROM FinancialYearPeriod WHERE financialYear = ?`)
      .get(financialYear) as { id: string } | undefined;

    let periodId: string;
    if (existing) {
      periodId = existing.id;
      db.prepare(
        `UPDATE FinancialYearPeriod
         SET status = 'OPEN', openedAt = ?, closedAt = NULL,
             startDate = ?, endDate = ?
         WHERE id = ?`,
      ).run(
        timestamp,
        yearStartDate(financialYear),
        yearEndDate(financialYear),
        periodId,
      );
    } else {
      periodId = createTextPrimaryKey();
      db.prepare(
        `INSERT INTO FinancialYearPeriod (
          id, financialYear, status, openedAt, closedAt, startDate, endDate
        ) VALUES (?, ?, 'OPEN', ?, NULL, ?, ?)`,
      ).run(
        periodId,
        financialYear,
        timestamp,
        yearStartDate(financialYear),
        yearEndDate(financialYear),
      );
    }

    ensureTwelveMonths(periodId, financialYear);
    seedOpenMonthForAllScopes(periodId, pickInitialMonth(financialYear));
    return periodId;
  });

  const periodId = tx();
  const year = getYearById(periodId);
  if (!year) {
    throw new Error("Failed to open financial year.");
  }
  return { year, months: listMonthsForPeriodScoped(periodId, null) };
}

export function closeYear(periodId: string): FinancialYearRow {
  const db = getDatabase();
  const timestamp = nowIso();
  const existing = db
    .prepare(`SELECT id, status FROM FinancialYearPeriod WHERE id = ?`)
    .get(periodId) as { id: string; status: string } | undefined;
  if (!existing) {
    throw new Error("Financial year not found.");
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE SalesPointPostingMonth
       SET status = 'CLOSED', closedAt = ?
       WHERE financialYearPeriodId = ? AND status = 'OPEN'`,
    ).run(timestamp, periodId);
    db.prepare(
      `UPDATE FinancialMonth
       SET status = 'CLOSED', closedAt = ?
       WHERE financialYearPeriodId = ? AND status = 'OPEN'`,
    ).run(timestamp, periodId);
    db.prepare(
      `UPDATE FinancialYearPeriod
       SET status = 'CLOSED', closedAt = ?
       WHERE id = ?`,
    ).run(timestamp, periodId);
  });
  tx();

  const year = getYearById(periodId);
  if (!year) {
    throw new Error("Financial year not found.");
  }
  return year;
}

export function setMonthStatus(
  monthId: string,
  status: FinancialPeriodStatus,
  salesPointId?: number | null,
): FinancialMonthRow {
  const scope = normalizeScope(salesPointId);
  const db = getDatabase();
  const month = db
    .prepare(`SELECT * FROM FinancialMonth WHERE id = ?`)
    .get(monthId) as Record<string, unknown> | undefined;
  if (!month) {
    throw new Error("Financial month not found.");
  }

  const year = db
    .prepare(`SELECT status FROM FinancialYearPeriod WHERE id = ?`)
    .get(String(month.financialYearPeriodId)) as { status: string } | undefined;
  if (!year || year.status !== "OPEN") {
    throw new Error("Open the financial year before changing month status.");
  }

  const periodId = String(month.financialYearPeriodId);
  const calendarMonth = Number(month.calendarMonth);

  if (status === "OPEN") {
    upsertOpenPostingMonth(periodId, calendarMonth, scope);
  } else {
    const timestamp = nowIso();
    if (scope == null) {
      db.prepare(
        `UPDATE SalesPointPostingMonth
         SET status = 'CLOSED', closedAt = ?
         WHERE salesPointId IS NULL
           AND financialYearPeriodId = ?
           AND calendarMonth = ?`,
      ).run(timestamp, periodId, calendarMonth);
    } else {
      db.prepare(
        `UPDATE SalesPointPostingMonth
         SET status = 'CLOSED', closedAt = ?
         WHERE salesPointId = ?
           AND financialYearPeriodId = ?
           AND calendarMonth = ?`,
      ).run(timestamp, scope, periodId, calendarMonth);
    }
  }

  return listMonthsForPeriodScoped(periodId, scope).find(
    (row) => row.id === monthId,
  )!;
}

/** Backfill months for open years after migration. */
export function backfillFinancialMonths(): void {
  const db = getDatabase();
  const years = db
    .prepare(`SELECT id, financialYear, status FROM FinancialYearPeriod`)
    .all() as Array<{ id: string; financialYear: number; status: string }>;

  for (const year of years) {
    ensureTwelveMonths(year.id, year.financialYear);
  }

  const openYears = years.filter((year) => year.status === "OPEN");
  for (const year of openYears) {
    const anyOpen = db
      .prepare(
        `SELECT 1 AS ok FROM SalesPointPostingMonth
         WHERE financialYearPeriodId = ? AND status = 'OPEN'
         LIMIT 1`,
      )
      .get(year.id) as { ok: number } | undefined;
    if (anyOpen) continue;

    const legacy = db
      .prepare(
        `SELECT calendarMonth FROM FinancialMonth
         WHERE financialYearPeriodId = ? AND status = 'OPEN'
         LIMIT 1`,
      )
      .get(year.id) as { calendarMonth: number } | undefined;
    const calendarMonth =
      legacy?.calendarMonth ?? pickInitialMonth(year.financialYear);
    seedOpenMonthForAllScopes(year.id, calendarMonth);
  }
}
