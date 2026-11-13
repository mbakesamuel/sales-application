import { randomBytes } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { loadRpcActor } from "./rpcActor.js";

export type FinancialPeriodStatus = "OPEN" | "CLOSED";

export type FinancialYearRow = {
  id: string;
  financialYear: number;
  status: FinancialPeriodStatus;
  openedAt: string | null;
  closedAt: string | null;
  startDate: string;
  endDate: string;
  openMonthCount: number;
  monthCount: number;
};

export type FinancialMonthRow = {
  id: string;
  financialYearPeriodId: string;
  financialYear: number;
  calendarMonth: number;
  name: string;
  status: FinancialPeriodStatus;
  openedAt: string | null;
  closedAt: string | null;
};

export type OpenPostingPeriod = {
  financialYearPeriodId: string;
  financialYear: number;
  monthId: string;
  calendarMonth: number;
  monthName: string;
  startDate: string;
  endDate: string;
};

export type OpenYearResult = {
  year: FinancialYearRow;
  months: FinancialMonthRow[];
};

/** Collection-point posting scope. Null means no CP (invalid for SP posting helpers). */
export type PostingScopeId = number | null;

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

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function createTextPrimaryKey(): string {
  const time = Date.now().toString(36);
  const random = randomBytes(8).toString("hex");
  return `c${time}${random}`;
}

function nowDate(): Date {
  return new Date();
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toIsoTimestamp(value: Date | null | undefined): string | null {
  if (!value) return null;
  const d = value;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function monthStartDate(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

function monthEndDate(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${pad2(month)}-${pad2(lastDay)}`;
}

function yearStartDate(year: number): Date {
  return new Date(Date.UTC(year, 0, 1));
}

function yearEndDate(year: number): Date {
  return new Date(Date.UTC(year, 11, 31));
}

function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function pickInitialMonth(financialYear: number): number {
  const today = new Date();
  if (today.getFullYear() === financialYear) {
    return today.getMonth() + 1;
  }
  return 1;
}

function mapStatus(value: string): FinancialPeriodStatus {
  return String(value).toUpperCase() === "OPEN" ? "OPEN" : "CLOSED";
}

export function normalizePostingScope(
  salesPointId?: number | null,
): PostingScopeId {
  if (salesPointId == null || !Number.isFinite(Number(salesPointId))) {
    return null;
  }
  return Number(salesPointId);
}

export async function postingScopeForUser(
  userId?: string | null,
): Promise<PostingScopeId> {
  if (!userId) return null;
  try {
    return (await loadRpcActor(userId)).salesPointId;
  } catch {
    return null;
  }
}

async function countOpenScopes(periodId: string): Promise<number> {
  const [spRows, userOpenCount] = await Promise.all([
    prisma.sales_point_posting_months.findMany({
      where: {
        financial_year_period_id: periodId,
        status: "OPEN",
        sales_point_id: { not: null },
      },
      select: { sales_point_id: true },
    }),
    prisma.user_posting_months.count({
      where: { financial_year_period_id: periodId, status: "OPEN" },
    }),
  ]);
  const spKeys = new Set(
    spRows
      .map((row) => row.sales_point_id)
      .filter((id): id is number => id != null)
      .map((id) => String(id)),
  );
  return spKeys.size + userOpenCount;
}

async function getYearById(id: string): Promise<FinancialYearRow | null> {
  const row = await prisma.financial_year_periods.findUnique({ where: { id } });
  if (!row) return null;
  const [monthCount, openMonthCount] = await Promise.all([
    prisma.financial_months.count({ where: { financial_year_period_id: id } }),
    countOpenScopes(id),
  ]);
  return {
    id: row.id,
    financialYear: row.financial_year,
    status: mapStatus(row.status),
    openedAt: toIsoTimestamp(row.opened_at),
    closedAt: toIsoTimestamp(row.closed_at),
    startDate: toIsoDate(row.start_date),
    endDate: toIsoDate(row.end_date),
    openMonthCount,
    monthCount,
  };
}

async function ensureTwelveMonths(
  periodId: string,
  financialYear: number,
): Promise<void> {
  const existing = await prisma.financial_months.findMany({
    where: { financial_year_period_id: periodId },
    select: { calendar_month: true },
  });
  const have = new Set(existing.map((row) => row.calendar_month));
  const missing = [];
  for (let month = 1; month <= 12; month += 1) {
    if (have.has(month)) continue;
    missing.push({
      id: createTextPrimaryKey(),
      financial_year_period_id: periodId,
      financial_year: financialYear,
      calendar_month: month,
      name: MONTH_NAMES[month - 1],
      status: "CLOSED",
      opened_at: null,
      closed_at: null,
    });
  }
  if (missing.length > 0) {
    await prisma.financial_months.createMany({ data: missing });
  }
}

function mapMonthRow(row: {
  id: string;
  financial_year_period_id: string;
  financial_year: number;
  calendar_month: number;
  name: string;
  status: string;
  opened_at: Date | null;
  closed_at: Date | null;
}): FinancialMonthRow {
  return {
    id: row.id,
    financialYearPeriodId: row.financial_year_period_id,
    financialYear: row.financial_year,
    calendarMonth: row.calendar_month,
    name: row.name,
    status: mapStatus(row.status),
    openedAt: toIsoTimestamp(row.opened_at),
    closedAt: toIsoTimestamp(row.closed_at),
  };
}

async function listActiveSalesPointIds(): Promise<number[]> {
  const rows = await prisma.sales_points.findMany({
    where: { is_active: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => row.id);
}

async function closeOpenPostingForScope(
  tx: typeof prisma,
  salesPointId: number,
): Promise<void> {
  const timestamp = nowDate();
  await tx.sales_point_posting_months.updateMany({
    where: { sales_point_id: salesPointId, status: "OPEN" },
    data: { status: "CLOSED", closed_at: timestamp },
  });
}

async function upsertOpenPostingMonth(
  tx: typeof prisma,
  periodId: string,
  calendarMonth: number,
  salesPointId: number,
): Promise<void> {
  if (!Number.isFinite(salesPointId)) {
    throw new Error("Collection-point id is required to open a posting month.");
  }
  const timestamp = nowDate();
  await closeOpenPostingForScope(tx, salesPointId);

  const existing = await tx.sales_point_posting_months.findFirst({
    where: {
      sales_point_id: salesPointId,
      financial_year_period_id: periodId,
      calendar_month: calendarMonth,
    },
  });

  if (existing) {
    await tx.sales_point_posting_months.update({
      where: { id: existing.id },
      data: {
        status: "OPEN",
        opened_at: existing.opened_at ?? timestamp,
        closed_at: null,
      },
    });
  } else {
    await tx.sales_point_posting_months.create({
      data: {
        id: createTextPrimaryKey(),
        sales_point_id: salesPointId,
        financial_year_period_id: periodId,
        calendar_month: calendarMonth,
        status: "OPEN",
        opened_at: timestamp,
        closed_at: null,
      },
    });
  }

  await tx.financial_months.updateMany({
    where: {
      financial_year_period_id: periodId,
      status: "OPEN",
      calendar_month: { not: calendarMonth },
    },
    data: { status: "CLOSED", closed_at: timestamp },
  });
  await tx.financial_months.updateMany({
    where: {
      financial_year_period_id: periodId,
      calendar_month: calendarMonth,
    },
    data: { status: "OPEN", closed_at: null },
  });
}

async function listUnscopedUserIds(): Promise<string[]> {
  const rows = await prisma.users.findMany({
    where: { sales_point_id: null },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => row.id);
}

async function closeOpenPostingForUser(
  tx: typeof prisma,
  userId: string,
): Promise<void> {
  await tx.user_posting_months.updateMany({
    where: { user_id: userId, status: "OPEN" },
    data: { status: "CLOSED", closed_at: nowDate() },
  });
}

async function upsertOpenPostingMonthForUser(
  tx: typeof prisma,
  periodId: string,
  calendarMonth: number,
  userId: string,
): Promise<void> {
  const timestamp = nowDate();
  await closeOpenPostingForUser(tx, userId);

  const existing = await tx.user_posting_months.findFirst({
    where: {
      user_id: userId,
      financial_year_period_id: periodId,
      calendar_month: calendarMonth,
    },
  });

  if (existing) {
    await tx.user_posting_months.update({
      where: { id: existing.id },
      data: {
        status: "OPEN",
        opened_at: existing.opened_at ?? timestamp,
        closed_at: null,
      },
    });
  } else {
    await tx.user_posting_months.create({
      data: {
        id: createTextPrimaryKey(),
        user_id: userId,
        financial_year_period_id: periodId,
        calendar_month: calendarMonth,
        status: "OPEN",
        opened_at: timestamp,
        closed_at: null,
      },
    });
  }

  await tx.financial_months.updateMany({
    where: {
      financial_year_period_id: periodId,
      status: "OPEN",
      calendar_month: { not: calendarMonth },
    },
    data: { status: "CLOSED", closed_at: timestamp },
  });
  await tx.financial_months.updateMany({
    where: {
      financial_year_period_id: periodId,
      calendar_month: calendarMonth,
    },
    data: { status: "OPEN", closed_at: null },
  });
}

async function seedOpenMonthForAllScopes(
  tx: typeof prisma,
  periodId: string,
  calendarMonth: number,
): Promise<void> {
  // CP months + personal HO UserPostingMonth only (no central null-scope row).
  for (const salesPointId of await listActiveSalesPointIds()) {
    await upsertOpenPostingMonth(tx, periodId, calendarMonth, salesPointId);
  }
  for (const userId of await listUnscopedUserIds()) {
    await upsertOpenPostingMonthForUser(tx, periodId, calendarMonth, userId);
  }
}

export async function listYears(): Promise<FinancialYearRow[]> {
  const rows = await prisma.financial_year_periods.findMany({
    orderBy: { financial_year: "desc" },
  });
  const result: FinancialYearRow[] = [];
  for (const row of rows) {
    const mapped = await getYearById(row.id);
    if (mapped) result.push(mapped);
  }
  return result;
}

export async function listMonthsForPeriod(
  periodId: string,
  salesPointId?: number | null,
): Promise<FinancialMonthRow[]> {
  const scope = normalizePostingScope(salesPointId);
  const catalog = await prisma.financial_months.findMany({
    where: { financial_year_period_id: periodId },
    orderBy: { calendar_month: "asc" },
  });
  const posting =
    scope == null
      ? []
      : await prisma.sales_point_posting_months.findMany({
          where: {
            financial_year_period_id: periodId,
            sales_point_id: scope,
          },
        });
  const byMonth = new Map(
    posting.map((row) => [row.calendar_month, row] as const),
  );
  return catalog.map((row) => {
    const live = byMonth.get(row.calendar_month);
    return mapMonthRow({
      ...row,
      status: live?.status ?? "CLOSED",
      opened_at: live?.opened_at ?? null,
      closed_at: live?.closed_at ?? null,
    });
  });
}

export async function listMonthsForOpenYear(
  salesPointId?: number | null,
): Promise<{
  year: FinancialYearRow | null;
  months: FinancialMonthRow[];
}> {
  const openYear = await prisma.financial_year_periods.findFirst({
    where: { status: "OPEN" },
    orderBy: { financial_year: "desc" },
  });
  if (!openYear) {
    return { year: null, months: [] };
  }
  await ensureTwelveMonths(openYear.id, openYear.financial_year);
  const year = await getYearById(openYear.id);
  return {
    year,
    months: await listMonthsForPeriod(openYear.id, salesPointId),
  };
}

export async function getOpenPostingPeriod(
  salesPointId?: number | null,
): Promise<OpenPostingPeriod | null> {
  const scope = normalizePostingScope(salesPointId);
  if (scope == null) {
    return null;
  }
  const posting = await prisma.sales_point_posting_months.findFirst({
    where: {
      status: "OPEN",
      sales_point_id: scope,
      period: { status: "OPEN" },
    },
    orderBy: [{ calendar_month: "desc" }],
    include: { period: true },
  });
  if (!posting) return null;

  const catalog = await prisma.financial_months.findFirst({
    where: {
      financial_year_period_id: posting.financial_year_period_id,
      calendar_month: posting.calendar_month,
    },
  });
  if (!catalog) return null;

  return {
    financialYearPeriodId: posting.financial_year_period_id,
    financialYear: posting.period.financial_year,
    monthId: catalog.id,
    calendarMonth: posting.calendar_month,
    monthName: catalog.name,
    startDate: monthStartDate(
      posting.period.financial_year,
      posting.calendar_month,
    ),
    endDate: monthEndDate(
      posting.period.financial_year,
      posting.calendar_month,
    ),
  };
}

export async function assertDateInOpenMonth(
  isoDate: string,
  salesPointId?: number | null,
): Promise<OpenPostingPeriod> {
  const period = await getOpenPostingPeriod(salesPointId);
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

export async function openYear(financialYear: number): Promise<OpenYearResult> {
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

  const timestamp = nowDate();
  const periodId = await prisma.$transaction(async (tx) => {
    await tx.financial_year_periods.updateMany({
      where: { status: "OPEN" },
      data: { status: "CLOSED", closed_at: timestamp },
    });
    await tx.financial_months.updateMany({
      where: { status: "OPEN" },
      data: { status: "CLOSED", closed_at: timestamp },
    });
    await tx.sales_point_posting_months.updateMany({
      where: { status: "OPEN" },
      data: { status: "CLOSED", closed_at: timestamp },
    });
    await tx.user_posting_months.updateMany({
      where: { status: "OPEN" },
      data: { status: "CLOSED", closed_at: timestamp },
    });

    const existing = await tx.financial_year_periods.findUnique({
      where: { financial_year: financialYear },
    });

    let id: string;
    if (existing) {
      id = existing.id;
      await tx.financial_year_periods.update({
        where: { id },
        data: {
          status: "OPEN",
          opened_at: timestamp,
          closed_at: null,
          start_date: yearStartDate(financialYear),
          end_date: yearEndDate(financialYear),
        },
      });
    } else {
      id = createTextPrimaryKey();
      await tx.financial_year_periods.create({
        data: {
          id,
          financial_year: financialYear,
          status: "OPEN",
          opened_at: timestamp,
          closed_at: null,
          start_date: yearStartDate(financialYear),
          end_date: yearEndDate(financialYear),
        },
      });
    }

    const existingMonths = await tx.financial_months.findMany({
      where: { financial_year_period_id: id },
      select: { calendar_month: true },
    });
    const have = new Set(existingMonths.map((m) => m.calendar_month));
    for (let month = 1; month <= 12; month += 1) {
      if (have.has(month)) continue;
      await tx.financial_months.create({
        data: {
          id: createTextPrimaryKey(),
          financial_year_period_id: id,
          financial_year: financialYear,
          calendar_month: month,
          name: MONTH_NAMES[month - 1],
          status: "CLOSED",
        },
      });
    }

    await seedOpenMonthForAllScopes(
      tx as unknown as typeof prisma,
      id,
      pickInitialMonth(financialYear),
    );
    return id;
  });

  const year = await getYearById(periodId);
  if (!year) {
    throw new Error("Failed to open financial year.");
  }
  return { year, months: await listMonthsForPeriod(periodId, null) };
}

export async function closeYear(periodId: string): Promise<FinancialYearRow> {
  const existing = await prisma.financial_year_periods.findUnique({
    where: { id: periodId },
  });
  if (!existing) {
    throw new Error("Financial year not found.");
  }
  const timestamp = nowDate();
  await prisma.$transaction([
    prisma.sales_point_posting_months.updateMany({
      where: { financial_year_period_id: periodId, status: "OPEN" },
      data: { status: "CLOSED", closed_at: timestamp },
    }),
    prisma.user_posting_months.updateMany({
      where: { financial_year_period_id: periodId, status: "OPEN" },
      data: { status: "CLOSED", closed_at: timestamp },
    }),
    prisma.financial_months.updateMany({
      where: { financial_year_period_id: periodId, status: "OPEN" },
      data: { status: "CLOSED", closed_at: timestamp },
    }),
    prisma.financial_year_periods.update({
      where: { id: periodId },
      data: { status: "CLOSED", closed_at: timestamp },
    }),
  ]);
  const year = await getYearById(periodId);
  if (!year) {
    throw new Error("Financial year not found.");
  }
  return year;
}

export async function setMonthStatus(
  monthId: string,
  status: FinancialPeriodStatus,
  salesPointId?: number | null,
): Promise<FinancialMonthRow> {
  const scope = normalizePostingScope(salesPointId);
  if (scope == null) {
    throw new Error(
      "Collection-point scope is required. Head-office users manage months via their personal posting month.",
    );
  }
  const month = await prisma.financial_months.findUnique({
    where: { id: monthId },
  });
  if (!month) {
    throw new Error("Financial month not found.");
  }
  const year = await prisma.financial_year_periods.findUnique({
    where: { id: month.financial_year_period_id },
  });
  if (!year || year.status !== "OPEN") {
    throw new Error("Open the financial year before changing month status.");
  }

  if (status === "OPEN") {
    await prisma.$transaction(async (tx) => {
      await upsertOpenPostingMonth(
        tx as unknown as typeof prisma,
        month.financial_year_period_id,
        month.calendar_month,
        scope,
      );
    });
  } else {
    await prisma.sales_point_posting_months.updateMany({
      where: {
        sales_point_id: scope,
        financial_year_period_id: month.financial_year_period_id,
        calendar_month: month.calendar_month,
      },
      data: { status: "CLOSED", closed_at: nowDate() },
    });
  }

  const rows = await listMonthsForPeriod(
    month.financial_year_period_id,
    scope,
  );
  const updated = rows.find((row) => row.id === monthId);
  if (!updated) {
    throw new Error("Financial month not found.");
  }
  return updated;
}

async function listMonthsForPeriodForUser(
  periodId: string,
  userId: string,
): Promise<FinancialMonthRow[]> {
  const catalog = await prisma.financial_months.findMany({
    where: { financial_year_period_id: periodId },
    orderBy: { calendar_month: "asc" },
  });
  const posting = await prisma.user_posting_months.findMany({
    where: { financial_year_period_id: periodId, user_id: userId },
  });
  const byMonth = new Map(
    posting.map((row) => [row.calendar_month, row] as const),
  );
  return catalog.map((row) => {
    const live = byMonth.get(row.calendar_month);
    return mapMonthRow({
      ...row,
      status: live?.status ?? "CLOSED",
      opened_at: live?.opened_at ?? null,
      closed_at: live?.closed_at ?? null,
    });
  });
}

export async function getOpenPostingPeriodForUser(
  userId: string,
): Promise<OpenPostingPeriod | null> {
  const posting = await prisma.user_posting_months.findFirst({
    where: {
      status: "OPEN",
      user_id: userId,
      period: { status: "OPEN" },
    },
    orderBy: [{ calendar_month: "desc" }],
    include: { period: true },
  });
  if (!posting) return null;

  const catalog = await prisma.financial_months.findFirst({
    where: {
      financial_year_period_id: posting.financial_year_period_id,
      calendar_month: posting.calendar_month,
    },
  });
  if (!catalog) return null;

  return {
    financialYearPeriodId: posting.financial_year_period_id,
    financialYear: posting.period.financial_year,
    monthId: catalog.id,
    calendarMonth: posting.calendar_month,
    monthName: catalog.name,
    startDate: monthStartDate(
      posting.period.financial_year,
      posting.calendar_month,
    ),
    endDate: monthEndDate(
      posting.period.financial_year,
      posting.calendar_month,
    ),
  };
}

export async function getOpenPostingPeriodForActor(
  userId: string | null | undefined,
): Promise<OpenPostingPeriod | null> {
  if (!userId) return null;
  const salesPointId = await postingScopeForUser(userId);
  if (salesPointId != null) {
    return getOpenPostingPeriod(salesPointId);
  }
  return getOpenPostingPeriodForUser(userId);
}

export async function listMonthsForOpenYearForActor(userId: string): Promise<{
  year: FinancialYearRow | null;
  months: FinancialMonthRow[];
}> {
  const salesPointId = await postingScopeForUser(userId);
  if (salesPointId != null) {
    return listMonthsForOpenYear(salesPointId);
  }

  const openYear = await prisma.financial_year_periods.findFirst({
    where: { status: "OPEN" },
    orderBy: { financial_year: "desc" },
  });
  if (!openYear) {
    return { year: null, months: [] };
  }
  await ensureTwelveMonths(openYear.id, openYear.financial_year);
  const year = await getYearById(openYear.id);
  return {
    year,
    months: await listMonthsForPeriodForUser(openYear.id, userId),
  };
}

export async function setMonthStatusForActor(
  userId: string,
  monthId: string,
  status: FinancialPeriodStatus,
): Promise<FinancialMonthRow> {
  const salesPointId = await postingScopeForUser(userId);
  if (salesPointId != null) {
    return setMonthStatus(monthId, status, salesPointId);
  }

  const month = await prisma.financial_months.findUnique({
    where: { id: monthId },
  });
  if (!month) {
    throw new Error("Financial month not found.");
  }
  const year = await prisma.financial_year_periods.findUnique({
    where: { id: month.financial_year_period_id },
  });
  if (!year || year.status !== "OPEN") {
    throw new Error("Open the financial year before changing month status.");
  }

  if (status === "OPEN") {
    await prisma.$transaction(async (tx) => {
      await upsertOpenPostingMonthForUser(
        tx as unknown as typeof prisma,
        month.financial_year_period_id,
        month.calendar_month,
        userId,
      );
    });
  } else {
    await prisma.user_posting_months.updateMany({
      where: {
        user_id: userId,
        financial_year_period_id: month.financial_year_period_id,
        calendar_month: month.calendar_month,
      },
      data: { status: "CLOSED", closed_at: nowDate() },
    });
  }

  const rows = await listMonthsForPeriodForUser(
    month.financial_year_period_id,
    userId,
  );
  const updated = rows.find((row) => row.id === monthId);
  if (!updated) {
    throw new Error("Financial month not found.");
  }
  return updated;
}

export async function assertDateInOpenMonthForActor(
  isoDate: string,
  userId: string,
): Promise<OpenPostingPeriod> {
  const period = await getOpenPostingPeriodForActor(userId);
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
