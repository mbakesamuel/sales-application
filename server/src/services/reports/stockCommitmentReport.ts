/**
 * Weekly Stock Summary (stock vs commitment) report.
 * Ports src/electron/reports/stockCommitment.ts.
 */
import { prisma } from "../../db/prisma.js";

const LOOSE_PALM_OIL_PRODUCT_NAME = "Loose Palm Oil";
const PALM_SLUDGE_OIL_REPORT_BUCKET_NAME = "Palm Sludge Oil";
import {
  getOpenPostingPeriodForActor,
} from "../financialYearsService.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  resolveReportAsAt,
} from "../reportCompany.js";
import { loadCommitmentMetricsAsOf } from "./commitmentReport.js";
import {
  BOTTLED_PACK_ORDER,
  detectBottledPack,
  isSludgeMemberReportProduct,
  isSludgePoolReportProduct,
  loadProducts,
  loadSalesPointsForUser,
  PALM_OIL_KG_PER_LITRE,
  reportScopedSalesPointId,
  sum,
  type ProductRow,
  type SalesPointRow,
} from "./reportShared.js";
import { loadStockBalancesAsOf } from "./stockBalancesAsOf.js";

type CategoryRow = {
  productCatId: number;
  productCat: string;
  isMain: number;
  isBottled: number;
};

type MetricRow = {
  salesPointId: number;
  productId: number;
  qty: number;
};

type StockCommitmentReportRow = {
  label: string;
  salesPointName: string | null;
  stockKg: number | null;
  commitmentKg: number | null;
  balanceKg: number | null;
  kind: "header" | "data" | "subtotal" | "total" | "grand_total";
  indent?: boolean;
};

type BottledPackColumn = {
  id: string;
  label: string;
  units: number;
  litresPerUnit: number;
};

type StockCommitmentBottledSection = {
  sectionNo: number;
  title: string;
  columns: BottledPackColumn[];
  unitCounts: number[];
  litres: number[];
  kgs: number[];
  totalUnits: number;
  totalLitres: number;
  totalKgs: number;
};

type StockCommitmentReportSection = {
  sectionNo: number;
  title: string;
  rows: StockCommitmentReportRow[];
};

async function loadCategories(): Promise<CategoryRow[]> {
  const rows = await prisma.product_cats.findMany({
    orderBy: [{ is_main: "desc" }, { product_cat: "asc" }],
  });
  return rows.map((r) => ({
    productCatId: r.product_cat_id,
    productCat: r.product_cat,
    isMain: r.is_main ? 1 : 0,
    isBottled: r.is_bottled ? 1 : 0,
  }));
}

async function loadStockMetrics(asAtIso: string): Promise<MetricRow[]> {
  const totals = new Map<string, number>();
  for (const row of await loadStockBalancesAsOf(asAtIso)) {
    if (row.condition !== "SELLABLE") continue;
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

function metricForProductAtSalesPoint(
  productId: number,
  salesPointId: number,
  stockMetrics: MetricRow[],
  commitmentMetrics: MetricRow[],
): { stockKg: number; commitmentKg: number; balanceKg: number } {
  const stockKg =
    stockMetrics.find(
      (metric) =>
        metric.salesPointId === salesPointId && metric.productId === productId,
    )?.qty ?? 0;
  const commitmentKg =
    commitmentMetrics.find(
      (metric) =>
        metric.salesPointId === salesPointId && metric.productId === productId,
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
        (metric) =>
          metric.salesPointId === salesPointId &&
          metric.productId === productId,
      )?.qty ?? 0;
  }
  for (const productId of commitmentProductIds) {
    commitmentKg +=
      commitmentMetrics.find(
        (metric) =>
          metric.salesPointId === salesPointId &&
          metric.productId === productId,
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
      if (!hideZero) return true;
      const stock = row.stockKg ?? 0;
      const commitment = row.commitmentKg ?? 0;
      return Math.abs(stock) > 0.0001 || Math.abs(commitment) > 0.0001;
    });

  if (hideZero && dataRows.length === 0) return null;

  return {
    sectionNo,
    title,
    rows: [
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
    ],
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
      if (!hideZero) return true;
      const stock = row.stockKg ?? 0;
      const commitment = row.commitmentKg ?? 0;
      return Math.abs(stock) > 0.0001 || Math.abs(commitment) > 0.0001;
    });

  if (hideZero && dataRows.length === 0) return null;

  return {
    sectionNo,
    title: sectionTitle,
    rows: [
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
    ],
  };
}

function sectionSortRank(title: string): number {
  const normalized = title.trim().toUpperCase();
  if (normalized === LOOSE_PALM_OIL_PRODUCT_NAME.toUpperCase()) return 0;
  if (normalized === PALM_SLUDGE_OIL_REPORT_BUCKET_NAME.toUpperCase()) return 1;
  return 2;
}

function assignSectionNumbers(
  sections: StockCommitmentReportSection[],
): StockCommitmentReportSection[] {
  const sorted = [...sections].sort((left, right) => {
    const rankDiff = sectionSortRank(left.title) - sectionSortRank(right.title);
    if (rankDiff !== 0) return rankDiff;
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

function buildBottledSection(
  sectionNo: number,
  category: CategoryRow,
  products: ProductRow[],
  stockMetrics: MetricRow[],
): StockCommitmentBottledSection | null {
  const bottledProducts = products.filter(
    (product) => product.productCatId === category.productCatId,
  );
  if (bottledProducts.length === 0) return null;

  const packRank = (product: ProductRow): number => {
    const packId = detectBottledPack(product).id;
    const index = (BOTTLED_PACK_ORDER as readonly string[]).indexOf(packId);
    return index >= 0 ? index : BOTTLED_PACK_ORDER.length;
  };
  const orderedProducts = [...bottledProducts].sort((a, b) => {
    const rankDiff = packRank(a) - packRank(b);
    if (rankDiff !== 0) return rankDiff;
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
  return {
    sectionNo,
    title: category.productCat.toUpperCase(),
    columns,
    unitCounts,
    litres,
    kgs,
    totalUnits: sum(unitCounts),
    totalLitres: sum(litres),
    totalKgs: sum(kgs),
  };
}

export async function getStockCommitmentReport(
  userId?: string | null,
  hideZeroArg?: boolean | null,
  asAtIsoArg?: string | null,
) {
  const defaultAsAt = await resolveReportAsAt(asAtIsoArg, userId);
  const period = await getOpenPostingPeriodForActor(userId);
  let asAtIso = defaultAsAt;
  if (period && typeof asAtIsoArg === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asAtIsoArg.trim())) {
    const raw = asAtIsoArg.trim().slice(0, 10);
    if (raw < period.startDate) asAtIso = period.startDate;
    else if (raw > period.endDate) asAtIso = period.endDate;
    else asAtIso = raw;
  }

  const hideZero = hideZeroArg ?? true;
  const [settings, salesPoints, scopedSalesPointId, categories, products, comments] =
    await Promise.all([
      loadReportCompanySettings(userId, asAtIso),
      loadSalesPointsForUser(userId),
      reportScopedSalesPointId(userId),
      loadCategories(),
      loadProducts(),
      loadReportComments("stock-commitment-report"),
    ]);

  const [stockMetrics, commitmentMetrics] = await Promise.all([
    loadStockMetrics(asAtIso),
    loadCommitmentMetricsAsOf(asAtIso, { salesPointId: scopedSalesPointId }),
  ]);

  const looseCategories = categories.filter((category) => category.isBottled !== 1);
  const bottledCategory =
    categories.find((category) => category.isBottled === 1) ?? null;

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
      if (section) pendingSections.push(section);
    }
  }

  const sludgeMemberProductIds = products
    .filter(isSludgeMemberProduct)
    .map((product) => product.productId);
  const sludgePoolProduct = products.find(isSludgePoolProduct);
  if (sludgeMemberProductIds.length > 0 || sludgePoolProduct) {
    const sludgeProductIds = new Set(sludgeMemberProductIds);
    if (sludgePoolProduct) sludgeProductIds.add(sludgePoolProduct.productId);
    const ids = [...sludgeProductIds];
    const sludgeSection = buildBucketedProductSection(
      0,
      PALM_SLUDGE_OIL_REPORT_BUCKET_NAME,
      ids,
      ids,
      salesPoints,
      stockMetrics,
      commitmentMetrics,
      hideZero,
    );
    if (sludgeSection) pendingSections.push(sludgeSection);
  }

  const sections = assignSectionNumbers(pendingSections);
  const bottledSection = bottledCategory
    ? buildBottledSection(
        sections.length + 1,
        bottledCategory,
        products,
        stockMetrics,
      )
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
    comments,
  };
}
