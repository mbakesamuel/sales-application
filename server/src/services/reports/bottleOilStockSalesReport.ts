import { prisma } from "../../db/prisma.js";
import { getOpenPostingPeriod } from "../financialYearsService.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  resolveReportAsAt,
} from "../reportCompany.js";
import { loadStockBalancesAsOf } from "./stockBalancesAsOf.js";
import {
  PALM_OIL_KG_PER_LITRE,
  detectBottledPack,
  formatDisplayDate,
  loadProducts,
  loadSalesPointsForUser,
  parseQty,
  reportScopedSalesPointId,
  sum,
  type ProductRow,
  type SalesPointRow,
} from "./reportShared.js";

const STOCK_PACK_COLUMNS = [
  {
    id: "carton15",
    unitLabel: "1LX15 CRTN",
    kgLabel: "1L X 15",
    litresPerUnit: 15,
    packIds: ["carton15", "unit1"] as const,
  },
  {
    id: "carton5",
    unitLabel: "3 X 5L CRTN",
    kgLabel: "3 X 5L",
    litresPerUnit: 15,
    packIds: ["carton5"] as const,
  },
  {
    id: "jug20",
    unitLabel: "1X 20L JUG",
    kgLabel: "1X 20L",
    litresPerUnit: 20,
    packIds: ["jug20"] as const,
  },
] as const;

const SALES_COLUMNS = [
  { id: "1L", label: "1 L", packIds: ["unit1", "carton15"] as const },
  { id: "5L", label: "5 L", packIds: ["carton5"] as const },
  { id: "20L", label: "20 L", packIds: ["jug20"] as const },
] as const;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function packIdForProduct(product: ProductRow): string {
  return detectBottledPack(product).id;
}

function salesColumnIndexForPack(packId: string): number {
  const index = SALES_COLUMNS.findIndex((column) =>
    (column.packIds as readonly string[]).includes(packId),
  );
  return index >= 0 ? index : 0;
}

function stockColumnIndexForPack(packId: string): number {
  const index = STOCK_PACK_COLUMNS.findIndex((column) =>
    (column.packIds as readonly string[]).includes(packId),
  );
  return index >= 0 ? index : 0;
}

function unitsToKg(units: number, litresPerUnit: number): number {
  return units * litresPerUnit * PALM_OIL_KG_PER_LITRE;
}

async function loadBottledStockBalances(asAtIso: string) {
  const bottledProductIds = new Set(
    (await loadProducts())
      .filter((p) => p.isBottled === 1)
      .map((p) => p.productId),
  );
  const totals = new Map<string, number>();
  for (const row of await loadStockBalancesAsOf(asAtIso)) {
    if (row.condition !== "SELLABLE" || !bottledProductIds.has(row.productId)) {
      continue;
    }
    const key = `${row.salesPointId}:${row.productId}`;
    totals.set(key, (totals.get(key) ?? 0) + row.qty);
  }
  return [...totals.entries()].map(([key, qty]) => {
    const [salesPointId, productId] = key
      .split(":")
      .map((value) => Number.parseInt(value, 10));
    return { salesPointId, productId, qty };
  });
}

function buildStockSection(
  salesPoints: SalesPointRow[],
  products: ProductRow[],
  balances: Array<{ salesPointId: number; productId: number; qty: number }>,
  asAtIso: string,
  hideZero: boolean,
) {
  const bottledProducts = products.filter((product) => product.isBottled === 1);
  const columns = STOCK_PACK_COLUMNS.map(
    ({ packIds: _packIds, ...column }) => column,
  );
  const title =
    `1. BOTTLED PALM OIL STOCKS - AS AT ${formatDisplayDate(asAtIso)}`.toUpperCase();

  const dataRows = salesPoints
    .map((salesPoint) => {
      const unitCounts = STOCK_PACK_COLUMNS.map(() => 0);
      const kgCounts = STOCK_PACK_COLUMNS.map(() => 0);

      for (const product of bottledProducts) {
        const packId = packIdForProduct(product);
        const columnIndex = stockColumnIndexForPack(packId);
        const units =
          balances.find(
            (balance) =>
              balance.salesPointId === salesPoint.id &&
              balance.productId === product.productId,
          )?.qty ?? 0;
        const column = STOCK_PACK_COLUMNS[columnIndex]!;
        unitCounts[columnIndex]! += units;
        kgCounts[columnIndex]! += unitsToKg(units, column.litresPerUnit);
      }

      return {
        salesPointName: salesPoint.name.toUpperCase(),
        unitCounts,
        kgCounts,
        rowTotalUnits: sum(unitCounts),
        rowTotalKg: sum(kgCounts),
        kind: "data" as const,
      };
    })
    .filter(
      (row) =>
        !hideZero ||
        Math.abs(row.rowTotalUnits) > 0.0001 ||
        Math.abs(row.rowTotalKg) > 0.0001,
    );

  const unitColumnTotals = STOCK_PACK_COLUMNS.map((_, columnIndex) =>
    sum(dataRows.map((row) => row.unitCounts[columnIndex])),
  );
  const kgColumnTotals = STOCK_PACK_COLUMNS.map((_, columnIndex) =>
    sum(dataRows.map((row) => row.kgCounts[columnIndex])),
  );
  const grandTotalKg = sum(kgColumnTotals);

  return {
    title,
    columns,
    rows: [
      ...dataRows,
      {
        salesPointName: "TOTAL",
        unitCounts: unitColumnTotals,
        kgCounts: kgColumnTotals,
        rowTotalUnits: sum(unitColumnTotals),
        rowTotalKg: grandTotalKg,
        kind: "total" as const,
      },
    ],
    unitColumnTotals,
    kgColumnTotals,
    grandTotalKg,
  };
}

async function loadBottledSaleLines(
  salesFromIso: string,
  salesToIso: string,
  salesPointId?: number | null,
) {
  const rows = await prisma.sales.findMany({
    where: {
      status: "VALIDATED",
      date_issued: { gte: salesFromIso, lte: salesToIso },
      ...(salesPointId != null ? { sales_point_id: salesPointId } : {}),
    },
    select: {
      date_issued: true,
      sale_lines: {
        select: {
          product_id: true,
          qty_units: true,
          qty_kg: true,
          line_net: true,
        },
      },
    },
  });

  const bottledIds = new Set(
    (await loadProducts())
      .filter((p) => p.isBottled === 1)
      .map((p) => p.productId),
  );

  const out: Array<{
    dateIssued: string;
    productId: number;
    units: number;
    lineNet: number;
  }> = [];
  for (const sale of rows) {
    for (const line of sale.sale_lines) {
      if (!bottledIds.has(line.product_id)) continue;
      out.push({
        dateIssued: String(sale.date_issued).slice(0, 10),
        productId: line.product_id,
        units: parseQty(line.qty_units ?? line.qty_kg),
        lineNet: parseQty(line.line_net),
      });
    }
  }
  return out;
}

function monthLabel(year: number, monthIndex: number): string {
  return `${MONTH_NAMES[monthIndex]}-${String(year).slice(-2)}`;
}

async function buildSalesSection(
  products: ProductRow[],
  salesFromIso: string,
  salesToIso: string,
  hideZero: boolean,
  salesPointId?: number | null,
) {
  const bottledProducts = products.filter((product) => product.isBottled === 1);
  const productPackById = new Map(
    bottledProducts.map((product) => [
      product.productId,
      packIdForProduct(product),
    ]),
  );
  const columns = SALES_COLUMNS.map(({ id, label }) => ({ id, label }));
  const saleLines = await loadBottledSaleLines(
    salesFromIso,
    salesToIso,
    salesPointId,
  );

  const fromDate = new Date(`${salesFromIso}T00:00:00`);
  const toDate = new Date(`${salesToIso}T00:00:00`);
  const year = fromDate.getFullYear();
  const monthRows = [];

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthStart = new Date(year, monthIndex, 1);
    if (monthStart > toDate) break;

    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const linesForMonth = saleLines.filter(
      (line) => line.dateIssued.slice(0, 7) === monthKey,
    );

    const kgs = SALES_COLUMNS.map(() => 0);
    const values = SALES_COLUMNS.map(() => 0);

    for (const line of linesForMonth) {
      const packId = productPackById.get(line.productId);
      if (!packId) continue;
      const columnIndex = salesColumnIndexForPack(packId);
      const stockColumn =
        STOCK_PACK_COLUMNS[stockColumnIndexForPack(packId)]!;
      kgs[columnIndex]! += unitsToKg(line.units, stockColumn.litresPerUnit);
      values[columnIndex]! += line.lineNet;
    }

    monthRows.push({
      label: monthLabel(year, monthIndex),
      kgs,
      values,
      rowTotalKg: sum(kgs),
      rowTotalValue: sum(values),
      kind: "month" as const,
    });
  }

  const activeMonthRows = monthRows.filter(
    (row) =>
      !hideZero ||
      Math.abs(row.rowTotalKg) > 0.0001 ||
      Math.abs(row.rowTotalValue) > 0.0001,
  );

  const totalKgs = SALES_COLUMNS.map((_, columnIndex) =>
    sum(activeMonthRows.map((row) => row.kgs[columnIndex])),
  );
  const totalValues = SALES_COLUMNS.map((_, columnIndex) =>
    sum(activeMonthRows.map((row) => row.values[columnIndex])),
  );
  const grandTotalKg = sum(totalKgs);
  const grandTotalValue = sum(totalValues);
  const percentageKgs = totalKgs.map((kg) =>
    grandTotalKg > 0 ? (kg / grandTotalKg) * 100 : 0,
  );
  const percentageValues = totalValues.map((value) =>
    grandTotalValue > 0 ? (value / grandTotalValue) * 100 : 0,
  );

  return {
    title:
      `2. SALES FROM ${formatDisplayDate(salesFromIso)} TO DATE ${formatDisplayDate(salesToIso)}`.toUpperCase(),
    salesFromIso,
    salesToIso,
    columns,
    rows: [
      ...activeMonthRows,
      {
        label: "TOTAL (KGs)",
        kgs: totalKgs,
        values: totalValues,
        rowTotalKg: grandTotalKg,
        rowTotalValue: grandTotalValue,
        kind: "total" as const,
      },
      {
        label: "%TAGE",
        kgs: percentageKgs,
        values: percentageValues,
        rowTotalKg: grandTotalKg > 0 ? 100 : 0,
        rowTotalValue: grandTotalValue > 0 ? 100 : 0,
        kind: "percentage" as const,
      },
      {
        label: "VALUE (FCFA) WITHOUT TAX",
        kgs: totalKgs,
        values: totalValues,
        rowTotalKg: grandTotalKg,
        rowTotalValue: grandTotalValue,
        kind: "value" as const,
      },
      {
        label: "%",
        kgs: percentageKgs,
        values: percentageValues,
        rowTotalKg: grandTotalKg > 0 ? 100 : 0,
        rowTotalValue: grandTotalValue > 0 ? 100 : 0,
        kind: "value_percentage" as const,
      },
    ],
  };
}

export async function getBottleOilStockSalesReport(
  userId: string,
  hideZeroArg?: boolean | null,
  asAtIsoArg?: string | null,
) {
  const defaultAsAt = await resolveReportAsAt();
  const period = await getOpenPostingPeriod();
  if (!period) {
    throw new Error("No open posting period. Open a financial month first.");
  }

  let asAtIso = defaultAsAt;
  if (
    typeof asAtIsoArg === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(asAtIsoArg.trim())
  ) {
    const raw = asAtIsoArg.trim().slice(0, 10);
    if (raw < period.startDate) asAtIso = period.startDate;
    else if (raw > period.endDate) asAtIso = period.endDate;
    else asAtIso = raw;
  }

  const hideZero = hideZeroArg ?? true;
  const [settings, salesPoints, products, balances, scopedSalesPointId, comments] =
    await Promise.all([
      loadReportCompanySettings(userId, asAtIso),
      loadSalesPointsForUser(userId),
      loadProducts(),
      loadBottledStockBalances(asAtIso),
      reportScopedSalesPointId(userId),
      loadReportComments("bottle-oil-stock-sales-report"),
    ]);

  const salesFromIso = `${period.financialYear}-01-01`;
  return {
    settings,
    asAtIso,
    generatedAtIso: nowIso(),
    stockSection: buildStockSection(
      salesPoints,
      products,
      balances,
      asAtIso,
      hideZero,
    ),
    salesSection: await buildSalesSection(
      products,
      salesFromIso,
      asAtIso,
      hideZero,
      scopedSalesPointId,
    ),
    comments,
  };
}
