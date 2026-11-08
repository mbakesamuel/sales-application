import { getOpenPostingPeriod, postingScopeForUser } from "../financialYearsService.js";
import { resolveReportAsAt } from "../reportCompany.js";

export type ReportWeekChoice = {
  weekMondayIso: string;
  weekFromIso: string;
  weekToIso: string;
  label: string;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

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

export function buildWeekChoices(
  monthStart: string,
  monthEnd: string,
  asAtIso: string,
): ReportWeekChoice[] {
  const hardEnd = minIso(monthEnd, asAtIso);
  if (hardEnd < monthStart) return [];

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
  if (choices.length === 0) return null;
  if (requestedMondayIso) {
    const match = choices.find(
      (choice) => choice.weekMondayIso === requestedMondayIso.slice(0, 10),
    );
    if (match) return match;
  }
  const asAtMonday = toIsoDate(mondayOf(parseLocalIso(asAtIso)));
  return (
    choices.find((choice) => choice.weekMondayIso === asAtMonday) ??
    choices[choices.length - 1] ??
    null
  );
}

export async function getOpenMonthWeekChoices(userId?: string | null): Promise<{
  asAtIso: string;
  weekChoices: ReportWeekChoice[];
  defaultWeekMondayIso: string | null;
}> {
  const asAtIso = await resolveReportAsAt(undefined, userId);
  const period = await getOpenPostingPeriod(await postingScopeForUser(userId));
  if (!period) {
    return { asAtIso, weekChoices: [], defaultWeekMondayIso: null };
  }
  const weekChoices = buildWeekChoices(
    period.startDate,
    period.endDate,
    asAtIso,
  );
  const selected = resolveSelectedWeek(weekChoices, asAtIso, null);
  return {
    asAtIso,
    weekChoices,
    defaultWeekMondayIso: selected?.weekMondayIso ?? null,
  };
}
