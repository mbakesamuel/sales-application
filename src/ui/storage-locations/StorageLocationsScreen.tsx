import { useEffect, useMemo, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import {
  formatDisplayDate as formatDate,
  formatDisplayDateTime,
} from "../../shared/formatDisplayDate.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";

import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { StorageLocationFormModal } from "./StorageLocationFormModal.tsx";
import type { TableSchema } from "../types/electron.d.ts";
import "../customers/CustomersScreen.css";

type SortKey =
  | "locationName"
  | "salesPointLabel"
  | "isActive"
  | "isDefault"
  | "createdAt";
type SortDir = "asc" | "desc";
type ActiveTab = "all" | "active" | "inactive" | "default";

interface StorageLocationRow {
  id: number;
  locationId: number;
  locationName: string;
  isActive: boolean;
  isSalesTank: boolean;
  allowsMultiProduct: boolean;
  salesPointId: number;
  salesPointLabel: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

type FormState = { mode: "create" } | { mode: "edit"; row: Record<string, unknown> };

const PAGE_SIZE = 6;

function statusBadgeClass(isActive: boolean): string {
  return isActive
    ? "customers-badge customers-badge-emerald"
    : "customers-badge customers-badge-amber";
}

function matchesTab(row: StorageLocationRow, tab: ActiveTab): boolean {
  if (tab === "all") {
    return true;
  }
  if (tab === "active") {
    return row.isActive;
  }
  if (tab === "inactive") {
    return !row.isActive;
  }
  if (tab === "default") {
    return row.isDefault;
  }
  return true;
}

function exportCsv(rows: StorageLocationRow[]) {
  const headers = [
    "id",
    "location",
    "isActive",
    "isSalesTank",
    "allowsMultiProduct",
    "salesPoint",
    "isDefault",
    "createdAt",
    "updatedAt",
  ];

  const lines = rows.map((row) =>
    [
      row.id,
      row.locationName,
      row.isActive ? "1" : "0",
      row.isSalesTank ? "1" : "0",
      row.allowsMultiProduct ? "1" : "0",
      row.salesPointLabel,
      row.isDefault ? "1" : "0",
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
  link.download = `storage-locations-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function IconWarehouse() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" />
      <path d="M6 18h12M6 14h12M6 10h12" />
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

function IconSliders() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="4" x2="4" y1="21" y2="14" />
      <line x1="4" x2="4" y1="10" y2="3" />
      <line x1="12" x2="12" y1="21" y2="12" />
      <line x1="12" x2="12" y1="8" y2="3" />
      <line x1="20" x2="20" y1="21" y2="16" />
      <line x1="20" x2="20" y1="12" y2="3" />
      <line x1="2" x2="6" y1="14" y2="14" />
      <line x1="10" x2="14" y1="8" y2="8" />
      <line x1="18" x2="22" y1="16" y2="16" />
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

interface StorageLocationsScreenProps {
  readOnly?: boolean;
}

export function StorageLocationsScreen({
  readOnly = false,
}: StorageLocationsScreenProps = {}) {
  const [printOpen, setPrintOpen] = useState(false);
  const canWrite = !readOnly;
  const [rows, setRows] = useState<StorageLocationRow[]>([]);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("locationName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<ActiveTab>("all");
  const [formState, setFormState] = useState<FormState | null>(null);
  const [viewRow, setViewRow] = useState<StorageLocationRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const api = getElectronApi();
        const [locationResult, storageResult, salesPointResult, tableSchema] =
          await Promise.all([
            api.db.queryTable({ table: "Location", limit: 500 }),
            api.db.queryTable({ table: "StorageLocation", limit: 500 }),
            api.db.queryTable({ table: "SalesPoint", limit: 200 }),
            api.db.getTableSchema("StorageLocation"),
          ]);

        if (cancelled) {
          return;
        }

        const locationLabels = new Map<number, string>();
        for (const location of locationResult.rows) {
          locationLabels.set(
            Number(location.id),
            String(location.locationName ?? `Location ${location.id}`),
          );
        }

        const salesPointLabels = new Map<number, string>();
        for (const salesPoint of salesPointResult.rows) {
          salesPointLabels.set(
            Number(salesPoint.id),
            String(salesPoint.name ?? `Collection point ${salesPoint.id}`),
          );
        }

        const mapped = storageResult.rows.map((row) => {
          const id = Number(row.id);
          const locationId = Number(row.locationId);
          const salesPointId = Number(row.salesPointId);
          const salesPointLabel =
            salesPointLabels.get(salesPointId) ?? `Collection point #${salesPointId}`;

          return {
            id,
            locationId,
            locationName: locationLabels.get(locationId) ?? `Location #${locationId}`,
            isActive:
              row.isActive === 1 || row.isActive === true || row.isActive == null,
            isSalesTank: row.isSalesTank === 1 || row.isSalesTank === true,
            allowsMultiProduct:
              row.allowsMultiProduct === 1 || row.allowsMultiProduct === true,
            salesPointId,
            salesPointLabel,
            isDefault: row.isDefault === 1 || row.isDefault === true,
            createdAt: formatDate(row.createdAt),
            updatedAt: formatDate(row.updatedAt),
            raw: row,
          } satisfies StorageLocationRow;
        });

        setRows(mapped);
        setSchema(tableSchema);
        setSelectedIds(new Set());
      } catch (loadError) {
        if (!cancelled) {
          setRows([]);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load storage locations.",
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
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchSearch =
        !query ||
        row.locationName.toLowerCase().includes(query) ||
        row.salesPointLabel.toLowerCase().includes(query);
      return matchSearch && matchesTab(row, activeTab);
    });
  }, [rows, search, activeTab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      let result = 0;
      if (sortKey === "isDefault" || sortKey === "isActive") {
        result = Number(left[sortKey]) - Number(right[sortKey]);
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
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const allSelected =
    paginated.length > 0 && paginated.every((row) => selectedIds.has(row.id));

  const stats = useMemo(
    () => [
      {
        label: "Total Locations",
        value: rows.length,
        icon: IconWarehouse,
        className: "customers-stat-icon-blue",
      },
      {
        label: "Active",
        value: rows.filter((row) => row.isActive).length,
        icon: IconWarehouse,
        className: "customers-stat-icon-emerald",
      },
      {
        label: "Inactive",
        value: rows.filter((row) => !row.isActive).length,
        icon: IconWarehouse,
        className: "customers-stat-icon-violet",
      },
      {
        label: "Default",
        value: rows.filter((row) => row.isDefault).length,
        icon: IconWarehouse,
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

  function toggleSelect(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
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

  async function deleteLocation(row: StorageLocationRow) {
    if (!schema) {
      return;
    }
    const confirmed = window.confirm(
      `Delete storage location "${row.locationName}" at ${row.salesPointLabel}? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    setActionError(null);
    try {
      await getAuthenticatedDb().deleteRow({
        table: "StorageLocation",
        primaryKey: { id: row.id },
      });
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete storage location.",
      );
    }
  }

  async function deleteSelected() {
    if (!schema || selectedIds.size === 0) {
      return;
    }
    const confirmed = window.confirm(
      `Delete ${selectedIds.size} selected location(s)? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    setActionError(null);
    try {
      for (const row of rows.filter((item) => selectedIds.has(item.id))) {
        await getAuthenticatedDb().deleteRow({
          table: "StorageLocation",
          primaryKey: { id: row.id },
        });
      }
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete selected locations.",
      );
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) {
      return <IconChevronUp />;
    }
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

  const printRows =
    selectedIds.size > 0
      ? sorted.filter((row) => selectedIds.has(row.id))
      : sorted;

  const printFilterLabel =
    activeTab === "all"
      ? "All storage locations"
      : activeTab === "active"
        ? "Active storage locations"
        : activeTab === "inactive"
          ? "Inactive storage locations"
          : "Default storage locations";

  const printGeneratedAt = formatDisplayDateTime(
    (() => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    })(),
  );

  function printStorageLocationList() {
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
            <IconWarehouse />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">Storage Locations</h2>
            <p class="customers-screen-brand-subtitle">Location Management</p>
          </div>
        </div>
        <div class="customers-screen-header-actions">
          <button
            type="button"
            class="customers-btn customers-btn-secondary"
            disabled={printRows.length === 0}
            onClick={() => printStorageLocationList()}
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
              <IconPlus /> Add Location
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
              <h3 class="customers-card-title">All Storage Locations</h3>
              <p class="customers-card-subtitle">
                {isLoading ? "Loading…" : `${filtered.length} records`}
              </p>
            </div>
            <div class="customers-card-controls">
              <div class="customers-tabs">
                {(
                  [
                    ["all", "All"],
                    ["active", "Active"],
                    ["inactive", "Inactive"],
                    ["default", "Default"],
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    class={`customers-tab${activeTab === tab ? " is-active" : ""}`}
                    onClick={() => {
                      setActiveTab(tab);
                      setPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div class="customers-search-wrap">
                <IconSearch />
                <input
                  class="customers-search"
                  type="search"
                  value={search}
                  placeholder="Search locations…"
                  onInput={(event) => {
                    setSearch((event.currentTarget as HTMLInputElement).value);
                    setPage(1);
                  }}
                />
              </div>
              <button type="button" class="customers-btn customers-btn-secondary">
                <IconSliders /> Filters
              </button>
            </div>
          </div>

          {selectedIds.size > 0 ? (
            <div class="customers-selection-bar">
              <strong>{selectedIds.size} selected</strong>
              {canWrite ? (
                <button
                  type="button"
                  class="customers-link-btn customers-link-btn-danger"
                  onClick={() => void deleteSelected()}
                >
                  Delete selected
                </button>
              ) : null}
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
                <SortableTh label="Location" col="locationName" />
                <SortableTh label="Status" col="isActive" />
                <SortableTh
                  label="Collection point"
                  col="salesPointLabel"
                  className="customers-col-hide-md customers-owner-cell"
                />
                <SortableTh label="Created" col="createdAt" className="customers-col-hide-lg" />
                <th style="width: 1%;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} class="customers-table-empty">
                    Loading storage locations…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={6} class="customers-table-empty">
                    No storage locations match your search.
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
                      <div class="customers-name-cell customers-name-cell-sm">
                        <div>
                          <p class="customers-name-primary" title={row.locationName}>
                            {row.locationName}
                          </p>
                          {row.isSalesTank ? (
                            <p class="customers-name-secondary">Sales tank</p>
                          ) : null}
                          {row.allowsMultiProduct ? (
                            <p class="customers-name-secondary">Multi-product</p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class={statusBadgeClass(row.isActive)}>
                        {row.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td class="customers-col-hide-md customers-owner-cell">
                      <span class="customers-contact-mono">{row.salesPointLabel}</span>
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
                        onDelete={() => void deleteLocation(row)}
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
        <StorageLocationFormModal
          mode={formState.mode}
          row={formState.mode === "edit" ? formState.row : undefined}
          onClose={() => setFormState(null)}
          onSaved={refreshRows}
        />
      ) : null}

      {viewRow ? (
        <FormDialog
          ariaLabel={`View ${viewRow.locationName}`}
          title={viewRow.locationName}
          subtitle="Storage location assignment"
          onClose={() => setViewRow(null)}
        >
          <div class="customers-view-grid">
            {[
              ["ID", String(viewRow.id)],
              ["Location", viewRow.locationName],
              ["Status", viewRow.isActive ? "Active" : "Inactive"],
              ["Sales tank", viewRow.isSalesTank ? "Yes" : "No"],
              ["Multi-product", viewRow.allowsMultiProduct ? "Yes" : "No"],
              ["Collection point", viewRow.salesPointLabel],
              ["Default location", viewRow.isDefault ? "Yes" : "No"],
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
                Edit location
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
        <ReportOverlayShell preview title="Storage locations" onClose={() => setPrintOpen(false)}>
          <DocumentPreview
            title="Storage locations"
            fileName="storage-locations.pdf"
            page="list"
            bodyClass="customers-print-mode storage-locations-print-mode"
            sourceKey={printRows}
          >
            <div class="customers-print-document" aria-hidden="true">
        <header class="customers-print-header">
          <h1>Storage Location List</h1>
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
              <th>Collection point</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {printRows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.locationName}</td>
                <td>{row.isActive ? "Active" : "Inactive"}</td>
                <td>{row.salesPointLabel}</td>
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
