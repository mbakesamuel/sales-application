/** Built-in roles seeded on install. Custom roles may be added from the UI. */
export declare const SYSTEM_USER_ROLES: readonly ["ADMIN", "MANAGER", "SENIOR_SALES_SUPERVISOR", "STATISTICS_CLERK", "STORE_KEEPER"];
/** @deprecated Prefer SYSTEM_USER_ROLES; kept for defaults seeding compatibility. */
export declare const USER_ROLES: readonly ["ADMIN", "MANAGER", "SENIOR_SALES_SUPERVISOR", "STATISTICS_CLERK", "STORE_KEEPER"];
export type SystemUserRole = (typeof SYSTEM_USER_ROLES)[number];
/** @deprecated Use string role ids from the Role table. */
export type UserRole = SystemUserRole;
export type RouteAccess = "none" | "read" | "write";
/** Custom role id for bottled-stock / collection-point operators. */
export declare const STORE_KEEPER_ROLE_ID = "STORE_KEEPER";
/** Custom role id for junior sales supervisors (manageable role). */
export declare const JNR_SALES_SUP_ROLE_ID = "JNR_SALES_SUP";
export declare const SENIOR_SALES_SUPERVISOR_ROLE_ID = "SENIOR_SALES_SUPERVISOR";
export declare const STATISTICS_CLERK_ROLE_ID = "STATISTICS_CLERK";
export declare function isStoreKeeperRole(role: string): boolean;
export declare function isStatisticsClerkRole(role: string): boolean;
/**
 * @deprecated Prefer Role permissions actions
 * `draft_stock_transfers` / `post_stock_transfers` / `direct_post_stock_transfers`.
 * Kept for any external callers; always returns true so UI matrix is authoritative.
 */
export declare function canInitiateStockTransfers(_role: string): boolean;
/**
 * @deprecated Prefer Role permission action `receive_stock_transfers`.
 */
export declare function canReceiveStockTransfers(_role: string): boolean;
/**
 * @deprecated Collection-point scope is driven by User.salesPointId
 * (unassigned = company-wide). Role id bypass is no longer used.
 */
export declare function bypassesTransferInitiateScope(_role: string): boolean;
export declare function isSupervisorOverviewRole(role: string): boolean;
export declare const SYSTEM_ROLE_LABELS: Record<SystemUserRole, string>;
/** @deprecated Prefer SYSTEM_ROLE_LABELS or Role.label from the database. */
export declare const ROLE_LABELS: Record<"ADMIN" | "MANAGER" | "SENIOR_SALES_SUPERVISOR" | "STATISTICS_CLERK" | "STORE_KEEPER", string>;
export declare function isSystemUserRole(role: string): role is SystemUserRole;
export declare function formatRoleLabel(role: string, labels?: Record<string, string>): string;
/** Normalize to a system role id, or null if not a built-in role. */
export declare function normalizeUserRole(role: string): SystemUserRole | null;
/** Build a stable role id from a display label (e.g. "Store Keeper" → "STORE_KEEPER"). */
export declare function roleIdFromLabel(label: string): string;
export declare function isValidRoleId(id: string): boolean;
