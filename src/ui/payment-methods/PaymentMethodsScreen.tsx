import { useEffect, useMemo, useState } from "preact/hooks";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import {
  formatDisplayDate as formatDate,
  formatDisplayDateTime,
} from "../../shared/formatDisplayDate.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";
import type { PaymentMethodKind } from "../../shared/sales.types.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import {
  PAYMENT_METHOD_KIND_LABELS,
  PaymentMethodFormModal,
} from "./PaymentMethodFormModal.tsx";
import type { TableSchema } from "../types/electron.d.ts";
import "../customers/CustomersScreen.css";
import { confirmDelete } from "../components/confirmModal.tsx";

type SortKey = "name" | "code" | "kind" | "sortOrder" | "usageCount" | "createdAt";
type SortDir = "asc" | "desc";
type ActiveTab = "all" | "active" | "inactive" | PaymentMethodKind;

interface PaymentMethodRow {
  id: string;
  code: string;
  name: string;
  kind: PaymentMethodKind;
  kindLabel: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

type FormState = { mode: "create" } | { mode: "edit"; row: Record<string, unknown> };

const PAGE_SIZE = 6;

function normalizeKind(value: unknown): PaymentMethodKind {
  const kind = String(value ?? "SIMPLE").toUpperCase();
  if (
    kind === "CHEQUE" ||
    kind === "TRAITE" ||
    kind === "CREDIT" ||
    kind === "BANK_TRANSFER"
  ) {
    return kind;
  }
  return "SIMPLE";
}

function kindBadgeClass(kind: PaymentMethodKind): string {
  if (kind === "CHEQUE") return "customers-badge customers-badge-violet";
  if (kind === "TRAITE") return "customers-badge customers-badge-blue";
  if (kind === "CREDIT") return "customers-badge customers-badge-amber";
  if (kind === "BANK_TRANSFER") return "customers-badge customers-badge-blue";
  return "customers-badge customers-badge-emerald";
}

function statusBadgeClass(isActive: boolean): string {
  return isActive
    ? "customers-badge customers-badge-emerald"
    : "customers-badge customers-badge-amber";
}

function matchesTab(row: PaymentMethodRow, tab: ActiveTab): boolean {
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

function exportCsv(rows: PaymentMethodRow[]) {
  const headers = [
    "id",
    "code",
    "name",
    "kind",
    "sortOrder",
    "isActive",
    "isSystem",
    "usageCount",
    "createdAt",
    "updatedAt",
  ];

  const lines = rows.map((row) =>
    [
      row.id,
      row.code,
      row.name,
      row.kind,
      row.sortOrder,
      row.isActive ? "1" : "0",
      row.isSystem ? "1" : "0",
      row.usageCount,
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
  link.download = `payment-methods-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function IconCreditCard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" x2="22" y1="10" y2="10" />
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
  disableDelete,
  canWrite = true,
}: {
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  disableDelete?: boolean;
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
            disabled={disableDelete}
            onClick={onDelete}
          >
            <IconTrash /> Delete
          </button>
        </>
      ) : null}
    </div>
  );
}

interface PaymentMethodsScreenProps {
  readOnly?: boolean;
}

export function PaymentMethodsScreen({
  readOnly = false,
}: PaymentMethodsScreenProps = {}) {
  const [printOpen, setPrintOpen] = useState(false);
  const canWrite = !readOnly;
  const [rows, setRows] = useState<PaymentMethodRow[]>([]);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<ActiveTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("sortOrder");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formState, setFormState] = useState<FormState | null>(null);
  const [viewRow, setViewRow] = useState<PaymentMethodRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const api = getElectronApi();
        const [methodResult, paymentResult, doPaymentResult, tableSchema] =
          await Promise.all([
            api.db.queryTable({ table: "PaymentMethodDefinition", limit: 200 }),
            api.db.queryTable({ table: "Payment", limit: 5000 }),
            api.db.queryTable({ table: "DeliveryOrderPaymentDetails", limit: 5000 }),
            api.db.getTableSchema("PaymentMethodDefinition"),
          ]);

        if (cancelled) return;

        const usage = new Map<string, number>();
        for (const payment of paymentResult.rows) {
          const methodId = String(payment.paymentMethodId ?? "");
          if (!methodId) continue;
          usage.set(methodId, (usage.get(methodId) ?? 0) + 1);
        }
        for (const payment of doPaymentResult.rows) {
          const methodId = String(payment.paymentMethodId ?? "");
          if (!methodId) continue;
          usage.set(methodId, (usage.get(methodId) ?? 0) + 1);
        }

        const mapped = methodResult.rows.map((row) => {
          const id = String(row.id ?? "");
          const kind = normalizeKind(row.kind);
          return {
            id,
            code: String(row.code ?? ""),
            name: String(row.name ?? ""),
            kind,
            kindLabel: PAYMENT_METHOD_KIND_LABELS[kind],
            sortOrder: Number(row.sortOrder ?? 0),
            isActive: row.isActive === 1 || row.isActive === true || row.isActive == null,
            isSystem: row.isSystem === 1 || row.isSystem === true,
            usageCount: usage.get(id) ?? 0,
            createdAt: formatDate(row.createdAt),
            updatedAt: formatDate(row.updatedAt),
            raw: row,
          } satisfies PaymentMethodRow;
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
              : "Failed to load payment methods.",
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
        row.code.toLowerCase().includes(query) ||
        row.kindLabel.toLowerCase().includes(query);
      return matchSearch && matchesTab(row, activeTab);
    });
  }, [rows, search, activeTab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      let result = 0;
      if (sortKey === "sortOrder" || sortKey === "usageCount") {
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

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const allSelected =
    paginated.length > 0 && paginated.every((row) => selectedIds.has(row.id));

  const stats = useMemo(
    () => [
      {
        label: "Total methods",
        value: rows.length,
        icon: IconCreditCard,
        className: "customers-stat-icon-blue",
      },
      {
        label: "Active",
        value: rows.filter((row) => row.isActive).length,
        icon: IconCheck,
        className: "customers-stat-icon-emerald",
      },
      {
        label: "Inactive",
        value: rows.filter((row) => !row.isActive).length,
        icon: IconCreditCard,
        className: "customers-stat-icon-amber",
      },
      {
        label: "Used in payments",
        value: rows.reduce((sum, row) => sum + row.usageCount, 0),
        icon: IconCreditCard,
        className: "customers-stat-icon-violet",
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

  async function deleteMethod(row: PaymentMethodRow) {
    if (!schema) return;
    if (row.isSystem) {
      setActionError("System payment methods cannot be deleted.");
      return;
    }
    const confirmed = await confirmDelete(
      `Delete payment method "${row.name}"? Methods already used on payments cannot be removed.`,
    );
    if (!confirmed) return;
    setActionError(null);
    try {
      await getAuthenticatedDb().deleteRow({
        table: "PaymentMethodDefinition",
        primaryKey: { id: row.id },
      });
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete payment method.",
      );
    }
  }

  async function deleteSelected() {
    if (!schema || selectedIds.size === 0) return;
    const targets = rows.filter(
      (row) => selectedIds.has(row.id) && !row.isSystem,
    );
    if (targets.length === 0) {
      setActionError("System payment methods cannot be deleted.");
      return;
    }
    const confirmed = await confirmDelete(
      `Delete ${targets.length} selected payment method(s)? Methods already used on payments cannot be removed.`,
    );
    if (!confirmed) return;
    setActionError(null);
    try {
      for (const row of targets) {
        await getAuthenticatedDb().deleteRow({
          table: "PaymentMethodDefinition",
          primaryKey: { id: row.id },
        });
      }
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete selected payment methods.",
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

  const printRows =
    selectedIds.size > 0
      ? sorted.filter((row) => selectedIds.has(row.id))
      : sorted;

  const printFilterLabel =
    activeTab === "all"
      ? "All payment methods"
      : activeTab === "active"
        ? "Active payment methods"
        : activeTab === "inactive"
          ? "Inactive payment methods"
          : `${PAYMENT_METHOD_KIND_LABELS[activeTab]} methods`;

  const printGeneratedAt = formatDisplayDateTime(
    (() => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    })(),
  );

  function printPaymentMethodList() {
    if (printRows.length === 0) {
      return;
    }

    setPrintOpen(true);
  }

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "inactive", label: "Inactive" },
    { id: "SIMPLE", label: "Simple" },
    { id: "CHEQUE", label: "Cheque" },
    { id: "BANK_TRANSFER", label: "Bank transfer" },
    { id: "TRAITE", label: "Traite" },
    { id: "CREDIT", label: "Credit" },
  ];

  return (
    <div class="customers-screen">
      <header class="customers-screen-header">
        <div class="customers-screen-brand">
          <div class="customers-screen-brand-icon">
            <IconCreditCard />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">Payment methods</h2>
            <p class="customers-screen-brand-subtitle">
              Accepted payment options for sales and delivery orders
            </p>
          </div>
        </div>
        <div class="customers-screen-header-actions">
          <button
            type="button"
            class="customers-btn customers-btn-secondary"
            disabled={printRows.length === 0}
            onClick={() => printPaymentMethodList()}
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
              <IconPlus /> Add method
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
              <h3 class="customers-card-title">All methods</h3>
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
                  placeholder="Search methods…"
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
                <SortableTh label="Method" col="name" />
                <SortableTh label="Kind" col="kind" />
                <SortableTh label="Order" col="sortOrder" className="customers-col-hide-md" />
                <SortableTh label="Used" col="usageCount" className="customers-col-hide-lg" />
                <th class="customers-col-hide-lg">Status</th>
                <th style="width: 1%;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    Loading payment methods…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    No payment methods match your filters.
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
                      <span class={kindBadgeClass(row.kind)}>{row.kindLabel}</span>
                    </td>
                    <td class="customers-col-hide-md">{row.sortOrder}</td>
                    <td class="customers-col-hide-lg">
                      <span class="customers-contact-mono">
                        {row.usageCount > 0 ? row.usageCount : "—"}
                      </span>
                    </td>
                    <td class="customers-col-hide-lg">
                      <span class={statusBadgeClass(row.isActive)}>
                        {row.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <RowActions
                        canWrite={canWrite}
                        disableDelete={row.isSystem}
                        onView={() => setViewRow(row)}
                        onEdit={() => {
                          setViewRow(null);
                          setFormState({ mode: "edit", row: row.raw });
                        }}
                        onDelete={() => void deleteMethod(row)}
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
        <PaymentMethodFormModal
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
          subtitle="Payment method details"
          onClose={() => setViewRow(null)}
        >
          <div class="customers-view-grid">
            {[
              ["ID", viewRow.id],
              ["Code", viewRow.code],
              ["Kind", viewRow.kindLabel],
              ["Sort order", String(viewRow.sortOrder)],
              ["Status", viewRow.isActive ? "Active" : "Inactive"],
              ["System", viewRow.isSystem ? "Yes" : "No"],
              ["Used on payments", String(viewRow.usageCount)],
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
                  setFormState({ mode: "edit", row: viewRow.raw });
                  setViewRow(null);
                }}
              >
                Edit method
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
        <ReportOverlayShell preview title="Payment methods" onClose={() => setPrintOpen(false)}>
          <DocumentPreview
            title="Payment methods"
            fileName="payment-methods.pdf"
            page="list"
            bodyClass="customers-print-mode payment-methods-print-mode"
            sourceKey={printRows}
          >
            <div class="customers-print-document" aria-hidden="true">
        <header class="customers-print-header">
          <h1>Payment Method List</h1>
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
              <th>Kind</th>
              <th>Status</th>
              <th>Order</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {printRows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{row.name}</td>
                <td>{row.kindLabel}</td>
                <td>{row.isActive ? "Active" : "Inactive"}</td>
                <td>{row.sortOrder}</td>
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
