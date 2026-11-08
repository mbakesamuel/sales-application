import { getOpenPostingPeriod, postingScopeForUser } from "../financialYearsService.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  resolveReportAsAt,
} from "../reportCompany.js";
import {
  PALM_OIL_ACTIVITY_CUSTOMER_ROWS,
  PALM_OIL_MONTH_ABBREVS,
  calendarMonthFromIso,
  kgToTons,
  loadBudgetUnitPricePerKg,
  loadMainAndBottledCategoryIds,
  loadPalmOilSaleLines,
  palmOilLineKg,
  resolvePalmOilActivityCategoryId,
  type PalmOilActivityCategoryId,
  type PalmOilSaleLineRecord,
} from "./palmOilSalesShared.js";
import {
  loadProducts,
  reportScopedSalesPointId,
  sum,
  type ProductRow,
} from "./reportShared.js";

const ROUTE_ID = "palm-oil-sales-activity-report";

type Cell = { tons: number; value: number };
type MonthColumn = {
  month: number;
  label: string;
  isPartialMonth?: boolean;
};
type Row = {
  id: string;
  label: string;
  kind: "section" | "data" | "total" | "avg_price" | "budget";
  months: Cell[];
  toDate: Cell;
  pctTage: number | null;
  budgetPricePerKg?: number;
  budgetPct?: number | null;
};
type Section = {
  id: "looseOil" | "looseAndBtldOil";
  title: string;
  monthColumns: MonthColumn[];
  rows: Row[];
};

function emptyCell(): Cell {
  return { tons: 0, value: 0 };
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

function buildLooseMonthColumns(
  financialYear: number,
  asAtIso: string,
  currentMonth: number,
): MonthColumn[] {
  const columns: MonthColumn[] = [];
  for (let month = 1; month < currentMonth; month += 1) {
    columns.push({
      month,
      label: `${PALM_OIL_MONTH_ABBREVS[month - 1]}. ${financialYear}`,
    });
  }
  if (currentMonth >= 1 && currentMonth <= 12) {
    const day = asAtIso.slice(8, 10);
    columns.push({
      month: currentMonth,
      label: `AS AT ${day} ${PALM_OIL_MONTH_ABBREVS[currentMonth - 1]}. ${financialYear}`,
      isPartialMonth: true,
    });
  }
  return columns;
}

function buildCombinedMonthColumns(
  financialYear: number,
  currentMonth: number,
): MonthColumn[] {
  const columns: MonthColumn[] = [];
  for (let month = 1; month <= currentMonth; month += 1) {
    columns.push({
      month,
      label: `${PALM_OIL_MONTH_ABBREVS[month - 1]}. ${financialYear}`,
    });
  }
  return columns;
}

function columnIndexForMonth(
  monthColumns: MonthColumn[],
  calendarMonth: number,
): number {
  return monthColumns.findIndex((column) => column.month === calendarMonth);
}

function aggregateSection(
  lines: PalmOilSaleLineRecord[],
  products: ProductRow[],
  monthColumns: MonthColumn[],
  includeBpo: boolean,
): Map<PalmOilActivityCategoryId, Cell[]> {
  const buckets = new Map<PalmOilActivityCategoryId, Cell[]>();
  for (const row of PALM_OIL_ACTIVITY_CUSTOMER_ROWS) {
    buckets.set(
      row.id,
      monthColumns.map(() => emptyCell()),
    );
  }
  if (includeBpo) {
    buckets.set(
      "bpo",
      monthColumns.map(() => emptyCell()),
    );
  }

  for (const line of lines) {
    const calendarMonth = calendarMonthFromIso(line.dateIssued);
    const columnIndex = columnIndexForMonth(monthColumns, calendarMonth);
    if (columnIndex < 0) continue;

    const tons = kgToTons(palmOilLineKg(line, products));
    const value = line.lineNet;

    if (line.isBottled === 1) {
      if (!includeBpo) continue;
      addCell(buckets.get("bpo")![columnIndex]!, tons, value);
      continue;
    }
    if (!line.isLooseLpo) continue;

    const category = resolvePalmOilActivityCategoryId(
      line.saleDisposition,
      line.customerTypeCode,
      line.customerTypeName,
    );
    addCell(buckets.get(category)![columnIndex]!, tons, value);
  }

  return buckets;
}

function makeDataRows(
  buckets: Map<PalmOilActivityCategoryId, Cell[]>,
  categoryOrder: PalmOilActivityCategoryId[],
  totalToDateTons: number,
): Row[] {
  return categoryOrder.map((categoryId) => {
    const months = buckets.get(categoryId) ?? [];
    const toDate = sumCells(months);
    const label =
      categoryId === "bpo"
        ? "B P O"
        : (PALM_OIL_ACTIVITY_CUSTOMER_ROWS.find((row) => row.id === categoryId)
            ?.label ?? categoryId.toUpperCase());
    return {
      id: categoryId,
      label,
      kind: "data" as const,
      months,
      toDate,
      pctTage: totalToDateTons > 0 ? (toDate.tons / totalToDateTons) * 100 : null,
    };
  });
}

function makeTotalRow(dataRows: Row[]): Row {
  const monthCount = dataRows[0]?.months.length ?? 0;
  const months = Array.from({ length: monthCount }, (_, index) => ({
    tons: sum(dataRows.map((row) => row.months[index]?.tons ?? 0)),
    value: sum(dataRows.map((row) => row.months[index]?.value ?? 0)),
  }));
  const toDate = sumCells(months);
  return {
    id: "total",
    label: "TOTAL",
    kind: "total",
    months,
    toDate,
    pctTage: null,
  };
}

function makeAvgPriceRow(totalRow: Row): Row {
  const months = totalRow.months.map((cell) => ({
    tons: cell.tons,
    value: cell.tons > 0 ? cell.value / (cell.tons * 1000) : 0,
  }));
  const toDateValue =
    totalRow.toDate.tons > 0
      ? totalRow.toDate.value / (totalRow.toDate.tons * 1000)
      : 0;

  return {
    id: "avgPrice",
    label: "AV. S. PRICE",
    kind: "avg_price",
    months,
    toDate: { tons: totalRow.toDate.tons, value: toDateValue },
    pctTage: null,
  };
}

function makeBudgetRow(
  budgetPricePerKg: number | null,
  avgPriceRow: Row,
  monthCount: number,
): Row | null {
  if (budgetPricePerKg == null) return null;

  const actualAvg = avgPriceRow.toDate.value;
  const budgetPct =
    budgetPricePerKg > 0 && actualAvg > 0
      ? (actualAvg / budgetPricePerKg) * 100
      : null;

  return {
    id: "budget",
    label: `BUDG. ${Math.round(budgetPricePerKg)}`,
    kind: "budget",
    months: Array.from({ length: monthCount }, () => emptyCell()),
    toDate: { tons: 0, value: actualAvg },
    pctTage: budgetPct,
    budgetPricePerKg,
    budgetPct,
  };
}

function buildSection(input: {
  id: Section["id"];
  title: string;
  monthColumns: MonthColumn[];
  lines: PalmOilSaleLineRecord[];
  products: ProductRow[];
  includeBpo: boolean;
  budgetPricePerKg: number | null;
}): Section {
  const buckets = aggregateSection(
    input.lines,
    input.products,
    input.monthColumns,
    input.includeBpo,
  );

  const categoryOrder: PalmOilActivityCategoryId[] = input.includeBpo
    ? ["bpo", ...PALM_OIL_ACTIVITY_CUSTOMER_ROWS.map((row) => row.id)]
    : [...PALM_OIL_ACTIVITY_CUSTOMER_ROWS.map((row) => row.id)];

  const provisionalTotalTons = sum(
    categoryOrder.map((id) => sumCells(buckets.get(id) ?? []).tons),
  );
  const dataRows = makeDataRows(buckets, categoryOrder, provisionalTotalTons);
  const totalRow = makeTotalRow(dataRows);
  const avgPriceRow = makeAvgPriceRow(totalRow);
  const budgetRow = makeBudgetRow(
    input.budgetPricePerKg,
    avgPriceRow,
    input.monthColumns.length,
  );

  const rows: Row[] = [
    {
      id: `${input.id}-header`,
      label: input.title,
      kind: "section",
      months: input.monthColumns.map(() => emptyCell()),
      toDate: emptyCell(),
      pctTage: null,
    },
    ...dataRows.map((row) => ({
      ...row,
      pctTage:
        totalRow.toDate.tons > 0
          ? (row.toDate.tons / totalRow.toDate.tons) * 100
          : null,
    })),
    totalRow,
    avgPriceRow,
  ];
  if (budgetRow) rows.push(budgetRow);

  return {
    id: input.id,
    title: input.title,
    monthColumns: input.monthColumns,
    rows,
  };
}

export async function getPalmOilSalesActivityReport(userId: string) {
  const asAtIso = await resolveReportAsAt(undefined, userId);
  const period = await getOpenPostingPeriod(await postingScopeForUser(userId));
  if (!period) {
    throw new Error("No open posting period. Open a financial month first.");
  }

  const financialYear = period.financialYear;
  const yearFromIso = `${financialYear}-01-01`;
  const yearToIso = `${financialYear}-12-31`;
  const currentMonth = calendarMonthFromIso(asAtIso);

  const [
    settings,
    comments,
    products,
    scopedSalesPointId,
    categoryIds,
  ] = await Promise.all([
    loadReportCompanySettings(userId, asAtIso),
    loadReportComments(ROUTE_ID),
    loadProducts(),
    reportScopedSalesPointId(userId),
    loadMainAndBottledCategoryIds(),
  ]);

  const { mainProductCatId, bottledProductCatId } = categoryIds;
  const allLines = (
    await loadPalmOilSaleLines(yearFromIso, yearToIso, scopedSalesPointId)
  ).filter((line) => line.dateIssued <= asAtIso);

  const palmOilLines = allLines.filter(
    (line) => line.isBottled === 1 || line.isLooseLpo,
  );
  const looseLines = palmOilLines.filter(
    (line) => line.isLooseLpo && line.isBottled !== 1,
  );

  const looseMonthColumns = buildLooseMonthColumns(
    financialYear,
    asAtIso,
    currentMonth,
  );
  const combinedMonthColumns = buildCombinedMonthColumns(
    financialYear,
    currentMonth,
  );

  const [looseBudget, combinedBudget] = await Promise.all([
    mainProductCatId != null
      ? loadBudgetUnitPricePerKg(financialYear, mainProductCatId)
      : Promise.resolve(null),
    bottledProductCatId != null
      ? loadBudgetUnitPricePerKg(financialYear, bottledProductCatId)
      : mainProductCatId != null
        ? loadBudgetUnitPricePerKg(financialYear, mainProductCatId)
        : Promise.resolve(null),
  ]);

  return {
    settings,
    financialYear,
    asAtIso,
    reportTitle: `${financialYear} PALM OIL SALES ACTIVITY`,
    generatedAtIso: nowIso(),
    looseOilSection: buildSection({
      id: "looseOil",
      title: "LOOSE PALM OIL",
      monthColumns: looseMonthColumns,
      lines: looseLines,
      products,
      includeBpo: false,
      budgetPricePerKg: looseBudget,
    }),
    looseAndBtldSection: buildSection({
      id: "looseAndBtldOil",
      title: "LOOSE AND BTLD OIL",
      monthColumns: combinedMonthColumns,
      lines: palmOilLines,
      products,
      includeBpo: true,
      budgetPricePerKg: combinedBudget,
    }),
    comments,
  };
}
