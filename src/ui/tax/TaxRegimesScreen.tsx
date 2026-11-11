import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import {
  formatDisplayDate as formatDate,
  formatDisplayDateTime,
} from "../../shared/formatDisplayDate.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";
import {
  TAX_REGIME_KIND_LABELS,
  normalizeTaxRegimeKind,
  type TaxRegimeKind,
} from "../../shared/taxRules.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { useDynamicPageSize } from "../hooks/useDynamicPageSize.ts";
import { TaxRegimeFormModal } from "./TaxRegimeFormModal.tsx";
import type { TableSchema } from "../types/electron.d.ts";
import "../customers/CustomersScreen.css";
import { confirmDelete } from "../components/confirmModal.tsx";

type SortKey = "name" | "kind" | "customerCount" | "createdAt" | "isActive";
type SortDir = "asc" | "desc";
type ActiveTab = "all" | "active" | "inactive" | TaxRegimeKind;

interface TaxRegimeRow {
  id: string;
  name: string;
  isActive: boolean;
  kind: TaxRegimeKind;
  kindLabel: string;
  customerCount: number;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

type FormState = { mode: "create" } | { mode: "edit"; row: Record<string, unknown> };

function statusBadgeClass(isActive: boolean): string {
  return isActive
    ? "customers-badge customers-badge-emerald"
    : "customers-badge customers-badge-amber";
}

function kindBadgeClass(kind: TaxRegimeKind): string {
  return kind === "REAL"
    ? "customers-badge customers-badge-violet"
    : "customers-badge customers-badge-blue";
}

function matchesTab(row: TaxRegimeRow, tab: ActiveTab): boolean {
  if (tab === "all") {
    return true;
  }
  if (tab === "active") {
    return row.isActive;
  }
  if (tab === "inactive") {
    return !row.isActive;
  }
  return row.kind === tab;
}

function exportCsv(rows: TaxRegimeRow[]) {
  const headers = [
    "id",
    "name",
    "isActive",
    "kind",
    "customerCount",
    "createdAt",
    "updatedAt",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.name,
      row.isActive ? "1" : "0",
      row.kind,
      row.customerCount,
      row.createdAt,
      row.updatedAt,
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
  link.download = `tax-regimes-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function IconScale() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10" />
      <path d="M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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

function IconPrinter() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
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

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function RowActions({
  onView,
  onEdit,
  onDelete,
  canWrite = true,
}: {
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canWrite?: boolean;
}) {
  return (
    <div class="customers-row-actions">
      <button type="button" class="customers-row-action-btn" onClick={onView}>
        <IconEye /> View
      </button>
      {canWrite ? (
        <>
          <button type="button" class="customers-row-action-btn" onClick={onEdit}>
            <IconPencil /> Edit
          </button>
          <button
            type="button"
            class="customers-row-action-btn customers-row-action-btn-danger"
            onClick={onDelete}
          >
            <IconTrash /> Delete
          </button>
        </>
      ) : null}
    </div>
  );
}

interface TaxRegimesScreenProps {
  readOnly?: boolean;
}

export function TaxRegimesScreen({ readOnly = false }: TaxRegimesScreenProps = {}) {
  const [printOpen, setPrintOpen] = useState(false);
  const canWrite = !readOnly;
  const [rows, setRows] = useState<TaxRegimeRow[]>([]);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formState, setFormState] = useState<FormState | null>(null);
  const [viewRow, setViewRow] = useState<TaxRegimeRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const pageSize = useDynamicPageSize(tableScrollRef);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const api = getElectronApi();
        const [regimeResult, customerResult, tableSchema] = await Promise.all([
          api.db.queryTable({ table: "TaxRegime", limit: 200 }),
          api.db.queryTable({ table: "Customer", limit: 2000 }),
          api.db.getTableSchema("TaxRegime"),
        ]);

        if (cancelled) return;

        const counts = new Map<string, number>();
        for (const customer of customerResult.rows) {
          const regimeId = customer.taxRegimeId != null ? String(customer.taxRegimeId) : "";
          if (!regimeId) continue;
          counts.set(regimeId, (counts.get(regimeId) ?? 0) + 1);
        }

        const mapped = regimeResult.rows.map((row) => {
          const id = String(row.id ?? "");
          const kind = normalizeTaxRegimeKind(String(row.kind ?? ""));
          return {
            id,
            name: String(row.name ?? ""),
            isActive: row.isActive === 1 || row.isActive === true || row.isActive == null,
            kind,
            kindLabel: TAX_REGIME_KIND_LABELS[kind],
            customerCount: counts.get(id) ?? 0,
            createdAt: formatDate(row.createdAt),
            updatedAt: formatDate(row.updatedAt),
            raw: row,
          } satisfies TaxRegimeRow;
        });

        setRows(mapped);
        setSchema(tableSchema);
        setSelectedIds(new Set());
      } catch (loadError) {
        if (!cancelled) {
          setRows([]);
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load tax regimes.",
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
      const matchSearch =
        !query ||
        row.name.toLowerCase().includes(query) ||
        row.kindLabel.toLowerCase().includes(query) ||
        row.id.toLowerCase().includes(query);
      return matchSearch && matchesTab(row, activeTab);
    });
  }, [rows, search, activeTab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      let result = 0;
      if (sortKey === "customerCount") {
        result = left.customerCount - right.customerCount;
      } else if (sortKey === "isActive") {
        result = Number(left.isActive) - Number(right.isActive);
      } else {
        result = String(left[sortKey]).localeCompare(String(right[sortKey]), undefined, {
          numeric: true,
          sensitivity: "base",
        });
      }
      return sortDir === "asc" ? result : -result;
    });
    return next;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const allSelected =
    paginated.length > 0 && paginated.every((row) => selectedIds.has(row.id));

  const stats = useMemo(
    () => [
      {
        label: "Total regimes",
        value: rows.length,
        icon: IconScale,
        className: "customers-stat-icon-blue",
      },
      {
        label: "Active",
        value: rows.filter((row) => row.isActive).length,
        icon: IconScale,
        className: "customers-stat-icon-emerald",
      },
      {
        label: "Inactive",
        value: rows.filter((row) => !row.isActive).length,
        icon: IconScale,
        className: "customers-stat-icon-violet",
      },
      {
        label: "Customers linked",
        value: rows.reduce((sum, row) => sum + row.customerCount, 0),
        icon: IconUsers,
        className: "customers-stat-icon-amber",
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
      setSortDir("asc");
    }
    setPage(1);
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds((current) => {
        const next = new Set(current);
        paginated.forEach((row) => next.delete(row.id));
        return next;
      });
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      paginated.forEach((row) => next.add(row.id));
      return next;
    });
  }

  async function deleteRegime(row: TaxRegimeRow) {
    if (!schema) return;
    const confirmed = await confirmDelete(
      `Delete tax regime "${row.name}"? Customers using it must be reassigned first.`,
    );
    if (!confirmed) return;
    setActionError(null);
    try {
      await getAuthenticatedDb().deleteRow({
        table: "TaxRegime",
        primaryKey: { id: row.id },
      });
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete tax regime.",
      );
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <IconChevronUp />;
    return sortDir === "asc" ? <IconChevronUp active /> : <IconChevronDown active />;
  }

  function SortableTh({
    label,
    col,
    className = "",
  }: {
    label: string;
    col: SortKey;
    className?: string;
  }) {
    return (
      <th class={`is-sortable ${className}`.trim()} onClick={() => toggleSort(col)}>
        <span class="customers-th-inner">
          {label}
          <SortIcon col={col} />
        </span>
      </th>
    );
  }

  const pageStart =
    sorted.length === 0 ? 0 : Math.min((currentPage - 1) * pageSize + 1, sorted.length);
  const pageEnd = Math.min(currentPage * pageSize, sorted.length);

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "inactive", label: "Inactive" },
    { id: "REAL", label: "Actual" },
    { id: "SIMPLIFIED", label: "Simplified" },
  ];

  const printRows =
    selectedIds.size > 0
      ? sorted.filter((row) => selectedIds.has(row.id))
      : sorted;

  const printFilterLabel =
    activeTab === "all"
      ? "All tax regimes"
      : activeTab === "active"
        ? "Active tax regimes"
        : activeTab === "inactive"
          ? "Inactive tax regimes"
          : activeTab === "REAL"
            ? "Actual tax regimes"
            : "Simplified tax regimes";

  const printGeneratedAt = formatDisplayDateTime(
    (() => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    })(),
  );

  function printTaxRegimeList() {
    if (printRows.length === 0) {
      return;
    }

    setPrintOpen(true);
  }

  return (
    <div class="customers-screen">
      <header class="customers-screen-header">
        <div class="customers-screen-brand">
          <div class="customers-screen-brand-icon">
            <IconScale />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">Tax regimes</h2>
            <p class="customers-screen-brand-subtitle">Actual vs Simplified</p>
          </div>
        </div>
        <div class="customers-screen-header-actions">
          <button
            type="button"
            class="customers-btn customers-btn-secondary"
            disabled={printRows.length === 0}
            onClick={() => printTaxRegimeList()}
          >
            <IconPrinter /> Print
          </button>
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
              disabled={!schema || isLoading}
              onClick={() => {
                setViewRow(null);
                setFormState({ mode: "create" });
              }}
            >
              <IconPlus /> Add regime
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p class="customers-error">{error}</p> : null}
      {actionError ? <p class="customers-error">{actionError}</p> : null}

      <div class="customers-stats">
        {stats.map((stat) => (
          <div key={stat.label} class="customers-stat-card">
            <div class={`customers-stat-icon ${stat.className}`}>
              <stat.icon />
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
              <h3 class="customers-card-title">All regimes</h3>
              <p class="customers-card-subtitle">
                {isLoading ? "Loading…" : `${filtered.length} records`}
              </p>
            </div>
            <div class="customers-card-controls">
              <div class="customers-tabs">
                {tabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    class={`customers-tab${activeTab === item.id ? " is-active" : ""}`}
                    onClick={() => {
                      setActiveTab(item.id);
                      setPage(1);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div class="customers-search-wrap">
                <IconSearch />
                <input
                  class="customers-search"
                  type="search"
                  value={search}
                  placeholder="Search regimes…"
                  onInput={(event) => {
                    setSearch((event.currentTarget as HTMLInputElement).value);
                    setPage(1);
                  }}
                />
              </div>
            </div>
          </div>

          {selectedIds.size > 0 ? (
            <div class="customers-selection-bar">
              <strong>{selectedIds.size} selected</strong>
              <button
                type="button"
                class="customers-link-btn customers-link-btn-primary"
                onClick={() =>
                  exportCsv(rows.filter((row) => selectedIds.has(row.id)))
                }
              >
                Export selected
              </button>
              <button
                type="button"
                class="customers-link-btn customers-link-btn-muted"
                onClick={() => setSelectedIds(new Set())}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>

        <div class="customers-table-scroll" ref={tableScrollRef}>
          <table class="customers-table">
            <thead>
              <tr>
                <th style="width: 40px;">
                  <input
                    type="checkbox"
                    class="customers-checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                  />
                </th>
                <SortableTh label="Regime" col="name" />
                <SortableTh label="Status" col="isActive" />
                <SortableTh label="Kind" col="kind" />
                <SortableTh
                  label="Customers"
                  col="customerCount"
                  className="customers-col-hide-md"
                />
                <SortableTh label="Created" col="createdAt" className="customers-col-hide-lg" />
                <th style="width: 1%;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    Loading tax regimes…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    No tax regimes match your filters.
                  </td>
                </tr>
              ) : (
                paginated.map((row) => (
                  <tr key={row.id} class={selectedIds.has(row.id) ? "is-selected" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        class="customers-checkbox"
                        checked={selectedIds.has(row.id)}
                        onChange={() => toggleSelect(row.id)}
                      />
                    </td>
                    <td>
                      <div class="customers-name-cell">
                        <div>
                          <p class="customers-name-primary">{row.name}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class={statusBadgeClass(row.isActive)}>
                        {row.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <span class={kindBadgeClass(row.kind)}>{row.kindLabel}</span>
                    </td>
                    <td class="customers-col-hide-md">
                      <span class="customers-contact-mono">
                        {row.customerCount > 0 ? row.customerCount : "—"}
                      </span>
                    </td>
                    <td class="customers-col-hide-lg">
                      <div class="customers-dates">
                        <div>{row.createdAt}</div>
                      </div>
                    </td>
                    <td>
                      <RowActions
                        canWrite={canWrite}
                        onView={() => setViewRow(row)}
                        onEdit={() => {
                          setViewRow(null);
                          setFormState({ mode: "edit", row: row.raw });
                        }}
                        onDelete={() => void deleteRegime(row)}
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

      {formState ? (
        <TaxRegimeFormModal
          mode={formState.mode}
          row={formState.mode === "edit" ? formState.row : undefined}
          onClose={() => setFormState(null)}
          onSaved={refreshRows}
        />
      ) : null}

      {viewRow ? (
        <FormDialog
          ariaLabel={`View ${viewRow.name}`}
          title={viewRow.name}
          subtitle="Tax regime details"
          onClose={() => setViewRow(null)}
        >
          <div class="customers-view-grid">
            {[
              ["ID", viewRow.id],
              ["Status", viewRow.isActive ? "Active" : "Inactive"],
              ["Kind", viewRow.kindLabel],
              ["Customers", String(viewRow.customerCount)],
              ["Created", viewRow.createdAt],
              ["Updated", viewRow.updatedAt],
            ].map(([label, value]) => (
              <div key={label} class="customers-view-row">
                <span class="customers-view-label">{label}</span>
                <span class="customers-view-value">{value}</span>
              </div>
            ))}
          </div>
          <div class="form-dialog-actions" style="padding-left: 0; margin-top: 12px;">
            {canWrite ? (
              <button
                type="button"
                class="form-dialog-btn-primary"
                onClick={() => {
                  setViewRow(null);
                  setFormState({ mode: "edit", row: viewRow.raw });
                }}
              >
                Edit regime
              </button>
            ) : null}
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

      {printOpen ? (
        <ReportOverlayShell preview title="Tax regimes" onClose={() => setPrintOpen(false)}>
          <DocumentPreview
            title="Tax regimes"
            fileName="tax-regimes.pdf"
            page="list"
            bodyClass="customers-print-mode tax-regimes-print-mode"
            sourceKey={printRows}
          >
            <div class="customers-print-document" aria-hidden="true">
        <header class="customers-print-header">
          <h1>Tax Regime List</h1>
          <p>
            {printFilterLabel}
            {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
            {" · "}
            {printRows.length} record{printRows.length === 1 ? "" : "s"}
          </p>
          <p class="customers-print-generated">Printed {printGeneratedAt}</p>
        </header>
        <table class="customers-print-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Status</th>
              <th>Kind</th>
              <th>Customers</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {printRows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.name}</td>
                <td>{row.isActive ? "Active" : "Inactive"}</td>
                <td>{row.kindLabel}</td>
                <td>{row.customerCount > 0 ? row.customerCount : "—"}</td>
                <td>{row.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
          </DocumentPreview>
        </ReportOverlayShell>
      ) : null}
    </div>
  );
}
