import type { PermissionActionKey } from "../../../shared/permissions.types.js";
import { ROUTE_IDS } from "../../../shared/routeCatalog.js";
import type { RouteAccess } from "../../../shared/roles.js";
import { JNR_SALES_SUP_ROLE_ID, USER_ROLES } from "../../../shared/roles.js";

type RouteMatrix = Record<string, RouteAccess>;
type ActionMatrix = Record<PermissionActionKey, boolean>;

const ROUTE_GROUPS = {
  operations: [
    "sales",
    "bottle-oil-sales",
    "sales-validation",
    "document-booklets",
    "booklet-validation",
    "transport-cost-compute",
    "delivery-orders",
    "delivery-order-tracking",
    "delivery-order-transfer",
    "carry-forward-commitments",
    "vehicle-consignment-notes",
    "vehicle-consignment-validation",
  ],
  customerOps: ["customers"],
  productConfig: [
    "products",
    "product-categories",
    "unit-prices",
    "transport-rates",
    "sales-budgets",
    "budget-phase-profiles",
    "sales-budget-monthly-crosstab",
    "sales-budget-monthly-revenue-crosstab",
    "sales-budget-weekly-crosstab",
    "sales-budget-weekly-revenue-crosstab",
  ],
  inventoryWrite: [
    "stock",
    "bottled-stock",
    "stock-validation",
    "stock-receipts",
    "stock-receipt-lines",
    "stock-transfers",
    "stock-transfer-lines",
    "stock-adjustments",
    "stock-adjustment-lines",
    "carry-forward-stock",
  ],
  inventoryRead: [
    "stock",
    "stock-balance",
    "stock-movements",
    "carry-forward-stock",
    "stock-bin-card",
    "stock-bin-card-report",
    "stock-commitment-report",
    "stock-report",
    "commitment-report",
    "bottle-oil-stock-sales-report",
    "bottled-weekly-issues-report",
    "sales-delivery-report",
    "daily-sales-report",
    "daily-sales-matrix-report",
    "monthly-delivery-report-h1",
    "monthly-delivery-report-h2",
    "monthly-stock-reconciliation-report",
    "loose-lpo-stock-summary-report",
    "monthly-payment-delivery-report",
    "transport-cost-report",
    "monthly-deliveries-by-destination-report",
    "monthly-palm-oil-sales-report",
    "revenue-taxes-report",
    "industry-product-monthly-sales-report",
    "bottled-palm-oil-sales-return-report",
    "monthly-bottled-oil-report",
    "other-product-sales-deliveries-report",
    "palm-oil-sales-activity-report",
  ],
  organization: [
    "commercial-services",
    "sales-points",
    "locations",
    "storage-locations",
    "company-settings",
    "report-settings",
    "financial-year-periods",
    "financial-months",
  ],
  taxFinance: [
    "tax-rate-schedules",
    "tax-regimes",
    "payment-methods",
  ],
  usersAccess: ["users"],
} as const;

function buildRouteAccess(
  routeIds: readonly string[],
  level: Exclude<RouteAccess, "none"> = "write",
): RouteMatrix {
  const allowed = new Set(routeIds);
  return Object.fromEntries(
    ROUTE_IDS.map((routeId) => [routeId, allowed.has(routeId) ? level : "none"]),
  ) as RouteMatrix;
}

function buildDefaultRouteMatrix(): Record<string, RouteMatrix> {
  const usersAccess = new Set<string>(ROUTE_GROUPS.usersAccess);

  return {
    ADMIN: Object.fromEntries(ROUTE_IDS.map((routeId) => [routeId, "write"])) as RouteMatrix,
    MANAGER: Object.fromEntries(
      ROUTE_IDS.map((routeId) => [
        routeId,
        usersAccess.has(routeId) ? "none" : "write",
      ]),
    ) as RouteMatrix,
    SENIOR_SALES_SUPERVISOR: buildRouteAccess([
      ...ROUTE_GROUPS.operations,
      ...ROUTE_GROUPS.customerOps,
      ...ROUTE_GROUPS.inventoryRead,
      ...ROUTE_GROUPS.inventoryWrite,
    ]),
    STATISTICS_CLERK: (() => {
      const matrix = buildRouteAccess(
        [
          ...ROUTE_GROUPS.operations,
          "sales-budgets",
          "budget-phase-profiles",
          "sales-budget",
          "sales-budget-monthly-crosstab",
          "sales-budget-monthly-revenue-crosstab",
          "sales-budget-weekly-crosstab",
          "sales-budget-weekly-revenue-crosstab",
          ...ROUTE_GROUPS.inventoryRead,
          "financial-year-periods",
          "financial-months",
          "tax-rate-schedules",
          "tax-regimes",
        ],
        "read",
      );
      matrix["stock"] = "write";
      matrix["bottled-stock"] = "write";
      matrix["carry-forward-stock"] = "write";
      matrix["carry-forward-commitments"] = "write";
      return matrix;
    })(),
    STORE_KEEPER: buildRouteAccess([
      "bottled-stock",
      "bottle-oil-sales",
      "stock-bin-card",
      "stock-bin-card-report",
      "stock-commitment-report",
      "stock-report",
      "commitment-report",
      "bottle-oil-stock-sales-report",
      "bottled-weekly-issues-report",
    ]),
    [JNR_SALES_SUP_ROLE_ID]: buildRouteAccess([
      ...ROUTE_GROUPS.operations,
      ...ROUTE_GROUPS.customerOps,
      ...ROUTE_GROUPS.inventoryRead,
      ...ROUTE_GROUPS.inventoryWrite,
    ]),
  };
}

function buildDefaultActionMatrix(): Record<string, ActionMatrix> {
  const stockDocumentActions = {
    draft_stock_receipts: true,
    post_stock_receipts: true,
    draft_stock_transfers: true,
    post_stock_transfers: true,
    // Receive is granted per role in Role permissions (Store Keeper by default).
    receive_stock_transfers: false,
    draft_stock_adjustments: true,
    post_stock_adjustments: true,
    direct_post_stock_receipts: true,
    direct_post_stock_transfers: true,
    validate_stock_documents: true,
  } as const;

  const stockDocumentNone = {
    draft_stock_receipts: false,
    post_stock_receipts: false,
    draft_stock_transfers: false,
    post_stock_transfers: false,
    receive_stock_transfers: false,
    draft_stock_adjustments: false,
    post_stock_adjustments: false,
    direct_post_stock_receipts: false,
    direct_post_stock_transfers: false,
    validate_stock_documents: false,
  } as const;

  const validator: ActionMatrix = {
    validate_sales: true,
    direct_validate_sales: false,
    cancel_validated_sales: false,
    delete_validated_sales: false,
    validate_delivery_orders: true,
    cancel_validated_delivery_order: false,
    transfer_delivery_order_balance: true,
    validate_vehicle_consignment_notes: true,
    validate_document_booklets: true,
    manage_permissions: false,
    ...stockDocumentActions,
  };

  const manager: ActionMatrix = {
    ...validator,
    cancel_validated_sales: true,
    cancel_validated_delivery_order: true,
    direct_post_stock_receipts: true,
    direct_post_stock_transfers: true,
  };

  const admin: ActionMatrix = {
    ...manager,
    delete_validated_sales: true,
    manage_permissions: true,
    receive_stock_transfers: true,
  };

  const seniorSupervisor: ActionMatrix = {
    ...validator,
    direct_post_stock_receipts: false,
    direct_post_stock_transfers: false,
  };

  const none: ActionMatrix = {
    validate_sales: false,
    direct_validate_sales: false,
    cancel_validated_sales: false,
    delete_validated_sales: false,
    validate_delivery_orders: false,
    cancel_validated_delivery_order: false,
    transfer_delivery_order_balance: false,
    validate_vehicle_consignment_notes: false,
    validate_document_booklets: false,
    manage_permissions: false,
    ...stockDocumentNone,
  };

  const statisticsClerkTransferOperator: ActionMatrix = {
    ...none,
    draft_stock_transfers: true,
    post_stock_transfers: true,
    receive_stock_transfers: false,
  };

  const storeKeeperBottleReception: ActionMatrix = {
    ...none,
    draft_stock_receipts: true,
    post_stock_receipts: true,
    direct_post_stock_receipts: true,
    draft_stock_adjustments: true,
    post_stock_adjustments: true,
    receive_stock_transfers: false,
  };

  return {
    ADMIN: admin,
    MANAGER: manager,
    SENIOR_SALES_SUPERVISOR: seniorSupervisor,
    STATISTICS_CLERK: statisticsClerkTransferOperator,
    STORE_KEEPER: storeKeeperBottleReception,
    [JNR_SALES_SUP_ROLE_ID]: seniorSupervisor,
  };
}

export function getDefaultRouteMatrix(): Record<string, RouteMatrix> {
  const matrix = buildDefaultRouteMatrix();
  for (const role of USER_ROLES) {
    matrix[role]["roles"] = role === "ADMIN" ? "write" : "none";
    matrix[role]["role-permissions"] =
      role === "ADMIN" ? "write" : "none";
    matrix[role]["data-backup"] = role === "ADMIN" ? "write" : "none";
    matrix[role]["sync-settings"] = role === "ADMIN" ? "write" : (role === "MANAGER" ? "read" : "none");
  }
  return matrix;
}

export function getDefaultActionMatrix(): Record<string, ActionMatrix> {
  return buildDefaultActionMatrix();
}
