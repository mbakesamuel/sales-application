import type { RolePermissionsSnapshot } from "./permissions.types.js";
import type { RouteAccess } from "./roles.js";

/** Legacy per-tab / table routes (still in catalog for matrix compatibility). */
export const STOCK_MODULE_ROUTE_IDS = [
  "stock-balance",
  "stock-movements",
  "stock-receipts",
  "stock-receipt-lines",
  "stock-transfers",
  "stock-transfer-lines",
  "stock-adjustments",
  "stock-adjustment-lines",
] as const;

/** Single gate for the bulk (non-bottled) stock management environment. */
export const STOCK_MODULE_ROUTE_ID = "stock";

/** Single gate for the bottled stock management environment. */
export const BOTTLED_STOCK_ROUTE_ID = "bottled-stock";

export type StockProductFilter = "bulk" | "bottled" | "all";
export type StockModuleVariant = StockProductFilter;

/** Document-level filter after resolving unified UI (bulk or bottled only). */
export type DocumentStockProductFilter = "bulk" | "bottled";

export function isAllProductFilter(filter: StockProductFilter): boolean {
  return filter === "all";
}

export function inferDocumentProductFilter(
  isBottledFlags: readonly number[],
): DocumentStockProductFilter {
  if (isBottledFlags.length === 0) {
    throw new Error("Add at least one line.");
  }
  const bottled = isBottledFlags[0] === 1;
  for (const flag of isBottledFlags) {
    if ((flag === 1) !== bottled) {
      throw new Error("Cannot mix loose and bottled products on one document.");
    }
  }
  return bottled ? "bottled" : "bulk";
}

export type StockTabId = "balance" | "movements" | "receipts" | "transfers" | "adjustments";

export const STOCK_TAB_DEFINITIONS: ReadonlyArray<{
  id: StockTabId;
  label: string;
  headerTable: string;
  lineTable?: string;
  description: string;
  lineDescription?: string;
}> = [
  {
    id: "balance",
    label: "Balance",
    headerTable: "StockBalance",
    description: "Current stock levels by collection point, product, location, and condition.",
  },
  {
    id: "movements",
    label: "Movements",
    headerTable: "StockMovement",
    description: "Stock movement ledger across receipts, transfers, sales, and adjustments.",
  },
  {
    id: "receipts",
    label: "Reception",
    headerTable: "StockReceipt",
    lineTable: "StockReceiptLine",
    description: "Inbound stock receipts.",
    lineDescription: "Line items on stock receipts.",
  },
  {
    id: "transfers",
    label: "Transfers",
    headerTable: "StockTransfer",
    lineTable: "StockTransferLine",
    description: "Transfers between collection points and storage locations.",
    lineDescription: "Line items on stock transfers.",
  },
  {
    id: "adjustments",
    label: "Adjustments",
    headerTable: "StockAdjustment",
    lineTable: "StockAdjustmentLine",
    description: "Manual stock adjustments.",
    lineDescription: "Line items on stock adjustments.",
  },
];

function getRouteAccess(snapshot: RolePermissionsSnapshot, routeId: string): RouteAccess {
  return snapshot.routes[routeId] ?? "none";
}

function canAccessRoute(snapshot: RolePermissionsSnapshot, routeId: string): boolean {
  return getRouteAccess(snapshot, routeId) !== "none";
}

export function canAccessStockModule(snapshot: RolePermissionsSnapshot): boolean {
  return canAccessRoute(snapshot, STOCK_MODULE_ROUTE_ID);
}

export function getStockModuleAccess(snapshot: RolePermissionsSnapshot): RouteAccess {
  return getRouteAccess(snapshot, STOCK_MODULE_ROUTE_ID);
}

export function canAccessBottledStockModule(snapshot: RolePermissionsSnapshot): boolean {
  return canAccessRoute(snapshot, BOTTLED_STOCK_ROUTE_ID);
}

export function getBottledStockModuleAccess(snapshot: RolePermissionsSnapshot): RouteAccess {
  return getRouteAccess(snapshot, BOTTLED_STOCK_ROUTE_ID);
}

/**
 * Bin card printable report (opened from Stock → Bin card).
 * Matches getBinCard: stock-bin-card, bottled-stock, or the dedicated report route.
 */
export function canAccessBinCardReport(snapshot: RolePermissionsSnapshot): boolean {
  return (
    canAccessRoute(snapshot, "stock-bin-card-report") ||
    canAccessRoute(snapshot, "stock-bin-card") ||
    canAccessBottledStockModule(snapshot)
  );
}

/** True when the role can manage bottled stock (module route or legacy bin-card write). */
export function hasUnifiedStockBottledCapability(snapshot: RolePermissionsSnapshot): boolean {
  if (getBottledStockModuleAccess(snapshot) === "write") {
    return true;
  }
  return getRouteAccess(snapshot, "stock-bin-card") === "write";
}

export function canAccessStockTab(
  snapshot: RolePermissionsSnapshot,
  _tabId: StockTabId,
): boolean {
  return canAccessStockModule(snapshot);
}

export function isStockTabReadOnly(
  snapshot: RolePermissionsSnapshot,
  _tabId: StockTabId,
): boolean {
  return getStockModuleAccess(snapshot) !== "write";
}

/** Bulk and bottled environments are each gated by a single module route. */
export function canAccessStockTabForVariant(
  snapshot: RolePermissionsSnapshot,
  variant: StockModuleVariant,
  tabId: StockTabId,
): boolean {
  if (variant === "bottled") {
    return canAccessBottledStockModule(snapshot);
  }
  if (variant === "all") {
    return canAccessStockModule(snapshot);
  }
  return canAccessStockTab(snapshot, tabId);
}

export function isStockTabReadOnlyForVariant(
  snapshot: RolePermissionsSnapshot,
  variant: StockModuleVariant,
  tabId: StockTabId,
): boolean {
  if (variant === "bottled") {
    return getBottledStockModuleAccess(snapshot) !== "write";
  }
  if (variant === "all") {
    return getStockModuleAccess(snapshot) !== "write";
  }
  return isStockTabReadOnly(snapshot, tabId);
}

export function getVisibleStockTabs(snapshot: RolePermissionsSnapshot): StockTabId[] {
  return STOCK_TAB_DEFINITIONS.filter((tab) => canAccessStockTab(snapshot, tab.id)).map(
    (tab) => tab.id,
  );
}

export function getVisibleStockTabsForVariant(
  snapshot: RolePermissionsSnapshot,
  variant: StockModuleVariant,
): StockTabId[] {
  return STOCK_TAB_DEFINITIONS.filter((tab) =>
    canAccessStockTabForVariant(snapshot, variant, tab.id),
  ).map((tab) => tab.id);
}

export function normalizeStockProductFilter(value: unknown): StockProductFilter {
  if (value === "all") {
    return "all";
  }
  return value === "bottled" ? "bottled" : "bulk";
}

/**
 * Main Stock screen variant: unified (loose + bottled) whenever the role can
 * write the stock module. Bottled-only roles (e.g. Store Keeper) open the
 * bottled-stock route instead (`routeVariant === "bottled"`).
 *
 * Stock Write also authorizes bottled document mutations on the main screen;
 * Bottled Stock Write remains for bottled-only keepers.
 */
export function resolveStockModuleVariant(
  snapshot: RolePermissionsSnapshot,
  routeVariant: "bulk" | "bottled",
): StockModuleVariant {
  if (routeVariant === "bottled") {
    return "bottled";
  }
  if (getStockModuleAccess(snapshot) === "write") {
    return "all";
  }
  return "bulk";
}

/** Bottled-only users (e.g. Store Keeper) use bottled stock; dual-write roles use unified all on Stock route. */
export function resolveStockProductFilterFromAccess(
  bulkAccess: RouteAccess,
  bottledAccess: RouteAccess,
  requested?: StockProductFilter | null,
  _bottledCapabilityAccess?: RouteAccess | null,
): StockProductFilter {
  const normalized =
    requested === undefined || requested === null
      ? null
      : normalizeStockProductFilter(requested);
  const hasBulk = bulkAccess !== "none";
  const hasBottledRoute = bottledAccess !== "none";

  // Bottled-primary users (e.g. Store Keeper): any bottled access without bulk write.
  if (hasBottledRoute && bulkAccess !== "write") {
    return "bottled";
  }
  // Main Stock writers: honor Loose / Bottled / All view filter.
  if (hasBulk && bulkAccess === "write") {
    if (normalized === "bottled") {
      return "bottled";
    }
    if (normalized === "bulk") {
      return "bulk";
    }
    return "all";
  }
  if (hasBulk && hasBottledRoute) {
    return normalizeStockProductFilter(requested);
  }
  if (hasBulk) {
    return normalized === "bottled" ? "bottled" : "bulk";
  }
  if (hasBottledRoute) {
    return "bottled";
  }
  return "bulk";
}

export function resolveStockProductFilterFromSnapshot(
  snapshot: RolePermissionsSnapshot,
  requested?: StockProductFilter | null,
): StockProductFilter {
  return resolveStockProductFilterFromAccess(
    getStockModuleAccess(snapshot),
    getBottledStockModuleAccess(snapshot),
    requested,
    getRouteAccess(snapshot, "stock-bin-card"),
  );
}
