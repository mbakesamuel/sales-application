export interface RouteDefinition {
  id: string;
  label: string;
  sectionId: string;
  table?: string;
}

export const ROUTE_DEFINITIONS: RouteDefinition[] = [
  { id: "sales", label: "Sales Invoice", sectionId: "sales", table: "Sale" },
  {
    id: "bottle-oil-sales",
    label: "Bottle Oil sales",
    sectionId: "sales",
    table: "Sale",
  },
  {
    id: "sales-validation",
    label: "Sales validation",
    sectionId: "sales",
    table: "Sale",
  },
  {
    id: "document-booklets",
    label: "Document booklets",
    sectionId: "sales",
    table: "DocumentBooklet",
  },
  {
    id: "booklet-validation",
    label: "Booklet validation",
    sectionId: "sales",
    table: "DocumentBooklet",
  },
  {
    id: "transport-cost-compute",
    label: "Transportation cost",
    sectionId: "sales",
    table: "Sale",
  },
  { id: "customers", label: "Customers", sectionId: "customers", table: "Customer" },
  {
    id: "customer-types",
    label: "Customer types",
    sectionId: "customers",
    table: "CustomerTypeDefinition",
  },
  { id: "products", label: "Products", sectionId: "products", table: "Product" },
  {
    id: "product-categories",
    label: "Categories",
    sectionId: "products",
    table: "ProductCat",
  },
  {
    id: "unit-prices",
    label: "Product unit prices",
    sectionId: "products",
    table: "ProductUnitPriceSchedule",
  },
  {
    id: "transport-rates",
    label: "Transport rates",
    sectionId: "products",
    table: "TransportRateSchedule",
  },
  {
    id: "sales-budgets",
    label: "Sales budgets",
    sectionId: "sales-budget",
    table: "ProductSalesBudget",
  },
  {
    id: "budget-phase-profiles",
    label: "Budget phase profiles",
    sectionId: "sales-budget",
    table: "ProductSalesBudgetMonthPhaseProfile",
  },
  {
    id: "sales-budget",
    label: "Sales budget phasing",
    sectionId: "sales-budget",
    table: "ProductSalesBudget",
  },
  {
    id: "sales-budget-monthly-crosstab",
    label: "Sales budget phasing (monthly)",
    sectionId: "sales-budget",
  },
  {
    id: "sales-budget-monthly-revenue-crosstab",
    label: "Sales budget revenue phasing (monthly)",
    sectionId: "sales-budget",
  },
  {
    id: "sales-budget-weekly-crosstab",
    label: "Sales budget phasing (weekly)",
    sectionId: "sales-budget",
  },
  {
    id: "sales-budget-weekly-revenue-crosstab",
    label: "Sales budget revenue phasing (weekly)",
    sectionId: "sales-budget",
  },
  {
    id: "delivery-orders",
    label: "Delivery orders",
    sectionId: "delivery",
    table: "DeliveryOrder",
  },
  {
    id: "delivery-order-tracking",
    label: "DO tracking",
    sectionId: "delivery",
    table: "DeliveryOrder",
  },
  {
    id: "delivery-order-transfer",
    label: "Transfer DO balance",
    sectionId: "delivery",
    table: "DeliveryOrder",
  },
  {
    id: "carry-forward-commitments",
    label: "Carry-forward commitments",
    sectionId: "delivery",
    table: "DeliveryOrder",
  },
  {
    id: "vehicle-consignment-notes",
    label: "Consignment notes",
    sectionId: "delivery",
    table: "VehicleConsignmentNote",
  },
  {
    id: "vehicle-consignment-validation",
    label: "Consignment validation",
    sectionId: "delivery",
    table: "VehicleConsignmentNote",
  },
  { id: "stock-balance", label: "Stock balance", sectionId: "inventory", table: "StockBalance" },
  {
    id: "stock",
    label: "Stock",
    sectionId: "inventory",
    table: "StockBalance",
  },
  {
    id: "bottled-stock",
    label: "Bottled Stock",
    sectionId: "inventory",
    table: "StockBalance",
  },
  {
    id: "receive-transfers",
    label: "Receive transfers",
    sectionId: "inventory",
    table: "StockTransfer",
  },
  {
    id: "stock-validation",
    label: "Stock validation",
    sectionId: "inventory",
    table: "StockTransfer",
  },
  {
    id: "carry-forward-stock",
    label: "Carry-forward stock",
    sectionId: "inventory",
    table: "StockBalance",
  },
  {
    id: "stock-bin-card",
    label: "Bin card",
    sectionId: "inventory",
    table: "StockMovement",
  },
  {
    id: "stock-bin-card-report",
    label: "Bin card report",
    sectionId: "reports",
  },
  {
    id: "stock-commitment-report",
    label: "Stock & commitment report",
    sectionId: "reports",
  },
  {
    id: "stock-report",
    label: "Stock report",
    sectionId: "reports",
  },
  {
    id: "commitment-report",
    label: "Commitment report",
    sectionId: "reports",
  },
  {
    id: "bottle-oil-stock-sales-report",
    label: "Bottle oil stock & sales",
    sectionId: "reports",
  },
  {
    id: "bottled-weekly-issues-report",
    label: "Bottled weekly issues",
    sectionId: "reports",
  },
  {
    id: "sales-delivery-report",
    label: "Sales / delivery report",
    sectionId: "reports",
  },
  {
    id: "daily-sales-report",
    label: "Daily sales report",
    sectionId: "reports",
  },
  {
    id: "daily-sales-matrix-report",
    label: "Daily sales summary (matrix)",
    sectionId: "reports",
  },
  {
    id: "monthly-delivery-report-h1",
    label: "Monthly delivery (Jan–Jun)",
    sectionId: "reports",
  },
  {
    id: "monthly-delivery-report-h2",
    label: "Monthly delivery (Jul–Dec)",
    sectionId: "reports",
  },
  {
    id: "monthly-stock-reconciliation-report",
    label: "Monthly stock reconciliation",
    sectionId: "reports",
  },
  {
    id: "loose-lpo-stock-summary-report",
    label: "Loose LPO stock summary",
    sectionId: "reports",
  },
  {
    id: "monthly-payment-delivery-report",
    label: "Monthly Payment/Delivery",
    sectionId: "reports",
  },
  {
    id: "transport-cost-report",
    label: "Transportation cost",
    sectionId: "reports",
  },
  {
    id: "monthly-deliveries-by-destination-report",
    label: "Deliveries by Destination",
    sectionId: "reports",
  },
  {
    id: "monthly-palm-oil-sales-report",
    label: "Monthly Palm Oil Sales",
    sectionId: "reports",
  },
  {
    id: "revenue-taxes-report",
    label: "Revenue & taxes",
    sectionId: "reports",
  },
  {
    id: "industry-product-monthly-sales-report",
    label: "Industry product monthly sales",
    sectionId: "reports",
  },
  {
    id: "bottled-palm-oil-sales-return-report",
    label: "Bottled palm oil sales return",
    sectionId: "reports",
  },
  {
    id: "monthly-bottled-oil-report",
    label: "Bottled Oil monthly",
    sectionId: "reports",
  },
  {
    id: "other-product-sales-deliveries-report",
    label: "Other product sales and deliveries",
    sectionId: "reports",
  },
  {
    id: "palm-oil-sales-activity-report",
    label: "Palm Oil Sales Activity",
    sectionId: "reports",
  },
  {
    id: "stock-movements",
    label: "Stock movements",
    sectionId: "inventory",
    table: "StockMovement",
  },
  {
    id: "stock-receipts",
    label: "Stock receipts",
    sectionId: "inventory",
    table: "StockReceipt",
  },
  {
    id: "stock-receipt-lines",
    label: "Receipt lines",
    sectionId: "inventory",
    table: "StockReceiptLine",
  },
  {
    id: "stock-transfers",
    label: "Stock transfers",
    sectionId: "inventory",
    table: "StockTransfer",
  },
  {
    id: "stock-transfer-lines",
    label: "Transfer lines",
    sectionId: "inventory",
    table: "StockTransferLine",
  },
  {
    id: "stock-adjustments",
    label: "Stock adjustments",
    sectionId: "inventory",
    table: "StockAdjustment",
  },
  {
    id: "stock-adjustment-lines",
    label: "Adjustment lines",
    sectionId: "inventory",
    table: "StockAdjustmentLine",
  },
  {
    id: "commercial-services",
    label: "Commercial services",
    sectionId: "organization",
    table: "CommercialService",
  },
  { id: "sales-points", label: "Collection points", sectionId: "organization", table: "SalesPoint" },
  { id: "locations", label: "Locations", sectionId: "organization", table: "Location" },
  {
    id: "storage-locations",
    label: "Storage locations",
    sectionId: "organization",
    table: "StorageLocation",
  },
  {
    id: "company-settings",
    label: "Company settings",
    sectionId: "organization",
    table: "CompanySettings",
  },
  {
    id: "report-settings",
    label: "Report settings",
    sectionId: "organization",
    table: "CompanySettings",
  },
  {
    id: "data-backup",
    label: "Data backup",
    sectionId: "organization",
  },
  {
    id: "sync-settings",
    label: "Data sync",
    sectionId: "organization",
  },
  {
    id: "tax-rate-schedules",
    label: "Tax rates",
    sectionId: "organization",
    table: "TaxRateSchedule",
  },
  { id: "tax-regimes", label: "Tax regimes", sectionId: "organization", table: "TaxRegime" },
  {
    id: "payment-methods",
    label: "Payment methods",
    sectionId: "organization",
    table: "PaymentMethodDefinition",
  },
  {
    id: "financial-year-periods",
    label: "Financial years",
    sectionId: "organization",
    table: "FinancialYearPeriod",
  },
  {
    id: "financial-months",
    label: "Financial months",
    sectionId: "organization",
    table: "FinancialMonth",
  },
  { id: "users", label: "Users", sectionId: "users-access", table: "User" },
  { id: "roles", label: "Roles", sectionId: "users-access" },
  {
    id: "role-permissions",
    label: "Role permissions",
    sectionId: "users-access",
  },
];

export const ROUTE_IDS = ROUTE_DEFINITIONS.map((route) => route.id);

export const TABLE_TO_ROUTE_ID: Record<string, string> = Object.fromEntries(
  ROUTE_DEFINITIONS.filter((route) => route.table).map((route) => [route.table!, route.id]),
);

export function getRouteLabel(routeId: string): string {
  return ROUTE_DEFINITIONS.find((route) => route.id === routeId)?.label ?? routeId;
}
