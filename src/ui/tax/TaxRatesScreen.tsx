import { useEffect, useMemo, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import {
  formatDisplayDate as formatDate,
  formatDisplayDateTime,
} from "../../shared/formatDisplayDate.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";
import {
  normalizeTaxRateDecimal,
  normalizeTaxRateKind,
  TAX_RATE_KIND_LABELS,
  TAX_RATE_KINDS,
  type TaxRateKind,
} from "../../shared/taxRules.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { TaxRateFormModal } from "./TaxRateFormModal.tsx";
import type { TableSchema } from "../types/electron.d.ts";
import "../customers/CustomersScreen.css";
import { confirmDelete } from "../components/confirmModal.tsx";

type SortKey = "rateKind" | "ratePercent" | "effectiveFrom" | "createdAt" | "isActive";
type SortDir = "asc" | "desc";
type ActiveTab = "all" | "active" | "inactive" | TaxRateKind;

interface TaxRateRow {
  id: string;
  isActive: boolean;
  rateKind: TaxRateKind;
  kindLabel: string;
  rateDecimal: number;
  ratePercent: number;
  effectiveFrom: string;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

type FormState = { mode: "create" } | { mode: "edit"; row: Record<string, unknown> };

const PAGE_SIZE = 8;

function formatPercent(value: number): string {
  return `${Number(value.toFixed(4))}%`;
}

function statusBadgeClass(isActive: boolean): string {
  return isActive
    ? "customers-badge customers-badge-emerald"
    : "customers-badge customers-badge-amber";
}

function matchesTab(row: TaxRateRow, tab: ActiveTab): boolean {
  if (tab === "all") {
    return true;
  }
  if (tab === "active") {
    return row.isActive;
  }
  if (tab === "inactive") {
    return !row.isActive;
  }
  return row.rateKind === tab;
}

function exportCsv(rows: TaxRateRow[]) {
  const headers = [
    "id",
    "rateKind",
    "isActive",
    "rateDecimal",
    "ratePercent",
    "effectiveFrom",
    "createdAt",
    "updatedAt",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.rateKind,
      row.isActive ? "1" : "0",
      row.rateDecimal,
      row.ratePercent,
      row.effectiveFrom,
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
  link.download = `tax-rates-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function IconPercent() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="19" x2="5" y1="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
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

interface TaxRatesScreenProps {
  readOnly?: boolean;
}

export function TaxRatesScreen({ readOnly = false }: TaxRatesScreenProps = {}) {
  const [printOpen, setPrintOpen] = useState(false);
  const canWrite = !readOnly;
  const [rows, setRows] = useState<TaxRateRow[]>([]);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("effectiveFrom");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formState, setFormState] = useState<FormState | null>(null);
  const [viewRow, setViewRow] = useState<TaxRateRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const api = getElectronApi();
        const [result, tableSchema] = await Promise.all([
          api.db.queryTable({ table: "TaxRateSchedule", limit: 500 }),
          api.db.getTableSchema("TaxRateSchedule"),
        ]);

        if (cancelled) return;

        const mapped = result.rows
          .map((row) => {
            const kind = normalizeTaxRateKind(String(row.rateKind ?? ""));
            if (!kind) return null;
            const rateDecimal = normalizeTaxRateDecimal(row.rate as string | number | null);
            return {
              id: String(row.id ?? ""),
              isActive: row.isActive === 1 || row.isActive === true || row.isActive == null,
              rateKind: kind,
              kindLabel: TAX_RATE_KIND_LABELS[kind],
              rateDecimal,
              ratePercent: rateDecimal * 100,
              effectiveFrom: formatDate(row.effectiveFrom),
              createdAt: formatDate(row.createdAt),
              updatedAt: formatDate(row.updatedAt),
              raw: row,
            } satisfies TaxRateRow;
          })
          .filter((row): row is TaxRateRow => row != null);

        setRows(mapped);
        setSchema(tableSchema);
        setSelectedIds(new Set());
      } catch (loadError) {
        if (!cancelled) {
          setRows([]);
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load tax rates.",
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
        row.kindLabel.toLowerCase().includes(query) ||
        row.rateKind.toLowerCase().includes(query) ||
        row.effectiveFrom.includes(query) ||
        row.id.toLowerCase().includes(query);
      return matchSearch && matchesTab(row, activeTab);
    });
  }, [rows, search, activeTab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      let result = 0;
      if (sortKey === "ratePercent") {
        result = left.ratePercent - right.ratePercent;
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

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const allSelected =
    paginated.length > 0 && paginated.every((row) => selectedIds.has(row.id));

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const latestByKind = new Map<TaxRateKind, TaxRateRow>();
    for (const row of rows) {
      const existing = latestByKind.get(row.rateKind);
      if (
        row.effectiveFrom <= today &&
        (!existing || row.effectiveFrom > existing.effectiveFrom)
      ) {
        latestByKind.set(row.rateKind, row);
      }
    }
    return [
      {
        label: "Total rates",
        value: rows.length,
        icon: IconPercent,
        className: "customers-stat-icon-blue",
      },
      {
        label: "Active",
        value: rows.filter((row) => row.isActive).length,
        icon: IconPercent,
        className: "customers-stat-icon-emerald",
      },
      {
        label: "Inactive",
        value: rows.filter((row) => !row.isActive).length,
        icon: IconPercent,
        className: "customers-stat-icon-violet",
      },
      {
        label: "Current VAT",
        value: latestByKind.get("VAT")
          ? formatPercent(latestByKind.get("VAT")!.ratePercent)
          : "—",
        icon: IconPercent,
        className: "customers-stat-icon-amber",
      },
    ];
  }, [rows]);

  function refreshRows() {
    setRefreshKey((current) => current + 1);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "effectiveFrom" ? "desc" : "asc");
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

  async function deleteRate(row: TaxRateRow) {
    if (!schema) return;
    const confirmed = await confirmDelete(
      `Delete ${row.kindLabel} rate effective ${row.effectiveFrom}?`,
    );
    if (!confirmed) return;
    setActionError(null);
    try {
      await getAuthenticatedDb().deleteRow({
        table: "TaxRateSchedule",
        primaryKey: { id: row.id },
      });
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete tax rate.",
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
    sorted.length === 0 ? 0 : Math.min((currentPage - 1) * PAGE_SIZE + 1, sorted.length);
  const pageEnd = Math.min(currentPage * PAGE_SIZE, sorted.length);

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "inactive", label: "Inactive" },
    ...TAX_RATE_KINDS.map((kind) => ({ id: kind, label: TAX_RATE_KIND_LABELS[kind] })),
  ];

  const printRows =
    selectedIds.size > 0
      ? sorted.filter((row) => selectedIds.has(row.id))
      : sorted;

  const printFilterLabel =
    activeTab === "all"
      ? "All tax rates"
      : activeTab === "active"
        ? "Active tax rates"
        : activeTab === "inactive"
          ? "Inactive tax rates"
          : `${TAX_RATE_KIND_LABELS[activeTab]} rates`;

  const printGeneratedAt = formatDisplayDateTime(
    (() => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    })(),
  );

  function printTaxRateList() {
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
            <IconPercent />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">Tax rates</h2>
            <p class="customers-screen-brand-subtitle">Date-effective VAT & sales tax</p>
          </div>
        </div>
        <div class="customers-screen-header-actions">
          <button
            type="button"
            class="customers-btn customers-btn-secondary"
            disabled={printRows.length === 0}
            onClick={() => printTaxRateList()}
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
              <IconPlus /> Add rate
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
              <h3 class="customers-card-title">Rate schedule</h3>
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
                  placeholder="Search rates…"
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

        <div class="customers-table-scroll">
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
                <SortableTh label="Kind" col="rateKind" />
                <SortableTh label="Status" col="isActive" />
                <SortableTh label="Rate" col="ratePercent" />
                <SortableTh label="Effective from" col="effectiveFrom" />
                <SortableTh label="Created" col="createdAt" className="customers-col-hide-lg" />
                <th style="width: 1%;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    Loading tax rates…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    No tax rates match your filters.
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
                          <p class="customers-name-primary">{row.kindLabel}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class={statusBadgeClass(row.isActive)}>
                        {row.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <span class="customers-contact-mono">
                        {formatPercent(row.ratePercent)}
                      </span>
                    </td>
                    <td>{row.effectiveFrom}</td>
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
                        onDelete={() => void deleteRate(row)}
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
        <TaxRateFormModal
          mode={formState.mode}
          row={formState.mode === "edit" ? formState.row : undefined}
          onClose={() => setFormState(null)}
          onSaved={refreshRows}
        />
      ) : null}

      {viewRow ? (
        <FormDialog
          ariaLabel={`View ${viewRow.kindLabel}`}
          title={viewRow.kindLabel}
          subtitle="Tax rate schedule entry"
          onClose={() => setViewRow(null)}
        >
          <div class="customers-view-grid">
            {[
              ["ID", viewRow.id],
              ["Status", viewRow.isActive ? "Active" : "Inactive"],
              ["Kind", viewRow.rateKind],
              ["Rate", formatPercent(viewRow.ratePercent)],
              ["Effective from", viewRow.effectiveFrom],
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
                Edit rate
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
        <ReportOverlayShell preview title="Tax rates" onClose={() => setPrintOpen(false)}>
          <DocumentPreview
            title="Tax rates"
            fileName="tax-rates.pdf"
            page="list"
            bodyClass="customers-print-mode tax-rates-print-mode"
            sourceKey={printRows}
          >
            <div class="customers-print-document" aria-hidden="true">
        <header class="customers-print-header">
          <h1>Tax Rate List</h1>
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
              <th>Kind</th>
              <th>Status</th>
              <th>Rate</th>
              <th>Effective from</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {printRows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.kindLabel}</td>
                <td>{row.isActive ? "Active" : "Inactive"}</td>
                <td>{formatPercent(row.ratePercent)}</td>
                <td>{row.effectiveFrom}</td>
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
