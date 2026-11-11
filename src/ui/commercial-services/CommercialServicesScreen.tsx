import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatDisplayDate as formatDate } from "../../shared/formatDisplayDate.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { CommercialServiceFormModal } from "./CommercialServiceFormModal.tsx";
import { useDynamicPageSize } from "../hooks/useDynamicPageSize.ts";
import type { TableSchema } from "../types/electron.d.ts";
import "../customers/CustomersScreen.css";
import { confirmDelete } from "../components/confirmModal.tsx";

type SortKey =
  | "code"
  | "name"
  | "invoicePrefix"
  | "siteKindLabel"
  | "sortOrder"
  | "productCount"
  | "customerCount"
  | "createdAt";

type SortDir = "asc" | "desc";
type ActiveTab = "all" | "active" | "inactive" | "sales_point" | "factory";

interface CommercialServiceRow {
  id: string;
  code: string;
  name: string;
  invoicePrefix: string;
  phone: string;
  address: string;
  siteKind: string;
  siteKindLabel: string;
  sortOrder: number;
  isActive: boolean;
  enabledModules: string;
  moduleCount: number;
  productCount: number;
  customerCount: number;
  userCount: number;
  factoryCount: number;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

type FormState = { mode: "create" } | { mode: "edit"; row: Record<string, unknown> };

const TAB_LABELS: Record<ActiveTab, string> = {
  all: "All",
  active: "Active",
  inactive: "Inactive",
  sales_point: "Collection point",
  factory: "Factory",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function siteKindLabel(siteKind: string): string {
  return siteKind === "FACTORY" ? "Factory" : "Collection point";
}

function parseModuleCount(value: string): number {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function matchesTab(row: CommercialServiceRow, tab: ActiveTab): boolean {
  if (tab === "all") {
    return true;
  }
  if (tab === "active") {
    return row.isActive;
  }
  if (tab === "inactive") {
    return !row.isActive;
  }
  if (tab === "sales_point") {
    return row.siteKind === "SALES_POINT";
  }
  return row.siteKind === "FACTORY";
}

function exportCsv(rows: CommercialServiceRow[]) {
  const headers = [
    "id",
    "code",
    "name",
    "invoicePrefix",
    "siteKind",
    "sortOrder",
    "isActive",
    "phone",
    "products",
    "customers",
    "users",
    "createdAt",
    "updatedAt",
  ];

  const lines = rows.map((row) =>
    [
      row.id,
      row.code,
      row.name,
      row.invoicePrefix,
      row.siteKindLabel,
      row.sortOrder,
      row.isActive ? "Yes" : "No",
      row.phone,
      row.productCount,
      row.customerCount,
      row.userCount,
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
  link.download = `commercial-services-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconStore() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M2 7h20" />
    </svg>
  );
}

function IconFactory() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
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
      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function ActionMenu({
  canWrite,
  disableDelete,
  onView,
  onEdit,
  onDelete,
}: {
  canWrite: boolean;
  disableDelete?: boolean;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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
            <IconEye />
            View
          </button>
          {canWrite ? (
            <>
              <button
                type="button"
                class="customers-actions-item"
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
              >
                <IconPencil />
                Edit
              </button>
              <div class="customers-actions-divider" />
              <button
                type="button"
                class="customers-actions-item customers-actions-item-danger"
                disabled={disableDelete}
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <IconTrash />
                Delete
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface CommercialServicesScreenProps {
  readOnly?: boolean;
}

export function CommercialServicesScreen({
  readOnly = false,
}: CommercialServicesScreenProps = {}) {
  const canWrite = !readOnly;
  const [rows, setRows] = useState<CommercialServiceRow[]>([]);
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
  const [viewRow, setViewRow] = useState<CommercialServiceRow | null>(null);
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
        const [
          serviceResult,
          productResult,
          customerResult,
          userResult,
          factoryResult,
          tableSchema,
        ] = await Promise.all([
          api.db.queryTable({ table: "CommercialService", limit: 200 }),
          api.db.queryTable({ table: "Product", limit: 500 }),
          api.db.queryTable({ table: "Customer", limit: 500 }),
          api.db.queryTable({ table: "User", limit: 500 }),
          api.db.queryTable({ table: "Factory", limit: 200 }),
          api.db.getTableSchema("CommercialService"),
        ]);

        if (cancelled) {
          return;
        }

        const productCounts = new Map<string, number>();
        for (const product of productResult.rows) {
          const serviceId = String(product.commercialServiceId ?? "");
          if (!serviceId) {
            continue;
          }
          productCounts.set(serviceId, (productCounts.get(serviceId) ?? 0) + 1);
        }

        const customerCounts = new Map<string, number>();
        for (const customer of customerResult.rows) {
          const serviceId = String(customer.commercialServiceId ?? "");
          if (!serviceId) {
            continue;
          }
          customerCounts.set(serviceId, (customerCounts.get(serviceId) ?? 0) + 1);
        }

        const userCounts = new Map<string, number>();
        for (const user of userResult.rows) {
          const serviceId = String(user.commercialServiceId ?? "");
          if (!serviceId) {
            continue;
          }
          userCounts.set(serviceId, (userCounts.get(serviceId) ?? 0) + 1);
        }

        const factoryCounts = new Map<string, number>();
        for (const factory of factoryResult.rows) {
          const serviceId = String(factory.commercialServiceId ?? "");
          if (!serviceId) {
            continue;
          }
          factoryCounts.set(serviceId, (factoryCounts.get(serviceId) ?? 0) + 1);
        }

        const mapped = serviceResult.rows.map((row) => {
          const id = String(row.id ?? "");
          const siteKind = String(row.siteKind ?? "SALES_POINT");
          const enabledModules = String(row.enabledModules ?? "[]");

          return {
            id,
            code: String(row.code ?? ""),
            name: String(row.name ?? ""),
            invoicePrefix: String(row.invoicePrefix ?? ""),
            phone: row.phone ? String(row.phone) : "—",
            address: row.address ? String(row.address) : "—",
            siteKind,
            siteKindLabel: siteKindLabel(siteKind),
            sortOrder: Number(row.sortOrder ?? 0),
            isActive: row.isActive === 1 || row.isActive === true,
            enabledModules,
            moduleCount: parseModuleCount(enabledModules),
            productCount: productCounts.get(id) ?? 0,
            customerCount: customerCounts.get(id) ?? 0,
            userCount: userCounts.get(id) ?? 0,
            factoryCount: factoryCounts.get(id) ?? 0,
            createdAt: formatDate(row.createdAt),
            updatedAt: formatDate(row.updatedAt),
            raw: row,
          } satisfies CommercialServiceRow;
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
              : "Failed to load commercial services.",
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
        row.code.toLowerCase().includes(query) ||
        row.name.toLowerCase().includes(query) ||
        row.invoicePrefix.toLowerCase().includes(query) ||
        row.siteKindLabel.toLowerCase().includes(query) ||
        row.phone.toLowerCase().includes(query);

      return matchSearch && matchesTab(row, activeTab);
    });
  }, [rows, search, activeTab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      let result = 0;

      if (
        sortKey === "sortOrder" ||
        sortKey === "productCount" ||
        sortKey === "customerCount"
      ) {
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
        label: "Total Services",
        value: rows.length,
        icon: IconBuilding,
        className: "customers-stat-icon-blue",
      },
      {
        label: "Active",
        value: rows.filter((row) => row.isActive).length,
        icon: IconCheck,
        className: "customers-stat-icon-emerald",
      },
      {
        label: "Collection Point Sites",
        value: rows.filter((row) => row.siteKind === "SALES_POINT").length,
        icon: IconStore,
        className: "customers-stat-icon-violet",
      },
      {
        label: "Factory Sites",
        value: rows.filter((row) => row.siteKind === "FACTORY").length,
        icon: IconFactory,
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

  function isDeleteBlocked(row: CommercialServiceRow): boolean {
    return (
      row.productCount > 0 ||
      row.customerCount > 0 ||
      row.userCount > 0 ||
      row.factoryCount > 0
    );
  }

  async function deleteService(row: CommercialServiceRow) {
    if (!schema || isDeleteBlocked(row)) {
      return;
    }

    const confirmed = await confirmDelete(
      `Delete commercial service "${row.name}"? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);

    try {
      await getAuthenticatedDb().deleteRow({
        table: "CommercialService",
        primaryKey: { id: row.id },
      });
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete commercial service.",
      );
    }
  }

  async function deleteSelected() {
    if (!schema || selectedIds.size === 0) {
      return;
    }

    const targets = rows.filter((row) => selectedIds.has(row.id));
    if (targets.some(isDeleteBlocked)) {
      setActionError("Some selected services are linked to products, customers, or users.");
      return;
    }

    const confirmed = await confirmDelete(
      `Delete ${selectedIds.size} selected service(s)? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);

    try {
      for (const row of targets) {
        await getAuthenticatedDb().deleteRow({
          table: "CommercialService",
          primaryKey: { id: row.id },
        });
      }
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete selected services.",
      );
    }
  }

  function exportRows(targetRows: CommercialServiceRow[]) {
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
            <IconBuilding />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">ServiceHub</h2>
            <p class="customers-screen-brand-subtitle">Commercial Services</p>
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
              onClick={() => {
                setViewRow(null);
                setFormState({ mode: "create" });
              }}
            >
              <IconPlus />
              Add Service
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
              <h3 class="customers-card-title">All Commercial Services</h3>
              <p class="customers-card-subtitle">
                {isLoading ? "Loading…" : `${filtered.length} records`}
              </p>
            </div>

            <div class="customers-card-controls">
              <div class="customers-tabs">
                {(Object.keys(TAB_LABELS) as ActiveTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    class={`customers-tab${activeTab === tab ? " is-active" : ""}`}
                    onClick={() => {
                      setActiveTab(tab);
                      setPage(1);
                    }}
                  >
                    {TAB_LABELS[tab]}
                  </button>
                ))}
              </div>

              <div class="customers-search-wrap">
                <IconSearch />
                <input
                  class="customers-search"
                  type="search"
                  value={search}
                  placeholder="Search services…"
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
                <SortableTh label="Service" col="name" />
                <SortableTh label="Code" col="code" />
                <SortableTh label="Invoice prefix" col="invoicePrefix" />
                <SortableTh label="Site kind" col="siteKindLabel" />
                <SortableTh label="Products" col="productCount" className="customers-col-hide-md" />
                <SortableTh
                  label="Customers"
                  col="customerCount"
                  className="customers-col-hide-lg"
                />
                <SortableTh label="Created" col="createdAt" className="customers-col-hide-lg" />
                <th style="width: 40px;" />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} class="customers-table-empty">
                    Loading commercial services…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={9} class="customers-table-empty">
                    No commercial services match your search.
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
                        <div class="customers-avatar">{initials(row.name)}</div>
                        <div>
                          <p class="customers-name-primary">{row.name}</p>
                          <p class="customers-name-secondary">
                            {row.isActive ? "Active" : "Inactive"} · {row.invoicePrefix}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span class="customers-mono-chip">{row.code}</span>
                    </td>

                    <td>
                      <span class="customers-mono-chip">{row.invoicePrefix}</span>
                    </td>

                    <td>
                      <span
                        class={
                          row.siteKind === "FACTORY"
                            ? "customers-badge customers-badge-amber"
                            : "customers-badge customers-badge-violet"
                        }
                      >
                        {row.siteKindLabel}
                      </span>
                    </td>

                    <td class="customers-col-hide-md">{row.productCount}</td>

                    <td class="customers-col-hide-lg">{row.customerCount}</td>

                    <td class="customers-col-hide-lg">
                      <div class="customers-dates">
                        <div>{row.createdAt}</div>
                        <div class="customers-dates-updated">↑ {row.updatedAt}</div>
                      </div>
                    </td>

                    <td>
                      <ActionMenu
                        canWrite={canWrite}
                        disableDelete={isDeleteBlocked(row)}
                        onView={() => setViewRow(row)}
                        onEdit={() => {
                          setViewRow(null);
                          setFormState({ mode: "edit", row: row.raw });
                        }}
                        onDelete={() => void deleteService(row)}
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
        <CommercialServiceFormModal
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
          subtitle="Commercial service details"
          onClose={() => setViewRow(null)}
        >
          <div class="customers-view-grid">
            {[
              ["Code", viewRow.code],
              ["Invoice prefix", viewRow.invoicePrefix],
              ["Site kind", viewRow.siteKindLabel],
              ["Sort order", String(viewRow.sortOrder)],
              ["Status", viewRow.isActive ? "Active" : "Inactive"],
              ["Phone", viewRow.phone],
              ["Address", viewRow.address],
              ["Enabled modules", String(viewRow.moduleCount)],
              ["Products", String(viewRow.productCount)],
              ["Customers", String(viewRow.customerCount)],
              ["Users", String(viewRow.userCount)],
              ["Factories", String(viewRow.factoryCount)],
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
                Edit service
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
