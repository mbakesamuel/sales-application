import { useEffect, useMemo, useState } from "preact/hooks";
import { PanelLeft, PanelLeftClose } from "lucide-react";
import logoSrc from "../../assets/logo.svg";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import {
  canAccessRouteFromSnapshot,
  canPerformActionFromSnapshot,
  canWriteRouteFromSnapshot,
  filterSectionsForPermissions,
  getRouteAccessFromSnapshot,
} from "../../shared/permissionUtils.ts";
import {
  filterSectionsForOpenMonth,
  isMonthlyDeliveryRouteVisible,
} from "../../shared/monthlyDeliveryReportRoutes.ts";
import { formatRoleLabel } from "../../shared/roles.ts";
import type { AuthUser } from "../auth/session.ts";
import { TableDataView } from "../components/TableDataView.tsx";
import { CustomersScreen } from "../customers/CustomersScreen.tsx";
import { CustomerTypesScreen } from "../customers/CustomerTypesScreen.tsx";
import { ProductsScreen } from "../products/ProductsScreen.tsx";
import { CategoriesScreen } from "../products/CategoriesScreen.tsx";
import { ProductUnitPricesScreen } from "../products/ProductUnitPricesScreen.tsx";
import { TransportRatesScreen } from "../transport/TransportRatesScreen.tsx";
import { TransportCostComputeScreen } from "../transport/TransportCostComputeScreen.tsx";
import { LocationsScreen } from "../locations/LocationsScreen.tsx";
import { SalesPointsScreen } from "../sales-points/SalesPointsScreen.tsx";
import { CommercialServicesScreen } from "../commercial-services/CommercialServicesScreen.tsx";
import { CompanySettingsScreen } from "../company-settings/CompanySettingsScreen.tsx";
import { DataBackupScreen } from "../organization/DataBackupScreen.tsx";
import { SyncSettingsScreen } from "../organization/SyncSettingsScreen.tsx";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import { ReportSettingsScreen } from "../reports/ReportSettingsScreen.tsx";
import { StorageLocationsScreen } from "../storage-locations/StorageLocationsScreen.tsx";
import { TaxRegimesScreen } from "../tax/TaxRegimesScreen.tsx";
import { TaxRatesScreen } from "../tax/TaxRatesScreen.tsx";
import { PaymentMethodsScreen } from "../payment-methods/PaymentMethodsScreen.tsx";
import { FinancialYearsScreen } from "../financial-years/FinancialYearsScreen.tsx";
import { FinancialMonthsScreen } from "../financial-years/FinancialMonthsScreen.tsx";
import { SalesScreen } from "../sales/SalesScreen.tsx";
import { SalesValidationScreen } from "../sales/SalesValidationScreen.tsx";
import { DocumentBookletsScreen } from "../booklets/DocumentBookletsScreen.tsx";
import { BookletValidationScreen } from "../booklets/BookletValidationScreen.tsx";
import { DeliveryOrdersScreen } from "../delivery-orders/DeliveryOrdersScreen.tsx";
import { DeliveryOrderTrackingScreen } from "../delivery-orders/DeliveryOrderTrackingScreen.tsx";
import { DeliveryOrderTransferScreen } from "../delivery-orders/DeliveryOrderTransferScreen.tsx";
import { ConsignmentNotesScreen } from "../vehconsignment-note/ConsignmentNotesScreen.tsx";
import { ConsignmentValidationScreen } from "../vehconsignment-note/ConsignmentValidationScreen.tsx";
import { CarryForwardCommitmentsScreen } from "../commitments/CarryForwardCommitmentsScreen.tsx";
import { CarryForwardStockScreen } from "../stock/CarryForwardStockScreen.tsx";
import { StockScreen } from "../stock/StockScreen.tsx";
import { StockValidationScreen } from "../stock/StockValidationScreen.tsx";
import { SalesBudgetScreen } from "../sales-budget/SalesBudgetScreen.tsx";
import {
  canAccessBinCardReport,
  canAccessBottledStockModule,
  canAccessStockModule,
} from "../../shared/stockModule.ts";
import { opensInReportWindow } from "../../shared/reportWindow.ts";
import { ReportBody } from "../reports/reportBody.tsx";
import {
  ReportOverlayContext,
  type ReportOverlayContextValue,
} from "../reports/ReportOverlayContext.tsx";
import { PermissionsScreen } from "../permissions/PermissionsScreen.tsx";
import { RolesScreen } from "../permissions/RolesScreen.tsx";
import { UsersScreen } from "../users/UsersScreen.tsx";
import { getElectronApi } from "../auth/client.ts";
import {
  DEFAULT_ROUTE_ID,
  findRouteById,
  OVERVIEW_ROUTE,
  SCHEMA_ROUTE_SECTIONS,
  type SchemaRoute,
  type SchemaRouteSection,
} from "../navigation/schemaRoutes.ts";
import {
  OVERVIEW_ICON,
  getRouteIcon,
  getSectionIcon,
} from "../navigation/sidebarIcons.ts";
import { SidebarChevron, SidebarIcon } from "../navigation/SidebarIcon.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import { DashboardScreen } from "../dashboard/DashboardScreen.tsx";
import { SyncStatusBadge } from "../components/SyncStatusBadge.tsx";
import { ServerOfflineBanner } from "../components/ServerOfflineBanner.tsx";
import "./HomeScreen.css";

const SIDEBAR_COLLAPSED_KEY = "home-sidebar-collapsed";
const DEFAULT_COMPANY_NAME = "CDC Palm Oil Sales";

function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface HomeScreenProps {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  onPermissionsSaved: (next: RolePermissionsSnapshot) => void;
  onLogout: () => void;
}

function SectionRouteList({
  section,
  activeRouteId,
  nested,
  onSelectRoute,
}: {
  section: SchemaRouteSection;
  activeRouteId: string;
  nested?: boolean;
  onSelectRoute: (routeId: string) => void;
}) {
  const nestedClass = nested ? " sidebar-route-nested" : "";

  if (section.groups?.length) {
    return (
      <>
        {section.groups.map((group) => (
          <div key={group.id} class="sidebar-route-group">
            <div class="sidebar-route-group-label">{group.label}</div>
            {group.routes.map((route) => (
              <button
                key={route.id}
                type="button"
                class={`sidebar-route${nestedClass}${
                  activeRouteId === route.id ? " is-active" : ""
                }`}
                onClick={() => onSelectRoute(route.id)}
              >
                <SidebarIcon icon={getRouteIcon(route.id)} className="sidebar-route-icon" />
                <span class="sidebar-route-label">{route.label}</span>
              </button>
            ))}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {section.routes.map((route) => (
        <button
          key={route.id}
          type="button"
          class={`sidebar-route${nestedClass}${
            activeRouteId === route.id ? " is-active" : ""
          }`}
          onClick={() => onSelectRoute(route.id)}
        >
          <SidebarIcon icon={getRouteIcon(route.id)} className="sidebar-route-icon" />
          <span class="sidebar-route-label">{route.label}</span>
        </button>
      ))}
    </>
  );
}

function RouteContent({
  route,
  user,
  permissions,
  onPermissionsSaved,
  openCalendarMonth,
  reportQuery,
  deliveryOrderLookupNo,
  onOpenDeliveryOrder,
  onOpenDeliveryOrderTracking,
}: {
  route: SchemaRoute;
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  onPermissionsSaved: (next: RolePermissionsSnapshot) => void;
  openCalendarMonth: number | null;
  reportQuery?: unknown;
  deliveryOrderLookupNo?: string;
  onOpenDeliveryOrder?: (deliveryOrderNo: string) => void;
  onOpenDeliveryOrderTracking?: (deliveryOrderNo: string) => void;
}) {
  const routeAccess = getRouteAccessFromSnapshot(permissions, route.id);
  const readOnly = routeAccess === "read";

  if (
    route.id === "stock"
      ? !canAccessStockModule(permissions)
      : route.id === "bottled-stock"
        ? !canAccessBottledStockModule(permissions)
        : route.id === "stock-bin-card-report"
          ? !canAccessBinCardReport(permissions)
          : !canAccessRouteFromSnapshot(permissions, route.id)
  ) {
    return (
      <p class="home-access-denied">
        You do not have permission to open this module.
      </p>
    );
  }

  if (route.id === "roles") {
    return <RolesScreen permissions={permissions} />;
  }

  if (route.id === "role-permissions") {
    return (
      <PermissionsScreen
        permissions={permissions}
        onPermissionsSaved={onPermissionsSaved}
      />
    );
  }

  if (route.id === "users") {
    return <UsersScreen readOnly={readOnly} />;
  }

  if (route.id === "sales") {
    return <SalesScreen user={user} permissions={permissions} readOnly={readOnly} variant="loose" />;
  }

  if (route.id === "bottle-oil-sales") {
    return (
      <SalesScreen
        user={user}
        permissions={permissions}
        readOnly={readOnly}
        variant="bottled"
      />
    );
  }

  if (route.id === "sales-validation") {
    if (!canPerformActionFromSnapshot(permissions, "validate_sales")) {
      return (
        <p class="home-access-denied">
          You do not have permission to validate sales invoices.
        </p>
      );
    }
    return <SalesValidationScreen user={user} />;
  }

  if (route.id === "document-booklets") {
    return (
      <DocumentBookletsScreen
        user={user}
        canWrite={!readOnly}
        canValidate={
          canPerformActionFromSnapshot(
            permissions,
            "validate_document_booklets",
          ) && !readOnly
        }
      />
    );
  }

  if (route.id === "booklet-validation") {
    if (
      !canPerformActionFromSnapshot(
        permissions,
        "validate_document_booklets",
      )
    ) {
      return (
        <p class="home-access-denied">
          You do not have permission to validate document booklets.
        </p>
      );
    }
    return <BookletValidationScreen user={user} />;
  }

  if (route.id === "delivery-orders") {
    return (
      <DeliveryOrdersScreen
        key={deliveryOrderLookupNo || "delivery-orders"}
        user={user}
        permissions={permissions}
        readOnly={readOnly}
        initialLookupNo={deliveryOrderLookupNo}
      />
    );
  }

  if (route.id === "delivery-order-tracking") {
    return (
      <DeliveryOrderTrackingScreen
        key={deliveryOrderLookupNo || "delivery-order-tracking"}
        initialLookupNo={deliveryOrderLookupNo}
        onOpenInDeliveryOrdering={onOpenDeliveryOrder}
      />
    );
  }

  if (route.id === "delivery-order-transfer") {
    return (
      <DeliveryOrderTransferScreen
        user={user}
        permissions={permissions}
        readOnly={readOnly}
        onOpenInDeliveryOrdering={onOpenDeliveryOrder}
        onOpenTracking={onOpenDeliveryOrderTracking}
      />
    );
  }

  if (route.id === "vehicle-consignment-notes") {
    return (
      <ConsignmentNotesScreen user={user} permissions={permissions} />
    );
  }

  if (route.id === "vehicle-consignment-validation") {
    if (
      !canPerformActionFromSnapshot(
        permissions,
        "validate_vehicle_consignment_notes",
      )
    ) {
      return (
        <p class="home-access-denied">
          You do not have permission to validate consignment notes.
        </p>
      );
    }
    return <ConsignmentValidationScreen user={user} />;
  }

  if (route.id === "carry-forward-commitments") {
    return (
      <CarryForwardCommitmentsScreen
        user={user}
        permissions={permissions}
        readOnly={readOnly}
      />
    );
  }

  if (route.id === "carry-forward-stock") {
    return (
      <CarryForwardStockScreen
        user={user}
        permissions={permissions}
        readOnly={readOnly}
      />
    );
  }

  if (route.id === "stock") {
    return (
      <StockScreen
        user={user}
        permissions={permissions}
        variant="bulk"
      />
    );
  }

  if (route.id === "bottled-stock") {
    return (
      <StockScreen
        user={user}
        permissions={permissions}
        variant="bottled"
      />
    );
  }

  if (route.id === "stock-validation") {
    if (!canAccessRouteFromSnapshot(permissions, "stock-validation")) {
      return (
        <p class="home-access-denied">
          You do not have permission to view stock validation.
        </p>
      );
    }
    const canValidate =
      canWriteRouteFromSnapshot(permissions, "stock-validation") &&
      canPerformActionFromSnapshot(permissions, "validate_stock_documents");
    return <StockValidationScreen user={user} canValidate={canValidate} />;
  }

  if (route.id === "receive-transfers") {
    return (
      <p class="home-access-denied">
        Bottle Oil stock is received at Bota via Bottle Stock → Reception
        (consignment note). Inter-site bottle transfers are no longer used.
      </p>
    );
  }

  if (opensInReportWindow(route.id)) {
    if (
      (route.id === "monthly-delivery-report-h1" ||
        route.id === "monthly-delivery-report-h2") &&
      !isMonthlyDeliveryRouteVisible(route.id, openCalendarMonth)
    ) {
      return (
        <p class="scr-status">
          {route.id === "monthly-delivery-report-h1"
            ? "Monthly delivery (Jan–Jun) is not available for the current open month."
            : "Monthly delivery (Jul–Dec) is not available for the current open month."}
        </p>
      );
    }

    return (
      <ReportBody
        reportId={route.id}
        query={route.id === "stock-bin-card-report" ? reportQuery : undefined}
        windowMode={false}
      />
    );
  }

  if (route.id === "sales-budget") {
    return <SalesBudgetScreen readOnly={readOnly} />;
  }

  if (route.id === "customers") {
    return <CustomersScreen readOnly={readOnly} />;
  }

  if (route.id === "customer-types") {
    return <CustomerTypesScreen readOnly={readOnly} />;
  }

  if (route.id === "products") {
    return <ProductsScreen readOnly={readOnly} />;
  }

  if (route.id === "product-categories") {
    return <CategoriesScreen readOnly={readOnly} />;
  }

  if (route.id === "unit-prices") {
    return <ProductUnitPricesScreen readOnly={readOnly} />;
  }

  if (route.id === "transport-rates") {
    return <TransportRatesScreen readOnly={readOnly} />;
  }

  if (route.id === "transport-cost-compute") {
    return (
      <TransportCostComputeScreen permissions={permissions} readOnly={readOnly} />
    );
  }

  if (route.id === "sales-points") {
    return <SalesPointsScreen readOnly={readOnly} />;
  }

  if (route.id === "commercial-services") {
    return <CommercialServicesScreen readOnly={readOnly} />;
  }

  if (route.id === "company-settings") {
    return <CompanySettingsScreen readOnly={readOnly} user={user} />;
  }

  if (route.id === "report-settings") {
    return <ReportSettingsScreen readOnly={readOnly} />;
  }

  if (route.id === "data-backup") {
    return <DataBackupScreen readOnly={readOnly} />;
  }

  if (route.id === "sync-settings") {
    return <SyncSettingsScreen readOnly={readOnly} />;
  }

  if (route.id === "locations") {
    return <LocationsScreen readOnly={readOnly} />;
  }

  if (route.id === "storage-locations") {
    return <StorageLocationsScreen readOnly={readOnly} />;
  }

  if (route.id === "tax-regimes") {
    return <TaxRegimesScreen readOnly={readOnly} />;
  }

  if (route.id === "tax-rate-schedules") {
    return <TaxRatesScreen readOnly={readOnly} />;
  }

  if (route.id === "payment-methods") {
    return <PaymentMethodsScreen readOnly={readOnly} />;
  }

  if (route.id === "financial-year-periods") {
    return <FinancialYearsScreen readOnly={readOnly} />;
  }

  if (route.id === "financial-months") {
    return (
      <FinancialMonthsScreen
        readOnly={readOnly}
        salesPointId={user.salesPointId}
      />
    );
  }

  return (
    <TableDataView
      key={route.table}
      table={route.table}
      description={route.description}
      readOnly={readOnly || !canWriteRouteFromSnapshot(permissions, route.id)}
    />
  );
}

export function HomeScreen({
  user,
  permissions,
  onPermissionsSaved,
  onLogout,
}: HomeScreenProps) {
  const [activeRouteId, setActiveRouteId] = useState(DEFAULT_ROUTE_ID);
  const [pendingDeliveryOrderLookup, setPendingDeliveryOrderLookup] = useState("");
  const [pendingTrackingLookup, setPendingTrackingLookup] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    sales: true,
  });
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [reportQuery, setReportQuery] = useState<unknown>(undefined);
  const [openPostingPeriod, setOpenPostingPeriod] =
    useState<OpenPostingPeriod | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
  );
  const [openFlyoutSectionId, setOpenFlyoutSectionId] = useState<string | null>(
    null,
  );
  const [flyoutAnchor, setFlyoutAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [companyName, setCompanyName] = useState(DEFAULT_COMPANY_NAME);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getElectronApi()
      .db.queryTable({ table: "CompanySettings", limit: 50 })
      .then((result) => {
        if (cancelled) {
          return;
        }
        const row =
          result.rows.find((item) => String(item.id) === "default") ??
          result.rows[0];
        if (!row) {
          return;
        }
        const name = String(row.companyName ?? "").trim();
        if (name) {
          setCompanyName(name);
        }
        const logo = String(row.logoUrl ?? "").trim();
        setCompanyLogoUrl(logo || null);
      })
      .catch(() => {
        // Keep the default brand when company settings are unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleSections = useMemo(() => {
    const permitted = filterSectionsForPermissions(SCHEMA_ROUTE_SECTIONS, permissions);
    return filterSectionsForOpenMonth(
      permitted,
      openPostingPeriod?.calendarMonth ?? null,
    );
  }, [permissions, openPostingPeriod]);

  const activeRoute = findRouteById(activeRouteId) ?? OVERVIEW_ROUTE;

  useEffect(() => {
    let cancelled = false;

    async function refreshOpenPostingPeriod() {
      try {
        const period =
          await getAuthenticatedFinancialYears().getOpenPostingPeriod(
            user.salesPointId,
          );
        if (!cancelled) setOpenPostingPeriod(period);
      } catch {
        if (!cancelled) setOpenPostingPeriod(null);
      }
    }

    void refreshOpenPostingPeriod();
    const refreshOnFocus = () => void refreshOpenPostingPeriod();
    window.addEventListener("focus", refreshOnFocus);
    const intervalId = window.setInterval(refreshOpenPostingPeriod, 15_000);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshOnFocus);
      window.clearInterval(intervalId);
    };
  }, [activeRouteId, user.salesPointId]);

  useEffect(() => {
    const api = getElectronApi();
    if (!api.windows?.onReportClosed) {
      return;
    }
    return api.windows.onReportClosed(({ reportId }) => {
      setActiveRouteId((current) =>
        current === reportId ? DEFAULT_ROUTE_ID : current,
      );
    });
  }, []);

  useEffect(() => {
    if (activeRouteId === DEFAULT_ROUTE_ID) {
      return;
    }

    const canAccess =
      activeRouteId === "stock"
        ? canAccessStockModule(permissions)
        : activeRouteId === "bottled-stock"
          ? canAccessBottledStockModule(permissions)
          : activeRouteId === "stock-bin-card-report"
            ? canAccessBinCardReport(permissions)
            : canAccessRouteFromSnapshot(permissions, activeRouteId);

    if (!canAccess) {
      setActiveRouteId(DEFAULT_ROUTE_ID);
      return;
    }

    if (!isMonthlyDeliveryRouteVisible(activeRouteId, openPostingPeriod?.calendarMonth ?? null)) {
      setActiveRouteId(DEFAULT_ROUTE_ID);
    }
  }, [activeRouteId, permissions, openPostingPeriod]);

  useEffect(() => {
    if (!openFlyoutSectionId) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenFlyoutSectionId(null);
        setFlyoutAnchor(null);
      }
    }

    function onMouseDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (
        target.closest(".sidebar-flyout") ||
        target.closest(".sidebar-flyout-backdrop") ||
        target.closest(".accordion-trigger")
      ) {
        return;
      }
      setOpenFlyoutSectionId(null);
      setFlyoutAnchor(null);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [openFlyoutSectionId]);

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((current) => {
      const next = !current;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
    setOpenFlyoutSectionId(null);
    setFlyoutAnchor(null);
  }

  function closeSidebarFlyout() {
    setOpenFlyoutSectionId(null);
    setFlyoutAnchor(null);
  }

  function handleSectionTriggerClick(
    sectionId: string,
    event: Event,
  ) {
    if (sidebarCollapsed) {
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (openFlyoutSectionId === sectionId) {
        closeSidebarFlyout();
        return;
      }
      const rect = target.getBoundingClientRect();
      setFlyoutAnchor({ top: rect.top, left: rect.right + 4 });
      setOpenFlyoutSectionId(sectionId);
      return;
    }

    toggleSection(sectionId);
  }

  function toggleSection(sectionId: string) {
    setOpenSections((current) => {
      const isCurrentlyOpen = Boolean(current[sectionId]);
      if (isCurrentlyOpen) {
        return { [sectionId]: false };
      }

      return { [sectionId]: true };
    });
  }

  function openReportOverlay(reportId: string, query?: unknown) {
    setReportQuery(query);
    setActiveRouteId(reportId);
    setOpenSections({ reports: true });
    closeSidebarFlyout();
  }

  const reportOverlayContextValue = useMemo<ReportOverlayContextValue>(
    () => ({
      openReportOverlay,
    }),
    [],
  );

  function selectRoute(routeId: string, sectionId?: string) {
    setActiveRouteId(routeId);
    closeSidebarFlyout();
    if (routeId !== "delivery-orders") {
      setPendingDeliveryOrderLookup("");
    }
    if (routeId !== "delivery-order-tracking") {
      setPendingTrackingLookup("");
    }
    if (routeId !== "stock-bin-card-report") {
      setReportQuery(undefined);
    }
    if (sectionId) {
      setOpenSections({ [sectionId]: true });
    }
  }

  const customScreenRoutes = new Set([
    "stock",
    "bottled-stock",
    "stock-validation",
    "sales-validation",
    "document-booklets",
    "booklet-validation",
    "vehicle-consignment-validation",
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
    "stock-bin-card-report",
    "sales-budget-monthly-crosstab",
    "sales-budget-monthly-revenue-crosstab",
    "sales-budget-weekly-crosstab",
    "sales-budget-weekly-revenue-crosstab",
    "sales-budget",
    "customers",
    "customer-types",
    "products",
    "product-categories",
    "unit-prices",
    "transport-rates",
    "transport-cost-compute",
    "sales-points",
    "commercial-services",
    "company-settings",
    "report-settings",
    "data-backup",
    "sync-settings",
    "locations",
    "storage-locations",
    "tax-regimes",
    "tax-rate-schedules",
    "payment-methods",
    "financial-year-periods",
    "financial-months",
    "users",
    "roles",
    "role-permissions",
    "carry-forward-commitments",
    "carry-forward-stock",
    "sales",
    "bottle-oil-sales",
    "delivery-orders",
    "delivery-order-tracking",
    "delivery-order-transfer",
    "vehicle-consignment-notes",
    "vehicle-consignment-validation",
  ]);

  const catalogFillRoutes = new Set([
    "customers",
    "customer-types",
    "products",
    "product-categories",
    "unit-prices",
    "transport-rates",
    "transport-cost-compute",
    "sales-points",
    "commercial-services",
    "locations",
    "storage-locations",
    "tax-regimes",
    "tax-rate-schedules",
    "payment-methods",
    "financial-year-periods",
    "financial-months",
    "users",
    "document-booklets",
    "booklet-validation",
  ]);

  const usesFillLayout =
    catalogFillRoutes.has(activeRouteId) ||
    activeRouteId === "roles" ||
    activeRouteId === "role-permissions";

  const flyoutSection = openFlyoutSectionId
    ? visibleSections.find((section) => section.id === openFlyoutSectionId) ?? null
    : null;

  return (
    <ReportOverlayContext.Provider value={reportOverlayContextValue}>
    <div class={`home-layout${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
      <ServerOfflineBanner />
      <header class="home-topbar no-print">
        <div class="home-topbar-brand">
          <img
            class="home-topbar-logo"
            src={companyLogoUrl || logoSrc}
            alt=""
          />
          <span class="home-topbar-company">{companyName}</span>
        </div>
        <div class="home-topbar-actions">
          <SyncStatusBadge />
          <div
            class="home-topbar-user"
            title={
              user.salesPointName
                ? `${formatRoleLabel(user.role)} · ${user.salesPointName}`
                : formatRoleLabel(user.role)
            }
          >
            <div class="home-topbar-avatar">{userInitials(user.name)}</div>
            <div class="home-topbar-user-text">
              <span class="home-topbar-user-name">{user.name}</span>
              <span class="home-topbar-user-meta">
                {formatRoleLabel(user.role)}
                {user.salesPointName ? ` · ${user.salesPointName}` : ""}
                {" · FY "}
                {openPostingPeriod?.financialYear ?? "—"}
                {openPostingPeriod?.monthName
                  ? ` · ${openPostingPeriod.monthName}`
                  : ""}
              </span>
            </div>
          </div>
          <button
            type="button"
            class="home-signout"
            onClick={() => setLogoutConfirmOpen(true)}
          >
            Sign out
          </button>
        </div>
      </header>

      <div class="home-body">
      <aside class="home-sidebar">
        <nav class="sidebar-nav" aria-label="Application modules">
          <div class="sidebar-home-row">
            <button
              type="button"
              class={`sidebar-route${activeRouteId === DEFAULT_ROUTE_ID ? " is-active" : ""}`}
              title="Overview"
              onClick={() => selectRoute(DEFAULT_ROUTE_ID)}
            >
              <SidebarIcon icon={OVERVIEW_ICON} className="sidebar-route-icon" />
              <span class="sidebar-route-label">Overview</span>
            </button>
            <button
              type="button"
              class="sidebar-collapse-toggle no-print"
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleSidebarCollapsed}
            >
              <SidebarIcon
                icon={sidebarCollapsed ? PanelLeft : PanelLeftClose}
                className="sidebar-route-icon"
                size={18}
              />
            </button>
          </div>

          <div class="sidebar-accordion">
            {visibleSections.map((section) => {
              const isOpen = Boolean(openSections[section.id]);
              const isFlyoutOpen = openFlyoutSectionId === section.id;

              return (
                <section key={section.id} class="accordion-section">
                  <button
                    type="button"
                    class={`accordion-trigger${
                      isFlyoutOpen ? " is-flyout-open" : ""
                    }`}
                    aria-expanded={sidebarCollapsed ? isFlyoutOpen : isOpen}
                    title={section.label}
                    onClick={(event) => handleSectionTriggerClick(section.id, event)}
                  >
                    <span class="accordion-trigger-label">
                      <SidebarIcon
                        icon={getSectionIcon(section.id)}
                        className="sidebar-route-icon"
                      />
                      <span class="accordion-trigger-text">{section.label}</span>
                    </span>
                    <SidebarChevron isOpen={isOpen} />
                  </button>

                  {isOpen && !sidebarCollapsed ? (
                    <div class="accordion-panel">
                      <SectionRouteList
                        section={section}
                        activeRouteId={activeRouteId}
                        nested
                        onSelectRoute={(routeId) => selectRoute(routeId, section.id)}
                      />
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </nav>
      </aside>

      {sidebarCollapsed && flyoutSection && flyoutAnchor ? (
        <>
          <button
            type="button"
            class="sidebar-flyout-backdrop no-print"
            aria-label="Close navigation menu"
            onClick={closeSidebarFlyout}
          />
          <div
            class="sidebar-flyout no-print"
            style={{
              top: `${flyoutAnchor.top}px`,
              left: `${flyoutAnchor.left}px`,
            }}
          >
            <div class="sidebar-flyout-title">{flyoutSection.label}</div>
            <div class="sidebar-flyout-routes">
              <SectionRouteList
                section={flyoutSection}
                activeRouteId={activeRouteId}
                onSelectRoute={(routeId) => selectRoute(routeId, flyoutSection.id)}
              />
            </div>
          </div>
        </>
      ) : null}

      {logoutConfirmOpen ? (
        <ConfirmDialog
          ariaLabel="Confirm logout"
          title="Log out?"
          description={`Are you sure you want to sign out as ${user.name}? You will need to sign in again to continue.`}
          confirmLabel="Log out"
          cancelLabel="Stay signed in"
          onCancel={() => setLogoutConfirmOpen(false)}
          onConfirm={() => {
            setLogoutConfirmOpen(false);
            onLogout();
          }}
        />
      ) : null}

      <main
        class={`home-main${
          activeRouteId === DEFAULT_ROUTE_ID
            ? " home-main--dashboard"
            : opensInReportWindow(activeRouteId)
              ? " home-main--report"
            : activeRouteId === "stock" ||
                activeRouteId === "bottled-stock" ||
                activeRouteId === "stock-validation" ||
                activeRouteId === "sales-validation" ||
                activeRouteId === "vehicle-consignment-validation" ||
                activeRouteId === "sales" ||
                activeRouteId === "bottle-oil-sales" ||
                activeRouteId === "delivery-orders" ||
                activeRouteId === "carry-forward-stock"
              ? " home-main--stock"
              : usesFillLayout
                ? " home-main--fill"
                : ""
        }`}
      >
        {activeRouteId !== DEFAULT_ROUTE_ID && !customScreenRoutes.has(activeRouteId) ? (
          <header class="home-header">
            <div>
              <h1>{activeRoute.label}</h1>
              {activeRoute.table ? (
                <p class="home-header-meta">Schema table: {activeRoute.table}</p>
              ) : null}
            </div>
          </header>
        ) : null}

        {activeRouteId === DEFAULT_ROUTE_ID ? (
          <section class="home-content">
            <DashboardScreen onNavigate={selectRoute} />
          </section>
        ) : (
          <section class="home-content">
            {opensInReportWindow(activeRouteId) ? (
              <ReportOverlayShell
                preview
                reportId={activeRouteId}
                title={activeRoute.label}
                onClose={() => selectRoute(DEFAULT_ROUTE_ID)}
              >
                <RouteContent
                  route={activeRoute}
                  user={user}
                  permissions={permissions}
                  onPermissionsSaved={onPermissionsSaved}
                  openCalendarMonth={openPostingPeriod?.calendarMonth ?? null}
                  reportQuery={reportQuery}
                  deliveryOrderLookupNo={
                    activeRouteId === "delivery-order-tracking"
                      ? pendingTrackingLookup
                      : pendingDeliveryOrderLookup
                  }
                  onOpenDeliveryOrder={(deliveryOrderNo) => {
                    setPendingDeliveryOrderLookup(deliveryOrderNo);
                    setActiveRouteId("delivery-orders");
                    setOpenSections({ delivery: true });
                  }}
                  onOpenDeliveryOrderTracking={(deliveryOrderNo) => {
                    setPendingTrackingLookup(deliveryOrderNo);
                    setActiveRouteId("delivery-order-tracking");
                    setOpenSections({ delivery: true });
                  }}
                />
              </ReportOverlayShell>
            ) : (
              <RouteContent
                route={activeRoute}
                user={user}
                permissions={permissions}
                onPermissionsSaved={onPermissionsSaved}
                openCalendarMonth={openPostingPeriod?.calendarMonth ?? null}
                reportQuery={reportQuery}
                deliveryOrderLookupNo={
                  activeRouteId === "delivery-order-tracking"
                    ? pendingTrackingLookup
                    : pendingDeliveryOrderLookup
                }
                onOpenDeliveryOrder={(deliveryOrderNo) => {
                  setPendingDeliveryOrderLookup(deliveryOrderNo);
                  setActiveRouteId("delivery-orders");
                  setOpenSections({ delivery: true });
                }}
                onOpenDeliveryOrderTracking={(deliveryOrderNo) => {
                  setPendingTrackingLookup(deliveryOrderNo);
                  setActiveRouteId("delivery-order-tracking");
                  setOpenSections({ delivery: true });
                }}
              />
            )}
          </section>
        )}

      </main>
      </div>

      <footer class="home-bottombar no-print">
        <span>© {new Date().getFullYear()} Information Systems Department</span>
      </footer>
    </div>
    </ReportOverlayContext.Provider>
  );
}
