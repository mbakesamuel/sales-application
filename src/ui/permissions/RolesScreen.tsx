import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  RoleDefinition,
  RolePermissionsSnapshot,
} from "../../shared/permissions.types.ts";
import { roleIdFromLabel } from "../../shared/roles.ts";
import { getAuthToken } from "../auth/db.ts";
import { getElectronApi } from "../auth/client.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import { RowActions } from "../components/RowActions.tsx";
import { useDynamicPageSize } from "../hooks/useDynamicPageSize.ts";
import "../customers/CustomersScreen.css";
import { confirmDelete } from "../components/confirmModal.tsx";

type SortKey = "label" | "id" | "type" | "userCount";
type SortDir = "asc" | "desc";
type ActiveTab = "all" | "system" | "custom";

type FormState =
  | { mode: "create" }
  | { mode: "edit"; role: RoleDefinition };

function exportCsv(rows: RoleDefinition[]) {
  const headers = ["id", "label", "isSystem", "userCount", "sortOrder"];
  const lines = rows.map((row) =>
    [
      row.id,
      row.label,
      row.isSystem ? "1" : "0",
      row.userCount,
      row.sortOrder,
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
  link.download = `roles-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
    </svg>
  );
}

function IconLayers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
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

interface RolesScreenProps {
  permissions: RolePermissionsSnapshot;
}

export function RolesScreen({ permissions }: RolesScreenProps) {
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [roleBusy, setRoleBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<ActiveTab>("all");
  const [sortKey, setSortKey] = useState<SortKey>("label");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formState, setFormState] = useState<FormState | null>(null);
  const [viewRole, setViewRole] = useState<RoleDefinition | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newId, setNewId] = useState("");
  const [copyFromRoleId, setCopyFromRoleId] = useState("STORE_KEEPER");
  const [editingLabel, setEditingLabel] = useState("");
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const pageSize = useDynamicPageSize(tableScrollRef);

  async function reloadRoles() {
    const token = getAuthToken();
    if (!token) {
      throw new Error("Login required.");
    }
    const result = await getElectronApi().permissions.listRoles(token);
    if ("error" in result) {
      throw new Error(result.error);
    }
    setRoles(result);
    setSelectedIds(new Set());
  }

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        await reloadRoles();
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Failed to load roles.",
        );
      } finally {
        setIsLoading(false);
      }
    }

    void load();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return roles.filter((role) => {
      if (tab === "system" && !role.isSystem) {
        return false;
      }
      if (tab === "custom" && role.isSystem) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        role.label.toLowerCase().includes(query) ||
        role.id.toLowerCase().includes(query)
      );
    });
  }, [roles, search, tab]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    next.sort((left, right) => {
      let result = 0;
      if (sortKey === "userCount") {
        result = left.userCount - right.userCount;
      } else if (sortKey === "type") {
        result = Number(left.isSystem) - Number(right.isSystem);
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
    paginated.length > 0 && paginated.every((role) => selectedIds.has(role.id));

  const stats = useMemo(
    () => [
      {
        label: "Total roles",
        value: roles.length,
        icon: IconShield,
        className: "customers-stat-icon-blue",
      },
      {
        label: "System",
        value: roles.filter((role) => role.isSystem).length,
        icon: IconLayers,
        className: "customers-stat-icon-slate",
      },
      {
        label: "Custom",
        value: roles.filter((role) => !role.isSystem).length,
        icon: IconCheck,
        className: "customers-stat-icon-emerald",
      },
      {
        label: "Assigned users",
        value: roles.reduce((sum, role) => sum + role.userCount, 0),
        icon: IconUsers,
        className: "customers-stat-icon-violet",
      },
    ],
    [roles],
  );

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
        paginated.forEach((role) => next.delete(role.id));
        return next;
      });
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      paginated.forEach((role) => next.add(role.id));
      return next;
    });
  }

  function openCreate() {
    setViewRole(null);
    setNewLabel("");
    setNewId("");
    setCopyFromRoleId(
      roles.some((role) => role.id === "STORE_KEEPER")
        ? "STORE_KEEPER"
        : (roles[0]?.id ?? "STORE_KEEPER"),
    );
    setFormState({ mode: "create" });
  }

  function openEdit(role: RoleDefinition) {
    setViewRole(null);
    setEditingLabel(role.label);
    setFormState({ mode: "edit", role });
  }

  async function handleCreateRole() {
    const token = getAuthToken();
    if (!token) {
      setError("Login required.");
      return;
    }
    setRoleBusy(true);
    setError(null);
    setBanner(null);
    try {
      const result = await getElectronApi().permissions.createRole({
        authToken: token,
        label: newLabel,
        id: newId.trim() || null,
        copyFromRoleId,
      });
      if (result.ok === false) {
        throw new Error(result.error);
      }
      setFormState(null);
      setNewLabel("");
      setNewId("");
      await reloadRoles();
      setBanner(`Role "${result.role.label}" created.`);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Failed to create role.",
      );
    } finally {
      setRoleBusy(false);
    }
  }

  async function handleUpdateRole(id: string) {
    const token = getAuthToken();
    if (!token) {
      setError("Login required.");
      return;
    }
    setRoleBusy(true);
    setError(null);
    setBanner(null);
    try {
      const result = await getElectronApi().permissions.updateRole({
        authToken: token,
        id,
        label: editingLabel,
      });
      if (result.ok === false) {
        throw new Error(result.error);
      }
      setFormState(null);
      setEditingLabel("");
      await reloadRoles();
      setBanner(`Role "${result.role.label}" updated.`);
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : "Failed to update role.",
      );
    } finally {
      setRoleBusy(false);
    }
  }

  async function handleDeleteRole(role: RoleDefinition) {
    if (role.isSystem) {
      return;
    }
    const confirmed = await confirmDelete(
      `Delete role "${role.label}" (${role.id})? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    const token = getAuthToken();
    if (!token) {
      setError("Login required.");
      return;
    }
    setRoleBusy(true);
    setError(null);
    setBanner(null);
    try {
      const result = await getElectronApi().permissions.deleteRole({
        authToken: token,
        id: role.id,
      });
      if (result.ok === false) {
        throw new Error(result.error);
      }
      await reloadRoles();
      setBanner(`Role "${role.label}" deleted.`);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete role.",
      );
    } finally {
      setRoleBusy(false);
    }
  }

  async function deleteSelected() {
    const toDelete = roles.filter(
      (role) => selectedIds.has(role.id) && !role.isSystem,
    );
    if (toDelete.length === 0) {
      setError("System roles cannot be deleted. Clear selection or choose custom roles.");
      return;
    }
    const confirmed = await confirmDelete(
      `Delete ${toDelete.length} selected custom role(s)? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }
    const token = getAuthToken();
    if (!token) {
      setError("Login required.");
      return;
    }
    setRoleBusy(true);
    setError(null);
    setBanner(null);
    try {
      for (const role of toDelete) {
        const result = await getElectronApi().permissions.deleteRole({
          authToken: token,
          id: role.id,
        });
        if (result.ok === false) {
          throw new Error(result.error);
        }
      }
      await reloadRoles();
      setBanner(`Deleted ${toDelete.length} role(s).`);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete selected roles.",
      );
    } finally {
      setRoleBusy(false);
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
    { id: "system", label: "system" },
    { id: "custom", label: "custom" },
  ];

  if (!permissions.actions.manage_permissions) {
    return (
      <p class="customers-error">You do not have permission to manage roles.</p>
    );
  }

  return (
    <div class="customers-screen">
      <header class="customers-screen-header">
        <div class="customers-screen-brand">
          <div class="customers-screen-brand-icon">
            <IconShield />
          </div>
          <div>
            <h2 class="customers-screen-brand-title">Roles</h2>
            <p class="customers-screen-brand-subtitle">Access & permissions</p>
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
          <button
            type="button"
            class="customers-btn customers-btn-primary"
            disabled={isLoading || roleBusy}
            onClick={openCreate}
          >
            <IconPlus /> Add Role
          </button>
        </div>
      </header>

      {error ? <p class="customers-error">{error}</p> : null}
      {banner ? <p class="customers-success">{banner}</p> : null}

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
              <h3 class="customers-card-title">All Roles</h3>
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
                  placeholder="Search roles…"
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
              <button
                type="button"
                class="customers-link-btn customers-link-btn-danger"
                disabled={roleBusy}
                onClick={() => void deleteSelected()}
              >
                Delete selected
              </button>
              <button
                type="button"
                class="customers-link-btn customers-link-btn-primary"
                onClick={() =>
                  exportCsv(roles.filter((role) => selectedIds.has(role.id)))
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
                <SortableTh label="Role" col="label" />
                <SortableTh label="Type" col="type" />
                <SortableTh label="Users" col="userCount" />
                <th style="width: 1%;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} class="customers-table-empty">
                    Loading roles…
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={5} class="customers-table-empty">
                    No roles match your search.
                  </td>
                </tr>
              ) : (
                paginated.map((role) => (
                  <tr
                    key={role.id}
                    class={selectedIds.has(role.id) ? "is-selected" : ""}
                  >
                    <td>
                      <input
                        type="checkbox"
                        class="customers-checkbox"
                        checked={selectedIds.has(role.id)}
                        onChange={() => toggleSelect(role.id)}
                      />
                    </td>
                    <td>
                      <div class="customers-name-cell">
                        <div>
                          <p class="customers-name-primary">{role.label}</p>
                          <p class="customers-name-secondary">{role.id}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        class={
                          role.isSystem
                            ? "customers-badge customers-badge-slate"
                            : "customers-badge customers-badge-sky"
                        }
                      >
                        {role.isSystem ? "System" : "Custom"}
                      </span>
                    </td>
                    <td>{role.userCount}</td>
                    <td>
                      <RowActions
                        canWrite
                        disableDelete={role.isSystem || roleBusy}
                        onView={() => setViewRole(role)}
                        onEdit={() => openEdit(role)}
                        onDelete={() => void handleDeleteRole(role)}
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

      {formState?.mode === "create" ? (
        <FormDialog
          ariaLabel="Add role"
          title="Add Role"
          subtitle="Create a role and copy permissions from an existing one"
          onClose={() => setFormState(null)}
        >
          <div class="form-dialog-form">
            <div class="form-dialog-row">
              <label class="form-dialog-label" for="role-new-label">
                Display name
              </label>
              <div class="form-dialog-control">
                <input
                  id="role-new-label"
                  class="form-dialog-input"
                  value={newLabel}
                  onInput={(event) =>
                    setNewLabel((event.currentTarget as HTMLInputElement).value)
                  }
                  placeholder="e.g. Store Keeper"
                />
              </div>
            </div>
            <div class="form-dialog-row">
              <label class="form-dialog-label" for="role-new-id">
                Role id (optional)
              </label>
              <div class="form-dialog-control">
                <input
                  id="role-new-id"
                  class="form-dialog-input"
                  value={newId}
                  onInput={(event) =>
                    setNewId(
                      (event.currentTarget as HTMLInputElement).value.toUpperCase(),
                    )
                  }
                  placeholder={
                    newLabel ? roleIdFromLabel(newLabel) || "STORE_KEEPER" : "STORE_KEEPER"
                  }
                />
              </div>
            </div>
            <div class="form-dialog-row">
              <label class="form-dialog-label" for="role-copy-from">
                Copy permissions from
              </label>
              <div class="form-dialog-control">
                <select
                  id="role-copy-from"
                  class="form-dialog-input"
                  value={copyFromRoleId}
                  onChange={(event) =>
                    setCopyFromRoleId((event.currentTarget as HTMLSelectElement).value)
                  }
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div class="form-dialog-actions">
              <button
                type="button"
                class="form-dialog-btn-primary"
                disabled={roleBusy || !newLabel.trim()}
                onClick={() => void handleCreateRole()}
              >
                {roleBusy ? "Creating…" : "Create role"}
              </button>
              <button
                type="button"
                class="form-dialog-btn-secondary"
                disabled={roleBusy}
                onClick={() => setFormState(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </FormDialog>
      ) : null}

      {formState?.mode === "edit" ? (
        <FormDialog
          ariaLabel={`Rename ${formState.role.label}`}
          title="Rename Role"
          subtitle={formState.role.id}
          onClose={() => setFormState(null)}
        >
          <div class="form-dialog-form">
            <div class="form-dialog-row">
              <label class="form-dialog-label" for="role-edit-label">
                Display name
              </label>
              <div class="form-dialog-control">
                <input
                  id="role-edit-label"
                  class="form-dialog-input"
                  value={editingLabel}
                  onInput={(event) =>
                    setEditingLabel((event.currentTarget as HTMLInputElement).value)
                  }
                />
              </div>
            </div>
            <div class="form-dialog-actions">
              <button
                type="button"
                class="form-dialog-btn-primary"
                disabled={roleBusy || !editingLabel.trim()}
                onClick={() => void handleUpdateRole(formState.role.id)}
              >
                {roleBusy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                class="form-dialog-btn-secondary"
                disabled={roleBusy}
                onClick={() => setFormState(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </FormDialog>
      ) : null}

      {viewRole ? (
        <FormDialog
          ariaLabel={`View ${viewRole.label}`}
          title={viewRole.label}
          subtitle="Role details"
          onClose={() => setViewRole(null)}
        >
          <div class="customers-view-grid">
            {[
              ["ID", viewRole.id],
              ["Type", viewRole.isSystem ? "System" : "Custom"],
              ["Users", String(viewRole.userCount)],
              ["Sort order", String(viewRole.sortOrder)],
            ].map(([label, value]) => (
              <div key={label} class="customers-view-row">
                <span class="customers-view-label">{label}</span>
                <span class="customers-view-value">{value}</span>
              </div>
            ))}
          </div>
          <div class="form-dialog-actions" style="padding-left: 0; margin-top: 12px;">
            <button
              type="button"
              class="form-dialog-btn-primary"
              onClick={() => openEdit(viewRole)}
            >
              Edit
            </button>
            <button
              type="button"
              class="form-dialog-btn-secondary"
              onClick={() => setViewRole(null)}
            >
              Close
            </button>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}
