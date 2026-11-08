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
  parseQty,
  reportScopedSalesPointId,
  type ProductRow,
} from "./reportShared.js";
import { parseLocalIso, toIsoDate } from "./weekChoices.js";

const ROUTE_ID = "bottled-palm-oil-sales-return-report";

type PackId = "jug20" | "carton5" | "carton15";
type Cell = { qty: number; amount: number };
type RowKind =
  | "bf"
  | "reception"
  | "totalStock"
  | "section"
  | "cashSales"
  | "publicRelation"
  | "totalIssues"
  | "issuesLitres"
  | "issuesKg"
  | "balance"
  | "balanceLitres"
  | "balanceKg";

const PACK_COLUMNS: Array<{ id: PackId; label: string; litresPerUnit: number }> =
  [
    { id: "jug20", label: "20L (JUG)", litresPerUnit: 20 },
    { id: "carton5", label: "3 X 5L (CARTON)", litresPerUnit: 15 },
    { id: "carton15", label: "1 X 15L (CARTON)", litresPerUnit: 15 },
  ];
const PACK_IDS = PACK_COLUMNS.map((c) => c.id);

function dayBeforeIso(isoDate: string): string {
  const date = parseLocalIso(isoDate);
  date.setDate(date.getDate() - 1);
  return toIsoDate(date);
}

function emptyCell(): Cell {
  return { qty: 0, amount: 0 };
}
function emptyPacks(): Cell[] {
  return PACK_IDS.map(() => emptyCell());
}
function isReportPack(packId: string): packId is PackId {
  return PACK_IDS.includes(packId as PackId);
}
function resolvePackId(
  product: Pick<ProductRow, "productName" | "productCode">,
): PackId | null {
  const pack = detectBottledPack(product);
  return isReportPack(pack.id) ? pack.id : null;
}
function kgForPack(qty: number, packId: PackId): number {
  const column = PACK_COLUMNS.find((entry) => entry.id === packId);
  return column ? Math.round(qty * column.litresPerUnit * PALM_OIL_KG_PER_LITRE) : 0;
}
function litresForPack(qty: number, packId: PackId): number {
  const column = PACK_COLUMNS.find((entry) => entry.id === packId);
  return qty * (column?.litresPerUnit ?? 0);
}
function rowTotalKg(packs: Cell[]): number {
  return Math.round(
    packs.reduce(
      (total, cell, index) => total + kgForPack(cell.qty, PACK_IDS[index]!),
      0,
    ),
  );
}
function rowGrandTotal(packs: Cell[]): number {
  return packs.reduce((total, cell) => total + cell.amount, 0);
}
function makeRow(
  id: string,
  label: string,
  kind: RowKind,
  packs: Cell[],
  options?: { totalKg?: number; grandTotalFcfa?: number },
) {
  return {
    id,
    label,
    kind,
    packs,
    totalKg: options?.totalKg ?? rowTotalKg(packs),
    grandTotalFcfa: options?.grandTotalFcfa ?? rowGrandTotal(packs),
  };
}
function addPackQty(packs: Cell[], packId: PackId, qty: number, amount = 0) {
  const index = PACK_IDS.indexOf(packId);
  if (index < 0) return;
  packs[index]!.qty += qty;
  packs[index]!.amount += amount;
}
function sumPackRows(
  rows: Array<{ packs: Cell[] }>,
): Cell[] {
  const packs = emptyPacks();
  for (const row of rows) {
    for (let i = 0; i < packs.length; i += 1) {
      packs[i]!.qty += row.packs[i]?.qty ?? 0;
      packs[i]!.amount += row.packs[i]?.amount ?? 0;
    }
  }
  return packs;
}
function subtractPackQty(left: Cell[], right: Cell[]): Cell[] {
  return left.map((cell, index) => ({
    qty: cell.qty - (right[index]?.qty ?? 0),
    amount: 0,
  }));
}
function convertQtyRow(
  source: Cell[],
  convert: (qty: number, packId: PackId) => number,
): Cell[] {
  return source.map((cell, index) => ({
    qty: convert(cell.qty, PACK_IDS[index]!),
    amount: 0,
  }));
}
function receptionLabel(supplierLabel: string): string {
  const trimmed = supplierLabel.trim().toUpperCase() || "UNKNOWN SUPPLIER";
  return trimmed.startsWith("RECEPTION FROM ")
    ? trimmed
    : `RECEPTION FROM ${trimmed}`;
}

async function sumSellableBottledPacks(
  products: ProductRow[],
  asOfIso: string,
  salesPointId?: number | null,
): Promise<Cell[]> {
  const bottledById = new Map(
    products
      .filter((p) => p.isBottled === 1)
      .map((p) => [p.productId, p]),
  );
  const packs = emptyPacks();
  for (const row of await loadStockBalancesAsOf(asOfIso)) {
    if (row.condition !== "SELLABLE") continue;
    if (salesPointId != null && row.salesPointId !== salesPointId) continue;
    const product = bottledById.get(row.productId);
    if (!product) continue;
    const packId = resolvePackId(product);
    if (!packId) continue;
    addPackQty(packs, packId, row.qty);
  }
  return packs;
}

async function sumCarryForwardBottledPacks(
  products: ProductRow[],
  fromIso: string,
  toIso: string,
  salesPointId?: number | null,
): Promise<Cell[]> {
  const bottledById = new Map(
    products.filter((p) => p.isBottled === 1).map((p) => [p.productId, p]),
  );
  const packs = emptyPacks();
  const from = new Date(`${fromIso}T00:00:00.000Z`);
  const to = new Date(`${toIso}T23:59:59.999Z`);
  const adjustments = await prisma.stock_adjustments.findMany({
    where: {
      source_kind: "CARRY_FORWARD",
      status: "POSTED",
      occurred_at: { gte: from, lte: to },
      ...(salesPointId != null ? { sales_point_id: salesPointId } : {}),
    },
    include: { stock_adjustment_lines: true },
  });
  for (const adj of adjustments) {
    for (const line of adj.stock_adjustment_lines) {
      const product = bottledById.get(line.product_id);
      if (!product) continue;
      const packId = resolvePackId(product);
      if (!packId) continue;
      addPackQty(packs, packId, parseQty(line.delta_qty));
    }
  }
  return packs;
}

export async function getBottledPalmOilSalesReturnReport(userId: string) {
  const asAtIso = await resolveReportAsAt();
  const period = await getOpenPostingPeriod();
  if (!period) {
    throw new Error("No open posting period. Open a financial month first.");
  }

  const [settings, comments, products, scopedSalesPointId] = await Promise.all([
    loadReportCompanySettings(userId, asAtIso),
    loadReportComments(ROUTE_ID),
    loadProducts(),
    reportScopedSalesPointId(userId),
  ]);

  const monthStartIso = period.startDate;
  const openingAsOfIso = dayBeforeIso(monthStartIso);
  const monthLabel =
    `${period.monthName} ${period.financialYear}`.toUpperCase();
  const reportTitle = `BOTTLED PALM OIL STOCKS RECONCILIATION FOR THE MONTH OF ${monthLabel} (VALUE WITHOUT TAXES)`;

  const from = new Date(`${monthStartIso}T00:00:00.000Z`);
  const to = new Date(`${asAtIso}T23:59:59.999Z`);

  const [receipts, sales, priorPacks, carryForwardPacks] = await Promise.all([
    prisma.stock_receipts.findMany({
      where: {
        status: "POSTED",
        received_at: { gte: from, lte: to },
        ...(scopedSalesPointId != null
          ? { sales_point_id: scopedSalesPointId }
          : {}),
      },
      include: { stock_receipt_lines: true },
    }),
    prisma.sales.findMany({
      where: {
        status: "VALIDATED",
        date_issued: { gte: monthStartIso, lte: asAtIso },
        ...(scopedSalesPointId != null
          ? { sales_point_id: scopedSalesPointId }
          : {}),
      },
      select: {
        sale_disposition: true,
        sale_lines: {
          select: {
            product_id: true,
            qty_units: true,
            qty_kg: true,
            line_net: true,
          },
        },
      },
    }),
    sumSellableBottledPacks(products, openingAsOfIso, scopedSalesPointId),
    sumCarryForwardBottledPacks(
      products,
      monthStartIso,
      asAtIso,
      scopedSalesPointId,
    ),
  ]);

  const productById = new Map(products.map((p) => [p.productId, p]));
  const bottledById = new Map(
    products.filter((p) => p.isBottled === 1).map((p) => [p.productId, p]),
  );

  const bySupplier = new Map<string, Cell[]>();
  for (const receipt of receipts) {
    for (const line of receipt.stock_receipt_lines) {
      const product = bottledById.get(line.product_id);
      if (!product) continue;
      const packId = resolvePackId(product);
      if (!packId) continue;
      const label = receptionLabel(receipt.supplier_label);
      let packs = bySupplier.get(label);
      if (!packs) {
        packs = emptyPacks();
        bySupplier.set(label, packs);
      }
      addPackQty(packs, packId, parseQty(line.qty));
    }
  }
  const receptionRows = [...bySupplier.entries()]
    .map(([label, packs], index) =>
      makeRow(`reception-${index}`, label, "reception", packs, {
        grandTotalFcfa: 0,
      }),
    )
    .filter((row) => Math.abs(rowTotalKg(row.packs)) > 0.0001)
    .sort((a, b) => a.label.localeCompare(b.label));

  const saleLines: Array<{
    saleDisposition: string | null;
    productId: number;
    qtyUnits: number;
    lineNet: number;
  }> = [];
  for (const sale of sales) {
    for (const line of sale.sale_lines) {
      if (!bottledById.has(line.product_id)) continue;
      saleLines.push({
        saleDisposition: sale.sale_disposition,
        productId: line.product_id,
        qtyUnits: parseQty(line.qty_units ?? line.qty_kg),
        lineNet: parseQty(line.line_net),
      });
    }
  }

  function buildIssuePacks(disposition: "NORMAL" | "PUBLIC_RELATION"): Cell[] {
    const packs = emptyPacks();
    for (const line of saleLines) {
      if ((line.saleDisposition ?? "NORMAL") !== disposition) continue;
      const product = productById.get(line.productId);
      if (!product) continue;
      const packId = resolvePackId(product);
      if (!packId) continue;
      addPackQty(packs, packId, line.qtyUnits, line.lineNet);
    }
    return packs;
  }

  const bfPacks = emptyPacks();
  for (let i = 0; i < bfPacks.length; i += 1) {
    bfPacks[i]!.qty =
      (priorPacks[i]?.qty ?? 0) + (carryForwardPacks[i]?.qty ?? 0);
  }
  const bfRow = makeRow(
    "bf",
    `B/F STOCK AS AT ${formatDisplayDate(monthStartIso)}`,
    "bf",
    bfPacks,
    { grandTotalFcfa: 0 },
  );
  const totalStockPacks = sumPackRows([bfRow, ...receptionRows]).map((cell) => ({
    qty: cell.qty,
    amount: 0,
  }));
  const totalStockRow = makeRow(
    "total-stock",
    "TOTAL STOCK",
    "totalStock",
    totalStockPacks,
    { grandTotalFcfa: 0 },
  );
  const lessIssuesRow = makeRow("less-issues", "LESS ISSUES", "section", []);
  const cashRow = makeRow(
    "cash-sales",
    "CASH SALES",
    "cashSales",
    buildIssuePacks("NORMAL"),
  );
  const prRow = makeRow(
    "public-relation",
    "GM'S PUBLIC RELATIONS",
    "publicRelation",
    buildIssuePacks("PUBLIC_RELATION"),
  );
  const totalIssuesPacks = sumPackRows([cashRow, prRow]);
  const totalIssuesRow = makeRow(
    "total-issues",
    "TOTAL ISSUES",
    "totalIssues",
    totalIssuesPacks,
  );
  const issuesLitresRow = makeRow(
    "issues-litres",
    "TOTAL ISSUES IN LITRES",
    "issuesLitres",
    convertQtyRow(totalIssuesPacks, litresForPack),
    { totalKg: 0, grandTotalFcfa: 0 },
  );
  const issuesKgRow = makeRow(
    "issues-kg",
    "TOTAL ISSUES IN KGS",
    "issuesKg",
    convertQtyRow(totalIssuesPacks, kgForPack),
    { totalKg: 0, grandTotalFcfa: 0 },
  );
  const balancePacks = subtractPackQty(totalStockPacks, totalIssuesPacks);
  const balanceRow = makeRow(
    "balance",
    `BALANCE STOCK AS @ ${formatDisplayDate(asAtIso)}`,
    "balance",
    balancePacks,
    { grandTotalFcfa: 0 },
  );
  const balanceLitresRow = makeRow(
    "balance-litres",
    "IN LITRES",
    "balanceLitres",
    convertQtyRow(balancePacks, litresForPack),
    { totalKg: 0, grandTotalFcfa: 0 },
  );
  const balanceKgRow = makeRow(
    "balance-kg",
    "IN KGS",
    "balanceKg",
    convertQtyRow(balancePacks, kgForPack),
    { totalKg: 0, grandTotalFcfa: 0 },
  );

  return {
    settings,
    asAtIso,
    monthStartIso,
    monthName: period.monthName,
    financialYear: period.financialYear,
    reportTitle,
    generatedAtIso: nowIso(),
    packColumns: PACK_COLUMNS,
    rows: [
      bfRow,
      ...receptionRows,
      totalStockRow,
      lessIssuesRow,
      cashRow,
      prRow,
      totalIssuesRow,
      issuesLitresRow,
      issuesKgRow,
      balanceRow,
      balanceLitresRow,
      balanceKgRow,
    ],
    comments,
  };
}
