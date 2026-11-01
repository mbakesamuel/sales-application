import type {
  BottledPackColumn,
  StockCommitmentBottledSection,
  StockCommitmentReport,
  StockCommitmentReportRow,
  StockCommitmentReportSection,
} from "../../shared/reports.types.js";
import { isSludgeMemberReportProduct, isSludgePoolReportProduct } from "../../shared/looseLpoProduct.js";
import {
  LOOSE_PALM_OIL_PRODUCT_NAME,
  PALM_SLUDGE_OIL_REPORT_BUCKET_NAME,
} from "../../shared/stockIntakeGroups.js";
import type Database from "better-sqlite3";
import { getDatabase } from "../db/index.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import { loadStockBalancesAsOf } from "../stock/asOfBalance.js";
import { getSludgeOilPoolProductId } from "../stock/stockIntakeMigration.js";
import { loadCommitmentMetricsAsOf } from "./commitmentAsOf.js";
import { loadReportCompanySettings, loadReportComments } from "./companySettings.js";
import {
  loadSalesPointsForUser,
  reportScopedSalesPointId,
  type SalesPointRow,
} from "./shared.js";

const PALM_OIL_KG_PER_LITRE = 0.85;

interface CategoryRow {
  productCatId: number;
  productCat: string;
  isMain: number;
  isBottled: number;
}

interface ProductRow {
  productId: number;
  productName: string;
  productCode: string | null;
  productCatId: number;
  uom: string;
}

interface MetricRow {
  salesPointId: number;
  productId: number;
  qty: number;
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function parseQty(value: string | number | null | undefined): number {
  if (value == null) {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function loadCategories(): CategoryRow[] {
  return getDatabase()
    .prepare(
      `SELECT productCatId, productCat, isMain, isBottled
       FROM ProductCat
       ORDER BY isMain DESC, productCat ASC`,
    )
    .all() as CategoryRow[];
}

function loadProducts(): ProductRow[] {
  return getDatabase()
    .prepare(
      `SELECT productId, productName, productCode, productCatId, uom
       FROM Product
       ORDER BY productName ASC`,
    )
    .all() as ProductRow[];
}

function loadStockMetrics(asAtIso: string): MetricRow[] {
  const totals = new Map<string, number>();
  for (const row of loadStockBalancesAsOf(getDatabase(), asAtIso)) {
    if (row.condition !== "SELLABLE") {
      continue;
    }
    const key = `${row.salesPointId}:${row.productId}`;
    totals.set(key, (totals.get(key) ?? 0) + row.qty);
  }
  return [...totals.entries()].map(([key, qty]) => {
    const [salesPointId, productId] = key.split(":").map((value) => Number.parseInt(value, 10));
    return { salesPointId, productId, qty };
  });
}

function loadCommitmentMetrics(
  asAtIso: string,
  salesPointId?: number | null,
): MetricRow[] {
  return loadCommitmentMetricsAsOf(getDatabase(), asAtIso, { salesPointId });
}

function metricForProductAtSalesPoint(
  productId: number,
  salesPointId: number,
  stockMetrics: MetricRow[],
  commitmentMetrics: MetricRow[],
): { stockKg: number; commitmentKg: number; balanceKg: number } {
  const stockKg =
    stockMetrics.find(
      (metric) => metric.salesPointId === salesPointId && metric.productId === productId,
    )?.qty ?? 0;
  const commitmentKg =
    commitmentMetrics.find(
      (metric) => metric.salesPointId === salesPointId && metric.productId === productId,
    )?.qty ?? 0;
  return {
    stockKg,
    commitmentKg,
    balanceKg: stockKg - commitmentKg,
  };
}

function metricForProductsAtSalesPoint(
  stockProductIds: number[],
  commitmentProductIds: number[],
  salesPointId: number,
  stockMetrics: MetricRow[],
  commitmentMetrics: MetricRow[],
): { stockKg: number; commitmentKg: number; balanceKg: number } {
  let stockKg = 0;
  let commitmentKg = 0;
  for (const productId of stockProductIds) {
    stockKg +=
      stockMetrics.find(
        (metric) => metric.salesPointId === salesPointId && metric.productId === productId,
      )?.qty ?? 0;
  }
  for (const productId of commitmentProductIds) {
    commitmentKg +=
      commitmentMetrics.find(
        (metric) => metric.salesPointId === salesPointId && metric.productId === productId,
      )?.qty ?? 0;
  }
  return {
    stockKg,
    commitmentKg,
    balanceKg: stockKg - commitmentKg,
  };
}

function isSludgeMemberProduct(product: ProductRow): boolean {
  return isSludgeMemberReportProduct({
    productCode: product.productCode,
    productName: product.productName,
  });
}

function isSludgePoolProduct(product: ProductRow): boolean {
  return isSludgePoolReportProduct({
    productCode: product.productCode,
    productName: product.productName,
    isBottled: 0,
  });
}

function resolveSludgeMemberProductIds(products: ProductRow[]): number[] {
  return products.filter(isSludgeMemberProduct).map((product) => product.productId);
}

function resolveSludgeStockProductIds(
  memberProductIds: number[],
  db: Database.Database,
): number[] {
  const ids = new Set(memberProductIds);
  const poolId = getSludgeOilPoolProductId(db);
  if (poolId != null) {
    ids.add(poolId);
  }
  return [...ids];
}

function makeDataRow(
  label: string,
  salesPointName: string | null,
  metrics: { stockKg: number; commitmentKg: number; balanceKg: number },
  kind: StockCommitmentReportRow["kind"] = "data",
  indent = false,
): StockCommitmentReportRow {
  return {
    label,
    salesPointName,
    stockKg: metrics.stockKg,
    commitmentKg: metrics.commitmentKg,
    balanceKg: metrics.balanceKg,
    kind,
    indent,
  };
}

function makeTotalRow(
  label: string,
  rows: StockCommitmentReportRow[],
  kind: StockCommitmentReportRow["kind"],
): StockCommitmentReportRow {
  const dataRows = rows.filter((row) => row.kind === "data");
  return {
    label,
    salesPointName: null,
    stockKg: sum(dataRows.map((row) => row.stockKg)),
    commitmentKg: sum(dataRows.map((row) => row.commitmentKg)),
    balanceKg: sum(dataRows.map((row) => row.balanceKg)),
    kind,
  };
}

function buildProductSection(
  sectionNo: number,
  product: ProductRow,
  salesPoints: SalesPointRow[],
  stockMetrics: MetricRow[],
  commitmentMetrics: MetricRow[],
  hideZero: boolean,
): StockCommitmentReportSection | null {
  const title = product.productName.toUpperCase();

  const dataRows = salesPoints
    .map((salesPoint) => {
      const metrics = metricForProductAtSalesPoint(
        product.productId,
        salesPoint.id,
        stockMetrics,
        commitmentMetrics,
      );
      return makeDataRow("", salesPoint.name, metrics);
    })
    .filter((row) => {
      if (!hideZero) {
        return true;
      }
      const stock = row.stockKg ?? 0;
      const commitment = row.commitmentKg ?? 0;
      return Math.abs(stock) > 0.0001 || Math.abs(commitment) > 0.0001;
    });

  if (hideZero && dataRows.length === 0) {
    return null;
  }

  const rows: StockCommitmentReportRow[] = [
    {
      label: `${sectionNo}. ${title}`,
      salesPointName: null,
      stockKg: null,
      commitmentKg: null,
      balanceKg: null,
      kind: "header",
    },
    ...dataRows,
    makeTotalRow("SUBTOTAL", dataRows, "subtotal"),
  ];

  return {
    sectionNo,
    title,
    rows,
  };
}

function buildBucketedProductSection(
  sectionNo: number,
  title: string,
  stockProductIds: number[],
  commitmentProductIds: number[],
  salesPoints: SalesPointRow[],
  stockMetrics: MetricRow[],
  commitmentMetrics: MetricRow[],
  hideZero: boolean,
): StockCommitmentReportSection | null {
  const sectionTitle = title.toUpperCase();

  const dataRows = salesPoints
    .map((salesPoint) => {
      const metrics = metricForProductsAtSalesPoint(
        stockProductIds,
        commitmentProductIds,
        salesPoint.id,
        stockMetrics,
        commitmentMetrics,
      );
      return makeDataRow("", salesPoint.name, metrics);
    })
    .filter((row) => {
      if (!hideZero) {
        return true;
      }
      const stock = row.stockKg ?? 0;
      const commitment = row.commitmentKg ?? 0;
      return Math.abs(stock) > 0.0001 || Math.abs(commitment) > 0.0001;
    });

  if (hideZero && dataRows.length === 0) {
    return null;
  }

  const rows: StockCommitmentReportRow[] = [
    {
      label: `${sectionNo}. ${sectionTitle}`,
      salesPointName: null,
      stockKg: null,
      commitmentKg: null,
      balanceKg: null,
      kind: "header",
    },
    ...dataRows,
    makeTotalRow("SUBTOTAL", dataRows, "subtotal"),
  ];

  return {
    sectionNo,
    title: sectionTitle,
    rows,
  };
}

function sectionSortRank(title: string): number {
  const normalized = title.trim().toUpperCase();
  if (normalized === LOOSE_PALM_OIL_PRODUCT_NAME.toUpperCase()) {
    return 0;
  }
  if (normalized === PALM_SLUDGE_OIL_REPORT_BUCKET_NAME.toUpperCase()) {
    return 1;
  }
  return 2;
}

function assignSectionNumbers(
  sections: StockCommitmentReportSection[],
): StockCommitmentReportSection[] {
  const sorted = [...sections].sort((left, right) => {
    const rankDiff = sectionSortRank(left.title) - sectionSortRank(right.title);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return left.title.localeCompare(right.title);
  });
  return sorted.map((section, index) => {
    const sectionNo = index + 1;
    return {
      ...section,
      sectionNo,
      rows: section.rows.map((row) =>
        row.kind === "header"
          ? { ...row, label: `${sectionNo}. ${section.title}` }
          : row,
      ),
    };
  });
}

function detectBottledPack(product: ProductRow): BottledPackColumn {
  const text = `${product.productName} ${product.productCode ?? ""}`.toUpperCase();
  if (text.includes("20L") || text.includes("JUG")) {
    return { id: "jug20", label: "1X20L JUG", units: 0, litresPerUnit: 20 };
  }
  if (text.includes("3X5") || (text.includes("5L") && text.includes("CTN"))) {
    return { id: "carton5", label: "3X5L CTN", units: 0, litresPerUnit: 15 };
  }
  if (text.includes("15L")) {
    return { id: "carton15", label: "1X15L CTN", units: 0, litresPerUnit: 15 };
  }
  if (text.includes("1L")) {
    return { id: "unit1", label: "1L BOTTLE", units: 0, litresPerUnit: 1 };
  }
  return { id: "other", label: "OTHER", units: 0, litresPerUnit: 1 };
}

const BOTTLED_PACK_ORDER = ["jug20", "carton5", "carton15", "unit1", "other"] as const;

function buildBottledSection(
  sectionNo: number,
  category: CategoryRow,
  products: ProductRow[],
  stockMetrics: MetricRow[],
): StockCommitmentBottledSection | null {
  const bottledProducts = products.filter((product) => product.productCatId === category.productCatId);
  if (bottledProducts.length === 0) {
    return null;
  }

  // One column per bottled product so every SKU shows (not collapsed by pack type).
  const packRank = (product: ProductRow): number => {
    const packId = detectBottledPack(product).id;
    const index = (BOTTLED_PACK_ORDER as readonly string[]).indexOf(packId);
    return index >= 0 ? index : BOTTLED_PACK_ORDER.length;
  };
  const orderedProducts = [...bottledProducts].sort((a, b) => {
    const rankDiff = packRank(a) - packRank(b);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.productName.localeCompare(b.productName);
  });

  const columns: BottledPackColumn[] = orderedProducts.map((product) => {
    const pack = detectBottledPack(product);
    const units = sum(
      stockMetrics
        .filter((metric) => metric.productId === product.productId)
        .map((metric) => metric.qty),
    );
    return {
      id: `product-${product.productId}`,
      label: product.productName.toUpperCase(),
      units,
      litresPerUnit: pack.litresPerUnit,
    };
  });

  const unitCounts = columns.map((column) => column.units);
  const litres = columns.map((column) => column.units * column.litresPerUnit);
  const kgs = litres.map((litre) => litre * PALM_OIL_KG_PER_LITRE);
  const totalUnits = sum(unitCounts);
  const totalLitres = sum(litres);
  const totalKgs = sum(kgs);

  return {
    sectionNo,
    title: category.productCat.toUpperCase(),
    columns,
    unitCounts,
    litres,
    kgs,
    totalUnits,
    totalLitres,
    totalKgs,
  };
}

export function getStockCommitmentReport(
  userId?: string | null,
  hideZeroArg?: boolean | null,
): StockCommitmentReport {
  const { asAtIso } = resolveReportAsAt();
  const settings = loadReportCompanySettings(userId, asAtIso);
  const hideZero = hideZeroArg ?? true;
  const salesPoints = loadSalesPointsForUser(userId);
  const scopedSalesPointId = reportScopedSalesPointId(userId);
  const categories = loadCategories();
  const products = loadProducts();
  const stockMetrics = loadStockMetrics(asAtIso);
  const commitmentMetrics = loadCommitmentMetrics(asAtIso, scopedSalesPointId);

  const looseCategories = categories.filter((category) => category.isBottled !== 1);
  const bottledCategory = categories.find((category) => category.isBottled === 1) ?? null;

  const db = getDatabase();
  const pendingSections: StockCommitmentReportSection[] = [];

  for (const category of looseCategories) {
    const categoryProducts = products
      .filter((product) => product.productCatId === category.productCatId)
      .sort((left, right) => left.productName.localeCompare(right.productName));

    for (const product of categoryProducts) {
      if (isSludgeMemberProduct(product) || isSludgePoolProduct(product)) {
        continue;
      }
      const section = buildProductSection(
        0,
        product,
        salesPoints,
        stockMetrics,
        commitmentMetrics,
        hideZero,
      );
      if (!section) {
        continue;
      }
      pendingSections.push(section);
    }
  }

  const sludgeMemberProductIds = resolveSludgeMemberProductIds(products);
  const sludgePoolProductId = getSludgeOilPoolProductId(db);
  if (sludgeMemberProductIds.length > 0 || sludgePoolProductId != null) {
    const sludgeProductIds = resolveSludgeStockProductIds(
      sludgeMemberProductIds,
      db,
    );
    const sludgeSection = buildBucketedProductSection(
      0,
      PALM_SLUDGE_OIL_REPORT_BUCKET_NAME,
      sludgeProductIds,
      sludgeProductIds,
      salesPoints,
      stockMetrics,
      commitmentMetrics,
      hideZero,
    );
    if (sludgeSection) {
      pendingSections.push(sludgeSection);
    }
  }

  const sections = assignSectionNumbers(pendingSections);

  const bottledSection = bottledCategory
    ? buildBottledSection(sections.length + 1, bottledCategory, products, stockMetrics)
    : null;

  const looseDataRows = sections.flatMap((section) =>
    section.rows.filter((row) => row.kind === "data"),
  );
  const looseGrandTotal =
    looseDataRows.length > 0
      ? makeTotalRow("GRAND TOTAL", looseDataRows, "grand_total")
      : null;

  return {
    settings,
    asAtIso,
    generatedAtIso: nowIso(),
    sections,
    looseGrandTotal,
    bottledSection,
    comments: loadReportComments("stock-commitment-report"),
  };
}
