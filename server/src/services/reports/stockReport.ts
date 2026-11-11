import { prisma } from "../../db/prisma.js";
import { getOpenPostingPeriodForActor } from "../financialYearsService.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  resolveReportAsAt,
} from "../reportCompany.js";
import { loadStockBalancesAsOf } from "./stockBalancesAsOf.js";
import {
  BOTTLED_PACK_ORDER,
  PALM_OIL_KG_PER_LITRE,
  compareStorageLocationsForReport,
  detectBottledPack,
  isLooseLpoProduct,
  loadProducts,
  loadSalesPointsForUser,
  loadStorageLocationsForUser,
  sum,
  type ProductRow,
  type SalesPointRow,
  type StorageLocationRow,
} from "./reportShared.js";

type CategoryRow = {
  productCatId: number;
  productCat: string;
  productCode: string;
  isMain: number;
  isBottled: number;
};

type BalanceRow = {
  salesPointId: number;
  storageLocationId: number | null;
  productId: number;
  productCatId: number;
  condition: string;
  qty: number;
};

type CategoryLayout =
  | "location_detail"
  | "bottled"
  | "kernel_split"
  | "sales_point_qty";

async function loadCategories(): Promise<CategoryRow[]> {
  const rows = await prisma.product_cats.findMany({
    orderBy: [{ is_main: "desc" }, { is_bottled: "asc" }, { product_cat: "asc" }],
  });
  return rows.map((r) => ({
    productCatId: r.product_cat_id,
    productCat: r.product_cat,
    productCode: r.product_code ?? "",
    isMain: r.is_main ? 1 : 0,
    isBottled: r.is_bottled ? 1 : 0,
  }));
}

async function loadStockBalances(asAtIso: string): Promise<BalanceRow[]> {
  const products = await prisma.products.findMany({
    select: { product_id: true, product_cat_id: true },
  });
  const productCatById = new Map(
    products.map((p) => [p.product_id, p.product_cat_id]),
  );
  return (await loadStockBalancesAsOf(asAtIso))
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
  if (category.isMain === 1 || category.isBottled === 1) return false;
  return (
    text.includes("PALM KERNEL") ||
    (text.includes("KERNEL") && !text.includes("OIL") && !text.includes("CAKE"))
  );
}

function resolveCategoryLayout(
  category: CategoryRow,
  categoryAllOmitStorage: Map<number, boolean>,
): CategoryLayout {
  if (categoryAllOmitStorage.get(category.productCatId)) return "sales_point_qty";
  if (category.isBottled === 1) return "bottled";
  if (isPalmKernelCategory(category)) return "kernel_split";
  if (isPalmKernelCakeCategory(category)) return "sales_point_qty";
  return "location_detail";
}

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
    if (!product) return false;
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
  if (names.length === 0 && !hasUnsellable) return null;
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
) {
  const rows: Array<{
    salesPointName: string | null;
    storageName: string | null;
    quantityKg: number | null;
    remarks: string | null;
    kind: "data" | "subtotal" | "grand_total";
  }> = [];
  let sectionTotalKg = 0;

  for (const salesPoint of salesPoints) {
    const locations = storageLocations
      .filter((location) => location.salesPointId === salesPoint.id)
      .sort(compareStorageLocationsForReport);
    const dataRows: typeof rows = [];
    for (const location of locations) {
      const quantityKg = qtyAtLocation(
        balances,
        category.productCatId,
        salesPoint.id,
        location.id,
      );
      if (hideZero && quantityKg === 0) continue;
      dataRows.push({
        salesPointName:
          dataRows.length === 0 ? salesPoint.name.toUpperCase() : null,
        storageName: location.name.toUpperCase(),
        quantityKg,
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
    if (hideZero && dataRows.length === 0) continue;
    const subtotal = sum(dataRows.map((row) => row.quantityKg ?? 0));
    sectionTotalKg += subtotal;
    rows.push(...dataRows);
    rows.push({
      salesPointName: null,
      storageName: "SUBTOTAL",
      quantityKg: subtotal,
      remarks: null,
      kind: "subtotal",
    });
  }

  return {
    kind: "location_detail" as const,
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
) {
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

  const columns = orderedProducts.map((product) => {
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
      .filter((location) => location.effectivelySellable)
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
    .map((salesPoint) => ({
      salesPointName: salesPoint.name.toUpperCase(),
      unitCounts: orderedProducts.map((product) =>
        sum(
          sellableBalances
            .filter(
              (balance) =>
                balance.salesPointId === salesPoint.id &&
                balance.productId === product.productId,
            )
            .map((balance) => balance.qty),
        ),
      ),
    }))
    .filter((row) => !hideZero || sum(row.unitCounts) !== 0);

  const columnTotals = columns.map((_, columnIndex) =>
    sum(rows.map((row) => row.unitCounts[columnIndex] ?? 0)),
  );
  const litres = columns.map(
    (column, index) => (columnTotals[index] ?? 0) * column.litresPerUnit,
  );
  const kgs = litres.map((litre) => litre * PALM_OIL_KG_PER_LITRE);

  return {
    kind: "bottled" as const,
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
) {
  const catProducts = products.filter(
    (p) => p.productCatId === category.productCatId,
  );
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

  return {
    kind: "kernel_split" as const,
    title: category.productCat.toUpperCase(),
    productCatId: category.productCatId,
    rows,
    totals: {
      salesPointName: "TOTAL",
      crackedKg: sum(rows.map((row) => row.crackedKg)),
      uncrackedKg: sum(rows.map((row) => row.uncrackedKg)),
      totalKg: sum(rows.map((row) => row.totalKg)),
    },
  };
}

function buildSalesPointQtySection(
  category: CategoryRow,
  salesPoints: SalesPointRow[],
  balances: BalanceRow[],
  hideZero: boolean,
) {
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
    kind: "sales_point_qty" as const,
    title: category.productCat.toUpperCase(),
    productCatId: category.productCatId,
    quantityLabel: "QUANTITY",
    rows,
    totalKg: sum(rows.map((row) => row.quantityKg)),
  };
}

export async function getStockReport(
  userId: string,
  hideZeroArg?: boolean | null,
  asAtIsoArg?: string | null,
) {
  const defaultAsAt = await resolveReportAsAt(undefined, userId);
  const period = await getOpenPostingPeriodForActor(userId);
  let asAtIso = defaultAsAt;
  if (
    typeof asAtIsoArg === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(asAtIsoArg.trim()) &&
    period
  ) {
    const raw = asAtIsoArg.trim().slice(0, 10);
    if (raw < period.startDate) asAtIso = period.startDate;
    else if (raw > period.endDate) asAtIso = period.endDate;
    else asAtIso = raw;
  }

  const hideZero = hideZeroArg ?? true;
  const [settings, salesPoints, storageLocations, products, balances, categories, comments] =
    await Promise.all([
      loadReportCompanySettings(userId, asAtIso),
      loadSalesPointsForUser(userId),
      loadStorageLocationsForUser(userId),
      loadProducts(),
      loadStockBalances(asAtIso),
      loadCategories(),
      loadReportComments("stock-report"),
    ]);

  const categoryAllOmitStorage = new Map<number, boolean>();
  for (const cat of categories) {
    const catProducts = products.filter((p) => p.productCatId === cat.productCatId);
    categoryAllOmitStorage.set(
      cat.productCatId,
      catProducts.length > 0 &&
        catProducts.every((p) => p.omitsStorageLocation),
    );
  }

  const sorted = sortCategoriesForReport(categories).filter((category) =>
    products.some((product) => product.productCatId === category.productCatId),
  );
  const oilCategories = sorted.filter(isOilLocationCategory);
  const lastOilCatId =
    oilCategories[oilCategories.length - 1]?.productCatId ?? null;

  const sections: unknown[] = [];
  let oilGrandTotalKg = 0;

  for (const category of sorted) {
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
      if (bottled && bottled.rows.length > 0) sections.push(bottled);
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
      if (qtySection.rows.length > 0) sections.push(qtySection);
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
    comments,
  };
}
