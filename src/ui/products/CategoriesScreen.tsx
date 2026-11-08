import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatDisplayDate as formatDate } from "../../shared/formatDisplayDate.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";

import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { RowActions } from "../components/RowActions.tsx";
import { useDynamicPageSize } from "../hooks/useDynamicPageSize.ts";
import { CategoryFormModal } from "./CategoryFormModal.tsx";
import type { TableSchema } from "../types/electron.d.ts";
import "../customers/CustomersScreen.css";
import { confirmDelete } from "../components/confirmModal.tsx";

type SortKey = "productCat" | "productCode" | "productCount" | "createdAt";
type SortDir = "asc" | "desc";
type ActiveTab = "all" | "Main" | "Bottled";

interface CategoryRow {
  productCatId: number;
  productCat: string;
  productCode: string;
  isMain: boolean;
  isBottled: boolean;
  productCount: number;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

type FormState = { mode: "create" } | { mode: "edit"; row: Record<string, unknown> };

function matchesTab(row: CategoryRow, tab: ActiveTab): boolean {
  if (tab === "all") return true;
  if (tab === "Main") return row.isMain;
  return row.isBottled;
}

function exportCsv(rows: CategoryRow[]) {
  const headers = [
    "productCatId",
    "productCat",
    "productCode",
    "isMain",
    "isBottled",
    "productCount",
    "createdAt",
    "updatedAt",
  ];
  const lines = rows.map((row) =>
    [
      row.productCatId,
      row.productCat,
      row.productCode,
      row.isMain ? "1" : "0",
      row.isBottled ? "1" : "0",
      row.productCount,
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
  link.download = `categories-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function IconLayers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m12.83 2.18 8.49 4.92a1 1 0 0 1 0 1.74l-8.49 4.91a2 2 0 0 1-1.66 0L2.68 8.84a1 1 0 0 1 0-1.74l8.49-4.92a2 2 0 0 1 1.66 0Z" />
      <path d="m22 12.65-8.49 4.91a2 2 0 0 1-1.66 0L3.35 12.65" />
      <path d="m22 17.65-8.49 4.91a2 2 0 0 1-1.66 0L3.35 17.65" />
    </svg>
  );
}

function IconDroplet() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12 2 12 2 8 6.5 8 9.5a7 7 0 0 0 7 12.5Z" />
    </svg>
  );
}

function IconBox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="M3.3 7 12 12l8.7-5M12 22V12" />
    </svg>
  );
}

function IconPackage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m7.5 4.27 9 5.15" />
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
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

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6M9 9l6 6" />
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

function BoolBadge({ value }: { value: boolean }) {
  return (
    <span class={`customers-bool-icon${value ? "" : " is-false"}`}>
      {value ? <IconCheck /> : <IconX />}
    </span>
  );
}

interface CategoriesScreenProps {
  readOnly?: boolean;
}

export function CategoriesScreen({ readOnly = false }: CategoriesScreenProps = {}) {
  const canWrite = !readOnly;
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("productCat");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<ActiveTab>("all");
  const [formState, setFormState] = useState<FormState | null>(null);
  const [viewRow, setViewRow] = useState<CategoryRow | null>(null);
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
        const [categoryResult, productResult, tableSchema] = await Promise.all([
          api.db.queryTable({ table: "ProductCat", limit: 200 }),
          api.db.queryTable({ table: "Product", limit: 500 }),
          api.db.getTableSchema("ProductCat"),
        ]);
        if (cancelled) return;

        const productCounts = new Map<number, number>();
        for (const product of productResult.rows) {
          const catId = Number(product.productCatId);
          productCounts.set(catId, (productCounts.get(catId) ?? 0) + 1);
        }

        const mapped = categoryResult.rows.map((row) => {
          const productCatId = Number(row.productCatId);
          return {
            productCatId,
            productCat: String(row.productCat ?? ""),
            productCode: String(row.productCode ?? ""),
            isMain: row.isMain === 1 || row.isMain === true,
            isBottled: row.isBottled === 1 || row.isBottled === true,
            productCount: productCounts.get(productCatId) ?? 0,
            createdAt: formatDate(row.createdAt),
            updatedAt: formatDate(row.updatedAt),
            raw: row,
          } satisfies CategoryRow;
        });

        setRows(mapped);
        setSchema(tableSchema);
        setSelectedIds(new Set());
      } catch (loadError) {
        if (!cancelled) {
          setRows([]);
          setError(loadError instanceof Error ? loadError.message : "Failed to load categories.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((row) => {
      const matchSearch =
        !query ||
        row.productCat.toLowerCase().includes(query) ||
        row.productCode.toLowerCase().includes(query);
      return matchSearch && matchesTab(row, activeTab);
    });
  }, [rows, search, activeTab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      let result = 0;
      if (sortKey === "productCount") {
        result = left.productCount - right.productCount;
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
  const paginated = sorted.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const allSelected =
    paginated.length > 0 && paginated.every((row) => selectedIds.has(row.productCatId));

  const stats = useMemo(
    () => [
      { label: "Total Categories", value: rows.length, icon: IconLayers, className: "customers-stat-icon-blue" },
      { label: "Main", value: rows.filter((row) => row.isMain).length, icon: IconDroplet, className: "customers-stat-icon-emerald" },
      { label: "Bottled", value: rows.filter((row) => row.isBottled).length, icon: IconBox, className: "customers-stat-icon-violet" },
      { label: "Products", value: rows.reduce((sum, row) => sum + row.productCount, 0), icon: IconPackage, className: "customers-stat-icon-amber" },
    ],
    [rows],
  );

  function refreshRows() { setRefreshKey((current) => current + 1); }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
    setPage(1);
  }

  function toggleSelect(id: number) {
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
        paginated.forEach((row) => next.delete(row.productCatId));
        return next;
      });
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      paginated.forEach((row) => next.add(row.productCatId));
      return next;
    });
  }

  async function deleteCategory(row: CategoryRow) {
    if (!schema) return;
    const confirmed = await confirmDelete(`Delete category "${row.productCat}"? This cannot be undone.`);
    if (!confirmed) return;
    setActionError(null);
    try {
      await getAuthenticatedDb().deleteRow({
        table: "ProductCat",
        primaryKey: { productCatId: row.productCatId },
      });
      refreshRows();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : "Failed to delete category.");
    }
  }

  async function deleteSelected() {
    if (!schema || selectedIds.size === 0) return;
    const confirmed = await confirmDelete(`Delete ${selectedIds.size} selected category(ies)? This cannot be undone.`);
    if (!confirmed) return;
    setActionError(null);
    try {
      for (const row of rows.filter((item) => selectedIds.has(item.productCatId))) {
        await getAuthenticatedDb().deleteRow({
          table: "ProductCat",
          primaryKey: { productCatId: row.productCatId },
        });
      }
      refreshRows();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : "Failed to delete selected categories.");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <IconChevronUp />;
    return sortDir === "asc" ? <IconChevronUp active /> : <IconChevronDown active />;
  }

  function SortableTh({ label, col, className = "" }: { label: string; col: SortKey; className?: string }) {
    return (
      <th class={`is-sortable ${className}`.trim()} onClick={() => toggleSort(col)}>
        <span class="customers-th-inner">{label}<SortIcon col={col} /></span>
      </th>
    );
  }

  const pageStart =
    sorted.length === 0
      ? 0
      : Math.min((currentPage - 1) * pageSize + 1, sorted.length);
  const pageEnd = Math.min(currentPage * pageSize, sorted.length);

  return (
    <div class="customers-screen">
      <header class="customers-screen-header">
        <div class="customers-screen-brand">
          <div class="customers-screen-brand-icon"><IconLayers /></div>
          <div>
            <h2 class="customers-screen-brand-title">Product Category</h2>
            <p class="customers-screen-brand-subtitle">Category Management</p>
          </div>
        </div>
        <div class="customers-screen-header-actions">
          <button type="button" class="customers-btn customers-btn-secondary" disabled={sorted.length === 0} onClick={() => exportCsv(sorted)}>
            <IconDownload /> Export
          </button>
          {canWrite ? (
            <button type="button" class="customers-btn customers-btn-primary" disabled={!schema || isLoading} onClick={() => { setViewRow(null); setFormState({ mode: "create" }); }}>
              <IconPlus /> Add Category
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p class="customers-error">{error}</p> : null}
      {actionError ? <p class="customers-error">{actionError}</p> : null}

      <div class="customers-stats">
        {stats.map((stat) => (
          <div key={stat.label} class="customers-stat-card">
            <div class={`customers-stat-icon ${stat.className}`}><stat.icon /></div>
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
              <h3 class="customers-card-title">All Categories</h3>
              <p class="customers-card-subtitle">{isLoading ? "Loading…" : `${filtered.length} records`}</p>
            </div>
            <div class="customers-card-controls">
              <div class="customers-tabs">
                {(["all", "Main", "Bottled"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    class={`customers-tab${activeTab === tab ? " is-active" : ""}`}
                    onClick={() => { setActiveTab(tab); setPage(1); }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div class="customers-search-wrap">
                <IconSearch />
                <input
                  class="customers-search"
                  type="search"
                  value={search}
                  placeholder="Search categories…"
                  onInput={(event) => {
                    setSearch((event.currentTarget as HTMLInputElement).value);
                    setPage(1);
                  }}
                />
              </div>
              <button type="button" class="customers-btn customers-btn-secondary"><IconSliders /> Filters</button>
            </div>
          </div>

          {selectedIds.size > 0 ? (
            <div class="customers-selection-bar">
              <strong>{selectedIds.size} selected</strong>
              {canWrite ? (
                <button type="button" class="customers-link-btn customers-link-btn-danger" onClick={() => void deleteSelected()}>Delete selected</button>
              ) : null}
              <button type="button" class="customers-link-btn customers-link-btn-primary" onClick={() => exportCsv(rows.filter((row) => selectedIds.has(row.productCatId)))}>Export selected</button>
              <button type="button" class="customers-link-btn customers-link-btn-muted" onClick={() => setSelectedIds(new Set())}>Clear</button>
            </div>
          ) : null}
        </div>

        <div class="customers-table-scroll" ref={tableScrollRef}>
          <table class="customers-table">
            <thead>
              <tr>
                <th style="width: 40px;">
                  <input type="checkbox" class="customers-checkbox" checked={allSelected} onChange={toggleSelectAll} />
                </th>
                <SortableTh label="Category" col="productCat" />
                <SortableTh label="Code" col="productCode" />
                <th class="customers-col-hide-md" style="text-align: center;">Main</th>
                <th class="customers-col-hide-md" style="text-align: center;">Bottled</th>
                <SortableTh label="Products" col="productCount" className="customers-col-hide-lg" />
                <SortableTh label="Created" col="createdAt" className="customers-col-hide-lg" />
                <th style="width: 1%;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} class="customers-table-empty">Loading categories…</td></tr>
              ) : paginated.length === 0 ? (
                <tr><td colSpan={8} class="customers-table-empty">No categories match your search.</td></tr>
              ) : (
                paginated.map((row) => (
                  <tr key={row.productCatId} class={selectedIds.has(row.productCatId) ? "is-selected" : ""}>
                    <td>
                      <input type="checkbox" class="customers-checkbox" checked={selectedIds.has(row.productCatId)} onChange={() => toggleSelect(row.productCatId)} />
                    </td>
                    <td>
                      <div class="customers-name-cell">
                        <div>
                          <p class="customers-name-primary">{row.productCat}</p>
                        </div>
                      </div>
                    </td>
                    <td><span class="customers-mono-chip">{row.productCode}</span></td>
                    <td class="customers-col-hide-md" style="text-align: center;"><BoolBadge value={row.isMain} /></td>
                    <td class="customers-col-hide-md" style="text-align: center;"><BoolBadge value={row.isBottled} /></td>
                    <td class="customers-col-hide-lg"><span class="customers-contact-mono">{row.productCount > 0 ? row.productCount : "—"}</span></td>
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
                        onDelete={() => void deleteCategory(row)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div class="customers-pagination">
          <span>Showing {pageStart}–{pageEnd} of {sorted.length}</span>
          <div class="customers-pagination-pages">
            <button type="button" class="customers-pagination-btn" disabled={currentPage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><IconChevronLeft /></button>
            <span class="customers-pagination-current">{currentPage} / {totalPages}</span>
            <button type="button" class="customers-pagination-btn" disabled={currentPage === totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><IconChevronRight /></button>
          </div>
        </div>
      </div>

      {formState ? (
        <CategoryFormModal
          mode={formState.mode}
          row={formState.mode === "edit" ? formState.row : undefined}
          onClose={() => setFormState(null)}
          onSaved={refreshRows}
        />
      ) : null}

      {viewRow ? (
        <FormDialog ariaLabel={`View ${viewRow.productCat}`} title={viewRow.productCat} subtitle="Category details" onClose={() => setViewRow(null)}>
          <div class="customers-view-grid">
            {[
              ["ID", String(viewRow.productCatId)],
              ["Code", viewRow.productCode],
              ["Main category", viewRow.isMain ? "Yes" : "No"],
              ["Bottled category", viewRow.isBottled ? "Yes" : "No"],
              ["Products", String(viewRow.productCount)],
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
              <button type="button" class="form-dialog-btn-primary" onClick={() => { setViewRow(null); setFormState({ mode: "edit", row: viewRow.raw }); }}>Edit category</button>
            ) : null}
            <button type="button" class="form-dialog-btn-secondary" onClick={() => setViewRow(null)}>Close</button>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}
