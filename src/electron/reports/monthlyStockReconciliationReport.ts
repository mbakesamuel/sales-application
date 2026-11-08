import type {
  MonthlyStockReconciliationMatrixRow,
  MonthlyStockReconciliationReport,
} from "../../shared/reports.types.js";
import { formatDisplayDate } from "../../shared/formatDisplayDate.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "./companySettings.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import {
  addVectors,
  dayBeforeIso,
  isLooseLpo,
  loadLpoReceiptLines,
  loadLpoSaleLines,
  subtractVectors,
  sumCarryForwardLpoInRange,
  sumLpoBySalesPoint,
  type LpoReceiptLineRecord,
  type LpoSaleLineRecord,
} from "./looseLpoReconciliationMetrics.js";
import {
  PALM_OIL_KG_PER_LITRE,
  detectBottledPack,
  loadProducts,
  loadSalesPointsForUser,
  nowIso,
  reportScopedSalesPointId,
  type ProductRow,
  type SalesPointRow,
} from "./shared.js";
import { getDatabase } from "../db/index.js";
import { loadStockBalancesAsOf } from "../stock/asOfBalance.js";

const ISSUE_CATEGORY_ROWS = [
  { id: "industries", label: "INDUSTRIES" },
  { id: "wholesales", label: "WHOLESALES" },
  { id: "retail", label: "RETAIL" },
  { id: "estates", label: "ESTATES/SERVICES" },
  { id: "staff", label: "STAFF" },
  { id: "makoko", label: "MAKOKO FARMS" },
] as const;

const OTHER_PRODUCT_ROWS = [
  {
    id: "pko",
    label: "PALM KERNEL OIL ISSUED",
    match: (product: ProductRow) => {
      const text = productNameUpper(product);
      return text.includes("KERNEL OIL") || /\bPKO\b/.test(text);
    },
  },
  {
    id: "pkc",
    label: "PALM KERNEL CAKE ISSUED",
    match: (product: ProductRow) => {
      const text = productNameUpper(product);
      return text.includes("KERNEL CAKE") || /\bPKC\b/.test(text);
    },
  },
  {
    id: "cracked",
    label: "CRACKED PALM KERNEL DELIVERED",
    match: (product: ProductRow) => {
      const text = productNameUpper(product);
      if (
        text.includes("KERNEL OIL") ||
        text.includes("KERNEL CAKE") ||
        /\bPKO\b/.test(text) ||
        /\bPKC\b/.test(text)
      ) {
        return false;
      }
      return text.includes("CRACKED") && !text.includes("UNCRACKED");
    },
  },
  {
    id: "uncracked",
    label: "UNCRACKED PALM KERNEL DELIVERED",
    match: (product: ProductRow) =>
      productNameUpper(product).includes("UNCRACKED"),
  },
  {
    id: "selected_nuts",
    label: "SELECTED NUTS",
    match: (product: ProductRow) => {
      const text = productNameUpper(product);
      return text.includes("SELECTED NUT") || text.includes("SELECTED NUTS");
    },
  },
] as const;

type SaleLineRecord = LpoSaleLineRecord;
type ReceiptLineRecord = LpoReceiptLineRecord;

function productNameUpper(
  product: Pick<ProductRow, "productName" | "productCode">,
): string {
  return `${product.productName} ${product.productCode ?? ""}`.toUpperCase();
}

function spKey(salesPointId: number): string {
  return String(salesPointId);
}

function zeroValues(
  salesPoints: SalesPointRow[],
): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  for (const salesPoint of salesPoints) {
    values[spKey(salesPoint.id)] = 0;
  }
  return values;
}

function blankValues(
  salesPoints: SalesPointRow[],
): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  for (const salesPoint of salesPoints) {
    values[spKey(salesPoint.id)] = null;
  }
  return values;
}

function rowTotal(values: Record<string, number | null>): number | null {
  let hasNumber = false;
  let total = 0;
  for (const value of Object.values(values)) {
    if (value != null) {
      hasNumber = true;
      total += value;
    }
  }
  return hasNumber ? total : null;
}

function makeRow(
  label: string,
  kind: MonthlyStockReconciliationMatrixRow["kind"],
  values: Record<string, number | null>,
): MonthlyStockReconciliationMatrixRow {
  return {
    label,
    kind,
    valuesBySalesPointId: values,
    total: kind === "blank" ? null : rowTotal(values),
  };
}

function resolveIssueCategoryId(
  saleDisposition: string | null,
  customerTypeCode: string,
  customerTypeName: string,
): (typeof ISSUE_CATEGORY_ROWS)[number]["id"] {
  if (saleDisposition === "RATION") {
    return "staff";
  }

  const text = `${customerTypeCode} ${customerTypeName}`.toUpperCase();
  if (text.includes("MAKOKO")) {
    return "makoko";
  }
  if (text.includes("ESTATE") || text.includes("SERVICE")) {
    return "estates";
  }
  if (
    text.includes("STAFF") ||
    text.includes("WORKER") ||
    text.includes("RATION")
  ) {
    return "staff";
  }
  if (text.includes("WHOLESALE")) {
    return "wholesales";
  }
  if (text.includes("RETAIL")) {
    return "retail";
  }
  if (text.includes("INDUSTR")) {
    return "industries";
  }
  return "staff";
}

function bottledUnitsToKg(units: number, product: ProductRow): number {
  return (
    units * detectBottledPack(product).litresPerUnit * PALM_OIL_KG_PER_LITRE
  );
}

function bottledLineKg(
  line: SaleLineRecord,
  product: ProductRow | undefined,
): number {
  if (!product) {
    return line.qtyKg;
  }
  const units = line.qtyUnits ?? line.qtyKg;
  return bottledUnitsToKg(units, product);
}

function sumSellableBottledBySalesPoint(
  salesPoints: SalesPointRow[],
  products: ProductRow[],
  asOfIso: string,
): Record<string, number | null> {
  const bottledById = new Map(
    products
      .filter((product) => product.isBottled === 1)
      .map((product) => [product.productId, product]),
  );
  const values = zeroValues(salesPoints);
  for (const row of loadStockBalancesAsOf(getDatabase(), asOfIso)) {
    if (row.condition !== "SELLABLE") {
      continue;
    }
    const product = bottledById.get(row.productId);
    if (!product) {
      continue;
    }
    const key = spKey(row.salesPointId);
    if (key in values) {
      values[key] = (values[key] ?? 0) + bottledUnitsToKg(row.qty, product);
    }
  }
  return values;
}

function buildReceptionRows(
  salesPoints: SalesPointRow[],
  receiptLines: ReceiptLineRecord[],
  hideZero: boolean,
): MonthlyStockReconciliationMatrixRow[] {
  const lpoLines = receiptLines.filter((line) => isLooseLpo(line));
  const bySupplier = new Map<string, Record<string, number | null>>();

  for (const line of lpoLines) {
    const label = line.supplierLabel.trim().toUpperCase() || "UNKNOWN SUPPLIER";
    let values = bySupplier.get(label);
    if (!values) {
      values = zeroValues(salesPoints);
      bySupplier.set(label, values);
    }
    const key = spKey(line.salesPointId);
    if (key in values) {
      values[key] = (values[key] ?? 0) + line.qty;
    }
  }

  return [...bySupplier.entries()]
    .map(([label, values]) => makeRow(label, "data", values))
    .filter((row) => !hideZero || Math.abs(row.total ?? 0) > 0.0001)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function sumDataRows(
  salesPoints: SalesPointRow[],
  rows: MonthlyStockReconciliationMatrixRow[],
): Record<string, number | null> {
  const values = zeroValues(salesPoints);
  for (const row of rows) {
    for (const salesPoint of salesPoints) {
      const key = spKey(salesPoint.id);
      values[key] = (values[key] ?? 0) + (row.valuesBySalesPointId[key] ?? 0);
    }
  }
  return values;
}

function buildIssueRows(
  salesPoints: SalesPointRow[],
  saleLines: SaleLineRecord[],
  hideZero: boolean,
): MonthlyStockReconciliationMatrixRow[] {
  const looseLines = saleLines.filter((line) => isLooseLpo(line));

  return ISSUE_CATEGORY_ROWS.map((category) => {
    const values = zeroValues(salesPoints);
    for (const line of looseLines) {
      if (
        resolveIssueCategoryId(
          line.saleDisposition,
          line.customerTypeCode,
          line.customerTypeName,
        ) !== category.id
      ) {
        continue;
      }
      if (line.salesPointId == null) {
        continue;
      }
      const key = spKey(line.salesPointId);
      if (key in values) {
        values[key] = (values[key] ?? 0) + line.qtyKg;
      }
    }
    return makeRow(category.label, "data", values);
  }).filter((row) => !hideZero || Math.abs(row.total ?? 0) > 0.0001);
}

function buildOtherRows(
  salesPoints: SalesPointRow[],
  saleLines: SaleLineRecord[],
  products: ProductRow[],
  hideZero: boolean,
): MonthlyStockReconciliationMatrixRow[] {
  const productById = new Map(
    products.map((product) => [product.productId, product]),
  );

  return OTHER_PRODUCT_ROWS.map((definition) => {
    const values = zeroValues(salesPoints);
    for (const line of saleLines) {
      if (line.isBottled === 1 || isLooseLpo(line)) {
        continue;
      }
      const product = productById.get(line.productId);
      if (!product || !definition.match(product)) {
        continue;
      }
      if (line.salesPointId == null) {
        continue;
      }
      const key = spKey(line.salesPointId);
      if (key in values) {
        values[key] = (values[key] ?? 0) + line.qtyKg;
      }
    }
    const row = makeRow(definition.label, "data", values);
    if (hideZero && Math.abs(row.total ?? 0) <= 0.0001) {
      return makeRow(definition.label, "data", blankValues(salesPoints));
    }
    return row;
  });
}

export function getMonthlyStockReconciliationReport(
  userId?: string | null,
  hideZeroArg?: boolean | null,
): MonthlyStockReconciliationReport {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const settings = loadReportCompanySettings(userId, asAtIso);
  const hideZero = hideZeroArg ?? true;
  const salesPoints = loadSalesPointsForUser(userId);
  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const products = loadProducts();
  const monthStartIso = period.startDate;
  const openingAsOfIso = dayBeforeIso(monthStartIso);
  const monthLabel =
    `${period.monthName} ${period.financialYear}`.toUpperCase();
  const reportTitle = `STOCK RECONCILIATION FOR ${monthLabel} (IN KGS)`;

  const saleLines = loadLpoSaleLines(monthStartIso, asAtIso, scopedSalesPointId);
  const receiptLines = loadLpoReceiptLines(monthStartIso, asAtIso, scopedSalesPointId);

  const priorOpeningValues = sumLpoBySalesPoint(
    salesPoints,
    products,
    openingAsOfIso,
  );
  const carryForwardOpeningValues = sumCarryForwardLpoInRange(
    salesPoints,
    products,
    monthStartIso,
    asAtIso,
  );
  const openingValues = addVectors(
    salesPoints,
    priorOpeningValues,
    carryForwardOpeningValues,
  );
  const openingRow = makeRow(
    `OPENING STOCK AS AT ${formatDisplayDate(monthStartIso)}`,
    "data",
    openingValues,
  );

  const receptionRows = buildReceptionRows(salesPoints, receiptLines, hideZero);
  const totalReceptionValues = sumDataRows(salesPoints, receptionRows);
  const totalReceptionRow = makeRow(
    "TOTAL RECEPTION - LPO",
    "total",
    totalReceptionValues,
  );
  const openingPlusReceptionValues = addVectors(
    salesPoints,
    openingValues,
    totalReceptionValues,
  );
  const openingPlusReceptionRow = makeRow(
    "TOTAL (OPENING + RECEPTION)",
    "subtotal",
    openingPlusReceptionValues,
  );

  const issueRows = buildIssueRows(salesPoints, saleLines, hideZero);
  const totalIssuesValues = sumDataRows(salesPoints, issueRows);
  const totalIssuesRow = makeRow("TOTAL", "total", totalIssuesValues);

  const calculatedValues = subtractVectors(
    salesPoints,
    openingPlusReceptionValues,
    totalIssuesValues,
  );
  const calculatedStockRow = makeRow(
    "CALCULATED STOCK",
    "subtotal",
    calculatedValues,
  );
  const physicalStockRow = makeRow(
    `PHYSICAL STOCK AS AT ${formatDisplayDate(asAtIso)}`,
    "blank",
    blankValues(salesPoints),
  );
  const varianceRow = makeRow(
    "STOCK VARIANCE",
    "blank",
    blankValues(salesPoints),
  );

  const productById = new Map(
    products.map((product) => [product.productId, product]),
  );
  const bottledIssuedValues = zeroValues(salesPoints);
  for (const line of saleLines) {
    if (line.isBottled !== 1 || line.salesPointId == null) {
      continue;
    }
    const key = spKey(line.salesPointId);
    if (key in bottledIssuedValues) {
      bottledIssuedValues[key] =
        (bottledIssuedValues[key] ?? 0) +
        bottledLineKg(line, productById.get(line.productId));
    }
  }
  const bottledCfValues = sumSellableBottledBySalesPoint(
    salesPoints,
    products,
    asAtIso,
  );

  const bpoRows = [
    makeRow("BOTTLED PALM OIL ISSUED IN KGS", "data", bottledIssuedValues),
    makeRow("BOTTLED PALM OIL STOCK C/F IN KGS", "data", bottledCfValues),
  ];

  const otherRows = buildOtherRows(salesPoints, saleLines, products, hideZero);

  return {
    settings,
    asAtIso,
    monthStartIso,
    monthLabel,
    reportTitle,
    generatedAtIso: nowIso(),
    salesPointIds: salesPoints.map((salesPoint) => salesPoint.id),
    salesPointNames: salesPoints.map((salesPoint) =>
      salesPoint.name.toUpperCase(),
    ),
    openingRow,
    receptionSectionTitle: "RECEPTION — LOOSE PALM OIL - LPO",
    receptionRows,
    totalReceptionRow,
    openingPlusReceptionRow,
    issuesSectionTitle: "ISSUES TO CUSTOMERS — LOOSE PALM OIL - LPO",
    issueRows,
    totalIssuesRow,
    calculatedStockRow,
    physicalStockRow,
    varianceRow,
    bpoSectionTitle: "BOTTLED PALM OIL - BPO",
    bpoRows,
    otherSectionTitle: "OTHER PRODUCTS / PALM KERNEL",
    otherRows,
    comments: loadReportComments("monthly-stock-reconciliation-report"),
  };
}
