import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type { SaleProductMode } from "../../shared/sales.types.ts";
import type { SalesModuleVariant } from "../../shared/salesModule.ts";
import type { AuthUser } from "../auth/session.ts";
import { getElectronApi } from "../auth/client.ts";
import { useDynamicPageSize } from "../hooks/useDynamicPageSize.ts";
import { SalePrintView } from "./SalePrintView.tsx";
import type { SalesListFilters, SalesListResult } from "./types.ts";

interface SalesListProps {
  user: AuthUser;
  variant?: SalesModuleVariant;
  listTitle?: string;
  productMode: SaleProductMode;
  onOpenInvoice: (invoiceNo: string) => void;
  onOpenScreen?: () => void;
}

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

export function SalesList({
  user,
  variant = "loose",
  listTitle,
  productMode,
  onOpenInvoice,
  onOpenScreen,
}: SalesListProps) {
  const filters = useMemo<SalesListFilters>(
    () => ({
      userId: user.id,
      q: "",
      period: "month",
      productMode,
    }),
    [user.id, productMode],
  );
  const [appliedFilters, setAppliedFilters] = useState<SalesListFilters>(filters);
  const [draftQ, setDraftQ] = useState("");
  const [result, setResult] = useState<SalesListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [printSaleId, setPrintSaleId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const pageSize = useDynamicPageSize(tableScrollRef, { paginationReserve: 96 });
  const isBottled = variant === "bottled";
  const title =
    listTitle ?? (isBottled ? "Bottle Oil invoices" : "Sales invoices");
  const qtyHeader = isBottled ? "Qty (units)" : "Qty (kg)";
  const colCount = isBottled ? 9 : 10;
  const newInvoiceLabel = isBottled
    ? "New Bottle Oil invoice"
    : "New invoice";

  useEffect(() => {
    setAppliedFilters((current) => ({
      ...current,
      userId: user.id,
      productMode,
    }));
  }, [user.id, productMode]);

  useEffect(() => {
    setPage(1);
  }, [appliedFilters]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const data = await getElectronApi().sales.listSales(appliedFilters);
        if (!cancelled) {
          setResult(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load sales list.",
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
  }, [appliedFilters]);

  const rows = result?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const pageStart =
    rows.length === 0 ? 0 : Math.min((currentPage - 1) * pageSize + 1, rows.length);
  const pageEnd = Math.min(currentPage * pageSize, rows.length);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  function applyFilters(event: Event) {
    event.preventDefault();
    setAppliedFilters((current) => ({ ...current, q: draftQ.trim() }));
  }

  return (
    <div class="sales-list">
      {printSaleId ? (
        <SalePrintView saleId={printSaleId} onClose={() => setPrintSaleId(null)} />
      ) : null}

      <div class="sales-panel-header">
        <h3>{title}</h3>
        {onOpenScreen ? (
          <button type="button" class="sales-btn-primary" onClick={onOpenScreen}>
            {newInvoiceLabel}
          </button>
        ) : null}
      </div>

      <form class="sales-panel sales-filters" onSubmit={applyFilters}>
        <label class="sales-field">
          <input
            type="search"
            aria-label="Invoice number"
            value={draftQ}
            placeholder="Invoice number"
            onInput={(event) =>
              setDraftQ((event.currentTarget as HTMLInputElement).value)
            }
          />
        </label>

        <label class="sales-field">
          <select
            aria-label="Period"
            value={appliedFilters.period ?? "month"}
            onChange={(event) =>
              setAppliedFilters((current) => ({
                ...current,
                period: (event.currentTarget as HTMLSelectElement)
                  .value as SalesListFilters["period"],
              }))
            }
          >
            <option value="month">Period · Open month</option>
            <option value="year">Period · Open year</option>
            <option value="all">Period · All time</option>
          </select>
        </label>

        <button type="submit" class="sales-btn-primary">
          Apply
        </button>
      </form>

      {error ? <p class="sales-error">{error}</p> : null}

      <div class="sales-table-wrap sales-panel" ref={tableScrollRef}>
        <table class="sales-table sales-list-table">
          <thead>
            <tr>
              <th>Invoice No</th>
              <th>Date</th>
              <th>Collection point</th>
              {!isBottled ? <th>DO No</th> : null}
              <th>Customer</th>
              <th>Product</th>
              <th>Status</th>
              <th class="sales-num">{qtyHeader}</th>
              <th class="sales-num">Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={colCount} class="sales-empty-cell">
                  Loading invoices…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colCount} class="sales-empty-cell">
                  No sales invoices match these filters.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.id}>
                  <td class="sales-strong">{row.invoiceNo}</td>
                  <td>{formatDisplayDate(row.soldAtIso)}</td>
                  <td>{row.salesPointName}</td>
                  {!isBottled ? <td>{row.deliveryOrderNo ?? ""}</td> : null}
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
                        class="sales-list-pagination-btn sales-list-edit-btn"
                        aria-label={`Edit ${row.invoiceNo}`}
                        title="Edit"
                        onClick={() => onOpenInvoice(row.invoiceNo)}
                      >
                        <IconPencil />
                      </button>
                    ) : (
                      <button
                        type="button"
                        class="sales-list-pagination-btn sales-list-open-btn"
                        aria-label={`Open ${row.invoiceNo}`}
                        title="Open"
                        onClick={() => onOpenInvoice(row.invoiceNo)}
                      >
                        <IconEye />
                      </button>
                    )}
                    <button
                      type="button"
                      class="sales-link-btn"
                      onClick={() => setPrintSaleId(row.id)}
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
                  Totals ({result.periodLabel}) · {result.totals.count} invoices
                </span>
                <span class="sales-num">{result.totals.totalQtyLabel}</span>
                <span class="sales-num">{result.totals.totalAmountXaf}</span>
              </>
            ) : (
              <span class="sales-muted">No invoices in this filter.</span>
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
