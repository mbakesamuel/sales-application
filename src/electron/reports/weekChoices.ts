import { formatDisplayDate } from "../../shared/formatDisplayDate.js";
import type { WeeklyDeliveriesWeekChoice } from "../../shared/reports.types.js";
import { resolveReportAsAt } from "../financialYears/service.js";


/** Neutral alias for open-month week picker rows. */
export type ReportWeekChoice = WeeklyDeliveriesWeekChoice;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local calendar date (avoids UTC shift from Date.toISOString). */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function parseLocalIso(iso: string): Date {
  return startOfDay(new Date(`${iso.slice(0, 10)}T00:00:00`));
}

export function mondayOf(date: Date): Date {
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diffToMonday);
  return startOfDay(monday);
}

export function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

export function formatWeekLabel(weekFromIso: string, weekToIso: string): string {
  return `${formatDisplayDate(weekFromIso)} – ${formatDisplayDate(weekToIso)}`;
}

/** Mondays of weeks that overlap the open month up to as-at. */
export function buildWeekChoices(
  monthStart: string,
  monthEnd: string,
  asAtIso: string,
): ReportWeekChoice[] {
  const hardEnd = minIso(monthEnd, asAtIso);
  if (hardEnd < monthStart) {
    return [];
  }

  const firstMonday = mondayOf(parseLocalIso(monthStart));
  const cursor = new Date(firstMonday);
  const choices: ReportWeekChoice[] = [];

  while (toIsoDate(cursor) <= hardEnd) {
    const mondayIso = toIsoDate(cursor);
    const sunday = new Date(cursor);
    sunday.setDate(cursor.getDate() + 6);
    const sundayIso = toIsoDate(sunday);

    const weekFromIso = maxIso(mondayIso, monthStart);
    const weekToIso = minIso(sundayIso, hardEnd);

    if (weekFromIso <= weekToIso) {
      choices.push({
        weekMondayIso: mondayIso,
        weekFromIso,
        weekToIso,
        label: formatWeekLabel(weekFromIso, weekToIso),
      });
    }

    cursor.setDate(cursor.getDate() + 7);
  }

  return choices;
}

export function resolveSelectedWeek(
  choices: ReportWeekChoice[],
  asAtIso: string,
  requestedMondayIso: string | null | undefined,
): ReportWeekChoice | null {
  if (choices.length === 0) {
    return null;
  }

  if (requestedMondayIso) {
    const match = choices.find((choice) => choice.weekMondayIso === requestedMondayIso.slice(0, 10));
    if (match) {
      return match;
    }
  }

  const asAtMonday = toIsoDate(mondayOf(parseLocalIso(asAtIso)));
  return (
    choices.find((choice) => choice.weekMondayIso === asAtMonday) ??
    choices[choices.length - 1] ??
    null
  );
}

/** Week choices for the open posting month (weekly report toolbars). */
export function getOpenMonthWeekChoices(userId?: string | null): {
  asAtIso: string;
  weekChoices: ReportWeekChoice[];
  defaultWeekMondayIso: string | null;
} {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const weekChoices = buildWeekChoices(period.startDate, period.endDate, asAtIso);
  const selected = resolveSelectedWeek(weekChoices, asAtIso, null);
  return {
    asAtIso,
    weekChoices,
    defaultWeekMondayIso: selected?.weekMondayIso ?? null,
  };
}

/**
 * Mon–Fri day columns for bottled weekly issues from a selected week Monday,
 * clipped to month start and weekTo/as-at.
 */
export function buildBottledWeekdayColumns(
  weekMondayIso: string,
  periodStartDate: string,
  weekToIso: string,
  asAtIso: string,
): {
  weekFromIso: string;
  weekToIso: string;
  dayColumns: Array<{ id: string; label: string; isoDate: string }>;
} {
  const WEEKDAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI"] as const;
  const monday = parseLocalIso(weekMondayIso);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const fridayIso = toIsoDate(friday);

  const hardEnd = minIso(minIso(weekToIso, asAtIso), fridayIso);
  const hardStart = maxIso(weekMondayIso.slice(0, 10), periodStartDate);

  const dayColumns: Array<{ id: string; label: string; isoDate: string }> = [];
  for (let offset = 0; offset < 5; offset += 1) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + offset);
    const isoDate = toIsoDate(date);
    if (isoDate < hardStart || isoDate > hardEnd) {
      continue;
    }
    dayColumns.push({
      id: `d${offset}`,
      label: WEEKDAY_LABELS[offset],
      isoDate,
    });
  }

  const weekFromIso =
    dayColumns.length > 0 ? dayColumns[0]!.isoDate : hardStart;
  const clippedTo =
    dayColumns.length > 0 ? dayColumns[dayColumns.length - 1]!.isoDate : hardEnd;

  return {
    weekFromIso,
    weekToIso: clippedTo,
    dayColumns,
  };
}
