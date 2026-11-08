import { getOpenPostingPeriod, postingScopeForUser } from "../financialYearsService.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  resolveReportAsAt,
} from "../reportCompany.js";
import {
  LPO_DESTINATION_ROWS,
  loadPalmOilSaleLines,
  monthIndexFromIso,
  palmOilLineKg,
  resolveMonthlyPalmOilDestinationId,
  type MonthlyPalmOilDestinationId,
} from "./palmOilSalesShared.js";
import {
  loadProducts,
  reportScopedSalesPointId,
  sum,
} from "./reportShared.js";

const ROUTE_ID = "monthly-palm-oil-sales-report";

const MONTH_NAMES = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
] as const;

type Cell = { tons: number; value: number };
type MonthColumn = { month: number; label: string };
type Row = {
  id: string;
  label: string;
  kind: "section" | "data" | "subtotal" | "total";
  months: Cell[];
  ytd: Cell;
};

function emptyCell(): Cell {
  return { tons: 0, value: 0 };
}

function emptyMonthCells(): Cell[] {
  return Array.from({ length: 12 }, () => emptyCell());
}

function kgToTons(kg: number): number {
  return kg / 1000;
}

function addCell(target: Cell, tons: number, value: number): void {
  target.tons += tons;
  target.value += value;
}

function sumCells(cells: Cell[]): Cell {
  return {
    tons: sum(cells.map((cell) => cell.tons)),
    value: sum(cells.map((cell) => cell.value)),
  };
}

function sumRowMonths(rows: Row[]): Cell[] {
  return Array.from({ length: 12 }, (_, monthIndex) => ({
    tons: sum(rows.map((row) => row.months[monthIndex]?.tons ?? 0)),
    value: sum(rows.map((row) => row.months[monthIndex]?.value ?? 0)),
  }));
}

function buildMonthColumns(
  financialYear: number,
  fromMonth: number,
  toMonth: number,
): MonthColumn[] {
  const columns: MonthColumn[] = [];
  for (let month = fromMonth; month <= toMonth; month += 1) {
    columns.push({
      month,
      label: `${MONTH_NAMES[month - 1]} ${financialYear}`,
    });
  }
  return columns;
}

function makeDataRow(id: string, label: string, months: Cell[]): Row {
  return {
    id,
    label,
    kind: "data",
    months,
    ytd: sumCells(months),
  };
}

export async function getMonthlyPalmOilSalesReport(userId: string) {
  const asAtIso = await resolveReportAsAt(undefined, userId);
  const period = await getOpenPostingPeriod(await postingScopeForUser(userId));
  if (!period) {
    throw new Error("No open posting period. Open a financial month first.");
  }

  const financialYear = period.financialYear;
  const yearFromIso = `${financialYear}-01-01`;
  const yearToIso = `${financialYear}-12-31`;

  const [settings, comments, products, scopedSalesPointId] = await Promise.all([
    loadReportCompanySettings(userId, asAtIso),
    loadReportComments(ROUTE_ID),
    loadProducts(),
    reportScopedSalesPointId(userId),
  ]);

  const lines = (
    await loadPalmOilSaleLines(yearFromIso, yearToIso, scopedSalesPointId)
  ).filter((line) => line.dateIssued <= asAtIso);

  const destinationMonths = new Map<
    MonthlyPalmOilDestinationId,
    Cell[]
  >();
  for (const row of LPO_DESTINATION_ROWS) {
    destinationMonths.set(row.id, emptyMonthCells());
  }
  const bpoMonths = emptyMonthCells();

  for (const line of lines) {
    const monthIndex = monthIndexFromIso(line.dateIssued);
    if (monthIndex < 0 || monthIndex > 11) continue;

    const tons = kgToTons(palmOilLineKg(line, products));
    const value = line.lineNet;

    if (line.isBottled === 1) {
      addCell(bpoMonths[monthIndex]!, tons, value);
      continue;
    }
    if (!line.isLooseLpo) continue;

    const destination = resolveMonthlyPalmOilDestinationId(
      line.saleDisposition,
      line.customerName,
      line.customerTypeCode,
      line.customerTypeName,
    );
    const months = destinationMonths.get(destination);
    if (months) {
      addCell(months[monthIndex]!, tons, value);
    }
  }

  const destinationRows = LPO_DESTINATION_ROWS.map((row) =>
    makeDataRow(
      row.id,
      row.label,
      destinationMonths.get(row.id) ?? emptyMonthCells(),
    ),
  );

  const totalLpoMonths = sumRowMonths(destinationRows);
  const totalLpoRow: Row = {
    id: "totalLpo",
    label: "TOTAL LPO",
    kind: "subtotal",
    months: totalLpoMonths,
    ytd: sumCells(totalLpoMonths),
  };

  const bpoRow = makeDataRow("bpo", "BOTTLE PALM OIL (BPO)", bpoMonths);
  const grandMonths = Array.from({ length: 12 }, (_, monthIndex) => ({
    tons:
      (totalLpoMonths[monthIndex]?.tons ?? 0) +
      (bpoMonths[monthIndex]?.tons ?? 0),
    value:
      (totalLpoMonths[monthIndex]?.value ?? 0) +
      (bpoMonths[monthIndex]?.value ?? 0),
  }));
  const grandTotalRow: Row = {
    id: "grandTotal",
    label: "GRAND TOTAL",
    kind: "total",
    months: grandMonths,
    ytd: sumCells(grandMonths),
  };

  const lpoHeaderRow: Row = {
    id: "lpoHeader",
    label: "LOOSE PALM OIL (LPO)",
    kind: "section",
    months: emptyMonthCells(),
    ytd: emptyCell(),
  };

  const monthName = period.monthName.toUpperCase();
  const reportTitle = `MONTHLY PALM OIL SALES FOR ${monthName} ${financialYear} (IN TONS AND '000 FRS) TAXES EXCLUDED`;

  return {
    settings,
    asAtIso,
    monthName: period.monthName,
    financialYear,
    reportTitle,
    generatedAtIso: nowIso(),
    monthColumnsH1: buildMonthColumns(financialYear, 1, 6),
    monthColumnsH2: buildMonthColumns(financialYear, 7, 12),
    rows: [lpoHeaderRow, ...destinationRows, totalLpoRow, bpoRow, grandTotalRow],
    comments,
  };
}
