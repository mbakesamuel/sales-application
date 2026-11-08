import type { BottledPackColumn } from "../../shared/reports.types.js";
import { isStorageLocationEffectivelySellable } from "../../shared/storageLocationSellability.js";
import {
  filterByCollectionPointScope,
  getUserCollectionPointId,
} from "../auth/collectionPointScope.js";
import { getDatabase } from "../db/index.js";

export const PALM_OIL_KG_PER_LITRE = 0.85;

export const BOTTLED_PACK_ORDER = ["jug20", "carton5", "carton15", "unit1", "other"] as const;

export interface SalesPointRow {
  id: number;
  name: string;
}

export interface StorageLocationRow {
  id: number;
  salesPointId: number;
  name: string;
  isActive: boolean;
  isSalesTank: boolean;
  /** Derived from location isActive. */
  effectivelySellable: boolean;
}

export interface ProductRow {
  productId: number;
  productName: string;
  productCode: string | null;
  productCatId: number;
  isMain: number;
  isBottled: number;
}

export function nowIso(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export function parseQty(value: string | number | null | undefined): number {
  if (value == null) {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function loadSalesPoints(): SalesPointRow[] {
  return getDatabase()
    .prepare(`SELECT id, name FROM SalesPoint ORDER BY name ASC`)
    .all() as SalesPointRow[];
}

/** Sales points visible to the actor (assigned CP only when scoped). */
export function loadSalesPointsForUser(userId?: string | null): SalesPointRow[] {
  const scopedId =
    userId != null && userId !== "" ? getUserCollectionPointId(userId) : null;
  return filterByCollectionPointScope(loadSalesPoints(), scopedId);
}

/**
 * Effective report collection-point filter.
 * Scoped users are forced to their assigned CP (UI "all"/other ids ignored).
 * Unscoped users keep the optional requested filter (`null` = all).
 */
export function resolveReportSalesPointId(
  userId: string | null | undefined,
  requested?: number | null,
): number | null {
  if (userId != null && userId !== "") {
    const scoped = getUserCollectionPointId(userId);
    if (scoped != null) {
      return scoped;
    }
  }
  if (requested != null && Number.isFinite(Number(requested))) {
    return Number(requested);
  }
  return null;
}

/** Actor's assigned CP id, or null when unscoped / anonymous. */
export function reportScopedSalesPointId(
  userId?: string | null,
): number | null {
  if (userId == null || userId === "") {
    return null;
  }
  return getUserCollectionPointId(userId);
}

export function loadStorageLocations(): StorageLocationRow[] {
  return getDatabase()
    .prepare(
      `SELECT sl.id, sl.salesPointId, l.locationName AS name,
              COALESCE(sl.isActive, 1) AS isActive,
              COALESCE(sl.isSalesTank, 0) AS isSalesTank
       FROM StorageLocation sl
       INNER JOIN Location l ON l.id = sl.locationId
       ORDER BY sl.salesPointId ASC, l.locationName ASC`,
    )
    .all()
    .map((row) => {
      const isActive = (row as { isActive: number }).isActive === 1;
      return {
        id: (row as { id: number }).id,
        salesPointId: Number((row as { salesPointId: number }).salesPointId),
        name: (row as { name: string }).name,
        isActive,
        isSalesTank: (row as { isSalesTank: number }).isSalesTank === 1,
        effectivelySellable: isStorageLocationEffectivelySellable({ isActive }),
      };
    });
}

/** Storage locations for the actor's collection point when scoped. */
export function loadStorageLocationsForUser(
  userId?: string | null,
): StorageLocationRow[] {
  const scopedId = reportScopedSalesPointId(userId);
  const locations = loadStorageLocations();
  if (scopedId == null) {
    return locations;
  }
  return locations.filter((row) => row.salesPointId === scopedId);
}

/**
 * Append `AND <column> = ?` when scopedOrRequested is set.
 * Returns `{ clause, params }` to merge into prepared statements.
 */
export function salesPointFilterSql(
  column: string,
  salesPointId: number | null | undefined,
): { clause: string; params: number[] } {
  if (salesPointId != null && Number.isFinite(Number(salesPointId))) {
    return { clause: ` AND ${column} = ?`, params: [Number(salesPointId)] };
  }
  return { clause: "", params: [] };
}

export function loadProducts(): ProductRow[] {
  return getDatabase()
    .prepare(
      `SELECT p.productId, p.productName, p.productCode, p.productCatId,
              COALESCE(pc.isMain, 0) AS isMain, COALESCE(pc.isBottled, 0) AS isBottled
       FROM Product p
       LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
       ORDER BY p.productName ASC`,
    )
    .all() as ProductRow[];
}

export function detectBottledPack(product: Pick<ProductRow, "productName" | "productCode">): BottledPackColumn {
  // Compact so "1X 15L" / "3 X 5L" match; check 15L before 5L ("15L" contains "5L").
  const text = `${product.productName} ${product.productCode ?? ""}`
    .toUpperCase()
    .replace(/\s+/g, "");
  if (text.includes("20L") || text.includes("JUG")) {
    return { id: "jug20", label: "1X20L JUG", units: 0, litresPerUnit: 20 };
  }
  if (text.includes("15L") || text.includes("1X15") || text.includes("1LX15")) {
    return { id: "carton15", label: "1X15L CTN", units: 0, litresPerUnit: 15 };
  }
  if (text.includes("3X5") || (text.includes("5L") && text.includes("CTN"))) {
    return { id: "carton5", label: "3X5L CTN", units: 0, litresPerUnit: 15 };
  }
  if (text.includes("1L")) {
    return { id: "unit1", label: "1L BOTTLE", units: 0, litresPerUnit: 1 };
  }
  return { id: "other", label: "OTHER", units: 0, litresPerUnit: 1 };
}
