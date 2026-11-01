import type {
  MonthlyPalmOilSalesCell,
  MonthlyPalmOilSalesMonthColumn,
  MonthlyPalmOilSalesReport,
  MonthlyPalmOilSalesRow,
} from "../../shared/reports.types.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "./companySettings.js";
import {
  LPO_DESTINATION_ROWS,
  loadPalmOilSaleLines,
  monthIndexFromIso,
  palmOilLineKg,
  resolveMonthlyPalmOilDestinationId,
  type MonthlyPalmOilDestinationId,
} from "./palmOilSalesShared.js";
import { loadProducts, nowIso, reportScopedSalesPointId, sum } from "./shared.js";

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

function emptyCell(): MonthlyPalmOilSalesCell {
  return { tons: 0, value: 0 };
}

function emptyMonthCells(): MonthlyPalmOilSalesCell[] {
  return Array.from({ length: 12 }, () => emptyCell());
}

function kgToTons(kg: number): number {
  return kg / 1000;
}

function addCell(target: MonthlyPalmOilSalesCell, tons: number, value: number): void {
  target.tons += tons;
  target.value += value;
}

function sumCells(cells: MonthlyPalmOilSalesCell[]): MonthlyPalmOilSalesCell {
  return {
    tons: sum(cells.map((cell) => cell.tons)),
    value: sum(cells.map((cell) => cell.value)),
  };
}

function sumRowMonths(rows: MonthlyPalmOilSalesRow[]): MonthlyPalmOilSalesCell[] {
  return Array.from({ length: 12 }, (_, monthIndex) => ({
    tons: sum(rows.map((row) => row.months[monthIndex]?.tons ?? 0)),
    value: sum(rows.map((row) => row.months[monthIndex]?.value ?? 0)),
  }));
}

function buildMonthColumns(
  financialYear: number,
  fromMonth: number,
  toMonth: number,
): MonthlyPalmOilSalesMonthColumn[] {
  const columns: MonthlyPalmOilSalesMonthColumn[] = [];
  for (let month = fromMonth; month <= toMonth; month += 1) {
    columns.push({
      month,
      label: `${MONTH_NAMES[month - 1]} ${financialYear}`,
    });
  }
  return columns;
}

function makeDataRow(
  id: string,
  label: string,
  months: MonthlyPalmOilSalesCell[],
): MonthlyPalmOilSalesRow {
  return {
    id,
    label,
    kind: "data",
    months,
    ytd: sumCells(months),
  };
}

export function getMonthlyPalmOilSalesReport(
  userId?: string,
): MonthlyPalmOilSalesReport {
  const { asAtIso, period } = resolveReportAsAt();
  const financialYear = period.financialYear;
  const yearFromIso = `${financialYear}-01-01`;
  const yearToIso = `${financialYear}-12-31`;
  const settings = loadReportCompanySettings(userId, asAtIso);
  const comments = loadReportComments(ROUTE_ID);
  const products = loadProducts();
  const scopedSalesPointId = reportScopedSalesPointId(userId);

  const lines = loadPalmOilSaleLines(
    yearFromIso,
    yearToIso,
    scopedSalesPointId,
  ).filter((line) => line.dateIssued <= asAtIso);

  const destinationMonths = new Map<MonthlyPalmOilDestinationId, MonthlyPalmOilSalesCell[]>();
  for (const row of LPO_DESTINATION_ROWS) {
    destinationMonths.set(row.id, emptyMonthCells());
  }
  const bpoMonths = emptyMonthCells();

  for (const line of lines) {
    const monthIndex = monthIndexFromIso(line.dateIssued);
    if (monthIndex < 0 || monthIndex > 11) {
      continue;
    }

    const tons = kgToTons(palmOilLineKg(line, products));
    const value = line.lineNet;

    if (line.isBottled === 1) {
      addCell(bpoMonths[monthIndex], tons, value);
      continue;
    }

    if (!line.isLooseLpo) {
      continue;
    }

    const destination = resolveMonthlyPalmOilDestinationId(
      line.saleDisposition,
      line.customerName,
      line.customerTypeCode,
      line.customerTypeName,
    );
    const months = destinationMonths.get(destination);
    if (months) {
      addCell(months[monthIndex], tons, value);
    }
  }

  const destinationRows = LPO_DESTINATION_ROWS.map((row) =>
    makeDataRow(row.id, row.label, destinationMonths.get(row.id) ?? emptyMonthCells()),
  );

  const totalLpoMonths = sumRowMonths(destinationRows);
  const totalLpoRow: MonthlyPalmOilSalesRow = {
    id: "totalLpo",
    label: "TOTAL LPO",
    kind: "subtotal",
    months: totalLpoMonths,
    ytd: sumCells(totalLpoMonths),
  };

  const bpoRow = makeDataRow("bpo", "BOTTLE PALM OIL (BPO)", bpoMonths);

  const grandMonths = Array.from({ length: 12 }, (_, monthIndex) => ({
    tons:
      (totalLpoMonths[monthIndex]?.tons ?? 0) + (bpoMonths[monthIndex]?.tons ?? 0),
    value:
      (totalLpoMonths[monthIndex]?.value ?? 0) + (bpoMonths[monthIndex]?.value ?? 0),
  }));
  const grandTotalRow: MonthlyPalmOilSalesRow = {
    id: "grandTotal",
    label: "GRAND TOTAL",
    kind: "total",
    months: grandMonths,
    ytd: sumCells(grandMonths),
  };

  const lpoHeaderRow: MonthlyPalmOilSalesRow = {
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
