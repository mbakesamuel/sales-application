import { ROUTE_DEFINITIONS } from "../../shared/routeCatalog.ts";

export interface SchemaRoute {
  id: string;
  label: string;
  table: string;
  description: string;
}

export interface SchemaRouteGroup {
  id: string;
  label: string;
  routes: SchemaRoute[];
}

export interface SchemaRouteSection {
  id: string;
  label: string;
  routes: SchemaRoute[];
  groups?: SchemaRouteGroup[];
}

export const SCHEMA_ROUTE_SECTIONS: SchemaRouteSection[] = [
  {
    id: "organization",
    label: "General Parameters",
    routes: [
      {
        id: "company-settings",
        label: "App settings",
        table: "CompanySettings",
        description: "Company-wide configuration.",
      },
      {
        id: "report-settings",
        label: "Report settings",
        table: "CompanySettings",
        description: "Display options for stock and delivery reports.",
      },
      {
        id: "data-backup",
        label: "Data backup",
        table: "",
        description: "Create and restore full database backups (ADMIN).",
      },
      {
        id: "sync-settings",
        label: "Data sync",
        table: "SyncState",
        description: "Central PostgreSQL synchronization settings and status (ADMIN).",
      },
      {
        id: "financial-year-periods",
        label: "Financial year",
        table: "FinancialYearPeriod",
        description: "Open and closed financial years.",
      },
      {
        id: "financial-months",
        label: "Financial month",
        table: "FinancialMonth",
        description:
          "Open and close calendar months for the current financial year.",
      },
      {
        id: "commercial-services",
        label: "Services",
        table: "CommercialService",
        description: "Commercial service sites and modules.",
      },
      {
        id: "sales-points",
        label: "Collection points",
        table: "SalesPoint",
        description: "Sales outlet locations.",
      },
      {
        id: "locations",
        label: "Oil storage Locations",
        table: "Location",
        description: "Reusable location name definitions.",
      },
      {
        id: "storage-locations",
        label: "Locations Assignment",
        table: "StorageLocation",
        description: "Assign locations to collection points.",
      },
      {
        id: "payment-methods",
        label: "Payment Options",
        table: "PaymentMethodDefinition",
        description: "Accepted payment methods.",
      },
      {
        id: "tax-regimes",
        label: "Tax Regime",
        table: "TaxRegime",
        description: "Actual vs Simplified tax regimes.",
      },
      {
        id: "tax-rate-schedules",
        label: "Tax Rate Schedule",
        table: "TaxRateSchedule",
        description: "Date-effective VAT and sales-tax rates.",
      },
      {
        id: "transport-rates",
        label: "Transport Rates",
        table: "TransportRateSchedule",
        description: "Transport cost per kg by collection point and product.",
      },
    ],
  },
  {
    id: "customers",
    label: "Customers",
    routes: [
      {
        id: "customers",
        label: "Customers",
        table: "Customer",
        description: "Customer accounts and profiles.",
      },
      {
        id: "customer-types",
        label: "Customer Types",
        table: "CustomerTypeDefinition",
        description: "Customer type definitions.",
      },
    ],
  },
  {
    id: "products",
    label: "Products",
    routes: [
      {
        id: "products",
        label: "Products",
        table: "Product",
        description: "Product catalog.",
      },
      {
        id: "product-categories",
        label: "Product Categories",
        table: "ProductCat",
        description: "Product categories and codes.",
      },
      {
        id: "unit-prices",
        label: "Product Unit Prices",
        table: "ProductUnitPriceSchedule",
        description: "Scheduled product unit prices.",
      },
    ],
  },
  {
    id: "sales-budget",
    label: "Sales Budget",
    routes: [
      {
        id: "sales-budget",
        label: "12 Months Phasing",
        table: "ProductSalesBudget",
        description: "Set annual quantities and monthly phasing profiles.",
      },   
     
    ],
  },
  {
    id: "inventory",
    label: "Stock",
    routes: [
      {
        id: "carry-forward-stock",
        label: "Opening Stock balances",
        table: "StockBalance",
        description:
          "Enter opening / carried-forward on-hand quantities by collection point and location.",
      },
      {
        id: "stock",
        label: "Stock",
        table: "StockBalance",
        description:
          "Manage loose and bottled stock balance, movements, receipts, transfers, and adjustments.",
      },
      {
        id: "bottled-stock",
        label: "Bottle Stock",
        table: "StockBalance",
        description:
          "Bin card ledger, transfers, and adjustments for bottled products.",
      },
      {
        id: "receive-transfers",
        label: "Receive transfers",
        table: "StockTransfer",
        description:
          "Review and receive dispatched bottled transfers at your collection point.",
      },
      {
        id: "stock-validation",
        label: "Stock validation",
        table: "StockTransfer",
        description:
          "Review and validate draft stock receipts, transfers, and adjustments.",
      },
    ],
  },
  {
    id: "delivery",
    label: "Delivery Order",
    routes: [
      {
        id: "carry-forward-commitments",
        label: "Register Commitments",
        table: "DeliveryOrder",
        description:
          "Enter opening / carried-forward customer commitments by product and collection point.",
      },
      {
        id: "delivery-orders",
        label: "Delivery Order",
        table: "DeliveryOrder",
        description:
          "Browse the DO list; create or edit delivery orders in a modal; validate pending DOs.",
      },
      {
        id: "delivery-order-tracking",
        label: "DO tracking",
        table: "DeliveryOrder",
        description:
          "Track a delivery order by number: commitment, lifts, and remaining.",
      },
      {
        id: "delivery-order-transfer",
        label: "Transfer DO balance",
        table: "DeliveryOrder",
        description:
          "Move remaining DO commitment from one collection point to another.",
      },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    routes: [
      {
        id: "sales",
        label: "Invoicing",
        table: "Sale",
        description:
          "Create and manage loose-product sales invoices (POS screen).",
      },
      {
        id: "bottle-oil-sales",
        label: "Bottle Oil sales",
        table: "Sale",
        description: "Create and manage bottled palm-oil sales invoices.",
      },
      {
        id: "sales-validation",
        label: "Sales validation",
        table: "Sale",
        description: "Review and validate pending sales invoices.",
      },
      {
        id: "document-booklets",
        label: "Document booklets",
        table: "DocumentBooklet",
        description:
          "Register and manage sales invoice and delivery order booklets issued to collection points.",
      },
      {
        id: "booklet-validation",
        label: "Booklet validation",
        table: "DocumentBooklet",
        description:
          "Review and validate pending document booklet issuances.",
      },
      {
        id: "vehicle-consignment-validation",
        label: "Consignment validation",
        table: "VehicleConsignmentNote",
        description: "Review and validate pending vehicle consignment notes.",
      },
      {
        id: "vehicle-consignment-notes",
        label: "Consignment notes",
        table: "VehicleConsignmentNote",
        description:
          "Prepare and validate vehicle consignment notes for validated sales.",
      },
      {
        id: "transport-cost-compute",
        label: "Transportation cost",
        table: "Sale",
        description:
          "Compute transportation cost for quantities lifted by a customer at a collection point in the open month.",
      },
    ],
  },
  (() => {
    const dailyRoutes: SchemaRoute[] = [
      {
        id: "daily-sales-report",
        label: "Sales Summary",
        table: "Sale",
        description:
          "Daily sales detail by product with DO lines and customer-type summary.",
      },
      {
        id: "daily-sales-matrix-report",
        label: "Day to Day Sales Details",
        table: "Sale",
        description:
          "Monthly day-by-day sales matrix by customer category with transfer column.",
      },
    ];
    const weeklyRoutes: SchemaRoute[] = [
      {
        id: "sales-budget-weekly-crosstab",
        label: "Quantity Phasing",
        table: "ProductSalesBudget",
        description: "Weekly phased budget kg crosstab by product and month.",
      },
      {
        id: "sales-budget-weekly-revenue-crosstab",
        label: "Revenue Phasing",
        table: "ProductSalesBudget",
        description: "Weekly phased budget revenue (XAF) crosstab by product and month.",
      },
      {
        id: "stock-commitment-report",
        label: "Stock Summary",
        table: "StockBalance",
        description:
          "Stock and delivery-order commitment report for management.",
      },
      {
        id: "stock-report",
        label: "Stock",
        table: "StockBalance",
        description: "Stock by collection point and storage location.",
      },
      {
        id: "commitment-report",
        label: "Commitments",
        table: "DeliveryOrder",
        description:
          "Outstanding delivery-order commitments by customer and collection point.",
      },
      {
        id: "bottle-oil-stock-sales-report",
        label: "Bottle Stock",
        table: "StockBalance",
        description:
          "Bottled palm oil stock by collection point and monthly sales to date.",
      },
      {
        id: "bottled-weekly-issues-report",
        label: "Bottle Sales",
        table: "Sale",
        description:
          "Bottled palm oil issues Mon–Fri by payment method, with MTD and YTD summary.",
      },
      {
        id: "sales-delivery-report",
        label: "Sales/Delivery By Product",
        table: "Sale",
        description: "Weekly sales and deliveries by customer category.",
      },
    ];
    const monthlyRoutes: SchemaRoute[] = [
      {
        id: "sales-budget-monthly-crosstab",
        label: "12-MTH Quantity Phasing",
        table: "ProductSalesBudget",
        description: "Monthly phased budget kg crosstab by product.",
      },
      {
        id: "sales-budget-monthly-revenue-crosstab",
        label: "12-MTH Revenue Phasing",
        table: "ProductSalesBudget",
        description: "Monthly phased budget revenue (XAF) crosstab by product.",
      },
      {
        id: "monthly-delivery-report-h1",
        label: "Delivery By Product/Cust Category (Jan–Jun)",
        table: "Sale",
        description: "Monthly deliveries and value for January through June.",
      },
      {
        id: "monthly-delivery-report-h2",
        label: "Delivery By Product/Cust Category (Jul–Dec)",
        table: "Sale",
        description: "Monthly deliveries and value for July through December.",
      },
      {
        id: "loose-lpo-stock-summary-report",
        label: "Stock Summary",
        table: "StockBalance",
        description:
          "Company-total loose palm oil opening, reception, issues, and calculated stock for the month and fiscal YTD.",
      },
      {
        id: "monthly-stock-reconciliation-report",
        label: "Stock Reconciliation",
        table: "StockBalance",
        description:
          "Open-month LPO opening/reception/issues reconciliation with BPO and palm-kernel rows.",
      },
     
      {
        id: "monthly-payment-delivery-report",
        label: "Sales/Delivery LPO",
        table: "Sale",
        description:
          "Open-month weekly bottled (Payments) vs other-product (Deliveries) sales kg and value.",
      },
      {
        id: "transport-cost-report",
        label: "Transportation cost",
        table: "Sale",
        description:
          "Open-month transportation cost for all customers by collection point and product.",
      },
      {
        id: "monthly-deliveries-by-destination-report",
        label: "Deliveries By Cust. Cat",
        table: "Sale",
        description:
          "Open-month weekly non-bottled deliveries (kg) by customer-type destination.",
      },
      {
        id: "monthly-palm-oil-sales-report",
        label: "Monthly Sales - LPO",
        table: "Sale",
        description:
          "Full-year LPO by destination and BPO in tons and '000 FRS (taxes excluded).",
      },
      {
        id: "other-product-sales-deliveries-report",
        label: "Sales/Deliveries - Other Prod.",
        table: "Sale",
        description:
          "Open-month non-LPO / non-bottled sales by collection point and product (deliveries kg and F.CFA without taxes).",
      },
      {
        id: "industry-product-monthly-sales-report",
        label: "Industry Product Monthly sales",
        table: "Sale",
        description:
          "Full-year Industry sales by collection point for each non-LPO, non-bottled product (tons and '000 FRS).",
      },      
      {
        id: "bottled-palm-oil-sales-return-report",
        label: "Bottled Palm Oil Stock Reconciliation",
        table: "Sale",
        description:
          "Open-month bottled B/F, receptions, cash/PR issues, and balance by pack (qty, kg, value without taxes).",
      },
      {
        id: "monthly-bottled-oil-report",
        label: "BPO Issued to GM's PR",
        table: "Sale",
        description:
          "Open-month Bottle Oil Ration and Public relation sales by invoice (packs, amount, receiver, VCN no.).",
      },
      {
        id: "revenue-taxes-report",
        label: "Revenue & taxes",
        table: "Sale",
        description:
          "Validated invoice net, VAT, sales tax, and gross for the open month or FY to date.",
      },
      
    ];
    const annualRoutes: SchemaRoute[] = [
      {
        id: "palm-oil-sales-activity-report",
        label: "Palm Oil Sales Activity",
        table: "Sale",
        description:
          "Annual palm oil sales by customer category in tons and FCFA.",
      },
    ];
    const groups: SchemaRouteGroup[] = [
      { id: "daily", label: "Daily", routes: dailyRoutes },
      { id: "weekly", label: "Weekly", routes: weeklyRoutes },
      { id: "monthly", label: "Monthly", routes: monthlyRoutes },
      { id: "annual", label: "Annual", routes: annualRoutes },
    ];
    return {
      id: "reports",
      label: "Reports",
      groups,
      routes: groups.flatMap((group) => group.routes),
    };
  })(),
  {
    id: "users-access",
    label: "Users & access",
    routes: [
      {
        id: "users",
        label: "Manage Users",
        table: "User",
        description: "Application user accounts.",
      },
      {
        id: "roles",
        label: "Manage roles",
        table: "",
        description: "Create, rename, and delete application roles.",
      },
      {
        id: "role-permissions",
        label: "Role permissions",
        table: "",
        description:
          "Configure module access and special actions for each role.",
      },
    ],
  },
];

export const DEFAULT_ROUTE_ID = "overview";

export const OVERVIEW_ROUTE: SchemaRoute = {
  id: DEFAULT_ROUTE_ID,
  label: "Overview",
  table: "",
  description: "Welcome to Sales Electron. Select a module from the sidebar.",
};

export function findRouteById(routeId: string): SchemaRoute | null {
  if (routeId === DEFAULT_ROUTE_ID) {
    return OVERVIEW_ROUTE;
  }

  for (const section of SCHEMA_ROUTE_SECTIONS) {
    const route = section.routes.find((item) => item.id === routeId);
    if (route) {
      return route;
    }
  }

  // Overlay-only routes (e.g. stock-bin-card-report) live in the catalog but
  // are intentionally omitted from the sidebar schema.
  const catalogRoute = ROUTE_DEFINITIONS.find((item) => item.id === routeId);
  if (catalogRoute) {
    return {
      id: catalogRoute.id,
      label: catalogRoute.label,
      table: catalogRoute.table ?? "",
      description: "",
    };
  }

  return null;
}

export function getSectionIdForRoute(routeId: string): string | null {
  for (const section of SCHEMA_ROUTE_SECTIONS) {
    if (section.routes.some((route) => route.id === routeId)) {
      return section.id;
    }
  }

  return null;
}
