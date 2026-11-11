import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatDisplayDate as formatDate } from "../../shared/formatDisplayDate.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";

import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { RowActions } from "../components/RowActions.tsx";
import { useDynamicPageSize } from "../hooks/useDynamicPageSize.ts";
import { CustomerTypeFormModal } from "./CustomerTypeFormModal.tsx";
import type { TableSchema } from "../types/electron.d.ts";
import "./CustomersScreen.css";
import { confirmDelete } from "../components/confirmModal.tsx";

type SortKey = "name" | "code" | "sortOrder" | "customerCount" | "createdAt";
type SortDir = "asc" | "desc";

const CUSTOMER_TYPE_TABS = ["Industry", "Wholesale", "Retail"] as const;
type CustomerTypeTab = (typeof CUSTOMER_TYPE_TABS)[number];
type ActiveTab = "all" | CustomerTypeTab;

interface CustomerTypeRow {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  exemptFromSalesTax: boolean;
  customerCount: number;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

type FormState = { mode: "create" } | { mode: "edit"; row: Record<string, unknown> };

function salesTaxBadgeClass(exempt: boolean): string {
  return exempt
    ? "customers-badge customers-badge-emerald"
    : "customers-badge customers-badge-blue";
}

function statusBadgeClass(isActive: boolean): string {
  return isActive
    ? "customers-badge customers-badge-emerald"
    : "customers-badge customers-badge-amber";
}

function matchesTab(row: CustomerTypeRow, tab: ActiveTab): boolean {
  if (tab === "all") {
    return true;
  }
  return row.name.toLowerCase() === tab.toLowerCase();
}

function countByName(rows: CustomerTypeRow[], name: CustomerTypeTab): number {
  return rows.filter((row) => row.name.toLowerCase() === name.toLowerCase()).length;
}

function exportCsv(rows: CustomerTypeRow[]) {
  const headers = [
    "id",
    "code",
    "name",
    "sortOrder",
    "isActive",
    "exemptFromSalesTax",
    "isSystem",
    "customerCount",
    "createdAt",
    "updatedAt",
  ];

  const lines = rows.map((row) =>
    [
      row.id,
      row.code,
      row.name,
      row.sortOrder,
      row.isActive ? "1" : "0",
      row.exemptFromSalesTax ? "1" : "0",
      row.isSystem ? "1" : "0",
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
  link.download = `customer-types-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function IconTags() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l6.59-6.59a1 1 0 0 0 0-1.41L12 2Z" />
      <path d="M7 7h.01" />
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01" />
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

interface CustomerTypesScreenProps {
  readOnly?: boolean;
}

export function CustomerTypesScreen({ readOnly = false }: CustomerTypesScreenProps = {}) {
  const canWrite = !readOnly;
  const [rows, setRows] = useState<CustomerTypeRow[]>([]);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("sortOrder");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<ActiveTab>("all");
  const [formState, setFormState] = useState<FormState | null>(null);
  const [viewRow, setViewRow] = useState<CustomerTypeRow | null>(null);
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
        const [typeResult, customerResult, tableSchema] = await Promise.all([
          api.db.queryTable({ table: "CustomerTypeDefinition", limit: 200 }),
          api.db.queryTable({ table: "Customer", limit: 500 }),
          api.db.getTableSchema("CustomerTypeDefinition"),
        ]);

        if (cancelled) {
          return;
        }

        const customerCounts = new Map<string, number>();
        for (const customer of customerResult.rows) {
          const typeId = String(customer.customerTypeId ?? "");
          if (!typeId) {
            continue;
          }
          customerCounts.set(typeId, (customerCounts.get(typeId) ?? 0) + 1);
        }

        const mapped = typeResult.rows.map((row) => {
          const id = String(row.id ?? "");
          return {
            id,
            code: String(row.code ?? ""),
            name: String(row.name ?? ""),
            sortOrder: Number(row.sortOrder ?? 0),
            isActive: row.isActive === 1 || row.isActive === true,
            isSystem: row.isSystem === 1 || row.isSystem === true,
            exemptFromSalesTax:
              row.exemptFromSalesTax === 1 || row.exemptFromSalesTax === true,
            customerCount: customerCounts.get(id) ?? 0,
            createdAt: formatDate(row.createdAt),
            updatedAt: formatDate(row.updatedAt),
            raw: row,
          } satisfies CustomerTypeRow;
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
              : "Failed to load customer types.",
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
        row.name.toLowerCase().includes(query) ||
        row.code.toLowerCase().includes(query) ||
        String(row.sortOrder).includes(query);

      return matchSearch && matchesTab(row, activeTab);
    });
  }, [rows, search, activeTab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      let result = 0;

      if (sortKey === "sortOrder" || sortKey === "customerCount") {
        result = left[sortKey] - right[sortKey];
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
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const allSelected =
    paginated.length > 0 && paginated.every((row) => selectedIds.has(row.id));

  const stats = useMemo(
    () => [
      {
        label: "Total Types",
        value: rows.length,
        icon: IconTags,
        className: "customers-stat-icon-blue",
      },
      {
        label: "Active",
        value: rows.filter((row) => row.isActive).length,
        icon: IconCheck,
        className: "customers-stat-icon-emerald",
      },
      {
        label: "Retail",
        value: countByName(rows, "Retail"),
        icon: IconBuilding,
        className: "customers-stat-icon-violet",
      },
      {
        label: "In Use",
        value: rows.filter((row) => row.customerCount > 0).length,
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

  async function deleteType(row: CustomerTypeRow) {
    if (!schema) {
      return;
    }

    if (row.isSystem) {
      setActionError("System customer types cannot be deleted.");
      return;
    }

    const confirmed = await confirmDelete(
      `Delete customer type "${row.name}"? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);

    try {
      await getAuthenticatedDb().deleteRow({
        table: "CustomerTypeDefinition",
        primaryKey: { id: row.id },
      });
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete customer type.",
      );
    }
  }

  async function deleteSelected() {
    if (!schema || selectedIds.size === 0) {
      return;
    }

    const targets = rows.filter((row) => selectedIds.has(row.id));
    if (targets.some((row) => row.isSystem)) {
      setActionError("Selection includes system types that cannot be deleted.");
      return;
    }

    const confirmed = await confirmDelete(
      `Delete ${selectedIds.size} selected type(s)? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);

    try {
      for (const row of targets) {
        await getAuthenticatedDb().deleteRow({
          table: "CustomerTypeDefinition",
          primaryKey: { id: row.id },
        });
      }
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete selected types.",
      );
    }
  }

  function exportRows(targetRows: CustomerTypeRow[]) {
    if (targetRows.length === 0) {
      return;
    }
    exportCsv(targetRows);
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
    sorted.length === 0 ? 0 : Math.min((currentPage - 1) * pageSize + 1, sorted.length);
  const pageEnd = Math.min(currentPage * pageSize, sorted.length);

  return (
    <div class="customers-screen">
      <header class="customers-screen-header">
        <div class="customers-screen-brand">
          <div class="customers-screen-brand-icon">
            <IconTags />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">Customer Types</h2>
            <p class="customers-screen-brand-subtitle">Customer Type Definitions</p>
          </div>
        </div>

        <div class="customers-screen-header-actions">
          <button
            type="button"
            class="customers-btn customers-btn-secondary"
            disabled={sorted.length === 0}
            onClick={() => exportRows(sorted)}
          >
            <IconDownload />
            Export
          </button>
          {canWrite ? (
            <button
              type="button"
              class="customers-btn customers-btn-primary"
              disabled={!schema || isLoading}
              onClick={() => setFormState({ mode: "create" })}
            >
              <IconPlus />
              Add Type
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
              <h3 class="customers-card-title">All Customer Types</h3>
              <p class="customers-card-subtitle">
                {isLoading ? "Loading…" : `${filtered.length} records`}
              </p>
            </div>

            <div class="customers-card-controls">
              <div class="customers-tabs">
                {(["all", ...CUSTOMER_TYPE_TABS] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    class={`customers-tab${activeTab === tab ? " is-active" : ""}`}
                    onClick={() => {
                      setActiveTab(tab);
                      setPage(1);
                    }}
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
                  placeholder="Search types…"
                  onInput={(event) => {
                    setSearch((event.currentTarget as HTMLInputElement).value);
                    setPage(1);
                  }}
                />
              </div>

              <button type="button" class="customers-btn customers-btn-secondary">
                <IconSliders />
                Filters
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
                onClick={() => exportRows(rows.filter((row) => selectedIds.has(row.id)))}
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
                <SortableTh label="Type" col="name" />
                <th>Status</th>
                <th>Sales tax</th>
                <SortableTh
                  label="Customers"
                  col="customerCount"
                  className="customers-col-hide-lg"
                />
                <SortableTh
                  label="Created"
                  col="createdAt"
                  className="customers-col-hide-lg"
                />
                <th style="width: 1%;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    Loading customer types…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    No customer types match your search.
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
                      <span class={salesTaxBadgeClass(row.exemptFromSalesTax)}>
                        {row.exemptFromSalesTax ? "Exempt" : "Applies"}
                      </span>
                    </td>

                    <td class="customers-col-hide-lg">
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
                        disableDelete={row.isSystem}
                        onView={() => setViewRow(row)}
                        onEdit={() => setFormState({ mode: "edit", row: row.raw })}
                        onDelete={() => void deleteType(row)}
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
        <CustomerTypeFormModal
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
          subtitle="Customer type details"
          onClose={() => setViewRow(null)}
        >
          <div class="customers-view-grid">
            {[
              ["ID", viewRow.id],
              ["Code", viewRow.code],
              ["Name", viewRow.name],
              ["Sort order", String(viewRow.sortOrder)],
              ["Status", viewRow.isActive ? "Active" : "Inactive"],
              ["Sales tax", viewRow.exemptFromSalesTax ? "Exempt" : "Applies"],
              ["System", viewRow.isSystem ? "Yes" : "No"],
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
                Edit type
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
    </div>
  );
}
