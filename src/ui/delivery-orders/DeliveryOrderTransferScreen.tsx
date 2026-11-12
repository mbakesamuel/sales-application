import { useEffect, useMemo, useState } from "preact/hooks";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import {
  canPerformActionFromSnapshot,
  canWriteRouteFromSnapshot,
} from "../../shared/permissionUtils.ts";
import type { AuthUser } from "../auth/session.ts";
import { getElectronApi } from "../auth/client.ts";
import type {
  DeliveryOrderTrackPayload,
  DeliveryOrdersFormOptions,
  TransferDeliveryOrderBalanceResult,
} from "./types.ts";
import "../sales/sales.css";
import "./DeliveryOrderTransferScreen.css";

interface DeliveryOrderTransferScreenProps {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  readOnly?: boolean;
  onOpenInDeliveryOrdering?: (deliveryOrderNo: string) => void;
  onOpenTracking?: (deliveryOrderNo: string) => void;
}

function formatQty(value: string | number): string {
  const amount =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(amount)) {
    return String(value);
  }
  return amount.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function parseQtyInput(value: string): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) {
    return "";
  }
  return String(Number.parseInt(digits, 10));
}

function formatQtyInput(value: string): string {
  if (!value.trim()) {
    return "";
  }
  return formatQty(Number.parseInt(value, 10) || 0);
}

export function DeliveryOrderTransferScreen({
  user,
  permissions,
  readOnly = false,
  onOpenInDeliveryOrdering,
  onOpenTracking,
}: DeliveryOrderTransferScreenProps) {
  const canWrite =
    canWriteRouteFromSnapshot(permissions, "delivery-order-transfer") &&
    !readOnly;
  const canTransfer =
    canWrite &&
    canPerformActionFromSnapshot(permissions, "transfer_delivery_order_balance");

  const [options, setOptions] = useState<DeliveryOrdersFormOptions | null>(
    null,
  );
  const [lookupNo, setLookupNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<DeliveryOrderTrackPayload | null>(
    null,
  );
  const [toSalesPointId, setToSalesPointId] = useState("");
  const [qtyByProduct, setQtyByProduct] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [result, setResult] =
    useState<Extract<TransferDeliveryOrderBalanceResult, { ok: true }> | null>(
      null,
    );
  const [completedAsDirect, setCompletedAsDirect] = useState(false);

  useEffect(() => {
    void getElectronApi()
      .deliveryOrders.getFormOptions(user.id)
      .then(setOptions)
      .catch(() => setOptions(null));
  }, [user.id]);

  const destinationPoints = useMemo(() => {
    const points = options?.salesPoints ?? [];
    if (!payload) {
      return points;
    }
    const sourceId = Number(payload.order.salesPointId);
    return points.filter((point) => Number(point.id) !== sourceId);
  }, [options, payload]);

  const isDirectPending = payload?.order.destinationPending === true;

  async function loadSource(rawNo?: string) {
    const no = (rawNo ?? lookupNo).trim();
    if (!no) {
      setError("Enter a delivery order number.");
      setPayload(null);
      setResult(null);
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    setCompletedAsDirect(false);

    try {
      const data = await getElectronApi().deliveryOrders.trackByNo(no);
      if (!data?.order?.deliveryOrderNo || !Array.isArray(data.products)) {
        setPayload(null);
        setError("Delivery order not found.");
        return;
      }
      if (data.order.status !== "VALIDATED") {
        setPayload(null);
        setError(
          data.order.destinationPending
            ? "Only validated delivery orders can be directed to a collection point."
            : "Only validated delivery orders can transfer remaining balance.",
        );
        return;
      }
      const remainingProducts = data.products.filter(
        (product) => Number.parseFloat(product.remainingQty) > 0,
      );
      if (remainingProducts.length === 0) {
        setPayload(null);
        setError(
          data.order.destinationPending
            ? "This delivery order has no remaining balance to direct."
            : "This delivery order has no remaining balance to transfer.",
        );
        return;
      }

      setLookupNo(data.order.deliveryOrderNo);
      setPayload(data);
      setToSalesPointId("");
      setNotes("");
      const pending = data.order.destinationPending === true;
      setQtyByProduct(
        Object.fromEntries(
          remainingProducts.map((product) => [
            String(product.productId),
            pending
              ? String(Math.trunc(Number.parseFloat(product.remainingQty) || 0))
              : "",
          ]),
        ),
      );
    } catch (loadError) {
      setPayload(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load delivery order.",
      );
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setLookupNo("");
    setPayload(null);
    setError(null);
    setResult(null);
    setCompletedAsDirect(false);
    setToSalesPointId("");
    setQtyByProduct({});
    setNotes("");
  }

  async function submitTransfer() {
    if (!payload || !canTransfer) {
      return;
    }

    const destId = Number.parseInt(toSalesPointId, 10);
    if (!Number.isFinite(destId)) {
      setError("Select a destination collection point.");
      return;
    }

    const lines = Object.entries(qtyByProduct)
      .map(([productId, qty]) => ({
        productId: Number.parseInt(productId, 10),
        qtyKg: Number.parseInt(qty || "0", 10) || 0,
      }))
      .filter((line) => line.qtyKg > 0);

    if (lines.length === 0) {
      setError(
        isDirectPending
          ? "Enter at least one product quantity to direct."
          : "Enter at least one product quantity to transfer.",
      );
      return;
    }

    for (const line of lines) {
      const product = payload.products.find(
        (item) => item.productId === line.productId,
      );
      const remaining = Number.parseFloat(product?.remainingQty ?? "0");
      if (line.qtyKg > remaining) {
        setError(
          `${product?.productName ?? "Product"}: qty exceeds remaining (${formatQty(remaining)}).`,
        );
        return;
      }
    }

    setBusy(true);
    setError(null);

    try {
      const response = await getElectronApi().deliveryOrders.transferBalance({
        userId: user.id,
        fromDeliveryOrderId: payload.order.id,
        toSalesPointId: destId,
        lines,
        notes: notes.trim() || undefined,
      });

      if (!response.ok) {
        setError(response.error);
        return;
      }

      setCompletedAsDirect(payload.order.destinationPending === true);
      setResult(response);
      setPayload(null);
      setQtyByProduct({});
      setToSalesPointId("");
      setNotes("");
    } catch (transferError) {
      setError(
        transferError instanceof Error
          ? transferError.message
          : isDirectPending
            ? "Direct failed."
            : "Transfer failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const remainingProducts = payload
    ? payload.products.filter(
        (product) => Number.parseFloat(product.remainingQty) > 0,
      )
    : [];

  return (
    <div class="sales-screen do-transfer-screen">
      <div class="sales-panel">
        <div class="sales-panel-header">
          <div>
            <h2>Transfer DO balance</h2>
            <p class="sales-muted">
              Move remaining commitment from one collection point to another, or
              direct a destination-pending DO held at Bota. Creates a new
              validated DO (<code>DT-…</code>) at the destination.
            </p>
          </div>
        </div>

        {!canTransfer ? (
          <p class="sales-hint">
            You can look up orders, but transferring requires the{" "}
            <strong>transfer delivery order balance</strong> permission.
          </p>
        ) : null}

        <div class="sales-lookup-row">
          <label class="sales-field sales-field-grow">
            <span>Source delivery order no.</span>
            <input
              type="text"
              value={lookupNo}
              disabled={busy}
              placeholder="Booklet, DO-, CF-, or DT- number"
              onInput={(event) =>
                setLookupNo((event.currentTarget as HTMLInputElement).value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void loadSource();
                }
              }}
            />
          </label>
          <button
            type="button"
            class="sales-btn-primary"
            disabled={busy}
            onClick={() => void loadSource()}
          >
            {busy ? "Loading…" : "Load"}
          </button>
          <button
            type="button"
            class="sales-btn-primary"
            disabled={busy}
            onClick={clear}
          >
            Clear
          </button>
        </div>

        {error ? <p class="sales-error">{error}</p> : null}
      </div>

      {result ? (
        <div class="sales-panel">
          <div class="sales-section-header">
            <div>
              <h3>{completedAsDirect ? "Direct complete" : "Transfer complete"}</h3>
              <p class="sales-muted">
                Remaining balance moved to{" "}
                <strong>{result.toSalesPointName}</strong>.
              </p>
            </div>
          </div>
          <div class="do-transfer-result-grid">
            <div>
              <span class="do-transfer-meta-label">Source DO</span>
              <strong>{result.fromDeliveryOrderNo}</strong>
            </div>
            <div>
              <span class="do-transfer-meta-label">New DO</span>
              <strong>{result.toDeliveryOrderNo}</strong>
            </div>
          </div>
          <div class="sales-table-wrap">
            <table class="sales-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th class="sales-num">Transferred kg</th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((line) => (
                  <tr key={line.productId}>
                    <td>{line.productName}</td>
                    <td class="sales-num">{formatQty(line.qtyKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="do-transfer-actions">
            {onOpenTracking ? (
              <>
                <button
                  type="button"
                  class="sales-btn-secondary"
                  onClick={() => onOpenTracking(result.fromDeliveryOrderNo)}
                >
                  Track source
                </button>
                <button
                  type="button"
                  class="sales-btn-secondary"
                  onClick={() => onOpenTracking(result.toDeliveryOrderNo)}
                >
                  Track new DO
                </button>
              </>
            ) : null}
            {onOpenInDeliveryOrdering ? (
              <button
                type="button"
                class="sales-btn-primary"
                onClick={() =>
                  onOpenInDeliveryOrdering(result.toDeliveryOrderNo)
                }
              >
                Open new DO
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {payload ? (
        <>
          <div class="sales-panel">
            <div class="sales-section-header">
              <div>
                <h3>
                  {isDirectPending
                    ? "Direct pending destination"
                    : "Source delivery order"}
                </h3>
                <p class="sales-muted">
                  {payload.order.customerName} · {payload.order.salesPointName} ·{" "}
                  remaining {formatQty(payload.totals.remainingKg)} kg
                  {isDirectPending ? " · destination pending" : ""}
                </p>
              </div>
            </div>

            <label class="sales-field">
              <span>
                {isDirectPending
                  ? "Fulfillment collection point"
                  : "Destination collection point"}
              </span>
              <select
                value={toSalesPointId}
                disabled={!canTransfer || busy || destinationPoints.length === 0}
                onChange={(event) =>
                  setToSalesPointId(
                    (event.currentTarget as HTMLSelectElement).value,
                  )
                }
              >
                <option value="">
                  {destinationPoints.length === 0
                    ? "No other collection points available"
                    : "Select collection point"}
                </option>
                {destinationPoints.map((point) => (
                  <option key={point.id} value={String(point.id)}>
                    {point.name}
                  </option>
                ))}
              </select>
              {options && destinationPoints.length === 0 ? (
                <span class="sales-hint sales-hint-error">
                  Add another active collection point to{" "}
                  {isDirectPending ? "direct" : "transfer"} this balance.
                </span>
              ) : null}
            </label>

            <label class="sales-field">
              <span>Notes (optional)</span>
              <input
                type="text"
                value={notes}
                disabled={!canTransfer || busy}
                placeholder={
                  isDirectPending
                    ? "Reason for directing"
                    : "Reason for transfer"
                }
                onInput={(event) =>
                  setNotes((event.currentTarget as HTMLInputElement).value)
                }
              />
            </label>
          </div>

          <div class="sales-panel">
            <div class="sales-section-header">
              <div>
                <h3>
                  {isDirectPending
                    ? "Quantities to direct"
                    : "Quantities to transfer"}
                </h3>
                <p class="sales-muted">
                  {isDirectPending
                    ? "Remaining kg is prefilled. Adjust if you only want to direct part of the balance."
                    : "Enter kg per product up to the remaining balance. Leave blank or 0 to skip."}
                </p>
              </div>
            </div>

            <div class="sales-table-wrap">
              <table class="sales-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th class="sales-num">Remaining kg</th>
                    <th class="sales-num">
                      {isDirectPending ? "Direct kg" : "Transfer kg"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {remainingProducts.map((product) => {
                    const key = String(product.productId);
                    return (
                      <tr key={product.productId}>
                        <td>{product.productName}</td>
                        <td class="sales-num">
                          {formatQty(product.remainingQty)}
                        </td>
                        <td class="sales-num">
                          <input
                            class="do-transfer-qty-input"
                            type="text"
                            inputMode="numeric"
                            disabled={!canTransfer || busy}
                            value={formatQtyInput(qtyByProduct[key] ?? "")}
                            placeholder="0"
                            onInput={(event) => {
                              const next = parseQtyInput(
                                (event.currentTarget as HTMLInputElement).value,
                              );
                              setQtyByProduct((current) => ({
                                ...current,
                                [key]: next,
                              }));
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div class="do-transfer-actions">
              <button
                type="button"
                class="sales-btn-primary"
                disabled={!canTransfer || busy}
                onClick={() => void submitTransfer()}
              >
                {busy
                  ? isDirectPending
                    ? "Directing…"
                    : "Transferring…"
                  : isDirectPending
                    ? "Direct to collection point"
                    : "Transfer balance"}
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
