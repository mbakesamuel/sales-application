import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  formatDisplayDate as formatDate,
  formatDisplayDateTime,
} from "../../shared/formatDisplayDate.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";
import { getAuthenticatedReports } from "../auth/reports.ts";

import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { RowActions } from "../components/RowActions.tsx";
import { useDynamicPageSize } from "../hooks/useDynamicPageSize.ts";
import { DocumentPreview } from "../print/DocumentPreview.tsx";
import { ReportFooter } from "../reports/ReportFooter.tsx";
import { ReportHeader } from "../reports/ReportHeader.tsx";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import { ProductFormModal } from "./ProductFormModal.tsx";
import type { TableSchema } from "../types/electron.d.ts";
import "../customers/CustomersScreen.css";

/** First page fits rows 1–33; row 34 starts the next page. */
const PRODUCT_PRINT_ROWS_PER_PAGE = 33;

function chunkPrintRows<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}

type SortKey =
  | "productName"
  | "productCode"
  | "categoryLabel"
  | "uom"
  | "commercialServiceLabel"
  | "createdAt";

type SortDir = "asc" | "desc";
type ActiveTab = "all" | string;

interface ProductRow {
  productId: number;
  productName: string;
  productCode: string;
  productCatId: number;
  categoryLabel: string;
  categoryCode: string;
  categoryIsMain: boolean;
  categoryIsBottled: boolean;
  commercialServiceId: string;
  commercialServiceLabel: string;
  uom: string;
  omitsStorageLocation: boolean;
  excludeFromDeliveryOrders: boolean;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

type FormState = { mode: "create" } | { mode: "edit"; row: Record<string, unknown> };

function categoryBadgeClass(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("palm")) {
    return "customers-badge customers-badge-emerald";
  }
  if (normalized.includes("bottle")) {
    return "customers-badge customers-badge-violet";
  }
  if (normalized.includes("main")) {
    return "customers-badge customers-badge-slate";
  }
  return "customers-badge customers-badge-blue";
}

function matchesTab(row: ProductRow, tab: ActiveTab): boolean {
  if (tab === "all") {
    return true;
  }
  return row.categoryLabel.toLowerCase() === tab.toLowerCase();
}

function exportCsv(rows: ProductRow[]) {
  const headers = [
    "productId",
    "productName",
    "productCode",
    "category",
    "uom",
    "commercialService",
    "createdAt",
    "updatedAt",
  ];

  const lines = rows.map((row) =>
    [
      row.productId,
      row.productName,
      row.productCode,
      row.categoryLabel,
      row.uom,
      row.commercialServiceLabel,
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
  link.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
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

interface ProductsScreenProps {
  readOnly?: boolean;
}

export function ProductsScreen({ readOnly = false }: ProductsScreenProps = {}) {
  const canWrite = !readOnly;
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [categoryTabs, setCategoryTabs] = useState<string[]>([]);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("productName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<ActiveTab>("all");
  const [formState, setFormState] = useState<FormState | null>(null);
  const [viewRow, setViewRow] = useState<ProductRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [printOpen, setPrintOpen] = useState(false);
  const [printCompanyName, setPrintCompanyName] = useState("CDC Palm Oil Sales");
  const [printDepartment, setPrintDepartment] = useState<string | null>(null);
  const [signatoryName, setSignatoryName] = useState<string | null>(null);
  const [signatoryTitle, setSignatoryTitle] = useState("Manager, Palm Oil Sales");
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const pageSize = useDynamicPageSize(tableScrollRef);

  useEffect(() => {
    let cancelled = false;
    void getElectronApi()
      .db.queryTable({ table: "CompanySettings", limit: 50 })
      .then((result) => {
        if (cancelled) {
          return;
        }
        const row =
          result.rows.find((item) => String(item.id) === "default") ??
          result.rows[0];
        if (!row) {
          return;
        }
        const name = String(row.companyName ?? "").trim();
        if (name) {
          setPrintCompanyName(name);
        }
        const department = String(row.department ?? "").trim();
        setPrintDepartment(department || null);
      })
      .catch(() => {
        // Keep defaults when company settings are unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAuthenticatedReports()
      .getSignatory()
      .then((signatory) => {
        if (cancelled) {
          return;
        }
        setSignatoryName(signatory.name);
        setSignatoryTitle(signatory.title);
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const api = getElectronApi();
        const [productResult, categoryResult, serviceResult, tableSchema] =
          await Promise.all([
            api.db.queryTable({ table: "Product", limit: 500 }),
            api.db.queryTable({ table: "ProductCat", limit: 200 }),
            api.db.queryTable({ table: "CommercialService", limit: 200 }),
            api.db.getTableSchema("Product"),
          ]);

        if (cancelled) {
          return;
        }

        const categoryMap = new Map<
          number,
          {
            label: string;
            code: string;
            isMain: boolean;
            isBottled: boolean;
          }
        >();

        for (const category of categoryResult.rows) {
          const id = Number(category.productCatId);
          categoryMap.set(id, {
            label: String(category.productCat ?? id),
            code: String(category.productCode ?? ""),
            isMain: category.isMain === 1 || category.isMain === true,
            isBottled: category.isBottled === 1 || category.isBottled === true,
          });
        }

        const serviceMap = new Map(
          serviceResult.rows.map((row) => [
            String(row.id),
            String(row.name ?? row.code ?? row.id),
          ]),
        );

        const mapped = productResult.rows.map((row) => {
          const productCatId = Number(row.productCatId);
          const category = categoryMap.get(productCatId);
          const commercialServiceId = row.commercialServiceId
            ? String(row.commercialServiceId)
            : "";

          return {
            productId: Number(row.productId),
            productName: String(row.productName ?? ""),
            productCode: row.productCode ? String(row.productCode) : "—",
            productCatId,
            categoryLabel: category?.label ?? String(productCatId),
            categoryCode: category?.code ?? "—",
            categoryIsMain: category?.isMain ?? false,
            categoryIsBottled: category?.isBottled ?? false,
            commercialServiceId,
            commercialServiceLabel: commercialServiceId
              ? serviceMap.get(commercialServiceId) ?? commercialServiceId
              : "—",
            uom: String(row.uom ?? "Kg"),
            omitsStorageLocation:
              row.omitsStorageLocation === 1 || row.omitsStorageLocation === true,
            excludeFromDeliveryOrders:
              row.excludeFromDeliveryOrders === 1 ||
              row.excludeFromDeliveryOrders === true,
            createdAt: formatDate(row.createdAt),
            updatedAt: formatDate(row.updatedAt),
            raw: row,
          } satisfies ProductRow;
        });

        const tabs = [...new Set(mapped.map((row) => row.categoryLabel))].sort(
          (left, right) => left.localeCompare(right),
        );

        setRows(mapped);
        setCategoryTabs(tabs);
        setSchema(tableSchema);
        setSelectedIds(new Set());
      } catch (loadError) {
        if (!cancelled) {
          setRows([]);
          setCategoryTabs([]);
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load products.",
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
        row.productName.toLowerCase().includes(query) ||
        row.productCode.toLowerCase().includes(query) ||
        row.categoryLabel.toLowerCase().includes(query) ||
        row.commercialServiceLabel.toLowerCase().includes(query) ||
        row.uom.toLowerCase().includes(query);

      return matchSearch && matchesTab(row, activeTab);
    });
  }, [rows, search, activeTab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      const leftValue = String(left[sortKey] ?? "");
      const rightValue = String(right[sortKey] ?? "");
      const result = leftValue.localeCompare(rightValue, undefined, {
        numeric: true,
        sensitivity: "base",
      });
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
    paginated.length > 0 && paginated.every((row) => selectedIds.has(row.productId));

  const stats = useMemo(
    () => [
      {
        label: "Total Products",
        value: rows.length,
        icon: IconPackage,
        className: "customers-stat-icon-blue",
      },
      {
        label: "Categories",
        value: categoryTabs.length,
        icon: IconLayers,
        className: "customers-stat-icon-violet",
      },
      {
        label: "Main Products",
        value: rows.filter((row) => row.categoryIsMain).length,
        icon: IconDroplet,
        className: "customers-stat-icon-emerald",
      },
      {
        label: "Bottled",
        value: rows.filter((row) => row.categoryIsBottled).length,
        icon: IconBox,
        className: "customers-stat-icon-amber",
      },
    ],
    [rows, categoryTabs.length],
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
        paginated.forEach((row) => next.delete(row.productId));
        return next;
      });
      return;
    }

    setSelectedIds((current) => {
      const next = new Set(current);
      paginated.forEach((row) => next.add(row.productId));
      return next;
    });
  }

  async function deleteProduct(row: ProductRow) {
    if (!schema) {
      return;
    }

    const confirmed = window.confirm(
      `Delete product "${row.productName}"? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);

    try {
      await getAuthenticatedDb().deleteRow({
        table: "Product",
        primaryKey: { productId: row.productId },
      });
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete product.",
      );
    }
  }

  async function deleteSelected() {
    if (!schema || selectedIds.size === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedIds.size} selected product(s)? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);

    try {
      for (const row of rows.filter((item) => selectedIds.has(item.productId))) {
        await getAuthenticatedDb().deleteRow({
          table: "Product",
          primaryKey: { productId: row.productId },
        });
      }
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete selected products.",
      );
    }
  }

  function exportRows(targetRows: ProductRow[]) {
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
    sorted.length === 0
      ? 0
      : Math.min((currentPage - 1) * pageSize + 1, sorted.length);
  const pageEnd = Math.min(currentPage * pageSize, sorted.length);

  const printRowsList =
    selectedIds.size > 0
      ? sorted.filter((row) => selectedIds.has(row.productId))
      : sorted;
  const printFilterLabel =
    activeTab === "all" ? "All products" : `${activeTab} products`;
  const printGeneratedAt = formatDisplayDateTime(
    (() => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    })(),
  );
  const printServiceName = [
    ...new Set(
      printRowsList
        .map((row) => {
          const label = row.commercialServiceLabel.trim();
          if (!label || label === "—") {
            return "";
          }
          return label.toUpperCase() === "POS"
            ? "Palm Oil Sales Service"
            : label;
        })
        .filter(Boolean),
    ),
  ].join(" · ");
  const printRowChunks = chunkPrintRows(
    printRowsList,
    PRODUCT_PRINT_ROWS_PER_PAGE,
  );

  function printProductList() {
    if (printRowsList.length === 0) {
      return;
    }
    setPrintOpen(true);
  }

  return (
    <div class="customers-screen">
      <header class="customers-screen-header">
        <div class="customers-screen-brand">
          <div class="customers-screen-brand-icon">
            <IconPackage />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">Products</h2>
            <p class="customers-screen-brand-subtitle">Product Management</p>
          </div>
        </div>

        <div class="customers-screen-header-actions">
          <button
            type="button"
            class="customers-btn customers-btn-secondary"
            disabled={sorted.length === 0}
            onClick={() => printProductList()}
          >
            <IconPrinter />
            Print
          </button>
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
              Add Product
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
              <h3 class="customers-card-title">All Products</h3>
              <p class="customers-card-subtitle">
                {isLoading ? "Loading…" : `${filtered.length} records`}
              </p>
            </div>

            <div class="customers-card-controls">
              <div class="customers-tabs">
                {(["all", ...categoryTabs] as const).map((tab) => (
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
                  placeholder="Search products…"
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
                onClick={() =>
                  exportRows(rows.filter((row) => selectedIds.has(row.productId)))
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
                <SortableTh label="Product" col="productName" />
                <SortableTh label="Category" col="categoryLabel" />
                <th class="customers-col-hide-md">Location</th>
                <SortableTh label="UOM" col="uom" className="customers-col-hide-md" />
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
                    Loading products…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    No products match your search.
                  </td>
                </tr>
              ) : (
                paginated.map((row) => (
                  <tr
                    key={row.productId}
                    class={selectedIds.has(row.productId) ? "is-selected" : ""}
                  >
                    <td>
                      <input
                        type="checkbox"
                        class="customers-checkbox"
                        checked={selectedIds.has(row.productId)}
                        onChange={() => toggleSelect(row.productId)}
                      />
                    </td>

                    <td>
                      <div class="customers-name-cell">
                        <div>
                          <p class="customers-name-primary">{row.productName}</p>
                        </div>
                      </div>
                    </td>

                    <td>
                      <span class={categoryBadgeClass(row.categoryLabel)}>
                        {row.categoryLabel}
                      </span>
                    </td>

                    <td class="customers-col-hide-md">
                      {row.omitsStorageLocation ? (
                        <span class="customers-badge customers-badge-slate">No location</span>
                      ) : (
                        <span class="customers-muted">Required</span>
                      )}
                    </td>

                    <td class="customers-col-hide-md">
                      <span class="customers-contact-mono">{row.uom}</span>
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
                        onDelete={() => void deleteProduct(row)}
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
        <ProductFormModal
          mode={formState.mode}
          row={formState.mode === "edit" ? formState.row : undefined}
          onClose={() => setFormState(null)}
          onSaved={refreshRows}
        />
      ) : null}

      {viewRow ? (
        <FormDialog
          ariaLabel={`View ${viewRow.productName}`}
          title={viewRow.productName}
          subtitle="Product details"
          onClose={() => setViewRow(null)}
        >
          <div class="customers-view-grid">
            {[
              ["ID", String(viewRow.productId)],
              ["Code", viewRow.productCode],
              ["Category", viewRow.categoryLabel],
              ["Category code", viewRow.categoryCode],
              ["UOM", viewRow.uom],
              ["Storage location", viewRow.omitsStorageLocation ? "No location" : "Required"],
              [
                "Delivery orders",
                viewRow.excludeFromDeliveryOrders ? "Excluded" : "Allowed",
              ],
              ["Commercial service", viewRow.commercialServiceLabel],
              ["Main category", viewRow.categoryIsMain ? "Yes" : "No"],
              ["Bottled category", viewRow.categoryIsBottled ? "Yes" : "No"],
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
                Edit product
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
        <ReportOverlayShell
          preview
          title="Product List"
          onClose={() => setPrintOpen(false)}
        >
          <DocumentPreview
            title="Product List"
            fileName="products.pdf"
            page="list"
            bodyClass="products-print-mode"
            sourceKey={printRowsList}
          >
            <div class="customers-print-document" aria-hidden="true">
              {printRowChunks.map((chunk, chunkIndex) => {
                const isFirst = chunkIndex === 0;
                const isLast = chunkIndex === printRowChunks.length - 1;
                const rowOffset = chunkIndex * PRODUCT_PRINT_ROWS_PER_PAGE;
                return (
                  <section
                    key={`products-print-page-${chunkIndex}`}
                    class={`customers-print-sheet${isFirst ? "" : " is-continued"}`}
                  >
                    <ReportHeader
                      companyName={printCompanyName}
                      department={printDepartment}
                      serviceName={printServiceName || null}
                      title="PRODUCT LIST"
                    />
                    <p class="customers-print-meta">
                      {printFilterLabel}
                      {selectedIds.size > 0
                        ? ` · ${selectedIds.size} selected`
                        : ""}
                      {" · "}
                      {printRowsList.length} record
                      {printRowsList.length === 1 ? "" : "s"}
                      {printRowChunks.length > 1
                        ? ` · Page ${chunkIndex + 1} of ${printRowChunks.length}`
                        : ""}
                      {" · "}
                      Printed {printGeneratedAt}
                    </p>
                    <table class="customers-print-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Product</th>
                          <th>Code</th>
                          <th>Category</th>
                          <th>UOM</th>
                          <th>Location</th>
                          <th>Service</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chunk.map((product, index) => (
                          <tr key={product.productId}>
                            <td>{rowOffset + index + 1}</td>
                            <td>{product.productName}</td>
                            <td>{product.productCode || "—"}</td>
                            <td>{product.categoryLabel || "—"}</td>
                            <td>{product.uom || "—"}</td>
                            <td>
                              {product.omitsStorageLocation
                                ? "No location"
                                : "Required"}
                            </td>
                            <td>
                              {product.commercialServiceLabel.toUpperCase() ===
                              "POS"
                                ? "Palm Oil Sales Service"
                                : product.commercialServiceLabel || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {isLast && signatoryTitle ? (
                      <ReportFooter
                        name={signatoryName}
                        label={signatoryTitle}
                      />
                    ) : null}
                  </section>
                );
              })}
            </div>
          </DocumentPreview>
        </ReportOverlayShell>
      ) : null}
    </div>
  );
}
