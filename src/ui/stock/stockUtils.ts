import type { StockBalanceRow, StorageLocationOption } from "../../shared/stock.types.ts";
import {
  formatDisplayDate,
  formatDisplayDateTime,
} from "../../shared/formatDisplayDate.ts";

export function formatDateTime(iso: string | null | undefined): string {
  return formatDisplayDateTime(iso);
}

export function formatDate(iso: string | null | undefined): string {
  return formatDisplayDate(iso);
}

export function trimQty(qty: string): string {
  if (!qty.includes(".")) return qty;
  const trimmed = qty.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed || "0";
}

export function locationsForSalesPoint(
  storageLocations: StorageLocationOption[],
  salesPointId: string | number,
): StorageLocationOption[] {
  const spId = Number(salesPointId);
  if (!Number.isFinite(spId)) return [];
  return storageLocations.filter((l) => l.salesPointId === spId);
}

/** Storage locations eligible for goods-in receipts (excludes sales tanks). */
export function locationsForReceiptAtSalesPoint(
  storageLocations: StorageLocationOption[],
  salesPointId: string | number,
  forBottled?: boolean,
): StorageLocationOption[] {
  const base = locationsForSalesPoint(storageLocations, salesPointId).filter(
    (location) => !location.isSalesTank,
  );
  if (forBottled === true) {
    return base.filter((location) => isBottleOilStoreLocationName(location.name));
  }
  if (forBottled === false) {
    return base.filter((location) => !isBottleOilStoreLocationName(location.name));
  }
  return base;
}

export function defaultLocationId(
  storageLocations: StorageLocationOption[],
  salesPointId: string | number,
): string {
  const locs = locationsForSalesPoint(storageLocations, salesPointId);
  const d = locs.find((l) => l.isDefault) ?? locs[0];
  return d ? String(d.id) : "";
}

function isBottleOilStoreLocationName(name: string): boolean {
  return name.toLowerCase().includes("bottle");
}

export function isBottleOilStoreLocation(name: string): boolean {
  return isBottleOilStoreLocationName(name);
}

/** Loose-product intra transfer destinations (excludes Bottle Oil Store). */
export function locationsForIntraTransferDestination(
  storageLocations: StorageLocationOption[],
  salesPointId: string | number,
): StorageLocationOption[] {
  return locationsForSalesPoint(storageLocations, salesPointId).filter(
    (location) => !isBottleOilStoreLocationName(location.name),
  );
}

export function defaultIntraToLocationId(
  storageLocations: StorageLocationOption[],
  salesPointId: string | number,
  excludeLocationId: string,
): string {
  const locs = locationsForIntraTransferDestination(storageLocations, salesPointId);
  const other = locs.find((loc) => String(loc.id) !== excludeLocationId);
  return other ? String(other.id) : "";
}

export function defaultReceiptLocationId(
  storageLocations: StorageLocationOption[],
  salesPointId: string | number,
  forBottled = false,
): string {
  const locs = locationsForReceiptAtSalesPoint(
    storageLocations,
    salesPointId,
    forBottled,
  );
  if (forBottled) {
    const bottleStore = locs[0];
    if (bottleStore) {
      return String(bottleStore.id);
    }
  }
  const d = locs.find((l) => l.isDefault) ?? locs[0];
  return d ? String(d.id) : "";
}

const QTY_EPS = 0.000001;

function hasPositiveQty(qty: string): boolean {
  const n = Number.parseFloat(qty);
  return Number.isFinite(n) && Math.abs(n) > QTY_EPS;
}

/**
 * Locations eligible for receiving this product.
 * Mirrors backend assertStorageLocationProductRules:
 * - Bottled products may share a location with other bottled products.
 * - Bulk products: empty, same product, or allowsMultiProduct only.
 * - Bottled and bulk must never share a location.
 */
export function receiptLocationOptionsForProduct(
  locationOptions: StorageLocationOption[],
  onHand: StockBalanceRow[],
  salesPointId: string | number,
  productId: string,
  products: Array<{ productId: number; isBottled: boolean }> = [],
): StorageLocationOption[] {
  if (!productId) {
    return locationOptions;
  }

  const spId = Number(salesPointId);
  const productIdNum = Number(productId);
  if (!Number.isFinite(spId) || !Number.isFinite(productIdNum)) {
    return locationOptions;
  }

  const bottledByProductId = new Map<number, boolean>();
  for (const product of products) {
    bottledByProductId.set(product.productId, product.isBottled);
  }
  const incomingBottled = bottledByProductId.get(productIdNum) === true;

  /** locationId → productIds with positive on-hand */
  const occupantsByLocation = new Map<number, Set<number>>();
  for (const row of onHand) {
    if (
      row.salesPointId !== spId ||
      row.storageLocationId == null ||
      !hasPositiveQty(row.qty)
    ) {
      continue;
    }
    let set = occupantsByLocation.get(row.storageLocationId);
    if (!set) {
      set = new Set();
      occupantsByLocation.set(row.storageLocationId, set);
    }
    set.add(row.productId);
  }

  return locationOptions.filter((loc) => {
    const occupants = occupantsByLocation.get(loc.id);
    if (!occupants || occupants.size === 0) {
      return true;
    }
    if (occupants.has(productIdNum)) {
      return true;
    }

    const otherProductIds = [...occupants].filter((id) => id !== productIdNum);
    if (otherProductIds.length === 0) {
      return true;
    }

    const kindMismatch = otherProductIds.some((id) => {
      const otherBottled = bottledByProductId.get(id) === true;
      return otherBottled !== incomingBottled;
    });
    if (kindMismatch) {
      return false;
    }

    // Bottled products may co-mingle with other bottled products.
    if (incomingBottled) {
      return true;
    }

    return loc.allowsMultiProduct === true;
  });
}

export function utcIsoDateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Clamp YYYY-MM-DD into [startDate, endDate] when a period is provided. */
export function clampIsoDateToRange(
  isoDate: string,
  range: { startDate: string; endDate: string } | null | undefined,
): string {
  if (!range) {
    return isoDate;
  }
  if (isoDate < range.startDate) {
    return range.startDate;
  }
  if (isoDate > range.endDate) {
    return range.endDate;
  }
  return isoDate;
}
