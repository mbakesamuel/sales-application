import { useEffect, useState } from "preact/hooks";
import { getAuthenticatedDb } from "../auth/db.ts";

import { RecordFormModal } from "./RecordFormModal.tsx";
import type { TableQueryResult, TableSchema } from "../types/electron.d.ts";
import "./TableDataView.css";
import { confirmDelete } from "./confirmModal.tsx";

interface TableDataViewProps {
  table: string;
  description?: string;
  readOnly?: boolean;
}

const PAGE_SIZE = 50;

type FormState =
  | { mode: "create" }
  | { mode: "edit"; row: Record<string, unknown> };

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    if (value === 0 || value === 1) {
      return String(value);
    }
    return value.toLocaleString();
  }

  const text = String(value);
  if (text.length > 120) {
    return `${text.slice(0, 117)}...`;
  }

  return text;
}

function formatColumnLabel(column: string): string {
  return column
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ");
}

function buildPrimaryKey(
  schema: TableSchema,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const primaryKey: Record<string, unknown> = {};
  for (const column of schema.primaryKeyColumns) {
    primaryKey[column] = row[column];
  }
  return primaryKey;
}

export function TableDataView({ table, description, readOnly = false }: TableDataViewProps) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [result, setResult] = useState<TableQueryResult | null>(null);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [formState, setFormState] = useState<FormState | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  useEffect(() => {
    setSearchInput("");
    setSearch("");
    setOffset(0);
    setFormState(null);
    setActionError(null);
  }, [table]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    async function loadSchema() {
      try {
        const tableSchema = await getAuthenticatedDb().getTableSchema(table);
        if (!cancelled) {
          setSchema(tableSchema);
        }
      } catch {
        if (!cancelled) {
          setSchema(null);
        }
      }
    }

    void loadSchema();

    return () => {
      cancelled = true;
    };
  }, [table]);

  useEffect(() => {
    let cancelled = false;

    async function loadRows() {
      setIsLoading(true);
      setError(null);

      try {
        const data = await getAuthenticatedDb().queryTable({
          table,
          limit: PAGE_SIZE,
          offset,
          search: search || undefined,
        });

        if (!cancelled) {
          setResult(data);
        }
      } catch (loadError) {
        if (!cancelled) {
          setResult(null);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load table data.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadRows();

    return () => {
      cancelled = true;
    };
  }, [table, offset, search, refreshKey]);

  function refreshRows() {
    setRefreshKey((current) => current + 1);
  }

  async function handleDelete(row: Record<string, unknown>, rowKey: string) {
    if (!schema) {
      return;
    }

    const confirmed = await confirmDelete("Delete this row? This cannot be undone.");
    if (!confirmed) {
      return;
    }

    setDeletingKey(rowKey);
    setActionError(null);

    try {
      await getAuthenticatedDb().deleteRow({
        table,
        primaryKey: buildPrimaryKey(schema, row),
      });
      refreshRows();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete row.",
      );
    } finally {
      setDeletingKey(null);
    }
  }

  const total = result?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const canGoBack = offset > 0;
  const canGoForward = offset + PAGE_SIZE < total;
  const showActions = !readOnly && Boolean(schema && schema.primaryKeyColumns.length > 0);

  return (
    <div class="table-data-view">
      <div class="table-data-toolbar">
        <div class="table-data-toolbar-left">
          {description ? <p class="table-data-description">{description}</p> : null}
          <p class="table-data-count">
            {isLoading ? "Loading..." : `${total.toLocaleString()} row${total === 1 ? "" : "s"}`}
          </p>
        </div>

        <div class="table-data-toolbar-right">
          {!readOnly ? (
            <button
              type="button"
              class="table-data-add-btn"
              disabled={!schema || isLoading}
              onClick={() => setFormState({ mode: "create" })}
            >
              Add new
            </button>
          ) : null}

          <label class="table-data-search">
            <span class="visually-hidden">Search rows</span>
            <input
              type="search"
              value={searchInput}
              placeholder="Search rows..."
              onInput={(event) =>
                setSearchInput((event.currentTarget as HTMLInputElement).value)
              }
            />
          </label>
        </div>
      </div>

      {error ? <p class="table-data-error">{error}</p> : null}
      {actionError ? <p class="table-data-error">{actionError}</p> : null}

      {!error && !isLoading && total === 0 ? (
        <div class="table-data-empty">
          <p>No rows found{search ? ` matching "${search}"` : ""}.</p>
          {schema && !readOnly ? (
            <button
              type="button"
              class="table-data-add-btn"
              onClick={() => setFormState({ mode: "create" })}
            >
              Add first row
            </button>
          ) : null}
        </div>
      ) : null}

      {!error && (isLoading || (result && result.rows.length > 0)) ? (
        <div class="table-data-scroll">
          <table class="table-data-grid">
            <thead>
              <tr>
                {result?.columns.map((column) => (
                  <th key={column}>{formatColumnLabel(column)}</th>
                ))}
                {showActions ? <th class="table-data-actions-col">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {isLoading && !result ? (
                <tr>
                  <td colSpan={8} class="table-data-loading-cell">
                    Loading rows...
                  </td>
                </tr>
              ) : (
                result?.rows.map((row, rowIndex) => {
                  const rowKey = `${table}-${offset}-${rowIndex}`;

                  return (
                    <tr key={rowKey}>
                      {result.columns.map((column) => (
                        <td
                          key={column}
                          title={row[column] == null ? undefined : String(row[column])}
                        >
                          {formatCellValue(row[column])}
                        </td>
                      ))}
                      {showActions ? (
                        <td class="table-data-actions-cell">
                          <button
                            type="button"
                            class="table-data-action-btn"
                            disabled={deletingKey === rowKey}
                            onClick={() => setFormState({ mode: "edit", row })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            class="table-data-action-btn table-data-action-danger"
                            disabled={deletingKey === rowKey}
                            onClick={() => void handleDelete(row, rowKey)}
                          >
                            {deletingKey === rowKey ? "Deleting..." : "Delete"}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {!error && total > 0 ? (
        <div class="table-data-pagination">
          <span>
            Showing {pageStart.toLocaleString()}–{pageEnd.toLocaleString()} of{" "}
            {total.toLocaleString()}
          </span>
          <div class="table-data-pagination-actions">
            <button
              type="button"
              disabled={!canGoBack || isLoading}
              onClick={() => setOffset((current) => Math.max(current - PAGE_SIZE, 0))}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={!canGoForward || isLoading}
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      {formState && schema ? (
        <RecordFormModal
          table={table}
          mode={formState.mode}
          schema={schema}
          row={formState.mode === "edit" ? formState.row : undefined}
          onClose={() => setFormState(null)}
          onSaved={refreshRows}
        />
      ) : null}
    </div>
  );
}
