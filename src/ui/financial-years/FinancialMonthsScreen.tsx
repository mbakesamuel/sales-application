import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatDisplayDate as formatDate } from "../../shared/formatDisplayDate.ts";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import type {
  FinancialMonthRow,
  FinancialYearRow,
} from "../../shared/financialYears.types.ts";
import { useDynamicPageSize } from "../hooks/useDynamicPageSize.ts";
import "../customers/CustomersScreen.css";
import "./FinancialMonthsScreen.css";

type ActiveTab = "all" | "OPEN" | "CLOSED";

function statusBadgeClass(status: string): string {
  return status === "OPEN"
    ? "customers-badge customers-badge-emerald"
    : "customers-badge customers-badge-amber";
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M8 2v4M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
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

interface FinancialMonthsScreenProps {
  readOnly?: boolean;
  /** Attached collection point, or null for head-office personal month. */
  salesPointId?: number | null;
}

export function FinancialMonthsScreen({
  readOnly = false,
  salesPointId = null,
}: FinancialMonthsScreenProps = {}) {
  const canWrite = !readOnly;
  const scopeId = salesPointId ?? null;
  const scopeLabel =
    scopeId == null ? "your head-office user account" : "this collection point";
  const [year, setYear] = useState<FinancialYearRow | null>(null);
  const [rows, setRows] = useState<FinancialMonthRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<ActiveTab>("all");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const pageSize = useDynamicPageSize(tableScrollRef);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data =
          await getAuthenticatedFinancialYears().listMonthsForOpenYear(
            scopeId,
          );
        if (!cancelled) {
          setYear(data.year);
          setRows(data.months);
        }
      } catch (loadError) {
        if (!cancelled) {
          setYear(null);
          setRows([]);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load financial months.",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, scopeId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (tab !== "all" && row.status !== tab) return false;
      if (!query) return true;
      return (
        row.name.toLowerCase().includes(query) ||
        String(row.calendarMonth).includes(query) ||
        row.status.toLowerCase().includes(query)
      );
    });
  }, [rows, search, tab]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageStart =
    filtered.length === 0
      ? 0
      : Math.min((currentPage - 1) * pageSize + 1, filtered.length);
  const pageEnd = Math.min(currentPage * pageSize, filtered.length);

  async function toggleStatus(row: FinancialMonthRow) {
    if (!canWrite) return;
    const next = row.status === "OPEN" ? "CLOSED" : "OPEN";
    if (next === "CLOSED") {
      const confirmed = window.confirm(
        `Close ${row.name} ${row.financialYear}? Posting will be blocked until another month is opened.`,
      );
      if (!confirmed) return;
    }
    setActionError(null);
    setBusyId(row.id);
    try {
      await getAuthenticatedFinancialYears().setMonthStatus(
        row.id,
        next,
        scopeId,
      );
      setRefreshKey((current) => current + 1);
    } catch (toggleError) {
      setActionError(
        toggleError instanceof Error
          ? toggleError.message
          : "Failed to update month status.",
      );
    } finally {
      setBusyId(null);
    }
  }

  /* const openMonth = rows.find((row) => row.status === "OPEN"); */

  return (
    <div class="customers-screen financial-months-screen">
      <header class="customers-screen-header">
        <div class="customers-screen-brand">
          <div class="customers-screen-brand-icon">
            <IconCalendar />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">Financial months</h2>
            <p class="customers-screen-brand-subtitle">
              {year
                ? `Open year ${year.financialYear} — open month for ${scopeLabel}`
                : "Open a financial year to manage months"}
            </p>
          </div>
        </div>
      </header>

      {error ? <p class="customers-error">{error}</p> : null}
      {actionError ? <p class="customers-error">{actionError}</p> : null}

      {!isLoading && !year && !error ? (
        <p class="customers-error">
          No open financial year. Open a year under Financial years first.
        </p>
      ) : null}

      <div class="customers-card">
        <div class="customers-card-toolbar">
          <div class="customers-card-toolbar-row">
            <div>
              <h3 class="customers-card-title">Calendar months</h3>
              <p class="customers-card-subtitle">
                {isLoading ? "Loading…" : `${filtered.length} months`}
              </p>
            </div>
            <div class="customers-card-controls">
              <div class="customers-search-wrap">
                <IconSearch />
                <input
                  class="customers-search"
                  type="search"
                  value={search}
                  placeholder="Search months…"
                  onInput={(event) => {
                    setSearch((event.currentTarget as HTMLInputElement).value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          </div>
          <div class="customers-tabs">
            {(
              [
                { id: "all", label: "All" },
                { id: "OPEN", label: "Open" },
                { id: "CLOSED", label: "Closed" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                class={`customers-tab${tab === item.id ? " is-active" : ""}`}
                onClick={() => {
                  setTab(item.id);
                  setPage(1);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div class="customers-table-scroll" ref={tableScrollRef}>
          <table class="customers-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Month</th>
                <th>Status</th>
                <th class="customers-col-hide-md">Opened</th>
                <th class="customers-col-hide-lg">Closed</th>
                {canWrite ? <th style="width: 120px;" /> : null}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={canWrite ? 6 : 5} class="customers-table-empty">
                    Loading months…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 6 : 5} class="customers-table-empty">
                    No months to show.
                  </td>
                </tr>
              ) : (
                paginated.map((row) => (
                  <tr key={row.id}>
                    <td>{row.calendarMonth}</td>
                    <td>
                      <p class="customers-name-primary">{row.name}</p>
                    </td>
                    <td>
                      <span class={statusBadgeClass(row.status)}>{row.status}</span>
                    </td>
                    <td class="customers-col-hide-md">{formatDate(row.openedAt)}</td>
                    <td class="customers-col-hide-lg">{formatDate(row.closedAt)}</td>
                    {canWrite ? (
                      <td>
                        <button
                          type="button"
                          class={
                            row.status === "OPEN"
                              ? "customers-btn customers-btn-secondary"
                              : "customers-btn customers-btn-primary"
                          }
                          disabled={busyId === row.id || !year}
                          onClick={() => void toggleStatus(row)}
                        >
                          {busyId === row.id
                            ? "Saving…"
                            : row.status === "OPEN"
                              ? "Close"
                              : "Open"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div class="customers-pagination">
          <span>
            Showing {pageStart}–{pageEnd} of {filtered.length}
          </span>
          <div class="customers-pagination-pages">
            <button
              type="button"
              class="customers-pagination-btn"
              disabled={currentPage === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <IconChevronLeft />
            </button>
            <span class="customers-pagination-current">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              class="customers-pagination-btn"
              disabled={currentPage === totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            >
              <IconChevronRight />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
