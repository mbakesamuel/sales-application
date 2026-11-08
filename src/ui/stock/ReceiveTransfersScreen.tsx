import { useEffect, useState } from "preact/hooks";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import type {
  StockReceiveQueuePage,
  StockReceiveQueueRow,
  TransferDetail,
} from "../../shared/stock.types.ts";
import type { AuthUser } from "../auth/session.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import { DocDialog, ReviewKeyValue, ReviewLineTable, type StockDialogMessage } from "./StockDialogs.tsx";
import {
  clampIsoDateToRange,
  defaultLocationId,
  formatDateTime,
  locationsForSalesPoint,
  trimQty,
  utcIsoDateToday,
} from "./stockUtils.ts";
import "./StockScreen.css";

interface ReceiveTransfersScreenProps {
  user: AuthUser;
}

export function ReceiveTransfersScreen({ user }: ReceiveTransfersScreenProps) {
  const [page, setPage] = useState<StockReceiveQueuePage | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [screenMessage, setScreenMessage] = useState<StockDialogMessage>(null);
  const [modalMessage, setModalMessage] = useState<StockDialogMessage>(null);
  const [review, setReview] = useState<TransferDetail | null>(null);
  const [receiveDetail, setReceiveDetail] = useState<TransferDetail | null>(
    null,
  );
  const [receiveBy, setReceiveBy] = useState("");
  const [receiveByDesign, setReceiveByDesign] = useState("");
  const [receiveDate, setReceiveDate] = useState("");
  const [receiveLines, setReceiveLines] = useState<
    Array<{ lineId: string; toStorageLocationId: string }>
  >([]);
  const [postingPeriod, setPostingPeriod] = useState<OpenPostingPeriod | null>(
    null,
  );

  async function refresh() {
    setPage(await getElectronApi().stock.listReceiveQueue(user.id));
  }

  useEffect(() => {
    void refresh().catch((error) => {
      setScreenMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Could not load receive queue.",
      });
    });
  }, [user.id]);

  useEffect(() => {
    let cancelled = false;
    void getAuthenticatedFinancialYears()
      .getOpenPostingPeriod(user.salesPointId)
      .then((period) => {
        if (!cancelled) {
          setPostingPeriod(period);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPostingPeriod(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user.salesPointId]);

  function openReceiveDialog(detail: TransferDetail) {
    const locations = page?.storageLocations ?? [];
    setModalMessage(null);
    setReceiveDetail(detail);
    setReceiveBy(detail.receiveBy ?? "");
    setReceiveByDesign(detail.receiveByDesign ?? "");
    setReceiveDate(
      detail.receiveDate ??
        clampIsoDateToRange(utcIsoDateToday(), postingPeriod),
    );
    setReceiveLines(
      detail.lines.map((line) => ({
        lineId: line.id,
        toStorageLocationId: defaultLocationId(
          locations,
          detail.toSalesPointId,
        ),
      })),
    );
  }

  function closeReceiveModal() {
    setModalMessage(null);
    setReceiveDetail(null);
  }

  function closeReviewModal() {
    setModalMessage(null);
    setReview(null);
  }

  async function openReview(row: StockReceiveQueueRow) {
    setReviewBusy(true);
    setScreenMessage(null);
    try {
      const res = await getElectronApi().stock.loadTransferForReview({
        userId: user.id,
        transferId: row.id,
      });
      if (res.ok === false) {
        setScreenMessage({ type: "error", text: res.error });
        return;
      }
      setModalMessage(null);
      setReview(res.detail);
    } finally {
      setReviewBusy(false);
    }
  }

  async function openReceive(row: StockReceiveQueueRow) {
    setReviewBusy(true);
    setScreenMessage(null);
    try {
      const res = await getElectronApi().stock.loadTransferForReview({
        userId: user.id,
        transferId: row.id,
      });
      if (res.ok === false) {
        setScreenMessage({ type: "error", text: res.error });
        return;
      }
      openReceiveDialog(res.detail);
    } finally {
      setReviewBusy(false);
    }
  }

  async function onReceiveSubmit(event: Event) {
    event.preventDefault();
    if (!receiveDetail || busy || !page) {
      return;
    }
    if (
      page.transferReceiveUsesDocumentDate &&
      !/^\d{4}-\d{2}-\d{2}$/.test(receiveDate.trim())
    ) {
      setModalMessage({ type: "error", text: "Receive date is required." });
      return;
    }
    setBusy(true);
    setModalMessage(null);
    try {
      const res = await getElectronApi().stock.receiveTransfer({
        userId: user.id,
        productFilter: "bottled",
        transferId: receiveDetail.id,
        lines: receiveLines
          .filter((line) => line.toStorageLocationId)
          .map((line) => ({
            lineId: line.lineId,
            toStorageLocationId: Number.parseInt(line.toStorageLocationId, 10),
          })),
        receiveBy: receiveBy || null,
        receiveByDesign: receiveByDesign || null,
        receiveDate: receiveDate || null,
      });
      if (res.ok === false) {
        setModalMessage({ type: "error", text: res.error });
        return;
      }
      const transferNo = receiveDetail.transferNo;
      const receivedId = receiveDetail.id;
      closeReceiveModal();
      if (review?.id === receivedId) {
        closeReviewModal();
      }
      setScreenMessage({
        type: "ok",
        text: `Transfer ${transferNo} received.`,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = page?.rows.length ?? 0;

  return (
    <div class="stock-screen">
      <header class="stock-header">
        <div class="stock-header-text">
          <h1>Receive transfers</h1>
          <p class="stock-header-subtitle">
            {page
              ? `${pendingCount} dispatched transfer(s) awaiting receive at your collection point.`
              : "Loading pending receives…"}
          </p>
        </div>
        <div class="stock-header-actions">
          <button
            type="button"
            class="stock-btn-secondary"
            disabled={busy || reviewBusy}
            onClick={() => {
              void refresh().catch((error) => {
                setScreenMessage({
                  type: "error",
                  text:
                    error instanceof Error
                      ? error.message
                      : "Could not refresh receive queue.",
                });
              });
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      {screenMessage ? (
        <div class={`stock-banner stock-banner-${screenMessage.type}`}>
          {screenMessage.text}
        </div>
      ) : null}

      <div class="stock-table-wrap">
        <table class="stock-table">
          <thead>
            <tr>
              <th>Transfer #</th>
              <th>From</th>
              <th>To</th>
              <th>Dispatched</th>
              <th class="stock-num">Lines</th>
              <th class="stock-num">Qty</th>
              <th>Dispatched by</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!page ? (
              <tr>
                <td colSpan={8} class="stock-muted">
                  Loading…
                </td>
              </tr>
            ) : page.rows.length === 0 ? (
              <tr>
                <td colSpan={8} class="stock-muted">
                  No transfers awaiting receive.
                </td>
              </tr>
            ) : (
              page.rows.map((row) => (
                <tr key={row.id}>
                  <td class="stock-strong">{row.transferNo}</td>
                  <td>{row.fromSalesPointName}</td>
                  <td>{row.toSalesPointName}</td>
                  <td>
                    {row.dispatchedAtIso
                      ? formatDateTime(row.dispatchedAtIso)
                      : "—"}
                  </td>
                  <td class="stock-num">{row.lineCount}</td>
                  <td class="stock-num">{trimQty(row.totalQty)}</td>
                  <td>{row.dispatchedByName ?? row.createdByName}</td>
                  <td class="stock-actions-col">
                    <div class="stock-actions-cell">
                      <button
                        type="button"
                        class="stock-btn-secondary stock-btn-small"
                        disabled={busy || reviewBusy}
                        onClick={() => void openReview(row)}
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        class="stock-btn-primary stock-btn-small"
                        disabled={busy || reviewBusy}
                        onClick={() => void openReceive(row)}
                      >
                        Receive
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {review ? (
        <DocDialog
          title={`Transfer ${review.transferNo}`}
          wide
          onClose={closeReviewModal}
        >
          <div class="stock-form">
            <ReviewKeyValue label="From">
              {review.fromSalesPointName}
            </ReviewKeyValue>
            <ReviewKeyValue label="To">{review.toSalesPointName}</ReviewKeyValue>
            <ReviewKeyValue label="Dispatched">
              {review.dispatchedAtIso
                ? formatDateTime(review.dispatchedAtIso)
                : "—"}
            </ReviewKeyValue>
            <ReviewKeyValue label="Status">{review.status}</ReviewKeyValue>
            <ReviewKeyValue label="Dispatched by">
              {review.dispatchedByName ?? "—"}
            </ReviewKeyValue>
            <ReviewLineTable
              lines={review.lines.map((line) => ({
                productName: line.productName,
                uom: line.uom,
                qty: line.qty,
                fromStorageLocationName: line.fromStorageLocationName,
                toStorageLocationName: line.toStorageLocationName,
              }))}
            />
            <div class="stock-modal-actions">
              <button
                type="button"
                class="stock-btn-secondary"
                onClick={closeReviewModal}
              >
                Close
              </button>
              <button
                type="button"
                class="stock-btn-primary"
                disabled={busy || reviewBusy}
                onClick={() => {
                  openReceiveDialog(review);
                  closeReviewModal();
                }}
              >
                Receive transfer
              </button>
            </div>
          </div>
        </DocDialog>
      ) : null}

      {receiveDetail && page ? (
        <DocDialog
          title={`Receive transfer ${receiveDetail.transferNo}`}
          wide
          message={modalMessage}
          onClose={closeReceiveModal}
        >
          <form onSubmit={onReceiveSubmit} class="stock-form">
            <p class="stock-hint">
              Choose where each line should be stored at{" "}
              {receiveDetail.toSalesPointName}.
            </p>
            <label class="stock-form-row">
              <span class="stock-form-label">Received by</span>
              <span class="stock-form-control-wrap">
                <input
                  class="stock-form-control"
                  value={receiveBy}
                  onInput={(event) =>
                    setReceiveBy(
                      (event.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
              </span>
            </label>
            <label class="stock-form-row">
              <span class="stock-form-label">Receiver designation</span>
              <span class="stock-form-control-wrap">
                <input
                  class="stock-form-control"
                  value={receiveByDesign}
                  onInput={(event) =>
                    setReceiveByDesign(
                      (event.currentTarget as HTMLInputElement).value,
                    )
                  }
                />
              </span>
            </label>
            <label class="stock-form-row">
              <span class="stock-form-label">
                Date
                {page.transferReceiveUsesDocumentDate ? " *" : ""}
              </span>
              <span class="stock-form-control-wrap">
                <input
                  type="date"
                  class="stock-form-control"
                  value={receiveDate}
                  min={postingPeriod?.startDate}
                  max={postingPeriod?.endDate}
                  disabled={!postingPeriod}
                  required={page.transferReceiveUsesDocumentDate}
                  onInput={(event) =>
                    setReceiveDate(
                      clampIsoDateToRange(
                        (event.currentTarget as HTMLInputElement).value,
                        postingPeriod,
                      ),
                    )
                  }
                />
                {page.transferReceiveUsesDocumentDate ? (
                  <span class="stock-hint">
                    This date posts destination stock (open month).
                  </span>
                ) : null}
              </span>
            </label>
            <div class="stock-table-wrap">
              <table class="stock-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>From</th>
                    <th class="stock-num">Qty</th>
                    <th>Receive into</th>
                  </tr>
                </thead>
                <tbody>
                  {receiveDetail.lines.map((line) => {
                    const receiveLine = receiveLines.find(
                      (entry) => entry.lineId === line.id,
                    );
                    const toLocationOptions = locationsForSalesPoint(
                      page.storageLocations,
                      receiveDetail.toSalesPointId,
                    );
                    return (
                      <tr key={line.id}>
                        <td class="stock-strong">{line.productName}</td>
                        <td class="stock-muted">
                          {line.fromStorageLocationName ?? "—"}
                        </td>
                        <td class="stock-num">
                          {trimQty(line.qty)} {line.uom}
                        </td>
                        <td>
                          <select
                            class="stock-line-select"
                            value={receiveLine?.toStorageLocationId ?? ""}
                            onChange={(event) => {
                              const value = (
                                event.currentTarget as HTMLSelectElement
                              ).value;
                              setReceiveLines((prev) =>
                                prev.map((entry) =>
                                  entry.lineId === line.id
                                    ? { ...entry, toStorageLocationId: value }
                                    : entry,
                                ),
                              );
                            }}
                            required
                            aria-label={`Receive ${line.productName} into`}
                          >
                            <option value="">Select location…</option>
                            {toLocationOptions.map((loc) => (
                              <option key={loc.id} value={loc.id}>
                                {loc.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div class="stock-modal-actions">
              <button
                type="button"
                disabled={busy}
                onClick={closeReceiveModal}
                class="stock-btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" disabled={busy} class="stock-btn-primary">
                Confirm receipt
              </button>
            </div>
          </form>
        </DocDialog>
      ) : null}
    </div>
  );
}
