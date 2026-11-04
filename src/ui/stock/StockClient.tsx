import { useMemo, useState } from "preact/hooks";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import {
  getVisibleStockTabsForVariant,
  isStockTabReadOnlyForVariant,
  type StockModuleVariant,
  type StockProductFilter,
  type StockTabId,
} from "../../shared/stockModule.ts";
import type { AuthUser } from "../auth/session.ts";
import type { StockBootstrap } from "../../shared/stock.types.ts";
import {
  filterOnHandForStockModule,
  filterStockModuleProducts,
} from "../../shared/stockIntakeGroups.ts";
import { BinCardScreen } from "./BinCardScreen.tsx";
import { OnHandTab } from "./OnHandTab.tsx";
import { MovementsTab } from "./MovementsTab.tsx";
import { ReceiptsTab } from "./ReceiptsTab.tsx";
import { TransfersTab } from "./TransfersTab.tsx";
import { AdjustmentsTab } from "./AdjustmentsTab.tsx";
import "./StockScreen.css";
import "../customers/CustomersScreen.css";

type TabId =
  | "bin-card"
  | "on-hand"
  | "movements"
  | "receipts"
  | "transfers"
  | "adjustments";
type Banner = { type: "ok" | "error"; text: string } | null;

type VisibleTab = {
  id: TabId;
  stockTabId?: StockTabId;
  label: string;
};

const TAB_DEFINITIONS: {
  id: Exclude<TabId, "bin-card">;
  stockTabId: StockTabId;
  label: string;
}[] = [
  { id: "on-hand", stockTabId: "balance", label: "On hand" },
  { id: "movements", stockTabId: "movements", label: "Movements" },
  { id: "receipts", stockTabId: "receipts", label: "Reception" },
  { id: "transfers", stockTabId: "transfers", label: "Transfers" },
  { id: "adjustments", stockTabId: "adjustments", label: "Adjustments" },
];

const PRODUCT_VIEW_OPTIONS: ReadonlyArray<{
  id: StockProductFilter;
  label: string;
}> = [
  { id: "bulk", label: "Loose" },
  { id: "bottled", label: "Bottled" },
  { id: "all", label: "All" },
];

interface StockClientProps {
  bootstrap: StockBootstrap;
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  variant: StockModuleVariant;
  viewFilter: StockProductFilter;
  showProductToggle: boolean;
  onViewFilterChange: (next: StockProductFilter) => void;
  onRefresh: () => void | Promise<void>;
}

export function StockClient({
  bootstrap,
  user,
  permissions,
  variant,
  viewFilter,
  showProductToggle,
  onViewFilterChange,
  onRefresh,
}: StockClientProps) {
  const productFilter = viewFilter;
  const visibleTabs = useMemo((): VisibleTab[] => {
    const allowedStockTabs = getVisibleStockTabsForVariant(permissions, variant);

    if (variant === "bottled") {
      const binCardTab: VisibleTab = { id: "bin-card", label: "Bin card" };
      const documentTabs = TAB_DEFINITIONS.filter((tab) => {
        if (
          tab.id === "receipts" ||
          tab.id === "on-hand" ||
          tab.id === "movements"
        ) {
          return false;
        }
        return allowedStockTabs.includes(tab.stockTabId);
      }).map((tab) => ({
        id: tab.id,
        stockTabId: tab.stockTabId,
        label: tab.label,
      }));
      return [binCardTab, ...documentTabs];
    }

    return TAB_DEFINITIONS.filter((tab) =>
      allowedStockTabs.includes(tab.stockTabId),
    ).map((tab) => ({
      id: tab.id,
      stockTabId: tab.stockTabId,
      label: tab.label,
    }));
  }, [permissions, variant]);

  const defaultTab = variant === "bottled" ? "bin-card" : "on-hand";
  const [tab, setTab] = useState<TabId>(
    () => visibleTabs[0]?.id ?? defaultTab,
  );
  const [banner, setBanner] = useState<Banner>(null);

  const activeTab = visibleTabs.some((item) => item.id === tab)
    ? tab
    : (visibleTabs[0]?.id ?? defaultTab);

  const activeStockTabId =
    visibleTabs.find((item) => item.id === activeTab)?.stockTabId ?? "balance";
  const tabReadOnly = isStockTabReadOnlyForVariant(
    permissions,
    variant,
    activeStockTabId,
  );

  const stockModuleProducts = useMemo(
    () =>
      filterStockModuleProducts(
        bootstrap.products,
        bootstrap.stockIntakeOilGrouping,
      ),
    [bootstrap.products, bootstrap.stockIntakeOilGrouping],
  );

  const stockModuleOnHand = useMemo(
    () =>
      filterOnHandForStockModule(
        bootstrap.onHand,
        bootstrap.products,
        bootstrap.stockIntakeOilGrouping,
      ),
    [bootstrap.onHand, bootstrap.products, bootstrap.stockIntakeOilGrouping],
  );

  function announceOk(text: string) {
    setBanner({ type: "ok", text });
    void onRefresh();
  }

  function announceErr(text: string) {
    setBanner({ type: "error", text });
  }

  if (visibleTabs.length === 0) {
    return (
      <p class="home-access-denied">
        You do not have permission to view stock data.
      </p>
    );
  }

  const title =
    variant === "bottled"
      ? "Stock Management - Bottled Products"
      : variant === "all"
        ? "Stock Management"
        : "Stock Management - Loose Products/Others";
  const subtitle =
    variant === "bottled"
      ? "Bin card ledger, transfers, and adjustments for bottled products."
      : variant === "all"
        ? "On-hand quantities, receipts, transfers, and adjustments for loose and bottled products."
        : "On-hand quantities, receipts, transfers and adjustments as reported by Production.";

  return (
    <div class="stock-screen">
      <header class="stock-header">
        <div class="stock-header-text">
          <h1>{title}</h1>
          <p class="stock-header-subtitle">{subtitle}</p>
        </div>
      </header>

      {banner ? (
        <div class={`stock-banner stock-banner-${banner.type}`}>
          {banner.text}
        </div>
      ) : null}

      <div class="stock-tabs-row">
        <nav class="stock-tabs">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              class={`stock-tab${activeTab === t.id ? " is-active" : ""}`}
              onClick={() => {
                setBanner(null);
                setTab(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {showProductToggle ? (
          <div
            class="stock-product-toggle"
            role="group"
            aria-label="Product view"
          >
            {PRODUCT_VIEW_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                class={`stock-product-toggle-btn${
                  viewFilter === option.id ? " is-active" : ""
                }`}
                aria-pressed={viewFilter === option.id}
                onClick={() => {
                  if (viewFilter === option.id) {
                    return;
                  }
                  setBanner(null);
                  onViewFilterChange(option.id);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div class="stock-tab-panel">
        {activeTab === "bin-card" ? (
          <BinCardScreen
            user={user}
            permissions={permissions}
            embedded
            bootstrap={bootstrap}
          />
        ) : null}

        {activeTab === "on-hand" ? (
          <OnHandTab
            salesPoints={bootstrap.salesPoints}
            scopedSalesPointId={bootstrap.scopedSalesPointId}
            rows={bootstrap.onHand}
          />
        ) : null}

        {activeTab === "movements" ? (
          <MovementsTab
            rows={bootstrap.movements}
            salesPoints={bootstrap.salesPoints}
            scopedSalesPointId={bootstrap.scopedSalesPointId}
          />
        ) : null}

        {activeTab === "receipts" ? (
          <ReceiptsTab
            rows={bootstrap.receipts}
            salesPoints={bootstrap.salesPoints}
            storageLocations={bootstrap.storageLocations}
            products={bootstrap.receiptProducts}
            onHand={bootstrap.onHand}
            scopedSalesPointId={bootstrap.scopedSalesPointId}
            canPost={!tabReadOnly && bootstrap.canManageReceipts}
            canCancel={!tabReadOnly && bootstrap.canCancelDocuments}
            canDraft={!tabReadOnly && bootstrap.canDraftReceipts}
            canDirectPost={!tabReadOnly && bootstrap.canDirectPostReceipts}
            autoGenerateReceiptNo={bootstrap.autoGenerateReceiptNo}
            userId={user.id}
            viewProductFilter={productFilter}
            stockIntakeOilGrouping={bootstrap.stockIntakeOilGrouping}
            onOk={announceOk}
            onErr={announceErr}
          />
        ) : null}

        {activeTab === "transfers" ? (
          <TransfersTab
            rows={bootstrap.transfers}
            salesPoints={bootstrap.salesPoints}
            storageLocations={bootstrap.storageLocations}
            products={stockModuleProducts}
            onHand={stockModuleOnHand}
            scopedSalesPointId={bootstrap.scopedSalesPointId}
            canDispatch={!tabReadOnly && bootstrap.canDispatchTransfers}
            canReceive={
              !tabReadOnly &&
              variant === "bottled" &&
              bootstrap.canReceiveTransfers
            }
            canCancel={!tabReadOnly && bootstrap.canCancelTransfers}
            canDraft={!tabReadOnly && bootstrap.canDraftTransfers}
            canDirectPost={!tabReadOnly && bootstrap.canDirectPostTransfers}
            autoGenerateTransferNo={bootstrap.autoGenerateTransferNo}
            transferReceiveUsesDocumentDate={
              bootstrap.transferReceiveUsesDocumentDate
            }
            loosePalmOilAllowInterSalesPointTransfer={
              bootstrap.loosePalmOilAllowInterSalesPointTransfer
            }
            userId={user.id}
            productFilter={productFilter}
            onOk={announceOk}
            onErr={announceErr}
          />
        ) : null}

        {activeTab === "adjustments" ? (
          <AdjustmentsTab
            rows={bootstrap.adjustments}
            salesPoints={bootstrap.salesPoints}
            storageLocations={bootstrap.storageLocations}
            products={stockModuleProducts}
            onHand={stockModuleOnHand}
            scopedSalesPointId={bootstrap.scopedSalesPointId}
            canPost={!tabReadOnly && bootstrap.canPostAdjustments}
            canReclassify={!tabReadOnly && bootstrap.canReclassifyStock}
            canCancel={!tabReadOnly && bootstrap.canCancelDocuments}
            canDraft={!tabReadOnly && bootstrap.canDraftAdjustments}
            userId={user.id}
            productFilter={productFilter}
            onOk={announceOk}
            onErr={announceErr}
          />
        ) : null}
      </div>
    </div>
  );
}
