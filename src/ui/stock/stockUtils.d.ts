import type { StockBalanceRow, StorageLocationOption } from "../../shared/stock.types.ts";
export declare function formatDateTime(iso: string | null | undefined): string;
export declare function formatDate(iso: string | null | undefined): string;
export declare function trimQty(qty: string): string;
export declare function locationsForSalesPoint(storageLocations: StorageLocationOption[], salesPointId: string | number): StorageLocationOption[];
/** Storage locations eligible for goods-in receipts (excludes sales tanks). */
export declare function locationsForReceiptAtSalesPoint(storageLocations: StorageLocationOption[], salesPointId: string | number, forBottled?: boolean): StorageLocationOption[];
export declare function defaultLocationId(storageLocations: StorageLocationOption[], salesPointId: string | number): string;
export declare function isBottleOilStoreLocation(name: string): boolean;
/** Loose-product intra transfer destinations (excludes Bottle Oil Store). */
export declare function locationsForIntraTransferDestination(storageLocations: StorageLocationOption[], salesPointId: string | number): StorageLocationOption[];
export declare function defaultIntraToLocationId(storageLocations: StorageLocationOption[], salesPointId: string | number, excludeLocationId: string): string;
export declare function defaultReceiptLocationId(storageLocations: StorageLocationOption[], salesPointId: string | number, forBottled?: boolean): string;
/**
 * Locations eligible for receiving this product.
 * Mirrors backend assertStorageLocationProductRules:
 * - Bottled products may share a location with other bottled products.
 * - Bulk products: empty, same product, or allowsMultiProduct only.
 * - Bottled and bulk must never share a location.
 */
export declare function receiptLocationOptionsForProduct(locationOptions: StorageLocationOption[], onHand: StockBalanceRow[], salesPointId: string | number, productId: string, products?: Array<{
    productId: number;
    isBottled: boolean;
}>): StorageLocationOption[];
export declare function utcIsoDateToday(): string;
/** Clamp YYYY-MM-DD into [startDate, endDate] when a period is provided. */
export declare function clampIsoDateToRange(isoDate: string, range: {
    startDate: string;
    endDate: string;
} | null | undefined): string;
