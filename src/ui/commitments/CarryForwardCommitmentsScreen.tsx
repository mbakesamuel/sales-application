import { useEffect, useMemo, useState } from "preact/hooks";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import { canWriteRouteFromSnapshot } from "../../shared/permissionUtils.ts";
import type {
  CarryForwardCommitmentPendingRow,
  CarryForwardCommitmentRow,
  CarryForwardFormOptions,
  UpsertCarryForwardBatchLine,
} from "../../shared/carryForward.types.ts";
import type { AuthUser } from "../auth/session.ts";
import { getElectronApi } from "../auth/client.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import "../components/FormDialog.css";
import "./CarryForwardCommitmentsScreen.css";
import { confirmDelete } from "../components/confirmModal.tsx";

interface CarryForwardCommitmentsScreenProps {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  readOnly?: boolean;
}

interface BatchDialogState {
  salesPointId: string;
  productId: string;
  focusKey: string | null;
}

type BatchLineDraft = {
  key: string;
  detailId: number | null;
  customerId: string;
  sourceDocumentNo: string;
  outstandingQty: string;
  soldQty: number;
  deliveryOrderNo: string | null;
};

function formatKg(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function newLineKey(): string {
  return `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyLine(): BatchLineDraft {
  return {
    key: newLineKey(),
    detailId: null,
    customerId: "",
    sourceDocumentNo: "",
    outstandingQty: "",
    soldQty: 0,
    deliveryOrderNo: null,
  };
}

export function CarryForwardCommitmentsScreen({
  user,
  permissions,
  readOnly = false,
}: CarryForwardCommitmentsScreenProps) {
  const canWrite =
    canWriteRouteFromSnapshot(permissions, "carry-forward-commitments") && !readOnly;

  const [rows, setRows] = useState<CarryForwardCommitmentRow[]>([]);
  const [pendingRows, setPendingRows] = useState<CarryForwardCommitmentPendingRow[]>(
    [],
  );
  const [options, setOptions] = useState<CarryForwardFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [batchDialog, setBatchDialog] = useState<BatchDialogState | null>(null);
  const [saving, setSaving] = useState(false);

  const [batchSalesPointId, setBatchSalesPointId] = useState("");
  const [batchProductId, setBatchProductId] = useState("");
  const [batchNotes, setBatchNotes] = useState("");
  const [batchLines, setBatchLines] = useState<BatchLineDraft[]>([]);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const api = getElectronApi();
      const [list, pending, formOptions] = await Promise.all([
        api.carryForward.list(),
        api.carryForward.listPending({ userId: user.id }),
        api.carryForward.getFormOptions(),
      ]);
      setRows(list);
      setPendingRows(pending);
      setOptions(formOptions);
    } catch (loadError) {
      setRows([]);
      setPendingRows([]);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load carry-forward commitments.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return rows;
    }
    return rows.filter(
      (row) =>
        row.customerName.toLowerCase().includes(query) ||
        row.salesPointName.toLowerCase().includes(query) ||
        row.productName.toLowerCase().includes(query) ||
        row.deliveryOrderNo.toLowerCase().includes(query) ||
        (row.sourceDocumentNo ?? "").toLowerCase().includes(query),
    );
  }, [rows, search]);

  const filteredPending = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return pendingRows;
    }
    return pendingRows.filter(
      (row) =>
        row.customerName.toLowerCase().includes(query) ||
        row.salesPointName.toLowerCase().includes(query) ||
        row.productName.toLowerCase().includes(query) ||
        row.deliveryOrderNo.toLowerCase().includes(query) ||
        (row.sourceDocumentNo ?? "").toLowerCase().includes(query),
    );
  }, [pendingRows, search]);

  const pendingDoCount = useMemo(
    () => new Set(filteredPending.map((row) => row.deliveryOrderId)).size,
    [filteredPending],
  );

  function linesForScope(
    salesPointId: string,
    productId: string,
    focusDetailId?: number | null,
  ): BatchLineDraft[] {
    const spId = Number.parseInt(salesPointId, 10);
    const pId = Number.parseInt(productId, 10);
    if (!Number.isFinite(spId) || !Number.isFinite(pId)) {
      return [emptyLine()];
    }

    const next: BatchLineDraft[] = [];
    for (const row of rows) {
      if (row.salesPointId === spId && row.productId === pId) {
        next.push({
          key: `detail-${row.detailId}`,
          detailId: row.detailId,
          customerId: String(row.customerId),
          sourceDocumentNo: row.sourceDocumentNo ?? "",
          outstandingQty: String(Math.round(row.outstandingQty)),
          soldQty: row.soldQty,
          deliveryOrderNo: row.deliveryOrderNo,
        });
      }
    }
    for (const row of pendingRows) {
      if (row.salesPointId === spId && row.productId === pId) {
        next.push({
          key: `detail-${row.detailId}`,
          detailId: row.detailId,
          customerId: String(row.customerId),
          sourceDocumentNo: row.sourceDocumentNo ?? "",
          outstandingQty: String(Math.round(row.outstandingQty)),
          soldQty: 0,
          deliveryOrderNo: row.deliveryOrderNo,
        });
      }
    }

    if (next.length === 0) {
      return [emptyLine()];
    }

    if (focusDetailId != null) {
      const focused = next.find((line) => line.detailId === focusDetailId);
      if (focused) {
        return [focused, ...next.filter((line) => line.key !== focused.key)];
      }
    }

    return next;
  }

  function openBatchEntry(prefill?: {
    salesPointId: number;
    productId: number;
    focusDetailId?: number;
  }) {
    setActionError(null);
    setActionSuccess(null);
    setBatchNotes("");
    const salesPointId = prefill ? String(prefill.salesPointId) : "";
    const productId = prefill ? String(prefill.productId) : "";
    setBatchSalesPointId(salesPointId);
    setBatchProductId(productId);
    const lines = linesForScope(
      salesPointId,
      productId,
      prefill?.focusDetailId ?? null,
    );
    setBatchLines(lines);
    setBatchDialog({
      salesPointId,
      productId,
      focusKey: prefill?.focusDetailId
        ? `detail-${prefill.focusDetailId}`
        : lines[0]?.key ?? null,
    });
  }

  function onBatchScopeChange(nextSalesPointId: string, nextProductId: string) {
    setBatchSalesPointId(nextSalesPointId);
    setBatchProductId(nextProductId);
    setBatchLines(linesForScope(nextSalesPointId, nextProductId));
  }

  function updateLine(key: string, patch: Partial<BatchLineDraft>) {
    setBatchLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    const line = emptyLine();
    setBatchLines((current) => [...current, line]);
    setBatchDialog((current) =>
      current ? { ...current, focusKey: line.key } : current,
    );
  }

  function removeLine(key: string) {
    setBatchLines((current) => {
      const next = current.filter((line) => line.key !== key);
      return next.length > 0 ? next : [emptyLine()];
    });
  }

  async function saveBatch() {
    if (!canWrite || !batchDialog) {
      return;
    }

    const salesPointId = Number.parseInt(batchSalesPointId, 10);
    const productId = Number.parseInt(batchProductId, 10);
    if (!Number.isFinite(salesPointId) || !Number.isFinite(productId)) {
      setActionError("Select collection point and product.");
      return;
    }

    const lines: UpsertCarryForwardBatchLine[] = [];
    for (const line of batchLines) {
      const customerId = Number.parseInt(line.customerId, 10);
      const qtyRaw = line.outstandingQty.trim();
      const sourceRaw = line.sourceDocumentNo.trim();

      if (!line.customerId && qtyRaw === "" && sourceRaw === "" && line.detailId == null) {
        continue;
      }

      if (!Number.isFinite(customerId)) {
        setActionError("Select a customer on every filled line.");
        return;
      }

      if (qtyRaw === "" && line.detailId == null) {
        continue;
      }

      const outstandingQty =
        qtyRaw === "" ? 0 : Number.parseInt(qtyRaw, 10);
      if (!Number.isFinite(outstandingQty) || outstandingQty < 0) {
        setActionError("Outstanding quantities must be whole numbers ≥ 0.");
        return;
      }

      if (outstandingQty > 0 && !sourceRaw) {
        setActionError("Enter the original DO # on every line with outstanding kg.");
        return;
      }

      lines.push({
        customerId,
        outstandingQty,
        sourceDocumentNo: sourceRaw,
        detailId: line.detailId,
      });
    }

    if (lines.length === 0) {
      setActionError("Add at least one line with outstanding kg.");
      return;
    }

    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await getElectronApi().carryForward.upsertBatch({
        userId: user.id,
        salesPointId,
        productId,
        notes: batchNotes.trim() || null,
        lines,
      });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setBatchDialog(null);
      if (result.pendingValidation) {
        setActionSuccess(
          result.saved > 0
            ? `Submitted ${result.saved} line${result.saved === 1 ? "" : "s"} for delivery-order validation. Commitments appear on reports and Pick DO after a supervisor validates them.`
            : "No quantity changes to submit.",
        );
      } else if (result.saved > 0) {
        setActionSuccess(
          `Saved ${result.saved} line${result.saved === 1 ? "" : "s"}. Commitments are live on reports and Pick DO.`,
        );
      } else {
        setActionSuccess("No quantity changes to save.");
      }
      await reload();
    } catch (saveError) {
      setActionError(
        saveError instanceof Error ? saveError.message : "Failed to save batch.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(row: CarryForwardCommitmentRow) {
    if (!canWrite) {
      return;
    }
    const confirmed = await confirmDelete(
      `Delete CF line for ${row.customerName} / ${row.productName} at ${row.salesPointName}?`,
    );
    if (!confirmed) {
      return;
    }
    setActionError(null);
    setActionSuccess(null);
    try {
      const result = await getElectronApi().carryForward.delete({
        userId: user.id,
        detailId: row.detailId,
      });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      await reload();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete.",
      );
    }
  }

  useEffect(() => {
    if (!batchDialog?.focusKey) {
      return;
    }
    const el = document.getElementById(
      `cf-line-${batchDialog.focusKey}`,
    ) as HTMLInputElement | null;
    el?.focus();
    el?.select();
  }, [batchDialog?.focusKey, batchSalesPointId, batchProductId]);

  return (
    <div class="cf-screen">
      <header class="cf-header">
        <div>
          <h2 class="cf-title">Carry-forward commitments</h2>
        </div>
        <div class="cf-header-actions">
          <button
            type="button"
            class="cf-btn cf-btn-secondary"
            onClick={() => void reload()}
            disabled={loading}
          >
            Refresh
          </button>
          {canWrite ? (
            <button
              type="button"
              class="cf-btn cf-btn-primary"
              onClick={() => openBatchEntry()}
            >
              Batch entry
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p class="cf-error">{error}</p> : null}
      {actionSuccess ? <p class="cf-success">{actionSuccess}</p> : null}
      {actionError && !batchDialog ? <p class="cf-error">{actionError}</p> : null}

      <div class="cf-toolbar">
        <input
          class="cf-search"
          type="search"
          value={search}
          placeholder="Search customer, product, collection point, original DO…"
          onInput={(event) =>
            setSearch((event.currentTarget as HTMLInputElement).value)
          }
        />
        <span class="cf-count">
          {loading
            ? "Loading…"
            : [
                `${filtered.length} live`,
                filteredPending.length > 0
                  ? `${filteredPending.length} pending validation`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
      </div>

      {filteredPending.length > 0 ? (
        <section class="cf-pending-section">
          <div class="cf-pending-header">
            <h3>Awaiting validation</h3>
            <p>
              {filteredPending.length} line
              {filteredPending.length === 1 ? "" : "s"} across {pendingDoCount} DO
              {pendingDoCount === 1 ? "" : "s"}
            </p>
          </div>
          <div class="cf-table-wrap">
            <table class="cf-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Collection point</th>
                  <th>Product</th>
                  <th>Original DO #</th>
                  <th class="cf-num">Outstanding (kg)</th>
                  <th>CF DO</th>
                </tr>
              </thead>
              <tbody>
                {filteredPending.map((row) => (
                  <tr key={row.detailId}>
                    <td>
                      <span class="cf-pending-badge">Pending validation</span>
                    </td>
                    <td>{row.dateIssued}</td>
                    <td>{row.customerName}</td>
                    <td>{row.salesPointName}</td>
                    <td>{row.productName}</td>
                    <td>
                      {row.sourceDocumentNo ? (
                        <code>{row.sourceDocumentNo}</code>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td class="cf-num">{formatKg(row.outstandingQty)}</td>
                    <td>
                      <code>{row.deliveryOrderNo}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {pendingRows.length > 0 ? (
        <h3 class="cf-posted-title">Live commitments</h3>
      ) : null}

      <div class="cf-table-wrap">
        <table class="cf-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Collection point</th>
              <th>Product</th>
              <th>Original DO #</th>
              <th>CF DO</th>
              <th class="cf-num">Outstanding (kg)</th>
              <th class="cf-num">Sold (kg)</th>
              <th class="cf-num">Order qty</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !loading ? (
              <tr>
                <td colSpan={9} class="cf-empty">
                  No carry-forward commitments yet. Use Batch entry to add them.
                </td>
              </tr>
            ) : null}
            {filtered.map((row) => (
              <tr key={row.detailId}>
                <td>{row.customerName}</td>
                <td>{row.salesPointName}</td>
                <td>{row.productName}</td>
                <td>
                  {row.sourceDocumentNo ? (
                    <code>{row.sourceDocumentNo}</code>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <code>{row.deliveryOrderNo}</code>
                </td>
                <td class="cf-num">{formatKg(row.outstandingQty)}</td>
                <td class="cf-num">{formatKg(row.soldQty)}</td>
                <td class="cf-num">{formatKg(row.orderQty)}</td>
                <td class="cf-actions">
                  {canWrite ? (
                    <>
                      <button
                        type="button"
                        class="cf-link"
                        onClick={() =>
                          openBatchEntry({
                            salesPointId: row.salesPointId,
                            productId: row.productId,
                            focusDetailId: row.detailId,
                          })
                        }
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        class="cf-link cf-link-danger"
                        onClick={() => void removeRow(row)}
                      >
                        Delete
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {batchDialog && options ? (
        <FormDialog
          ariaLabel="Batch carry-forward entry"
          title="Batch carry-forward entry"
          subtitle="Pick collection point and product, then add one line per original outstanding DO."
          wide
          panelClassName="cf-batch-dialog-panel"
          onClose={() => {
            if (!saving) {
              setBatchDialog(null);
              setActionError(null);
            }
          }}
        >
          <div class="cf-batch">
            <div class="cf-batch-scope">
              <label class="cf-field">
                <select
                  aria-label="Collection point"
                  value={batchSalesPointId}
                  disabled={saving}
                  onChange={(event) => {
                    const next = (event.currentTarget as HTMLSelectElement).value;
                    onBatchScopeChange(next, batchProductId);
                  }}
                >
                  <option value="">Collection point…</option>
                  {options.salesPoints.map((point) => (
                    <option key={point.id} value={point.id}>
                      {point.name}
                    </option>
                  ))}
                </select>
              </label>

              <label class="cf-field">
                <select
                  aria-label="Product"
                  value={batchProductId}
                  disabled={saving}
                  onChange={(event) => {
                    const next = (event.currentTarget as HTMLSelectElement).value;
                    onBatchScopeChange(batchSalesPointId, next);
                  }}
                >
                  <option value="">Product…</option>
                  {options.products.map((product) => (
                    <option key={product.productId} value={product.productId}>
                      {product.productName}
                    </option>
                  ))}
                </select>
              </label>

              <label class="cf-field cf-field-notes">
                <input
                  type="text"
                  aria-label="Notes"
                  placeholder="Notes (optional)"
                  value={batchNotes}
                  disabled={saving}
                  onInput={(event) =>
                    setBatchNotes((event.currentTarget as HTMLInputElement).value)
                  }
                />
              </label>
            </div>

            <div class="cf-batch-toolbar">
              <button
                type="button"
                class="cf-btn cf-btn-secondary"
                disabled={saving || !batchSalesPointId || !batchProductId}
                onClick={addLine}
              >
                Add line
              </button>
              <span class="cf-count">
                {batchSalesPointId && batchProductId ? batchLines.length : 0} line
                {(batchSalesPointId && batchProductId ? batchLines.length : 0) === 1
                  ? ""
                  : "s"}
              </span>
            </div>

            <div class="cf-batch-grid-wrap">
              <table class="cf-table cf-batch-grid">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Original DO #</th>
                    <th class="cf-num">Sold (kg)</th>
                    <th class="cf-num">Outstanding (kg)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {batchSalesPointId && batchProductId
                    ? batchLines.map((line) => (
                        <tr key={line.key}>
                          <td>
                            <select
                              aria-label="Customer"
                              value={line.customerId}
                              disabled={saving || line.detailId != null}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  customerId: (
                                    event.currentTarget as HTMLSelectElement
                                  ).value,
                                })
                              }
                            >
                              <option value="">Customer…</option>
                              {options.customers.map((customer) => (
                                <option key={customer.id} value={String(customer.id)}>
                                  {customer.name}
                                </option>
                              ))}
                            </select>
                            {line.deliveryOrderNo ? (
                              <span class="cf-hint-inline">
                                {" "}
                                · {line.deliveryOrderNo}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <input
                              id={`cf-line-${line.key}`}
                              class="cf-source-input"
                              type="text"
                              inputMode="numeric"
                              pattern="\d*"
                              placeholder="Original DO #"
                              disabled={saving}
                              value={line.sourceDocumentNo}
                              onInput={(event) =>
                                updateLine(line.key, {
                                  sourceDocumentNo: (
                                    event.currentTarget as HTMLInputElement
                                  ).value,
                                })
                              }
                            />
                          </td>
                          <td class="cf-num">
                            {line.detailId != null ? formatKg(line.soldQty) : "—"}
                          </td>
                          <td class="cf-num">
                            <input
                              class="cf-qty-input"
                              type="number"
                              min="0"
                              step="1"
                              inputMode="numeric"
                              disabled={saving}
                              value={line.outstandingQty}
                              placeholder="—"
                              onInput={(event) =>
                                updateLine(line.key, {
                                  outstandingQty: (
                                    event.currentTarget as HTMLInputElement
                                  ).value,
                                })
                              }
                            />
                          </td>
                          <td>
                            {line.detailId == null ? (
                              <button
                                type="button"
                                class="cf-link cf-link-danger"
                                disabled={saving}
                                onClick={() => removeLine(line.key)}
                              >
                                Remove
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    : null}
                </tbody>
              </table>
            </div>

            {actionError ? <p class="cf-error">{actionError}</p> : null}

            <div class="form-dialog-actions">
              <button
                type="button"
                class="form-dialog-btn-primary"
                disabled={saving || !batchSalesPointId || !batchProductId}
                onClick={() => void saveBatch()}
              >
                {saving ? "Saving…" : "Save batch"}
              </button>
              <button
                type="button"
                class="form-dialog-btn-secondary"
                disabled={saving}
                onClick={() => {
                  setBatchDialog(null);
                  setActionError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}
