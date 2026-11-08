import type {
  BottledPackColumn,
  StockReport,
  StockReportBottledSection,
  StockReportKernelSplitSection,
  StockReportLocationRow,
  StockReportLocationSection,
  StockReportSalesPointQtySection,
  StockReportSection,
} from "../../shared/reports.types.js";
import { loadReportCompanySettings, loadReportComments } from "./companySettings.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import {
  BOTTLED_PACK_ORDER,
  PALM_OIL_KG_PER_LITRE,
  detectBottledPack,
  loadProducts,
  loadSalesPointsForUser,
  loadStorageLocationsForUser,
  nowIso,
  parseQty,
  sum,
  type ProductRow,
  type SalesPointRow,
  type StorageLocationRow,
} from "./shared.js";
import { getDatabase } from "../db/index.js";
import { isLooseLpoProduct } from "../../shared/looseLpoProduct.js";
import { loadStockBalancesAsOf } from "../stock/asOfBalance.js";
import { compareStorageLocationsForReport } from "./storageLocationReportOrder.js";

interface CategoryRow {
  productCatId: number;
  productCat: string;
  productCode: string;
  isMain: number;
  isBottled: number;
}

interface BalanceRow {
  salesPointId: number;
  storageLocationId: number | null;
  productId: number;
  productCatId: number;
  condition: string;
  qty: number;
}

type CategoryLayout = "location_detail" | "bottled" | "kernel_split" | "sales_point_qty";

function loadCategories(): CategoryRow[] {
  return getDatabase()
    .prepare(
      `SELECT productCatId, productCat, COALESCE(productCode, '') AS productCode,
              COALESCE(isMain, 0) AS isMain,
              COALESCE(isBottled, 0) AS isBottled
       FROM ProductCat
       ORDER BY isMain DESC, isBottled ASC, productCat ASC`,
    )
    .all() as CategoryRow[];
}

function loadStockBalances(asAtIso: string): BalanceRow[] {
  const db = getDatabase();
  const productCatById = new Map<number, number>();
  const products = db
    .prepare(`SELECT productId, productCatId FROM Product`)
    .all() as Array<{ productId: number; productCatId: number }>;
  for (const product of products) {
    productCatById.set(product.productId, product.productCatId);
  }

  return loadStockBalancesAsOf(db, asAtIso)
    .map((row) => ({
      salesPointId: row.salesPointId,
      storageLocationId: row.storageLocationId,
      productId: row.productId,
      productCatId: productCatById.get(row.productId) ?? 0,
      condition: row.condition,
      qty: row.qty,
    }))
    .filter((row) => row.productCatId > 0);
}

function categoryText(category: CategoryRow): string {
  return category.productCat.toUpperCase();
}

function isPalmKernelOilCategory(category: CategoryRow): boolean {
  const text = categoryText(category);
  return text.includes("KERNEL OIL") || /\bPKO\b/.test(text);
}

function isPalmKernelCakeCategory(category: CategoryRow): boolean {
  const text = categoryText(category);
  return text.includes("KERNEL CAKE") || /\bPKC\b/.test(text);
}

function isPalmKernelCategory(category: CategoryRow): boolean {
  const text = categoryText(category);
  if (isPalmKernelOilCategory(category) || isPalmKernelCakeCategory(category)) {
    return false;
  }
  if (category.isMain === 1 || category.isBottled === 1) {
    return false;
  }
  return (
    text.includes("PALM KERNEL") ||
    (text.includes("KERNEL") && !text.includes("OIL") && !text.includes("CAKE"))
  );
}

function loadCategoryAllOmitStorageLocation(): Map<number, boolean> {
  const rows = getDatabase()
    .prepare(
      `SELECT productCatId,
              MIN(COALESCE(omitsStorageLocation, 0)) AS minOmit,
              MAX(COALESCE(omitsStorageLocation, 0)) AS maxOmit,
              COUNT(*) AS productCount
       FROM Product
       GROUP BY productCatId`,
    )
    .all() as Array<{
    productCatId: number;
    minOmit: number;
    maxOmit: number;
    productCount: number;
  }>;

  const map = new Map<number, boolean>();
  for (const row of rows) {
    map.set(
      row.productCatId,
      row.productCount > 0 && row.minOmit === 1 && row.maxOmit === 1,
    );
  }
  return map;
}

function resolveCategoryLayout(
  category: CategoryRow,
  categoryAllOmitStorage: Map<number, boolean>,
): CategoryLayout {
  if (categoryAllOmitStorage.get(category.productCatId)) {
    return "sales_point_qty";
  }
  if (category.isBottled === 1) {
    return "bottled";
  }
  if (isPalmKernelCategory(category)) {
    return "kernel_split";
  }
  if (isPalmKernelCakeCategory(category)) {
    return "sales_point_qty";
  }
  return "location_detail";
}

/** Report order: main loose → PKO → palm kernel → cake → bottled → other. */
function sortCategoriesForReport(categories: CategoryRow[]): CategoryRow[] {
  const rank = (category: CategoryRow): number => {
    if (category.isMain === 1) return 0;
    if (isPalmKernelOilCategory(category)) return 1;
    if (isPalmKernelCategory(category)) return 2;
    if (isPalmKernelCakeCategory(category)) return 3;
    if (category.isBottled === 1) return 4;
    return 5;
  };
  return [...categories].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.productCat.localeCompare(b.productCat);
  });
}

function isOilLocationCategory(category: CategoryRow): boolean {
  return category.isMain === 1 || isPalmKernelOilCategory(category);
}

function productNameUpper(product: ProductRow): string {
  return `${product.productName} ${product.productCode ?? ""}`.toUpperCase();
}

function isUncrackedProduct(product: ProductRow): boolean {
  return productNameUpper(product).includes("UNCRACKED");
}

function isCrackedProduct(product: ProductRow): boolean {
  const text = productNameUpper(product);
  return text.includes("CRACKED") && !text.includes("UNCRACKED");
}

function qtyAtLocation(
  balances: BalanceRow[],
  productCatId: number,
  salesPointId: number,
  storageLocationId: number,
): number {
  return sum(
    balances
      .filter(
        (row) =>
          row.productCatId === productCatId &&
          row.salesPointId === salesPointId &&
          row.storageLocationId === storageLocationId,
      )
      .map((row) => row.qty),
  );
}

function remarksAtLocation(
  balances: BalanceRow[],
  products: ProductRow[],
  productCatId: number,
  salesPointId: number,
  storageLocationId: number,
  locationIsSellable: boolean,
): string | null {
  const atLocation = balances.filter(
    (row) =>
      row.productCatId === productCatId &&
      row.salesPointId === salesPointId &&
      row.storageLocationId === storageLocationId &&
      row.qty > 0,
  );

  const remarkLines = atLocation.filter((row) => {
    const product = products.find((p) => p.productId === row.productId);
    if (!product) {
      return false;
    }
    return !isLooseLpoProduct({
      productCode: product.productCode,
      productName: product.productName,
      isBottled: product.isBottled,
    });
  });

  const names = [
    ...new Set(
      remarkLines
        .map((row) => products.find((p) => p.productId === row.productId)?.productName)
        .filter((name): name is string => Boolean(name)),
    ),
  ].map((name) => name.toUpperCase());

  const hasUnsellable =
    atLocation.length > 0 &&
    (!locationIsSellable || atLocation.some((row) => row.condition !== "SELLABLE"));

  if (names.length === 0 && !hasUnsellable) {
    return null;
  }

  const parts = hasUnsellable ? [...names, "UNSELLABLE"] : [...names];
  return parts.length > 0 ? parts.join(" · ") : null;
}

function buildLocationSection(
  category: CategoryRow,
  salesPoints: SalesPointRow[],
  storageLocations: StorageLocationRow[],
  balances: BalanceRow[],
  products: ProductRow[],
  showOilGrandTotalAfter: boolean,
  hideZero: boolean,
): StockReportLocationSection {
  const rows: StockReportLocationRow[] = [];
  let sectionTotalKg = 0;

  for (const salesPoint of salesPoints) {
    const locations = storageLocations
      .filter((location) => location.salesPointId === salesPoint.id)
      .sort(compareStorageLocationsForReport);
    const dataRows: StockReportLocationRow[] = [];

    for (const location of locations) {
      const quantityKg = qtyAtLocation(
        balances,
        category.productCatId,
        salesPoint.id,
        location.id,
      );
      if (hideZero && (quantityKg == null || quantityKg === 0)) {
        continue;
      }
      dataRows.push({
        salesPointName:
          dataRows.length === 0 ? salesPoint.name.toUpperCase() : null,
        storageName: location.name.toUpperCase(),
        quantityKg: quantityKg ?? 0,
        remarks: remarksAtLocation(
          balances,
          products,
          category.productCatId,
          salesPoint.id,
          location.id,
          location.effectivelySellable,
        ),
        kind: "data",
      });
    }

    if (hideZero && dataRows.length === 0) {
      continue;
    }

    const subtotal = sum(dataRows.map((row) => row.quantityKg ?? 0));
    sectionTotalKg += subtotal;
    rows.push(...dataRows);
    rows.push({
      salesPointName: null,
      storageName: "SUB TOTAL",
      quantityKg: subtotal,
      remarks: null,
      kind: "subtotal",
    });
  }

  return {
    kind: "location_detail",
    title: category.productCat.toUpperCase(),
    productCatId: category.productCatId,
    rows,
    sectionTotalKg,
    showOilGrandTotalAfter,
  };
}

function buildBottledSection(
  category: CategoryRow,
  salesPoints: SalesPointRow[],
  products: ProductRow[],
  balances: BalanceRow[],
  storageLocations: StorageLocationRow[],
  hideZero: boolean,
): StockReportBottledSection | null {
  const bottledProducts = products.filter(
    (product) => product.productCatId === category.productCatId,
  );
  if (bottledProducts.length === 0) {
    return null;
  }

  // One column per product so every bottled SKU is visible (not collapsed by pack type).
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
    return {
      id: `product-${product.productId}`,
      label: product.productName.toUpperCase(),
      units: 0,
      litresPerUnit: pack.litresPerUnit,
    };
  });

  const sellableLocationIds = new Set(
    storageLocations
      .filter(
        (location) =>
          location.effectivelySellable,
      )
      .map((location) => location.id),
  );
  const sellableBalances = balances.filter(
    (row) =>
      row.condition === "SELLABLE" &&
      row.storageLocationId != null &&
      sellableLocationIds.has(row.storageLocationId) &&
      bottledProducts.some((p) => p.productId === row.productId),
  );

  const rows = salesPoints
    .map((salesPoint) => {
      const unitCounts = orderedProducts.map((product) =>
        sum(
          sellableBalances
            .filter(
              (balance) =>
                balance.salesPointId === salesPoint.id &&
                balance.productId === product.productId,
            )
            .map((balance) => balance.qty),
        ),
      );

      return {
        salesPointName: salesPoint.name.toUpperCase(),
        unitCounts,
      };
    })
    .filter((row) => !hideZero || sum(row.unitCounts) !== 0);

  const columnTotals = columns.map((_, columnIndex) =>
    sum(rows.map((row) => row.unitCounts[columnIndex] ?? 0)),
  );
  const litres = columns.map(
    (column, index) => (columnTotals[index] ?? 0) * column.litresPerUnit,
  );
  const kgs = litres.map((litre) => litre * PALM_OIL_KG_PER_LITRE);

  return {
    kind: "bottled",
    title: category.productCat.toUpperCase(),
    productCatId: category.productCatId,
    columns,
    rows,
    columnTotals,
    litres,
    kgs,
    totalKgs: sum(kgs),
  };
}

function buildKernelSplitSection(
  category: CategoryRow,
  salesPoints: SalesPointRow[],
  products: ProductRow[],
  balances: BalanceRow[],
  hideZero: boolean,
): StockReportKernelSplitSection {
  const catProducts = products.filter((p) => p.productCatId === category.productCatId);
  const crackedIds = new Set(
    catProducts.filter(isCrackedProduct).map((p) => p.productId),
  );
  const uncrackedIds = new Set(
    catProducts.filter(isUncrackedProduct).map((p) => p.productId),
  );

  const rows = salesPoints
    .map((salesPoint) => {
      const pointBalances = balances.filter(
        (row) =>
          row.productCatId === category.productCatId &&
          row.salesPointId === salesPoint.id,
      );
      const crackedKg = sum(
        pointBalances
          .filter((row) => crackedIds.has(row.productId))
          .map((row) => row.qty),
      );
      const uncrackedKg = sum(
        pointBalances
          .filter((row) => uncrackedIds.has(row.productId))
          .map((row) => row.qty),
      );
      return {
        salesPointName: salesPoint.name.toUpperCase(),
        crackedKg,
        uncrackedKg,
        totalKg: crackedKg + uncrackedKg,
      };
    })
    .filter((row) => !hideZero || row.totalKg !== 0);

  const totals = {
    salesPointName: "TOTAL",
    crackedKg: sum(rows.map((row) => row.crackedKg)),
    uncrackedKg: sum(rows.map((row) => row.uncrackedKg)),
    totalKg: sum(rows.map((row) => row.totalKg)),
  };

  return {
    kind: "kernel_split",
    title: category.productCat.toUpperCase(),
    productCatId: category.productCatId,
    rows,
    totals,
  };
}

function buildSalesPointQtySection(
  category: CategoryRow,
  salesPoints: SalesPointRow[],
  balances: BalanceRow[],
  hideZero: boolean,
): StockReportSalesPointQtySection {
  const rows = salesPoints
    .map((salesPoint) => ({
      salesPointName: salesPoint.name.toUpperCase(),
      quantityKg: sum(
        balances
          .filter(
            (row) =>
              row.productCatId === category.productCatId &&
              row.salesPointId === salesPoint.id,
          )
          .map((row) => row.qty),
      ),
    }))
    .filter((row) => !hideZero || row.quantityKg !== 0);

  return {
    kind: "sales_point_qty",
    title: category.productCat.toUpperCase(),
    productCatId: category.productCatId,
    quantityLabel: "QUANTITY",
    rows,
    totalKg: sum(rows.map((row) => row.quantityKg)),
  };
}

export function getStockReport(
  userId?: string | null,
  hideZeroArg?: boolean | null,
  asAtIsoArg?: string | null,
): StockReport {
  const { asAtIso: defaultAsAt, period } = resolveReportAsAt(userId);
  let asAtIso = defaultAsAt;
  if (typeof asAtIsoArg === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asAtIsoArg.trim())) {
    const raw = asAtIsoArg.trim().slice(0, 10);
    if (raw < period.startDate) {
      asAtIso = period.startDate;
    } else if (raw > period.endDate) {
      asAtIso = period.endDate;
    } else {
      asAtIso = raw;
    }
  }
  const settings = loadReportCompanySettings(userId, asAtIso);
  const hideZero = hideZeroArg ?? true;
  const salesPoints = loadSalesPointsForUser(userId);
  const storageLocations = loadStorageLocationsForUser(userId);
  const products = loadProducts();
  const balances = loadStockBalances(asAtIso);
  const categories = sortCategoriesForReport(loadCategories()).filter((category) =>
    products.some((product) => product.productCatId === category.productCatId),
  );
  const categoryAllOmitStorage = loadCategoryAllOmitStorageLocation();

  const oilCategories = categories.filter(isOilLocationCategory);
  const lastOilCatId = oilCategories[oilCategories.length - 1]?.productCatId ?? null;

  const sections: StockReportSection[] = [];
  let oilGrandTotalKg = 0;

  for (const category of categories) {
    const layout = resolveCategoryLayout(category, categoryAllOmitStorage);
    if (layout === "bottled") {
      const bottled = buildBottledSection(
        category,
        salesPoints,
        products,
        balances,
        storageLocations,
        hideZero,
      );
      if (bottled && bottled.rows.length > 0) {
        sections.push(bottled);
      }
      continue;
    }
    if (layout === "kernel_split") {
      const kernelSection = buildKernelSplitSection(
        category,
        salesPoints,
        products,
        balances,
        hideZero,
      );
      if (
        kernelSection.rows.length > 0 ||
        Math.abs(kernelSection.totals.totalKg) > 0.0001
      ) {
        sections.push(kernelSection);
      }
      continue;
    }
    if (layout === "sales_point_qty") {
      const qtySection = buildSalesPointQtySection(
        category,
        salesPoints,
        balances,
        hideZero,
      );
      if (qtySection.rows.length > 0) {
        sections.push(qtySection);
      }
      continue;
    }

    const showOilGrandTotalAfter =
      lastOilCatId != null && category.productCatId === lastOilCatId;
    const locationSection = buildLocationSection(
      category,
      salesPoints,
      storageLocations,
      balances,
      products,
      showOilGrandTotalAfter,
      hideZero,
    );
    if (locationSection.rows.length > 0) {
      sections.push(locationSection);
      if (isOilLocationCategory(category)) {
        oilGrandTotalKg += locationSection.sectionTotalKg;
      }
    }
  }

  return {
    settings,
    asAtIso,
    generatedAtIso: nowIso(),
    sections,
    oilGrandTotalKg,
    comments: loadReportComments("stock-report"),
  };
}
