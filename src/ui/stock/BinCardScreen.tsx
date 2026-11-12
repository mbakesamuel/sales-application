import { useEffect, useMemo, useState } from "preact/hooks";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import type {
  BinCardConditionFilter,
  BinCardQuery,
  BinCardReport,
  ProductOption,
  StockBootstrap,
  StorageLocationOption,
} from "../../shared/stock.types.ts";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import type { AuthUser } from "../auth/session.ts";
import { getElectronApi } from "../auth/client.ts";
import { useReportOverlay } from "../reports/ReportOverlayContext.tsx";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import {
  clampIsoDateToRange,
  defaultReceiptLocationId,
  formatDate,
  utcIsoDateToday,
} from "./stockUtils.ts";
import "./StockScreen.css";
import "./BinCardScreen.css";

/** Bin card is limited to bottled products only. */
const BIN_CARD_PRODUCT_FILTER = "bottled" as const;

interface BinCardScreenProps {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  /** When true, omit standalone page header (for use inside Stock tab panel). */
  embedded?: boolean;
  /** Parent-provided bootstrap skips a duplicate getBootstrap fetch. */
  bootstrap?: StockBootstrap;
}

function formatQty(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.0000005) {
    return "—";
  }
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function BinCardColGroup() {
  return (
    <colgroup>
      <col class="bincard-col-date" />
      <col class="bincard-col-ref" />
      <col />
      <col class="bincard-col-num" />
      <col class="bincard-col-num" />
      <col class="bincard-col-num" />
    </colgroup>
  );
}

function buildQuery(input: {
  productId: string;
  salesPointId: string;
  storageLocationId: string;
  condition: BinCardConditionFilter;
  fromIso: string;
  toIso: string;
}): BinCardQuery | null {
  if (!input.productId || !input.fromIso || !input.toIso) {
    return null;
  }
  return {
    productId: Number(input.productId),
    salesPointId: input.salesPointId ? Number(input.salesPointId) : null,
    storageLocationId: input.storageLocationId
      ? Number(input.storageLocationId)
      : null,
    condition: input.condition,
    fromIso: input.fromIso,
    toIso: input.toIso,
    productFilter: BIN_CARD_PRODUCT_FILTER,
  };
}


export function BinCardScreen({
  user,
  permissions: _permissions,
  embedded,
  bootstrap: bootstrapProp,
}: BinCardScreenProps) {
  const { openReportOverlay } = useReportOverlay();
  const [bootstrap, setBootstrap] = useState<StockBootstrap | null>(
    bootstrapProp ?? null,
  );
  const [postingPeriod, setPostingPeriod] = useState<OpenPostingPeriod | null>(
    null,
  );
  const [productId, setProductId] = useState("");
  const [salesPointId, setSalesPointId] = useState("");
  const [storageLocationId, setStorageLocationId] = useState("");
  const condition: BinCardConditionFilter = "SELLABLE";
  const [fromIso, setFromIso] = useState("");
  const [toIso, setToIso] = useState("");
  const [report, setReport] = useState<BinCardReport | null>(null);
  const [loadingBootstrap, setLoadingBootstrap] = useState(!bootstrapProp);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bootstrapProp) {
      setBootstrap(bootstrapProp);
    }
  }, [bootstrapProp]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingBootstrap(true);
      setError(null);
      try {
        const bootstrapPromise = bootstrapProp
          ? Promise.resolve(bootstrapProp)
          : getElectronApi().stock.getBootstrap(
              user.id,
              BIN_CARD_PRODUCT_FILTER,
            );
        const [data, period] = await Promise.all([
          bootstrapPromise,
          getAuthenticatedFinancialYears().getOpenPostingPeriod(
            user.salesPointId,
          ),
        ]);
        if (cancelled) return;
        setBootstrap(data);
        setPostingPeriod(period);
        if (!period) {
          setError("Open a financial month before using the bin card.");
          setFromIso("");
          setToIso("");
        } else {
          const start = period.startDate.slice(0, 10);
          const end = clampIsoDateToRange(utcIsoDateToday(), period);
          setFromIso(start);
          setToIso(end);
        }
        const lockedSalesPointId =
          data.botaSalesPointId ?? data.scopedSalesPointId;
        if (lockedSalesPointId != null) {
          setSalesPointId(String(lockedSalesPointId));
          setStorageLocationId(
            defaultReceiptLocationId(
              data.storageLocations,
              lockedSalesPointId,
              true,
            ),
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load stock options.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingBootstrap(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user.id, user.salesPointId, bootstrapProp]);

  const products: ProductOption[] = bootstrap?.products ?? [];
  const storageLocations: StorageLocationOption[] =
    bootstrap?.storageLocations ?? [];

  const lockedSalesPointId = useMemo(() => {
    if (bootstrap?.botaSalesPointId != null) {
      return String(bootstrap.botaSalesPointId);
    }
    if (bootstrap?.scopedSalesPointId != null) {
      return String(bootstrap.scopedSalesPointId);
    }
    return "";
  }, [bootstrap?.botaSalesPointId, bootstrap?.scopedSalesPointId]);

  const lockedStorageLocationId = useMemo(
    () =>
      lockedSalesPointId
        ? defaultReceiptLocationId(storageLocations, lockedSalesPointId, true)
        : "",
    [lockedSalesPointId, storageLocations],
  );

  useEffect(() => {
    if (lockedSalesPointId && salesPointId !== lockedSalesPointId) {
      setSalesPointId(lockedSalesPointId);
    }
  }, [lockedSalesPointId, salesPointId]);

  useEffect(() => {
    if (
      lockedStorageLocationId &&
      storageLocationId !== lockedStorageLocationId
    ) {
      setStorageLocationId(lockedStorageLocationId);
    }
  }, [lockedStorageLocationId, storageLocationId]);

  async function applyFilters() {
    if (!postingPeriod) {
      setError("Open a financial month before using the bin card.");
      return;
    }
    const clampedFrom = clampIsoDateToRange(fromIso, postingPeriod);
    const clampedTo = clampIsoDateToRange(toIso, postingPeriod);
    const query = buildQuery({
      productId,
      salesPointId,
      storageLocationId,
      condition,
      fromIso: clampedFrom,
      toIso: clampedTo < clampedFrom ? clampedFrom : clampedTo,
    });
    if (!query) {
      setError("Select a product and date range.");
      return;
    }

    setFromIso(query.fromIso);
    setToIso(query.toIso);
    setLoadingReport(true);
    setError(null);
    try {
      const data = await getElectronApi().stock.getBinCard(user.id, query);
      setReport(data);
    } catch (loadError) {
      setReport(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load bin card.",
      );
    } finally {
      setLoadingReport(false);
    }
  }

  function openReportOverlayFromFilters() {
    if (!postingPeriod) {
      setError("Open a financial month before using the bin card.");
      return;
    }
    const clampedFrom = clampIsoDateToRange(fromIso, postingPeriod);
    const clampedTo = clampIsoDateToRange(toIso, postingPeriod);
    const query = buildQuery({
      productId,
      salesPointId,
      storageLocationId,
      condition,
      fromIso: clampedFrom,
      toIso: clampedTo < clampedFrom ? clampedFrom : clampedTo,
    });
    if (!query) {
      setError("Select a product and date range, then Apply before opening the report.");
      return;
    }
    if (!report) {
      setError("Apply filters first, then open the report.");
      return;
    }

    setError(null);
    openReportOverlay("stock-bin-card-report", query);
  }

  if (loadingBootstrap) {
    return <p class="scr-status">Loading bin card…</p>;
  }

  return (
    <div
      class={
        embedded ? "bincard-page bincard-embedded" : "stock-screen bincard-page"
      }
    >
      {!embedded ? (
        <header class="stock-header">
          <h1>Bin Card</h1>
          <p class="stock-header-subtitle">
            Bottled products only — opening balance, receipts, issues, and running
            balance. Open the printable report in an overlay.
          </p>
        </header>
      ) : null}

      <section class="stock-section">
        <div class="bincard-filters">
          <label>
            Product
            <select
              value={productId}
              onChange={(event) =>
                setProductId((event.target as HTMLSelectElement).value)
              }
            >
              <option value="">Select bottled product…</option>
              {products.map((product) => (
                <option key={product.productId} value={product.productId}>
                  {product.productName} ({product.uom})
                </option>
              ))}
            </select>
          </label>
          <label>
            From
            <input
              type="date"
              value={fromIso}
              min={postingPeriod?.startDate}
              max={postingPeriod?.endDate}
              disabled={!postingPeriod}
              onInput={(event) => {
                const raw = (event.target as HTMLInputElement).value;
                const next = clampIsoDateToRange(raw, postingPeriod);
                setFromIso(next);
                if (toIso && toIso < next) {
                  setToIso(next);
                }
              }}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={toIso}
              min={postingPeriod?.startDate}
              max={postingPeriod?.endDate}
              disabled={!postingPeriod}
              onInput={(event) => {
                const raw = (event.target as HTMLInputElement).value;
                const next = clampIsoDateToRange(raw, postingPeriod);
                setToIso(fromIso && next < fromIso ? fromIso : next);
              }}
            />
          </label>
          <div class="bincard-filter-actions">
            <button
              type="button"
              class="scr-btn"
              disabled={loadingReport || !postingPeriod}
              onClick={() => void applyFilters()}
            >
              {loadingReport ? "Loading…" : "Apply"}
            </button>
            <button
              type="button"
              class="scr-btn scr-btn-secondary"
              disabled={!report}
              onClick={() => openReportOverlayFromFilters()}
              >
              Open report
            </button>
          </div>
        </div>

        {error ? <p class="stock-error">{error}</p> : null}

        {report?.truncated ? (
          <p class="bincard-warning">
            Showing the first 5,000 movements in range. Narrow the date range or
            filters for a full ledger.
          </p>
        ) : null}

        {report ? (
          <div class="stock-section-header">
            <div>
              <h2>{report.productName}</h2>
              <p class="stock-hint">
                {report.salesPointLabel} · {report.storageLocationLabel} ·{" "}
                {formatDate(report.fromIso)} – {formatDate(report.toIso)} ·{" "}
                {report.uom}
              </p>
            </div>
            <div class="stock-hint bincard-balance-summary">
              Opening {formatQty(report.openingBalance)} · Closing{" "}
              {formatQty(report.closingBalance)}
            </div>
          </div>
        ) : null}

        <div class="stock-table-wrap bincard-ledger-scroll">
          <table class="stock-table bincard-ledger-table">
            <BinCardColGroup />
            <thead>
              <tr>
                <th>Date</th>
                <th>Reference</th>
                <th>Particulars</th>
                <th class="stock-num">In</th>
                <th class="stock-num">Out</th>
                <th class="stock-num">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="stock-nowrap">
                  {report ? formatDate(report.fromIso) : fromIso ? formatDate(fromIso) : "—"}
                </td>
                <td>—</td>
                <td class="stock-strong">Opening balance</td>
                <td class="stock-num">—</td>
                <td class="stock-num">—</td>
                <td class="stock-num stock-strong">
                  {report ? formatQty(report.openingBalance) : "—"}
                </td>
              </tr>
              {report
                ? report.lines.map((line) => (
                    <tr key={line.id}>
                      <td class="stock-nowrap">
                        {formatDate(line.occurredAtIso)}
                      </td>
                      <td class="stock-mono">{line.reference}</td>
                      <td>
                        {line.particulars}
                        {report.salesPointId == null ||
                        report.storageLocationId == null ? (
                          <div class="stock-subtext">
                            {line.salesPointName}
                            {report.storageLocationId == null
                              ? ` · ${line.storageLocationName}`
                              : ""}
                          </div>
                        ) : null}
                      </td>
                      <td class="stock-num stock-text-positive">
                        {line.qtyIn > 0 ? formatQty(line.qtyIn) : "—"}
                      </td>
                      <td class="stock-num stock-text-negative">
                        {line.qtyOut > 0 ? formatQty(line.qtyOut) : "—"}
                      </td>
                      <td class="stock-num">{formatQty(line.balance)}</td>
                    </tr>
                  ))
                : (
                  <tr>
                    <td colSpan={6} class="stock-empty-cell">
                      {loadingReport
                        ? "Loading…"
                        : "Select a product and date range, then click Apply."}
                    </td>
                  </tr>
                )}
            </tbody>
            <tfoot class="bincard-ledger-footer">
              <tr>
                <td class="stock-nowrap">
                  {report ? formatDate(report.toIso) : toIso ? formatDate(toIso) : "—"}
                </td>
                <td>—</td>
                <td class="stock-strong">Closing balance</td>
                <td class="stock-num">—</td>
                <td class="stock-num">—</td>
                <td class="stock-num stock-strong">
                  {report ? formatQty(report.closingBalance) : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    
    </div>
  );
}
