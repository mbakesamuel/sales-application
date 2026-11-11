import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  formatDisplayDate as formatDate,
  formatDisplayDateTime as formatDateTime,
} from "../../shared/formatDisplayDate.ts";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import type { FinancialYearRow } from "../../shared/financialYears.types.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { useDynamicPageSize } from "../hooks/useDynamicPageSize.ts";
import { FinancialYearFormModal } from "./FinancialYearFormModal.tsx";
import "../customers/CustomersScreen.css";
import "./FinancialMonthsScreen.css";

type SortKey = "financialYear" | "status" | "openedAt" | "openMonthCount";
type SortDir = "asc" | "desc";
type ActiveTab = "all" | "OPEN" | "CLOSED";

function statusBadgeClass(status: string): string {
  return status === "OPEN"
    ? "customers-badge customers-badge-emerald"
    : "customers-badge customers-badge-amber";
}

function exportCsv(rows: FinancialYearRow[]) {
  const headers = [
    "id",
    "financialYear",
    "status",
    "startDate",
    "endDate",
    "openedAt",
    "closedAt",
    "monthCount",
    "openMonthCount",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.financialYear,
      row.status,
      row.startDate,
      row.endDate,
      row.openedAt ?? "",
      row.closedAt ?? "",
      row.monthCount,
      row.openMonthCount,
    ]
      .map((value) => `"${String(value).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers.join(","), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `financial-years-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M5 12h14M12 5v14" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function IconMore() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  );
}

function IconChevronUp({ active = false }: { active?: boolean }) {
  return (
    <svg
      class={`customers-sort-icon${active ? " is-active" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

function IconChevronDown({ active = false }: { active?: boolean }) {
  return (
    <svg
      class={`customers-sort-icon${active ? " is-active" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="m6 9 6 6 6-6" />
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

function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ActionMenu({
  onView,
  onCloseYear,
  canWrite,
  canClose,
}: {
  onView: () => void;
  onCloseYear: () => void;
  canWrite: boolean;
  canClose: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div class="customers-actions" ref={rootRef}>
      <button
        type="button"
        class="customers-actions-trigger"
        aria-label="Actions"
        onClick={() => setOpen((current) => !current)}
      >
        <IconMore />
      </button>
      {open ? (
        <div class="customers-actions-menu">
          <button
            type="button"
            class="customers-actions-item"
            onClick={() => {
              setOpen(false);
              onView();
            }}
          >
            <IconEye /> View
          </button>
          {canWrite && canClose ? (
            <>
              <div class="customers-actions-divider" />
              <button
                type="button"
                class="customers-actions-item customers-actions-item-danger"
                onClick={() => {
                  setOpen(false);
                  onCloseYear();
                }}
              >
                Close year
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface FinancialYearsScreenProps {
  readOnly?: boolean;
}

export function FinancialYearsScreen({
  readOnly = false,
}: FinancialYearsScreenProps = {}) {
  const canWrite = !readOnly;
  const [rows, setRows] = useState<FinancialYearRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<ActiveTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("financialYear");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [viewRow, setViewRow] = useState<FinancialYearRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const pageSize = useDynamicPageSize(tableScrollRef);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getAuthenticatedFinancialYears().listYears();
        if (!cancelled) setRows(data);
      } catch (loadError) {
        if (!cancelled) {
          setRows([]);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load financial years.",
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
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (tab !== "all" && row.status !== tab) return false;
      if (!query) return true;
      return (
        String(row.financialYear).includes(query) ||
        row.status.toLowerCase().includes(query)
      );
    });
  }, [rows, search, tab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      let result = 0;
      if (sortKey === "financialYear" || sortKey === "openMonthCount") {
        result = left[sortKey] - right[sortKey];
      } else {
        result = String(left[sortKey] ?? "").localeCompare(String(right[sortKey] ?? ""));
      }
      return sortDir === "asc" ? result : -result;
    });
    return next;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const stats = useMemo(
    () => [
      { label: "Total years", value: rows.length },
      { label: "Open", value: rows.filter((row) => row.status === "OPEN").length },
      {
        label: "Open months",
        value: rows.reduce((sum, row) => sum + row.openMonthCount, 0),
      },
    ],
    [rows],
  );

  function refreshRows() {
    setRefreshKey((current) => current + 1);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "financialYear" ? "desc" : "asc");
    }
    setPage(1);
  }

  async function handleCloseYear(row: FinancialYearRow) {
    const confirmed = window.confirm(
      `Close financial year ${row.financialYear}? This closes all open months for the year.`,
    );
    if (!confirmed) return;
    setActionError(null);
    try {
      await getAuthenticatedFinancialYears().closeYear(row.id);
      refreshRows();
    } catch (closeError) {
      setActionError(
        closeError instanceof Error ? closeError.message : "Failed to close year.",
      );
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <IconChevronUp />;
    return sortDir === "asc" ? <IconChevronUp active /> : <IconChevronDown active />;
  }

  const pageStart =
    sorted.length === 0 ? 0 : Math.min((currentPage - 1) * pageSize + 1, sorted.length);
  const pageEnd = Math.min(currentPage * pageSize, sorted.length);

  return (
    <div class="customers-screen">
      <header class="customers-screen-header">
        <div class="customers-screen-brand">
          <div class="customers-screen-brand-icon">
            <IconCalendar />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">Financial years</h2>
            <p class="customers-screen-brand-subtitle">
              Open one year at a time for posting and budgets
            </p>
          </div>
        </div>
        <div class="customers-screen-header-actions">
          <button
            type="button"
            class="customers-btn customers-btn-secondary"
            disabled={sorted.length === 0}
            onClick={() => exportCsv(sorted)}
          >
            <IconDownload /> Export
          </button>
          {canWrite ? (
            <button
              type="button"
              class="customers-btn customers-btn-primary"
              disabled={isLoading}
              onClick={() => setFormOpen(true)}
            >
              <IconPlus /> Open year
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p class="customers-error">{error}</p> : null}
      {actionError ? <p class="customers-error">{actionError}</p> : null}

      <div class="customers-stats">
        {stats.map((stat) => (
          <div key={stat.label} class="customers-stat-card">
            <div class="customers-stat-icon customers-stat-icon-blue">
              <IconCalendar />
            </div>
            <div>
              <p class="customers-stat-value">{stat.value}</p>
              <p class="customers-stat-label">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div class="customers-card">
        <div class="customers-card-toolbar">
          <div class="customers-card-toolbar-row">
            <div>
              <h3 class="customers-card-title">All years</h3>
              <p class="customers-card-subtitle">
                {isLoading ? "Loading…" : `${filtered.length} records`}
              </p>
            </div>
            <div class="customers-card-controls">
              <div class="customers-search-wrap">
                <IconSearch />
                <input
                  class="customers-search"
                  type="search"
                  value={search}
                  placeholder="Search years…"
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
                <th class="is-sortable" onClick={() => toggleSort("financialYear")}>
                  <span class="customers-th-inner">
                    Year <SortIcon col="financialYear" />
                  </span>
                </th>
                <th class="is-sortable" onClick={() => toggleSort("status")}>
                  <span class="customers-th-inner">
                    Status <SortIcon col="status" />
                  </span>
                </th>
                <th class="customers-col-hide-md">Range</th>
                <th
                  class="is-sortable customers-col-hide-lg"
                  onClick={() => toggleSort("openMonthCount")}
                >
                  <span class="customers-th-inner">
                    Open months <SortIcon col="openMonthCount" />
                  </span>
                </th>
                <th
                  class="is-sortable customers-col-hide-lg"
                  onClick={() => toggleSort("openedAt")}
                >
                  <span class="customers-th-inner">
                    Opened <SortIcon col="openedAt" />
                  </span>
                </th>
                <th style="width: 40px;" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} class="customers-table-empty">
                    Loading financial years…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={6} class="customers-table-empty">
                    No financial years yet. Open a year to begin posting.
                  </td>
                </tr>
              ) : (
                paginated.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div class="customers-name-cell">
                        <div class="customers-avatar">{String(row.financialYear).slice(2)}</div>
                        <div>
                          <p class="customers-name-primary">{row.financialYear}</p>
                          <span class="customers-badge customers-badge-slate">
                            {row.monthCount}/12 months
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class={statusBadgeClass(row.status)}>{row.status}</span>
                    </td>
                    <td class="customers-col-hide-md">
                      {formatDate(row.startDate)} → {formatDate(row.endDate)}
                    </td>
                    <td class="customers-col-hide-lg">{row.openMonthCount}</td>
                    <td class="customers-col-hide-lg">{formatDate(row.openedAt)}</td>
                    <td>
                      <ActionMenu
                        canWrite={canWrite}
                        canClose={row.status === "OPEN"}
                        onView={() => setViewRow(row)}
                        onCloseYear={() => void handleCloseYear(row)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div class="customers-pagination">
          <span>
            Showing {pageStart}–{pageEnd} of {sorted.length}
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

      {formOpen ? (
        <FinancialYearFormModal
          onClose={() => setFormOpen(false)}
          onSaved={refreshRows}
        />
      ) : null}

      {viewRow ? (
        <FormDialog
          ariaLabel={`View ${viewRow.financialYear}`}
          title={`Financial year ${viewRow.financialYear}`}
          subtitle={viewRow.status === "OPEN" ? "Currently open for posting" : "Closed year"}
          onClose={() => setViewRow(null)}
        >
          <div class="fy-view-sections">
            <section class="fy-view-section">
              <h3 class="fy-view-section-title">Status</h3>
              <div class="customers-view-grid">
                <div class="customers-view-row">
                  <span class="customers-view-label">Year</span>
                  <span class="customers-view-value">{viewRow.financialYear}</span>
                </div>
                <div class="customers-view-row">
                  <span class="customers-view-label">Status</span>
                  <span class="customers-view-value">
                    <span class={statusBadgeClass(viewRow.status)}>{viewRow.status}</span>
                  </span>
                </div>
              </div>
            </section>

            <section class="fy-view-section">
              <h3 class="fy-view-section-title">Period</h3>
              <div class="customers-view-grid">
                <div class="customers-view-row">
                  <span class="customers-view-label">Start</span>
                  <span class="customers-view-value">{formatDate(viewRow.startDate)}</span>
                </div>
                <div class="customers-view-row">
                  <span class="customers-view-label">End</span>
                  <span class="customers-view-value">{formatDate(viewRow.endDate)}</span>
                </div>
              </div>
            </section>

            <section class="fy-view-section">
              <h3 class="fy-view-section-title">Opened / closed</h3>
              <div class="customers-view-grid">
                <div class="customers-view-row">
                  <span class="customers-view-label">Opened</span>
                  <span class="customers-view-value">{formatDateTime(viewRow.openedAt)}</span>
                </div>
                <div class="customers-view-row">
                  <span class="customers-view-label">Closed</span>
                  <span class="customers-view-value">{formatDateTime(viewRow.closedAt)}</span>
                </div>
              </div>
            </section>

            <section class="fy-view-section">
              <h3 class="fy-view-section-title">Months</h3>
              <div class="customers-view-grid">
                <div class="customers-view-row">
                  <span class="customers-view-label">Total</span>
                  <span class="customers-view-value">{viewRow.monthCount} / 12</span>
                </div>
                <div class="customers-view-row">
                  <span class="customers-view-label">Open</span>
                  <span class="customers-view-value">{viewRow.openMonthCount}</span>
                </div>
              </div>
            </section>
          </div>
          <div class="form-dialog-actions" style="padding-left: 0; margin-top: 12px;">
            <button
              type="button"
              class="form-dialog-btn-secondary"
              onClick={() => setViewRow(null)}
            >
              Close
            </button>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}
