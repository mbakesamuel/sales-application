import { useEffect, useState } from "preact/hooks";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import { getElectronApi } from "../auth/client.ts";
import type { DeliveryOrderTrackPayload } from "./types.ts";
import { DeliveryOrderTrackingPrintView } from "./DeliveryOrderTrackingPrintView.tsx";
import "../sales/sales.css";
import "./DeliveryOrderTrackingScreen.css";

interface DeliveryOrderTrackingScreenProps {
  initialLookupNo?: string;
  onOpenInDeliveryOrdering?: (deliveryOrderNo: string) => void;
}

function statusClass(status: string): string {
  if (status === "VALIDATED") {
    return "sales-status sales-status-validated";
  }
  if (status === "REJECTED") {
    return "sales-status sales-status-rejected";
  }
  return "sales-status sales-status-pending";
}

function sourceKindLabel(kind: string): string {
  if (kind === "CARRY_FORWARD") {
    return "Carry-forward";
  }
  if (kind === "TRANSFER") {
    return "Transfer";
  }
  return "Normal";
}

function formatQty(value: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) {
    return value;
  }
  return amount.toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function formatMoney(value: string): string {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) {
    return value;
  }
  return Math.round(amount).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function DeliveryOrderTrackingScreen({
  initialLookupNo = "",
  onOpenInDeliveryOrdering,
}: DeliveryOrderTrackingScreenProps) {
  const [lookupNo, setLookupNo] = useState(initialLookupNo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<DeliveryOrderTrackPayload | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  async function track(rawNo?: string) {
    const no = (rawNo ?? lookupNo).trim();
    if (!no) {
      setError("Enter a delivery order number.");
      setPayload(null);
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const data = await getElectronApi().deliveryOrders.trackByNo(no);
      if (!data?.order?.deliveryOrderNo) {
        setPayload(null);
        setError("Delivery order not found.");
        return;
      }
      setLookupNo(data.order.deliveryOrderNo);
      setPayload(data);
    } catch (trackError) {
      setPayload(null);
      setError(
        trackError instanceof Error
          ? trackError.message
          : "Could not load delivery order tracking.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const no = initialLookupNo.trim();
    if (no) {
      void track(no);
    }
  }, [initialLookupNo]);

  function clear() {
    setLookupNo("");
    setPayload(null);
    setError(null);
    setPrintOpen(false);
  }

  return (
    <div class="sales-screen do-track-screen">
      <div class="sales-panel">
        <div class="sales-panel-header">
          <div>
            <h2>DO tracking</h2>
            <p class="sales-muted">
              Enter a booklet, DO, CF, or DT number to see commitment vs lifts.
            </p>
          </div>
        </div>

        <div class="sales-lookup-row">
          <label class="sales-field sales-field-grow">
            <span>Delivery order no.</span>
            <input
              type="text"
              value={lookupNo}
              disabled={busy}
              placeholder="12345 or CF-2026-000001"
              onInput={(event) =>
                setLookupNo((event.currentTarget as HTMLInputElement).value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void track();
                }
              }}
            />
          </label>
          <button
            type="button"
            class="sales-btn-primary"
            disabled={busy}
            onClick={() => void track()}
          >
            {busy ? "Tracking…" : "Track"}
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

      {!payload && !error ? (
        <p class="sales-muted">
          Track a delivery order to see ordered, lifted, and remaining quantities
          plus the sales invoices that drew it down.
        </p>
      ) : null}

      {payload ? (
        <>
          <div class="sales-panel">
            <div class="sales-section-header">
              <div>
                <h3>1 · Delivery order</h3>
                <p class="sales-muted">
                  <span class={statusClass(payload.order.status)}>
                    {payload.order.status}
                  </span>
                  {" · "}
                  {sourceKindLabel(payload.order.sourceKind)}
                  {payload.order.status !== "VALIDATED" ? (
                    <>
                      {" · "}
                      <span class="sales-hint">
                        Pick DO only lists validated delivery orders.
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
              <div class="do-track-header-actions">
                <button
                  type="button"
                  class="sales-btn-secondary"
                  onClick={() => setPrintOpen(true)}
                >
                  Print tracking report
                </button>
                {onOpenInDeliveryOrdering ? (
                  <button
                    type="button"
                    class="sales-btn-primary"
                    onClick={() =>
                      onOpenInDeliveryOrdering(payload.order.deliveryOrderNo)
                    }
                  >
                    Open in Delivery ordering
                  </button>
                ) : null}
              </div>
            </div>

            <div class="do-track-meta-grid">
              <div>
                <span class="do-track-meta-label">DO no.</span>
                <strong>{payload.order.deliveryOrderNo}</strong>
              </div>
              <div>
                <span class="do-track-meta-label">Customer</span>
                <strong>{payload.order.customerName}</strong>
              </div>
              <div>
                <span class="do-track-meta-label">Collection point</span>
                <strong>{payload.order.salesPointName}</strong>
              </div>
              <div>
                <span class="do-track-meta-label">Date issued</span>
                <strong>{formatDisplayDate(payload.order.dateIssued)}</strong>
              </div>
              {payload.order.orderRef ? (
                <div>
                  <span class="do-track-meta-label">Customer reference</span>
                  <strong>{payload.order.orderRef}</strong>
                </div>
              ) : null}
              {payload.order.transferredFromDeliveryOrderNo ? (
                <div>
                  <span class="do-track-meta-label">Transferred from</span>
                  <strong>
                    <button
                      type="button"
                      class="do-track-link"
                      onClick={() =>
                        void track(payload.order.transferredFromDeliveryOrderNo!)
                      }
                    >
                      {payload.order.transferredFromDeliveryOrderNo}
                    </button>
                  </strong>
                </div>
              ) : null}
            </div>

            <div class="do-track-summary">
              <div class="do-track-chip">
                <span>Ordered</span>
                <strong>{formatQty(payload.totals.orderedKg)} kg</strong>
              </div>
              <div class="do-track-chip">
                <span>Lifted</span>
                <strong>{formatQty(payload.totals.liftedKg)} kg</strong>
              </div>
              <div class="do-track-chip">
                <span>Remaining</span>
                <strong>{formatQty(payload.totals.remainingKg)} kg</strong>
              </div>
            </div>
          </div>

          <div class="sales-panel">
            <div class="sales-section-header">
              <div>
                <h3>2 · Commitment by product</h3>
                <p class="sales-muted">
                  Ordered vs lifted quantities for this delivery order.
                </p>
              </div>
            </div>

            <div class="sales-table-wrap">
              <table class="sales-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th class="do-track-num">Ordered (kg)</th>
                    <th class="do-track-num">Lifted (kg)</th>
                    <th class="do-track-num">Remaining (kg)</th>
                    <th class="do-track-num">% lifted</th>
                  </tr>
                </thead>
                <tbody>
                  {payload.products.length === 0 ? (
                    <tr>
                      <td colSpan={5} class="sales-muted">
                        No product lines on this delivery order.
                      </td>
                    </tr>
                  ) : (
                    payload.products.map((row) => (
                      <tr key={row.productId}>
                        <td>{row.productName}</td>
                        <td class="do-track-num">{formatQty(row.orderQty)}</td>
                        <td class="do-track-num">{formatQty(row.liftedQty)}</td>
                        <td class="do-track-num do-track-remaining">
                          {formatQty(row.remainingQty)}
                        </td>
                        <td class="do-track-num">{row.liftedPercent}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {payload.products.length > 0 ? (
                  <tfoot>
                    <tr>
                      <td>
                        <strong>Total</strong>
                      </td>
                      <td class="do-track-num">
                        <strong>{formatQty(payload.totals.orderedKg)}</strong>
                      </td>
                      <td class="do-track-num">
                        <strong>{formatQty(payload.totals.liftedKg)}</strong>
                      </td>
                      <td class="do-track-num do-track-remaining">
                        <strong>{formatQty(payload.totals.remainingKg)}</strong>
                      </td>
                      <td class="do-track-num">
                        <strong>
                          {Number.parseFloat(payload.totals.orderedKg) > 0
                            ? `${(
                                Math.round(
                                  (Number.parseFloat(payload.totals.liftedKg) /
                                    Number.parseFloat(payload.totals.orderedKg)) *
                                    1000,
                                ) / 10
                              ).toString()}%`
                            : "0%"}
                        </strong>
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>

          <div class="sales-panel">
            <div class="sales-section-header">
              <div>
                <h3>3 · Lift history (sales)</h3>
                <p class="sales-muted">
                  Pending and validated invoices linked to this delivery order.
                </p>
              </div>
            </div>

            {payload.lifts.length === 0 ? (
              <p class="sales-muted">
                No sales have lifted this delivery order.
              </p>
            ) : (
              <div class="do-track-lifts">
                {payload.lifts.map((lift) => (
                  <article class="do-track-lift-card" key={lift.saleId}>
                    <header class="do-track-lift-header">
                      <div>
                        <strong>{lift.invoiceNo}</strong>
                        <span class={statusClass(lift.status)}>{lift.status}</span>
                      </div>
                      <div class="sales-muted">
                        {formatDisplayDate(lift.dateIssued)}
                        {lift.customerName ? ` · ${lift.customerName}` : ""}
                      </div>
                    </header>
                    <div class="sales-table-wrap">
                      <table class="sales-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th class="do-track-num">Qty (kg)</th>
                            <th class="do-track-num">Unit price</th>
                            <th class="do-track-num">Line net</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lift.lines.map((line) => (
                            <tr key={`${lift.saleId}:${line.productId}:${line.qtyKg}`}>
                              <td>{line.productName}</td>
                              <td class="do-track-num">{formatQty(line.qtyKg)}</td>
                              <td class="do-track-num">
                                {formatMoney(line.unitPricePerKg)}
                              </td>
                              <td class="do-track-num">
                                {formatMoney(line.lineNet)} XAF
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div class="sales-panel">
            <div class="sales-section-header">
              <div>
                <h3>4 · Transfers out</h3>
                <p class="sales-muted">
                  Remaining balance moved to other collection points from this DO.
                </p>
              </div>
            </div>

            {(payload.transfersOut ?? []).length === 0 ? (
              <p class="sales-muted">No transfers out from this delivery order.</p>
            ) : (
              <div class="do-track-lifts">
                {(payload.transfersOut ?? []).map((transfer) => (
                  <article
                    class="do-track-lift-card"
                    key={transfer.transferId}
                  >
                    <header class="do-track-lift-header">
                      <div>
                        <button
                          type="button"
                          class="do-track-link"
                          onClick={() => void track(transfer.toDeliveryOrderNo)}
                        >
                          {transfer.toDeliveryOrderNo}
                        </button>
                        <span class="sales-muted">
                          → {transfer.toSalesPointName}
                        </span>
                      </div>
                      <div class="sales-muted">
                        {formatDisplayDate(transfer.transferredAt.slice(0, 10))}
                      </div>
                    </header>
                    <div class="sales-table-wrap">
                      <table class="sales-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th class="do-track-num">Transferred (kg)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {transfer.lines.map((line) => (
                            <tr
                              key={`${transfer.transferId}:${line.productId}`}
                            >
                              <td>{line.productName}</td>
                              <td class="do-track-num">
                                {formatQty(line.qtyKg)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      {printOpen && payload ? (
        <DeliveryOrderTrackingPrintView
          payload={payload}
          onClose={() => setPrintOpen(false)}
        />
      ) : null}
    </div>
  );
}
