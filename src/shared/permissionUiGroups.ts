import { PERMISSION_ACTIONS, type PermissionActionKey } from "./permissions.types.js";
import { ROUTE_IDS } from "./routeCatalog.js";

export interface PermissionUiGroup {
  id: string;
  label: string;
  routeIds: readonly string[];
  actionKeys: readonly PermissionActionKey[];
}

/**
 * Operator-facing order for the Role permissions matrix.
 * Every catalog route id and every permission action key must appear in exactly one group.
 */
export const PERMISSION_UI_GROUPS: readonly PermissionUiGroup[] = [
  {
    id: "loose-sales",
    label: "Loose sales",
    routeIds: ["sales"],
    actionKeys: [],
  },
  {
    id: "bottle-oil-sales",
    label: "Bottle Oil sales",
    routeIds: ["bottle-oil-sales"],
    actionKeys: [],
  },
  {
    id: "sales-validation",
    label: "Sales validation",
    routeIds: ["sales-validation"],
    actionKeys: [
      "validate_sales",
      "direct_validate_sales",
      "cancel_validated_sales",
      "delete_validated_sales",
    ],
  },
  {
    id: "document-booklets",
    label: "Document booklets",
    routeIds: ["document-booklets", "booklet-validation"],
    actionKeys: ["validate_document_booklets"],
  },
  {
    id: "transportation-cost",
    label: "Transportation cost",
    routeIds: ["transport-cost-compute"],
    actionKeys: [],
  },
  {
    id: "customers",
    label: "Customers",
    routeIds: ["customers", "customer-types"],
    actionKeys: [],
  },
  {
    id: "products",
    label: "Products",
    routeIds: ["products", "product-categories", "unit-prices", "transport-rates"],
    actionKeys: [],
  },
  {
    id: "sales-budget",
    label: "Sales budget",
    routeIds: [
      "sales-budgets",
      "budget-phase-profiles",
      "sales-budget",
      "sales-budget-monthly-crosstab",
      "sales-budget-monthly-revenue-crosstab",
      "sales-budget-weekly-crosstab",
      "sales-budget-weekly-revenue-crosstab",
    ],
    actionKeys: [],
  },
  {
    id: "delivery-orders",
    label: "Delivery orders",
    routeIds: [
      "carry-forward-commitments",
      "delivery-orders",
      "delivery-order-tracking",
      "delivery-order-transfer",
      "vehicle-consignment-notes",
      "vehicle-consignment-validation",
    ],
    actionKeys: [
      "validate_delivery_orders",
      "cancel_validated_delivery_order",
      "transfer_delivery_order_balance",
      "validate_vehicle_consignment_notes",
    ],
  },
  {
    id: "stocks",
    label: "Stocks",
    routeIds: [
      "carry-forward-stock",
      "stock",
      "bottled-stock",
      // Retired from sidebar; kept for Role permissions matrix completeness.
      "receive-transfers",
      "stock-validation",
      "stock-bin-card",
    ],
    actionKeys: [
      "draft_stock_receipts",
      "post_stock_receipts",
      "direct_post_stock_receipts",
      "draft_stock_transfers",
      "post_stock_transfers",
      "receive_stock_transfers",
      "direct_post_stock_transfers",
      "draft_stock_adjustments",
      "post_stock_adjustments",
      "validate_stock_documents",
    ],
  },
  {
    id: "legacy-stock-tables",
    label: "Legacy stock tables",
    routeIds: [
      "stock-balance",
      "stock-movements",
      "stock-receipts",
      "stock-receipt-lines",
      "stock-transfers",
      "stock-transfer-lines",
      "stock-adjustments",
      "stock-adjustment-lines",
    ],
    actionKeys: [],
  },
  {
    id: "reports",
    label: "Reports",
    routeIds: [
      // Daily
      "daily-sales-report",
      "daily-sales-matrix-report",
      // Weekly
      "stock-commitment-report",
      "stock-report",
      "commitment-report",
      "bottle-oil-stock-sales-report",
      "bottled-weekly-issues-report",
      "sales-delivery-report",
      // Monthly
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
      // Annual
      "palm-oil-sales-activity-report",
      // Opened from bin card (not sidebar)
      "stock-bin-card-report",
    ],
    actionKeys: [],
  },
  {
    id: "general-parameters",
    label: "General parameters",
    routeIds: [
      "company-settings",
      "report-settings",
      "data-backup",
      "sync-settings",
      "financial-year-periods",
      "financial-months",
      "commercial-services",
      "sales-points",
      "locations",
      "storage-locations",
      "payment-methods",
      "tax-regimes",
      "tax-rate-schedules",
    ],
    actionKeys: [],
  },
  {
    id: "users-access",
    label: "Users and access",
    routeIds: ["users", "roles", "role-permissions"],
    actionKeys: ["manage_permissions"],
  },
];

function assertPermissionUiGroupsComplete(): void {
  const routeSeen = new Set<string>();
  const actionSeen = new Set<string>();

  for (const group of PERMISSION_UI_GROUPS) {
    for (const routeId of group.routeIds) {
      if (routeSeen.has(routeId)) {
        throw new Error(`permissionUiGroups: route "${routeId}" listed in more than one group`);
      }
      routeSeen.add(routeId);
    }
    for (const actionKey of group.actionKeys) {
      if (actionSeen.has(actionKey)) {
        throw new Error(
          `permissionUiGroups: action "${actionKey}" listed in more than one group`,
        );
      }
      actionSeen.add(actionKey);
    }
  }

  for (const routeId of ROUTE_IDS) {
    if (!routeSeen.has(routeId)) {
      throw new Error(`permissionUiGroups: route "${routeId}" is missing from groups`);
    }
  }
  for (const actionKey of PERMISSION_ACTIONS) {
    if (!actionSeen.has(actionKey)) {
      throw new Error(`permissionUiGroups: action "${actionKey}" is missing from groups`);
    }
  }

  for (const routeId of routeSeen) {
    if (!ROUTE_IDS.includes(routeId)) {
      throw new Error(`permissionUiGroups: unknown route "${routeId}"`);
    }
  }
  for (const actionKey of actionSeen) {
    if (!(PERMISSION_ACTIONS as readonly string[]).includes(actionKey)) {
      throw new Error(`permissionUiGroups: unknown action "${actionKey}"`);
    }
  }
}

assertPermissionUiGroupsComplete();
