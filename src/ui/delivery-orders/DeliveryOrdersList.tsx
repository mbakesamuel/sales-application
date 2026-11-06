import { useEffect, useState } from "preact/hooks";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type { AuthUser } from "../auth/session.ts";
import { getElectronApi } from "../auth/client.ts";
import type {
  DeliveryOrdersListFilters,
  DeliveryOrdersListResult,
  DeliveryOrdersSalesPointOption,
} from "./types.ts";
import { DeliveryOrderPrintView } from "./DeliveryOrderPrintView.tsx";
import "../sales/sales.css";

interface DeliveryOrdersListProps {
  user: AuthUser;
  onOpenOrder: (deliveryOrderNo: string) => void;
  onOpenScreen?: () => void;
}

const PAGE_SIZE = 15;

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function DeliveryOrdersList({
  user,
  onOpenOrder,
  onOpenScreen,
}: DeliveryOrdersListProps) {
  const [filters, setFilters] = useState<DeliveryOrdersListFilters>({
    userId: user.id,
    q: "",
    period: "month",
    salesPointId: null,
  });
  const [draftQ, setDraftQ] = useState("");
  const [salesPoints, setSalesPoints] = useState<DeliveryOrdersSalesPointOption[]>([]);
  const [scopedSalesPointId, setScopedSalesPointId] = useState<number | null>(
    null,
  );
  const [result, setResult] = useState<DeliveryOrdersListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [printOrderId, setPrintOrderId] = useState<number | string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setFilters((current) => ({ ...current, userId: user.id }));
  }, [user.id]);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      try {
        const options = await getElectronApi().deliveryOrders.getFormOptions(
          user.id,
        );
        if (!cancelled) {
          setSalesPoints(options.salesPoints);
          setScopedSalesPointId(options.scopedSalesPointId);
          if (options.scopedSalesPointId != null) {
            setFilters((current) => ({
              ...current,
              salesPointId: options.scopedSalesPointId,
            }));
          }
        }
      } catch {
        // Options are best-effort; list can still load without them.
      }
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [user.id]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const data = await getElectronApi().deliveryOrders.listOrders(filters);
        if (!cancelled) {
          setResult(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load delivery orders.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [filters]);

  const rows = result?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const pageStart =
    rows.length === 0 ? 0 : Math.min((currentPage - 1) * PAGE_SIZE + 1, rows.length);
  const pageEnd = Math.min(currentPage * PAGE_SIZE, rows.length);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  function applyFilters(event: Event) {
    event.preventDefault();
    setFilters((current) => ({ ...current, q: draftQ.trim() }));
  }

  return (
    <div class="sales-list">
      {printOrderId != null ? (
        <DeliveryOrderPrintView
          orderId={printOrderId}
          onClose={() => setPrintOrderId(null)}
        />
      ) : null}

      <div class="sales-panel-header">
        <div>
          <h3>Delivery orders</h3>
          <p class="sales-muted">
            Filter by DO number, collection point, or view documents in the open posting month or year.
          </p>
        </div>
        {onOpenScreen ? (
          <button type="button" class="sales-btn-primary" onClick={onOpenScreen}>
            New delivery order
          </button>
        ) : null}
      </div>

      <form class="sales-panel sales-filters" onSubmit={applyFilters}>
        <label class="sales-field">
          <input
            type="search"
            aria-label="DO number"
            value={draftQ}
            placeholder="DO number"
            onInput={(event) =>
              setDraftQ((event.currentTarget as HTMLInputElement).value)
            }
          />
        </label>

        <label class="sales-field">
          <select
            aria-label="Period"
            value={filters.period ?? "month"}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                period: (event.currentTarget as HTMLSelectElement)
                  .value as DeliveryOrdersListFilters["period"],
              }))
            }
          >
            <option value="month">Period · Open month</option>
            <option value="year">Period · Open year</option>
            <option value="all">Period · All time</option>
          </select>
        </label>

        <label class="sales-field">
          <select
            aria-label="Collection point"
            value={filters.salesPointId == null ? "" : String(filters.salesPointId)}
            disabled={scopedSalesPointId != null}
            onChange={(event) => {
              const value = (event.currentTarget as HTMLSelectElement).value;
              setFilters((current) => ({
                ...current,
                salesPointId: value ? Number.parseInt(value, 10) : null,
              }));
            }}
          >
            <option value="">Collection point…</option>
            {salesPoints.map((point) => (
              <option key={point.id} value={String(point.id)}>
                {point.name}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" class="sales-btn-primary">
          Apply
        </button>
      </form>

      {error ? <p class="sales-error">{error}</p> : null}

      <div class="sales-panel sales-table-wrap">
        <table class="sales-table sales-list-table">
          <thead>
            <tr>
              <th>DO no.</th>
              <th>Date</th>
              <th>Collection point</th>
              <th>Customer</th>
              <th>Product</th>
              <th>Status</th>
              <th class="sales-num">Qty</th>
              <th class="sales-num">Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} class="sales-empty-cell">
                  Loading delivery orders…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} class="sales-empty-cell">
                  No delivery orders match these filters.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.id}>
                  <td class="sales-strong">{row.deliveryOrderNo}</td>
                  <td>{formatDisplayDate(row.dateIssuedIso)}</td>
                  <td>{row.salesPointName}</td>
                  <td>{row.customerName}</td>
                  <td>{row.productSummary}</td>
                  <td>
                    <span class={`sales-status sales-status-${row.status.toLowerCase()}`}>
                      {row.status}
                    </span>
                  </td>
                  <td class="sales-num">{row.totalQtyLabel}</td>
                  <td class="sales-num">{row.totalAmountXaf}</td>
                  <td class="sales-actions-cell">
                    {row.status === "PENDING" ? (
                      <button
                        type="button"
                        class="sales-list-pagination-btn do-list-edit-btn"
                        aria-label={`Edit ${row.deliveryOrderNo}`}
                        title="Edit"
                        onClick={() => onOpenOrder(row.deliveryOrderNo)}
                      >
                        <IconPencil />
                      </button>
                    ) : (
                      <button
                        type="button"
                        class="sales-list-pagination-btn do-list-open-btn"
                        aria-label={`Open ${row.deliveryOrderNo}`}
                        title="Open"
                        onClick={() => onOpenOrder(row.deliveryOrderNo)}
                      >
                        <IconEye />
                      </button>
                    )}
                    <button
                      type="button"
                      class="sales-link-btn"
                      onClick={() => setPrintOrderId(row.id)}
                    >
                      Print
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {result && !isLoading ? (
        <div class="sales-list-footer">
          <div class="sales-list-footer-totals">
            {rows.length > 0 ? (
              <>
                <span>
                  Totals ({result.periodLabel}) · {result.totals.count} DOs
                </span>
                <span class="sales-num">{result.totals.totalQtyLabel}</span>
                <span class="sales-num">{result.totals.totalAmountXaf}</span>
              </>
            ) : (
              <span class="sales-muted">No delivery orders in this filter.</span>
            )}
          </div>
          <div class="sales-list-pagination">
            <span>
              Showing {pageStart}–{pageEnd} of {rows.length}
            </span>
            <div class="sales-list-pagination-pages">
              <button
                type="button"
                class="sales-list-pagination-btn"
                disabled={currentPage <= 1}
                aria-label="Previous page"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <IconChevronLeft />
              </button>
              <span>
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                class="sales-list-pagination-btn"
                disabled={currentPage >= totalPages}
                aria-label="Next page"
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
              >
                <IconChevronRight />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
