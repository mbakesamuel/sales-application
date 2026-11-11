import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { formatDisplayDate as formatDate } from "../../shared/formatDisplayDate.ts";
import type { RoleDefinition } from "../../shared/permissions.types.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb, getAuthToken } from "../auth/db.ts";
import { formatRoleLabel } from "../../shared/roles.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { RowActions } from "../components/RowActions.tsx";
import { useDynamicPageSize } from "../hooks/useDynamicPageSize.ts";
import { UserFormModal } from "./UserFormModal.tsx";
import type { TableSchema } from "../types/electron.d.ts";
import "../customers/CustomersScreen.css";
import { confirmDelete } from "../components/confirmModal.tsx";

type SortKey =
  | "name"
  | "username"
  | "roleLabel"
  | "salesPointLabel"
  | "createdAt"
  | "isActive";
type SortDir = "asc" | "desc";
type ActiveTab = "all" | "active" | "inactive" | string;

interface UserRow {
  id: string;
  name: string;
  username: string;
  role: string;
  roleLabel: string;
  isActive: boolean;
  commercialServiceId: string;
  commercialServiceLabel: string;
  salesPointId: string;
  salesPointLabel: string;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

type FormState = { mode: "create" } | { mode: "edit"; row: Record<string, unknown> };

function normalizeRole(value: unknown): string {
  const role = String(value ?? "").trim();
  return role || "STORE_KEEPER";
}

function roleBadgeClass(role: string): string {
  if (role === "ADMIN") {
    return "customers-badge customers-badge-violet";
  }
  if (role === "MANAGER") {
    return "customers-badge customers-badge-blue";
  }
  if (role === "SENIOR_SALES_SUPERVISOR" || role === "STATISTICS_CLERK") {
    return "customers-badge customers-badge-sky";
  }
  return "customers-badge customers-badge-slate";
}

function exportCsv(rows: UserRow[]) {
  const headers = [
    "id",
    "name",
    "username",
    "role",
    "isActive",
    "commercialService",
    "salesPoint",
    "createdAt",
    "updatedAt",
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.name,
      row.username,
      row.role,
      row.isActive ? "1" : "0",
      row.commercialServiceLabel,
      row.salesPointLabel,
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
  link.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
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

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 6 9 17l-5-5" />
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

interface UsersScreenProps {
  readOnly?: boolean;
}

export function UsersScreen({ readOnly = false }: UsersScreenProps = {}) {
  const canWrite = !readOnly;
  const [rows, setRows] = useState<UserRow[]>([]);
  const [roleCatalog, setRoleCatalog] = useState<RoleDefinition[]>([]);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<ActiveTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formState, setFormState] = useState<FormState | null>(null);
  const [viewRow, setViewRow] = useState<UserRow | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const pageSize = useDynamicPageSize(tableScrollRef);

  const roleLabels = useMemo(
    () => Object.fromEntries(roleCatalog.map((role) => [role.id, role.label])),
    [roleCatalog],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const api = getElectronApi();
        const token = getAuthToken();
        const [userResult, serviceResult, salesPointResult, tableSchema, rolesResult] =
          await Promise.all([
            api.db.queryTable({ table: "User", limit: 2000 }),
            api.db.queryTable({ table: "CommercialService", limit: 200 }),
            api.db.queryTable({ table: "SalesPoint", limit: 200 }),
            api.db.getTableSchema("User"),
            token
              ? api.permissions.listRoles(token)
              : Promise.resolve([] as RoleDefinition[]),
          ]);

        if (cancelled) {
          return;
        }

        const roles =
          Array.isArray(rolesResult) ? rolesResult : ([] as RoleDefinition[]);
        const labels = Object.fromEntries(roles.map((role) => [role.id, role.label]));
        setRoleCatalog(roles);

        const serviceMap = new Map<string, string>();
        for (const service of serviceResult.rows) {
          const id = String(service.id ?? "");
          if (!id) {
            continue;
          }
          const name = String(service.name ?? id);
          const code = service.code != null ? String(service.code) : "";
          serviceMap.set(id, code ? `${name} (${code})` : name);
        }

        const salesPointMap = new Map<string, string>();
        for (const point of salesPointResult.rows) {
          const id = String(point.id ?? "");
          if (!id) {
            continue;
          }
          salesPointMap.set(id, String(point.name ?? id));
        }

        const mapped = userResult.rows.map((row) => {
          const id = String(row.id ?? "");
          const role = normalizeRole(row.role);
          const commercialServiceId =
            row.commercialServiceId != null ? String(row.commercialServiceId) : "";
          const salesPointId =
            row.salesPointId != null ? String(row.salesPointId) : "";

          return {
            id,
            name: String(row.name ?? ""),
            username: String(row.username ?? ""),
            role,
            roleLabel: formatRoleLabel(role, labels),
            isActive: row.isActive === 1 || row.isActive === true,
            commercialServiceId,
            commercialServiceLabel: commercialServiceId
              ? serviceMap.get(commercialServiceId) ?? commercialServiceId
              : "—",
            salesPointId,
            salesPointLabel: salesPointId
              ? salesPointMap.get(salesPointId) ?? salesPointId
              : "—",
            createdAt: formatDate(row.createdAt),
            updatedAt: formatDate(row.updatedAt),
            raw: row,
          } satisfies UserRow;
        });

        setRows(mapped);
        setSchema(tableSchema);
        setSelectedIds(new Set());
      } catch (loadError) {
        if (!cancelled) {
          setRows([]);
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load users.",
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
      if (tab === "active" && !row.isActive) {
        return false;
      }
      if (tab === "inactive" && row.isActive) {
        return false;
      }
      if (tab !== "all" && tab !== "active" && tab !== "inactive" && row.role !== tab) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        row.name.toLowerCase().includes(query) ||
        row.username.toLowerCase().includes(query) ||
        row.roleLabel.toLowerCase().includes(query) ||
        row.commercialServiceLabel.toLowerCase().includes(query) ||
        row.salesPointLabel.toLowerCase().includes(query)
      );
    });
  }, [rows, search, tab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      let result = 0;
      if (sortKey === "isActive") {
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
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const allSelected =
    paginated.length > 0 && paginated.every((row) => selectedIds.has(row.id));

  const stats = useMemo(
    () => [
      {
        label: "Total users",
        value: rows.length,
        icon: IconUsers,
        className: "customers-stat-icon-blue",
      },
      {
        label: "Active",
        value: rows.filter((row) => row.isActive).length,
        icon: IconCheck,
        className: "customers-stat-icon-emerald",
      },
      {
        label: "Admins",
        value: rows.filter((row) => row.role === "ADMIN").length,
        icon: IconUser,
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

  async function deleteUser(row: UserRow) {
    if (!schema) {
      return;
    }
    const confirmed = await confirmDelete(
      `Delete user "${row.name}" (${row.username})? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    setActionError(null);
    try {
      await getAuthenticatedDb().deleteRow({
        table: "User",
        primaryKey: { id: row.id },
      });
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete user.",
      );
    }
  }

  async function deleteSelected() {
    if (!schema || selectedIds.size === 0) {
      return;
    }
    const confirmed = await confirmDelete(
      `Delete ${selectedIds.size} selected user(s)? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    setActionError(null);
    try {
      for (const row of rows.filter((item) => selectedIds.has(item.id))) {
        await getAuthenticatedDb().deleteRow({
          table: "User",
          primaryKey: { id: row.id },
        });
      }
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete selected users.",
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
    sorted.length === 0 ? 0 : Math.min((currentPage - 1) * pageSize + 1, sorted.length);
  const pageEnd = Math.min(currentPage * pageSize, sorted.length);

  const tabs: Array<{ id: ActiveTab; label: string }> = [
    { id: "all", label: "all" },
    { id: "active", label: "active" },
    { id: "inactive", label: "inactive" },
    ...roleCatalog.map((role) => ({
      id: role.id,
      label: roleLabels[role.id] ?? formatRoleLabel(role.id),
    })),
  ];

  return (
    <div class="customers-screen">
      <header class="customers-screen-header">
        <div class="customers-screen-brand">
          <div class="customers-screen-brand-icon">
            <IconUsers />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">Users</h2>
            <p class="customers-screen-brand-subtitle">Accounts & access</p>
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
              disabled={!schema || isLoading}
              onClick={() => {
                setViewRow(null);
                setFormState({ mode: "create" });
              }}
            >
              <IconPlus /> Add User
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
              <h3 class="customers-card-title">All Users</h3>
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
              <div class="customers-search-wrap">
                <IconSearch />
                <input
                  class="customers-search"
                  type="search"
                  value={search}
                  placeholder="Search users…"
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
                <SortableTh label="User" col="name" />
                <SortableTh label="Status" col="isActive" />
                <SortableTh label="Role" col="roleLabel" />
                <SortableTh
                  label="Collection point"
                  col="salesPointLabel"
                  className="customers-col-hide-lg"
                />
                <SortableTh label="Created" col="createdAt" className="customers-col-hide-lg" />
                <th style="width: 1%;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    Loading users…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} class="customers-table-empty">
                    No users match your search.
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
                          <p class="customers-name-primary">{row.name || "—"}</p>
                          <p class="customers-name-secondary">{row.username}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        class={
                          row.isActive
                            ? "customers-badge customers-badge-emerald"
                            : "customers-badge customers-badge-amber"
                        }
                      >
                        {row.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <span class={roleBadgeClass(row.role)}>{row.roleLabel}</span>
                    </td>
                    <td class="customers-col-hide-lg">{row.salesPointLabel}</td>
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
                        onDelete={() => void deleteUser(row)}
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
        <UserFormModal
          mode={formState.mode}
          row={formState.mode === "edit" ? formState.row : undefined}
          onClose={() => setFormState(null)}
          onSaved={refreshRows}
        />
      ) : null}

      {viewRow ? (
        <FormDialog
          ariaLabel={`View ${viewRow.name}`}
          title={viewRow.name || viewRow.username}
          subtitle="User account details"
          onClose={() => setViewRow(null)}
        >
          <div class="customers-view-grid">
            {[
              ["ID", viewRow.id],
              ["Username", viewRow.username],
              ["Role", viewRow.roleLabel],
              ["Status", viewRow.isActive ? "Active" : "Inactive"],
              ["Commercial service", viewRow.commercialServiceLabel],
              ["Collection point", viewRow.salesPointLabel],
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
                Edit
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
