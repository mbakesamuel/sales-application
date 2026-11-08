import type {
  BottledPalmOilSalesReturnCell,
  BottledPalmOilSalesReturnPackColumn,
  BottledPalmOilSalesReturnPackId,
  BottledPalmOilSalesReturnReport,
  BottledPalmOilSalesReturnRow,
  BottledPalmOilSalesReturnRowKind,
} from "../../shared/reports.types.js";
import { formatDisplayDate } from "../../shared/formatDisplayDate.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "./companySettings.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import {
  PALM_OIL_KG_PER_LITRE,
  detectBottledPack,
  loadProducts,
  nowIso,
  parseQty,
  reportScopedSalesPointId,
  salesPointFilterSql,
  type ProductRow,
} from "./shared.js";
import { getDatabase } from "../db/index.js";
import { loadStockBalancesAsOf } from "../stock/asOfBalance.js";
import { parseLocalIso, toIsoDate } from "./weekChoices.js";

const ROUTE_ID = "bottled-palm-oil-sales-return-report";

const PACK_COLUMNS: BottledPalmOilSalesReturnPackColumn[] = [
  { id: "jug20", label: "20L (JUG)", litresPerUnit: 20 },
  { id: "carton5", label: "3 X 5L (CARTON)", litresPerUnit: 15 },
  { id: "carton15", label: "1 X 15L (CARTON)", litresPerUnit: 15 },
];

const PACK_IDS = PACK_COLUMNS.map((column) => column.id);

interface ReceiptLineRecord {
  supplierLabel: string;
  productId: number;
  isBottled: number;
  qty: number;
}

interface SaleLineRecord {
  saleDisposition: string | null;
  productId: number;
  isBottled: number;
  qtyUnits: number;
  lineNet: number;
}

function dayBeforeIso(isoDate: string): string {
  const date = parseLocalIso(isoDate);
  date.setDate(date.getDate() - 1);
  return toIsoDate(date);
}

function emptyCell(): BottledPalmOilSalesReturnCell {
  return { qty: 0, amount: 0 };
}

function emptyPacks(): BottledPalmOilSalesReturnCell[] {
  return PACK_IDS.map(() => emptyCell());
}

function packIndex(packId: BottledPalmOilSalesReturnPackId): number {
  return PACK_IDS.indexOf(packId);
}

function isReportPack(
  packId: string,
): packId is BottledPalmOilSalesReturnPackId {
  return PACK_IDS.includes(packId as BottledPalmOilSalesReturnPackId);
}

function resolvePackId(
  product: Pick<ProductRow, "productName" | "productCode">,
): BottledPalmOilSalesReturnPackId | null {
  const pack = detectBottledPack(product);
  return isReportPack(pack.id) ? pack.id : null;
}

function kgForPack(qty: number, packId: BottledPalmOilSalesReturnPackId): number {
  const column = PACK_COLUMNS.find((entry) => entry.id === packId);
  if (!column) {
    return 0;
  }
  return Math.round(qty * column.litresPerUnit * PALM_OIL_KG_PER_LITRE);
}

function litresForPack(
  qty: number,
  packId: BottledPalmOilSalesReturnPackId,
): number {
  const column = PACK_COLUMNS.find((entry) => entry.id === packId);
  return qty * (column?.litresPerUnit ?? 0);
}

function rowTotalKg(packs: BottledPalmOilSalesReturnCell[]): number {
  return Math.round(
    packs.reduce(
      (total, cell, index) =>
        total + kgForPack(cell.qty, PACK_IDS[index] as BottledPalmOilSalesReturnPackId),
      0,
    ),
  );
}

function rowGrandTotal(packs: BottledPalmOilSalesReturnCell[]): number {
  return packs.reduce((total, cell) => total + cell.amount, 0);
}

function makeRow(
  id: string,
  label: string,
  kind: BottledPalmOilSalesReturnRowKind,
  packs: BottledPalmOilSalesReturnCell[],
  options?: { totalKg?: number; grandTotalFcfa?: number },
): BottledPalmOilSalesReturnRow {
  return {
    id,
    label,
    kind,
    packs,
    totalKg: options?.totalKg ?? rowTotalKg(packs),
    grandTotalFcfa: options?.grandTotalFcfa ?? rowGrandTotal(packs),
  };
}

function addPackQty(
  packs: BottledPalmOilSalesReturnCell[],
  packId: BottledPalmOilSalesReturnPackId,
  qty: number,
  amount = 0,
): void {
  const index = packIndex(packId);
  if (index < 0) {
    return;
  }
  packs[index].qty += qty;
  packs[index].amount += amount;
}

function sumPackRows(
  rows: BottledPalmOilSalesReturnRow[],
): BottledPalmOilSalesReturnCell[] {
  const packs = emptyPacks();
  for (const row of rows) {
    for (let index = 0; index < packs.length; index += 1) {
      packs[index].qty += row.packs[index]?.qty ?? 0;
      packs[index].amount += row.packs[index]?.amount ?? 0;
    }
  }
  return packs;
}

function subtractPackQty(
  left: BottledPalmOilSalesReturnCell[],
  right: BottledPalmOilSalesReturnCell[],
): BottledPalmOilSalesReturnCell[] {
  return left.map((cell, index) => ({
    qty: cell.qty - (right[index]?.qty ?? 0),
    amount: 0,
  }));
}

function convertQtyRow(
  source: BottledPalmOilSalesReturnCell[],
  convert: (qty: number, packId: BottledPalmOilSalesReturnPackId) => number,
): BottledPalmOilSalesReturnCell[] {
  return source.map((cell, index) => ({
    qty: convert(cell.qty, PACK_IDS[index] as BottledPalmOilSalesReturnPackId),
    amount: 0,
  }));
}

function receptionLabel(supplierLabel: string): string {
  const trimmed = supplierLabel.trim().toUpperCase() || "UNKNOWN SUPPLIER";
  if (trimmed.startsWith("RECEPTION FROM ")) {
    return trimmed;
  }
  return `RECEPTION FROM ${trimmed}`;
}

function loadReceiptLines(
  fromIso: string,
  toIso: string,
  salesPointId?: number | null,
): ReceiptLineRecord[] {
  const sp = salesPointFilterSql("r.salesPointId", salesPointId);
  return getDatabase()
    .prepare(
      `SELECT r.supplierLabel, l.productId,
              COALESCE(pc.isBottled, 0) AS isBottled, l.qty
       FROM StockReceipt r
       INNER JOIN StockReceiptLine l ON l.receiptId = r.id
       INNER JOIN Product p ON p.productId = l.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE r.status = 'POSTED'
         AND substr(r.receivedAt, 1, 10) >= ?
         AND substr(r.receivedAt, 1, 10) <= ?${sp.clause}`,
    )
    .all(fromIso, toIso, ...sp.params)
    .map((row) => ({
      supplierLabel: String((row as { supplierLabel: string }).supplierLabel),
      productId: (row as { productId: number }).productId,
      isBottled: (row as { isBottled: number }).isBottled,
      qty: parseQty((row as { qty: string }).qty),
    }));
}

function loadSaleLines(
  fromIso: string,
  toIso: string,
  salesPointId?: number | null,
): SaleLineRecord[] {
  const sp = salesPointFilterSql("s.salesPointId", salesPointId);
  return getDatabase()
    .prepare(
      `SELECT s.saleDisposition, sl.productId,
              COALESCE(pc.isBottled, 0) AS isBottled, sl.qtyKg, sl.qtyUnits, sl.lineNet
       FROM Sale s
       INNER JOIN SaleLine sl ON sl.saleId = s.id
       INNER JOIN Product p ON p.productId = sl.productId
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE s.status = 'VALIDATED'
         AND s.dateIssued >= ?
         AND s.dateIssued <= ?${sp.clause}`,
    )
    .all(fromIso, toIso, ...sp.params)
    .map((row) => {
      const qtyUnitsRaw = (row as { qtyUnits: string | null }).qtyUnits;
      const qtyKg = parseQty((row as { qtyKg: string }).qtyKg);
      return {
        saleDisposition: (row as { saleDisposition: string | null }).saleDisposition,
        productId: (row as { productId: number }).productId,
        isBottled: (row as { isBottled: number }).isBottled,
        qtyUnits: qtyUnitsRaw != null ? parseQty(qtyUnitsRaw) : qtyKg,
        lineNet: parseQty((row as { lineNet: string }).lineNet),
      };
    });
}

function sumSellableBottledPacks(
  products: ProductRow[],
  asOfIso: string,
  salesPointId?: number | null,
): BottledPalmOilSalesReturnCell[] {
  const bottledById = new Map(
    products
      .filter((product) => product.isBottled === 1)
      .map((product) => [product.productId, product]),
  );
  const packs = emptyPacks();
  for (const row of loadStockBalancesAsOf(getDatabase(), asOfIso)) {
    if (row.condition !== "SELLABLE") {
      continue;
    }
    if (salesPointId != null && row.salesPointId !== salesPointId) {
      continue;
    }
    const product = bottledById.get(row.productId);
    if (!product) {
      continue;
    }
    const packId = resolvePackId(product);
    if (!packId) {
      continue;
    }
    addPackQty(packs, packId, row.qty);
  }
  return packs;
}

function sumCarryForwardBottledPacks(
  products: ProductRow[],
  fromIso: string,
  toIso: string,
  salesPointId?: number | null,
): BottledPalmOilSalesReturnCell[] {
  const bottledById = new Map(
    products
      .filter((product) => product.isBottled === 1)
      .map((product) => [product.productId, product]),
  );
  const packs = emptyPacks();
  const sp = salesPointFilterSql("a.salesPointId", salesPointId);
  const rows = getDatabase()
    .prepare(
      `SELECT l.productId, l.deltaQty
       FROM StockAdjustment a
       INNER JOIN StockAdjustmentLine l ON l.adjustmentId = a.id
       WHERE a.sourceKind = 'CARRY_FORWARD'
         AND a.status = 'POSTED'
         AND substr(a.occurredAt, 1, 10) >= ?
         AND substr(a.occurredAt, 1, 10) <= ?${sp.clause}`,
    )
    .all(fromIso, toIso, ...sp.params) as Array<{
    productId: number;
    deltaQty: string;
  }>;

  for (const row of rows) {
    const product = bottledById.get(row.productId);
    if (!product) {
      continue;
    }
    const packId = resolvePackId(product);
    if (!packId) {
      continue;
    }
    addPackQty(packs, packId, parseQty(row.deltaQty));
  }
  return packs;
}

function buildReceptionRows(
  products: ProductRow[],
  receiptLines: ReceiptLineRecord[],
): BottledPalmOilSalesReturnRow[] {
  const productById = new Map(products.map((product) => [product.productId, product]));
  const bySupplier = new Map<string, BottledPalmOilSalesReturnCell[]>();

  for (const line of receiptLines) {
    if (line.isBottled !== 1) {
      continue;
    }
    const product = productById.get(line.productId);
    if (!product) {
      continue;
    }
    const packId = resolvePackId(product);
    if (!packId) {
      continue;
    }
    const label = receptionLabel(line.supplierLabel);
    let packs = bySupplier.get(label);
    if (!packs) {
      packs = emptyPacks();
      bySupplier.set(label, packs);
    }
    addPackQty(packs, packId, line.qty);
  }

  return [...bySupplier.entries()]
    .map(([label, packs], index) =>
      makeRow(`reception-${index}`, label, "reception", packs, {
        grandTotalFcfa: 0,
      }),
    )
    .filter((row) => Math.abs(rowTotalKg(row.packs)) > 0.0001)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildIssuePacks(
  products: ProductRow[],
  saleLines: SaleLineRecord[],
  disposition: "NORMAL" | "PUBLIC_RELATION",
): BottledPalmOilSalesReturnCell[] {
  const productById = new Map(products.map((product) => [product.productId, product]));
  const packs = emptyPacks();

  for (const line of saleLines) {
    if (line.isBottled !== 1) {
      continue;
    }
    if ((line.saleDisposition ?? "NORMAL") !== disposition) {
      continue;
    }
    const product = productById.get(line.productId);
    if (!product) {
      continue;
    }
    const packId = resolvePackId(product);
    if (!packId) {
      continue;
    }
    addPackQty(packs, packId, line.qtyUnits, line.lineNet);
  }

  return packs;
}

export function getBottledPalmOilSalesReturnReport(
  userId?: string,
): BottledPalmOilSalesReturnReport {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const settings = loadReportCompanySettings(userId, asAtIso);
  const comments = loadReportComments(ROUTE_ID);
  const products = loadProducts();
  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const monthStartIso = period.startDate;
  const openingAsOfIso = dayBeforeIso(monthStartIso);
  const monthLabel = `${period.monthName} ${period.financialYear}`.toUpperCase();
  const reportTitle = `BOTTLED PALM OIL STOCKS RECONCILIATION FOR THE MONTH OF ${monthLabel} (VALUE WITHOUT TAXES)`;

  const receiptLines = loadReceiptLines(
    monthStartIso,
    asAtIso,
    scopedSalesPointId,
  );
  const saleLines = loadSaleLines(monthStartIso, asAtIso, scopedSalesPointId);

  const priorPacks = sumSellableBottledPacks(
    products,
    openingAsOfIso,
    scopedSalesPointId,
  );
  const carryForwardPacks = sumCarryForwardBottledPacks(
    products,
    monthStartIso,
    asAtIso,
    scopedSalesPointId,
  );
  const bfPacks = emptyPacks();
  for (let index = 0; index < bfPacks.length; index += 1) {
    bfPacks[index].qty =
      (priorPacks[index]?.qty ?? 0) + (carryForwardPacks[index]?.qty ?? 0);
  }

  const bfRow = makeRow(
    "bf",
    `B/F STOCK AS AT ${formatDisplayDate(monthStartIso)}`,
    "bf",
    bfPacks,
    { grandTotalFcfa: 0 },
  );

  const receptionRows = buildReceptionRows(products, receiptLines);
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

  const cashPacks = buildIssuePacks(products, saleLines, "NORMAL");
  const cashRow = makeRow("cash-sales", "CASH SALES", "cashSales", cashPacks);

  const prPacks = buildIssuePacks(products, saleLines, "PUBLIC_RELATION");
  const prRow = makeRow(
    "public-relation",
    "GM'S PUBLIC RELATIONS",
    "publicRelation",
    prPacks,
  );

  const totalIssuesPacks = sumPackRows([cashRow, prRow]);
  const totalIssuesRow = makeRow(
    "total-issues",
    "TOTAL ISSUES",
    "totalIssues",
    totalIssuesPacks,
  );

  const issuesLitresPacks = convertQtyRow(totalIssuesPacks, litresForPack);
  const issuesLitresRow = makeRow(
    "issues-litres",
    "TOTAL ISSUES IN LITRES",
    "issuesLitres",
    issuesLitresPacks,
    {
      totalKg: 0,
      grandTotalFcfa: 0,
    },
  );

  const issuesKgPacks = convertQtyRow(totalIssuesPacks, kgForPack);
  const issuesKgRow = makeRow(
    "issues-kg",
    "TOTAL ISSUES IN KGS",
    "issuesKg",
    issuesKgPacks,
    {
      totalKg: 0,
      grandTotalFcfa: 0,
    },
  );

  const balancePacks = subtractPackQty(totalStockPacks, totalIssuesPacks);
  const balanceRow = makeRow(
    "balance",
    `BALANCE STOCK AS @ ${formatDisplayDate(asAtIso)}`,
    "balance",
    balancePacks,
    { grandTotalFcfa: 0 },
  );

  const balanceLitresPacks = convertQtyRow(balancePacks, litresForPack);
  const balanceLitresRow = makeRow(
    "balance-litres",
    "IN LITRES",
    "balanceLitres",
    balanceLitresPacks,
    {
      totalKg: 0,
      grandTotalFcfa: 0,
    },
  );

  const balanceKgPacks = convertQtyRow(balancePacks, kgForPack);
  const balanceKgRow = makeRow(
    "balance-kg",
    "IN KGS",
    "balanceKg",
    balanceKgPacks,
    {
      totalKg: 0,
      grandTotalFcfa: 0,
    },
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
