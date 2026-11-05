import { randomBytes } from "node:crypto";
import { prisma } from "../db/prisma.js";

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

async function getYearById(id: string): Promise<FinancialYearRow | null> {
  const row = await prisma.financial_year_periods.findUnique({ where: { id } });
  if (!row) return null;
  const [monthCount, openMonthCount] = await Promise.all([
    prisma.financial_months.count({ where: { financial_year_period_id: id } }),
    prisma.financial_months.count({
      where: { financial_year_period_id: id, status: "OPEN" },
    }),
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

async function openMonthRow(monthId: string): Promise<void> {
  const month = await prisma.financial_months.findUnique({
    where: { id: monthId },
  });
  if (!month) {
    throw new Error("Financial month not found.");
  }
  const timestamp = nowDate();
  await prisma.$transaction([
    prisma.financial_months.updateMany({
      where: {
        financial_year_period_id: month.financial_year_period_id,
        status: "OPEN",
        id: { not: monthId },
      },
      data: { status: "CLOSED", closed_at: timestamp },
    }),
    prisma.financial_months.update({
      where: { id: monthId },
      data: {
        status: "OPEN",
        opened_at: month.opened_at ?? timestamp,
        closed_at: null,
      },
    }),
  ]);
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
): Promise<FinancialMonthRow[]> {
  const rows = await prisma.financial_months.findMany({
    where: { financial_year_period_id: periodId },
    orderBy: { calendar_month: "asc" },
  });
  return rows.map(mapMonthRow);
}

export async function listMonthsForOpenYear(): Promise<{
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
    months: await listMonthsForPeriod(openYear.id),
  };
}

export async function getOpenPostingPeriod(): Promise<OpenPostingPeriod | null> {
  const row = await prisma.financial_months.findFirst({
    where: {
      status: "OPEN",
      period: { status: "OPEN" },
    },
    orderBy: [{ financial_year: "desc" }, { calendar_month: "desc" }],
    include: { period: true },
  });
  if (!row) return null;
  return {
    financialYearPeriodId: row.financial_year_period_id,
    financialYear: row.financial_year,
    monthId: row.id,
    calendarMonth: row.calendar_month,
    monthName: row.name,
    startDate: monthStartDate(row.financial_year, row.calendar_month),
    endDate: monthEndDate(row.financial_year, row.calendar_month),
  };
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

    const initialMonth = pickInitialMonth(financialYear);
    const monthRow = await tx.financial_months.findFirst({
      where: {
        financial_year_period_id: id,
        calendar_month: initialMonth,
      },
    });
    if (!monthRow) {
      throw new Error("Failed to create financial months.");
    }

    await tx.financial_months.updateMany({
      where: {
        financial_year_period_id: id,
        status: "OPEN",
        id: { not: monthRow.id },
      },
      data: { status: "CLOSED", closed_at: timestamp },
    });
    await tx.financial_months.update({
      where: { id: monthRow.id },
      data: {
        status: "OPEN",
        opened_at: monthRow.opened_at ?? timestamp,
        closed_at: null,
      },
    });

    return id;
  });

  const year = await getYearById(periodId);
  if (!year) {
    throw new Error("Failed to open financial year.");
  }
  return { year, months: await listMonthsForPeriod(periodId) };
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
): Promise<FinancialMonthRow> {
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
    await openMonthRow(monthId);
  } else {
    await prisma.financial_months.update({
      where: { id: monthId },
      data: { status: "CLOSED", closed_at: nowDate() },
    });
  }

  const updated = await prisma.financial_months.findUnique({
    where: { id: monthId },
  });
  if (!updated) {
    throw new Error("Financial month not found.");
  }
  return mapMonthRow(updated);
}
