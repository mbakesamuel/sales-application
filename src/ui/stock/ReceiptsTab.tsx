import { useEffect, useMemo, useState } from "preact/hooks";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import type {
  ProductOption,
  ReceiptDetail,
  ReceiptListRow,
  SalesPointOption,
  StockBalanceRow,
  StockProductFilter,
  StorageLocationOption,
} from "../../shared/stock.types.ts";
import {
  ConfirmDialog,
  DocDialog,
  ReviewKeyValue,
  ReviewLineTable,
  StatusBadge,
  type StockDialogMessage,
} from "./StockDialogs.tsx";
import { ReceiptPrintView } from "./ReceiptPrintView.tsx";
import { ReceiptLineEditor, type ReceiptLineDraft } from "./LineEditors.tsx";
import {
  clampIsoDateToRange,
  defaultReceiptLocationId,
  formatDate,
  formatDateTime,
  locationsForReceiptAtSalesPoint,
  trimQty,
  utcIsoDateToday,
} from "./stockUtils.ts";
import {
  IconEye,
  IconPencil,
  IconTrash,
  StockRowActionButton,
} from "./StockRowActions.tsx";

interface ReceiptsTabProps {
  rows: ReceiptListRow[];
  salesPoints: SalesPointOption[];
  storageLocations: StorageLocationOption[];
  products: ProductOption[];
  onHand: StockBalanceRow[];
  scopedSalesPointId: number | null;
  botaSalesPointId?: number | null;
  canPost: boolean;
  canCancel: boolean;
  canDraft: boolean;
  canDirectPost: boolean;
  autoGenerateReceiptNo: boolean;
  userId: string;
  /** Global Stock view filter; locks the bottled checkbox when Loose or Bottled. */
  viewProductFilter?: StockProductFilter;
  stockIntakeOilGrouping?: boolean;
  onOk: (text: string) => void;
  onErr: (text: string) => void;
}

export function ReceiptsTab(props: ReceiptsTabProps) {
  const {
    rows,
    salesPoints,
    storageLocations,
    products,
    onHand,
    scopedSalesPointId,
    botaSalesPointId = null,
    userId,
    autoGenerateReceiptNo,
    viewProductFilter = "all",
    stockIntakeOilGrouping = false,
  } = props;
  const bottledLocked =
    viewProductFilter === "bulk" || viewProductFilter === "bottled";
  const lockedBottled = viewProductFilter === "bottled";
  const bottleReceiptAtBota = lockedBottled && botaSalesPointId != null;
  const defaultSalesPointId = (): string => {
    if (bottleReceiptAtBota) {
      return String(botaSalesPointId);
    }
    return scopedSalesPointId != null ? String(scopedSalesPointId) : "";
  };
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [bottledProducts, setBottledProducts] = useState(lockedBottled);
  const [receiptNo, setReceiptNo] = useState("");
  const [consignmentNoteNo, setConsignmentNoteNo] = useState("");
  const [consignedBy, setConsignedBy] = useState("");
  const [consDesign, setConsDesign] = useState("");
  const [consDate, setConsDate] = useState("");
  const [receiveBy, setReceiveBy] = useState("");
  const [receiveByDesign, setReceiveByDesign] = useState("");
  const [receiveDate, setReceiveDate] = useState("");
  const [salesPointId, setSalesPointId] = useState<string>(defaultSalesPointId);
  const [supplierLabel, setSupplierLabel] = useState("");
  const [receivedAt, setReceivedAt] = useState(utcIsoDateToday());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ReceiptLineDraft[]>(() => [
    {
      productId: "",
      qty: "",
      storageLocationId: defaultReceiptLocationId(
        storageLocations,
        scopedSalesPointId ?? "",
        false,
      ),
    },
  ]);
  const [pendingCancel, setPendingCancel] = useState<ReceiptListRow | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [lookupNo, setLookupNo] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [reviewDetail, setReviewDetail] = useState<ReceiptDetail | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [postingPeriod, setPostingPeriod] = useState<OpenPostingPeriod | null>(
    null,
  );
  const [modalMessage, setModalMessage] = useState<StockDialogMessage>(null);

  function showModalErr(text: string) {
    setModalMessage({ type: "error", text });
  }

  function clearModalMessage() {
    setModalMessage(null);
  }

  function closeReviewModal() {
    clearModalMessage();
    setReviewDetail(null);
  }

  function closeFormModal() {
    clearModalMessage();
    setOpen(false);
  }

  function closeCancelModal() {
    clearModalMessage();
    setPendingCancel(null);
  }

  const receiptSalesPoints = useMemo(() => {
    if (lockedBottled) {
      if (botaSalesPointId == null) {
        return [];
      }
      const bota = salesPoints.find((sp) => sp.id === botaSalesPointId);
      return bota ? [bota] : [];
    }
    const millAttached = salesPoints.filter((sp) => sp.attachedToMill);
    if (!salesPointId) {
      return millAttached;
    }
    const currentId = Number.parseInt(salesPointId, 10);
    if (
      Number.isFinite(currentId) &&
      !millAttached.some((sp) => sp.id === currentId)
    ) {
      const legacy = salesPoints.find((sp) => sp.id === currentId);
      if (legacy) {
        return [legacy, ...millAttached];
      }
    }
    return millAttached;
  }, [salesPoints, salesPointId, lockedBottled, botaSalesPointId]);

  useEffect(() => {
    let cancelled = false;
    void getAuthenticatedFinancialYears()
      .getOpenPostingPeriod(scopedSalesPointId)
      .then((period) => {
        if (!cancelled) {
          setPostingPeriod(period);
          setReceivedAt((current) => clampIsoDateToRange(current, period));
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
  }, [scopedSalesPointId]);

  function defaultReceivedAt(): string {
    return clampIsoDateToRange(utcIsoDateToday(), postingPeriod);
  }

  function resetForm() {
    setEditingId(null);
    const nextBottled = bottledLocked ? lockedBottled : false;
    setBottledProducts(nextBottled);
    setReceiptNo("");
    setConsignmentNoteNo("");
    setConsignedBy("");
    setConsDesign("");
    setConsDate("");
    setReceiveBy("");
    setReceiveByDesign("");
    setReceiveDate("");
    const sp =
      nextBottled && botaSalesPointId != null
        ? String(botaSalesPointId)
        : scopedSalesPointId != null
          ? String(scopedSalesPointId)
          : "";
    setSalesPointId(sp);
    setSupplierLabel("");
    setReceivedAt(defaultReceivedAt());
    setNotes("");
    setLines([
      {
        productId: "",
        qty: "",
        storageLocationId: defaultReceiptLocationId(
          storageLocations,
          sp,
          nextBottled,
        ),
      },
    ]);
  }

  function receiptProductFilter(): StockProductFilter {
    return bottledProducts ? "bottled" : "bulk";
  }

  function productFilterForDetail(detail: ReceiptDetail): StockProductFilter {
    const first = detail.lines[0];
    if (!first) {
      return "bulk";
    }
    const product = products.find((p) => p.productId === first.productId);
    return product?.isBottled ? "bottled" : "bulk";
  }

  const modalProducts = products.filter((p) => p.isBottled === bottledProducts);

  function onBottledProductsChange(next: boolean) {
    setBottledProducts(next);
    const defLoc = defaultReceiptLocationId(
      storageLocations,
      salesPointId,
      next,
    );
    setLines((prev) =>
      prev.map((line) => {
        const cleared = !line.productId
          ? line
          : (() => {
              const product = products.find(
                (p) => String(p.productId) === line.productId,
              );
              if (product && product.isBottled === next) {
                return line;
              }
              return { ...line, productId: "" };
            })();
        return { ...cleared, storageLocationId: defLoc };
      }),
    );
  }

  useEffect(() => {
    if (!bottledLocked) {
      return;
    }
    onBottledProductsChange(lockedBottled);
  }, [bottledLocked, lockedBottled]);

  function onSalesPointChange(nextId: string) {
    setSalesPointId(nextId);
    const defLoc = defaultReceiptLocationId(
      storageLocations,
      nextId,
      bottledProducts,
    );
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        storageLocationId: locationsForReceiptAtSalesPoint(
          storageLocations,
          nextId,
          bottledProducts,
        ).some((loc) => String(loc.id) === l.storageLocationId)
          ? l.storageLocationId
          : defLoc,
      })),
    );
  }

  function openCreate() {
    resetForm();
    clearModalMessage();
    setOpen(true);
  }

  async function onSave(event: Event, postImmediately = false) {
    event.preventDefault();
    if (busy) return;
    if (postImmediately && (editingId || !props.canDirectPost)) {
      return;
    }
    if (!postImmediately && !editingId && !props.canDraft) {
      return;
    }
    const showConsignment = bottledProducts;
    if (showConsignment) {
      if (!consignmentNoteNo.trim()) {
        showModalErr("Consignment Note # is required for Bottle Oil receipts.");
        return;
      }
      if (!consignedBy.trim()) {
        showModalErr("Consigned by is required for Bottle Oil receipts.");
        return;
      }
      if (!receiveBy.trim()) {
        showModalErr("Received by is required for Bottle Oil receipts.");
        return;
      }
    }
    setBusy(true);
    clearModalMessage();
    try {
      const res = await getElectronApi().stock.saveReceipt({
        userId,
        productFilter: receiptProductFilter(),
        id: editingId,
        postImmediately: postImmediately && !editingId,
        ...(autoGenerateReceiptNo || editingId
          ? {}
          : { receiptNo: receiptNo.trim() }),
        salesPointId: Number.parseInt(salesPointId, 10),
        supplierLabel,
        receivedAt,
        notes: notes || null,
        consignmentNoteNo: showConsignment
          ? consignmentNoteNo.trim() || null
          : null,
        consignedBy: showConsignment ? consignedBy.trim() || null : null,
        consDesign: showConsignment ? consDesign.trim() || null : null,
        consDate: showConsignment ? consDate.trim() || null : null,
        receiveBy: showConsignment ? receiveBy.trim() || null : null,
        receiveByDesign: showConsignment
          ? receiveByDesign.trim() || null
          : null,
        receiveDate: showConsignment ? receiveDate.trim() || null : null,
        lines: lines
          .filter((l) => {
            if (!l.productId || !l.qty) {
              return false;
            }
            const product = products.find(
              (p) => String(p.productId) === l.productId,
            );
            if (product?.omitsStorageLocation) {
              return true;
            }
            return Boolean(l.storageLocationId);
          })
          .map((l) => {
            const product = products.find(
              (p) => String(p.productId) === l.productId,
            );
            return {
              productId: Number.parseInt(l.productId, 10),
              qty: l.qty,
              storageLocationId: product?.omitsStorageLocation
                ? null
                : Number.parseInt(l.storageLocationId, 10),
            };
          }),
      });
      if (res.ok === false) {
        showModalErr(res.error);
        return;
      }
      if (editingId) {
        props.onOk(`Receipt ${res.documentNo} updated.`);
      } else if (postImmediately) {
        props.onOk(`Receipt ${res.documentNo} posted; balances updated.`);
      } else {
        props.onOk(`Receipt ${res.documentNo} drafted.`);
      }
      closeFormModal();
      resetForm();
    } finally {
      setBusy(false);
    }
  }

  async function onPost(id: string) {
    setBusy(true);
    clearModalMessage();
    try {
      const detailRes = await getElectronApi().stock.loadReceiptForReview({
        userId,
        receiptId: id,
      });
      if (detailRes.ok === false) {
        showModalErr(detailRes.error);
        return;
      }
      const res = await getElectronApi().stock.postReceipt({
        userId,
        productFilter: productFilterForDetail(detailRes.detail),
        receiptId: id,
      });
      if (res.ok === false) {
        showModalErr(res.error);
        return;
      }
      props.onOk("Receipt posted; balances updated.");
      if (reviewDetail?.id === id) closeReviewModal();
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (!pendingCancel) return;
    const id = pendingCancel.id;
    setBusy(true);
    clearModalMessage();
    try {
      const detailRes = await getElectronApi().stock.loadReceiptForReview({
        userId,
        receiptId: id,
      });
      if (detailRes.ok === false) {
        showModalErr(detailRes.error);
        return;
      }
      const res = await getElectronApi().stock.cancelReceipt({
        userId,
        productFilter: productFilterForDetail(detailRes.detail),
        receiptId: id,
      });
      if (res.ok === false) {
        showModalErr(res.error);
        return;
      }
      props.onOk("Receipt cancelled.");
      closeCancelModal();
      if (reviewDetail?.id === id) closeReviewModal();
    } finally {
      setBusy(false);
    }
  }

  async function openReviewById(id: string) {
    setReviewBusy(true);
    try {
      const res = await getElectronApi().stock.loadReceiptForReview({
        userId,
        receiptId: id,
      });
      if (res.ok === false) {
        props.onErr(res.error);
        return;
      }
      clearModalMessage();
      setReviewDetail(res.detail);
    } finally {
      setReviewBusy(false);
    }
  }

  function populateFormFromDetail(detail: ReceiptDetail) {
    setEditingId(detail.id);
    setSalesPointId(String(detail.salesPointId));
    setSupplierLabel(detail.supplierLabel);
    setReceiptNo(detail.receiptNo);
    setConsignmentNoteNo(detail.consignmentNoteNo ?? "");
    setConsignedBy(detail.consignedBy ?? "");
    setConsDesign(detail.consDesign ?? "");
    setConsDate(detail.consDate ?? "");
    setReceiveBy(detail.receiveBy ?? "");
    setReceiveByDesign(detail.receiveByDesign ?? "");
    setReceiveDate(detail.receiveDate ?? "");
    setBottledProducts(productFilterForDetail(detail) === "bottled");
    const rawDate =
      detail.receivedAtIso.length > 10
        ? detail.receivedAtIso.slice(0, 10)
        : detail.receivedAtIso;
    setReceivedAt(clampIsoDateToRange(rawDate, postingPeriod));
    setNotes(detail.notes ?? "");
    setLines(
      detail.lines.length > 0
        ? detail.lines.map((l) => ({
            productId: String(l.productId),
            qty: l.qty,
            storageLocationId:
              l.storageLocationId != null ? String(l.storageLocationId) : "",
          }))
        : [
            {
              productId: "",
              qty: "",
              storageLocationId: defaultReceiptLocationId(
                storageLocations,
                detail.salesPointId,
                productFilterForDetail(detail) === "bottled",
              ),
            },
          ],
    );
    setOpen(true);
  }

  async function openEditById(id: string) {
    setReviewBusy(true);
    const fromReview = reviewDetail?.id === id;
    try {
      const res = await getElectronApi().stock.loadReceiptForReview({
        userId,
        receiptId: id,
      });
      if (res.ok === false) {
        if (fromReview) {
          showModalErr(res.error);
        } else {
          props.onErr(res.error);
        }
        return;
      }
      if (res.detail.status !== "DRAFT") {
        const text = "Only draft receipts can be edited.";
        if (fromReview) {
          showModalErr(text);
        } else {
          props.onErr(text);
        }
        return;
      }
      closeReviewModal();
      clearModalMessage();
      populateFormFromDetail(res.detail);
    } finally {
      setReviewBusy(false);
    }
  }

  async function onLookup(event: Event) {
    event.preventDefault();
    if (lookupBusy) return;
    const n = lookupNo.trim();
    if (!n) return;
    setLookupBusy(true);
    try {
      const res = await getElectronApi().stock.findReceiptByNumber({
        userId,
        receiptNo: n,
      });
      if (res.ok === false) {
        props.onErr(res.error);
        return;
      }
      setReviewDetail(res.detail);
      setLookupNo("");
    } finally {
      setLookupBusy(false);
    }
  }

  return (
    <section class="stock-section">
      <div class="stock-section-header">
        <div>
          <h2>Stock receipts</h2>
        </div>
        <div class="stock-header-actions">
          {props.canPost ? (
            <form
              onSubmit={onLookup}
              class="stock-lookup-row"
              aria-label="Pull voucher by number"
            >
              <input
                value={lookupNo}
                onInput={(event) =>
                  setLookupNo((event.currentTarget as HTMLInputElement).value)
                }
                placeholder="SR-2026-000001"
                class="stock-lookup-input"
                aria-label="Receipt number"
              />
              <button
                type="submit"
                class="stock-btn-primary"
                disabled={lookupBusy || !lookupNo.trim()}
              >
                {lookupBusy ? "…" : "Pull voucher"}
              </button>
            </form>
          ) : null}
          {props.canDraft || props.canDirectPost ? (
            <button
              type="button"
              class="stock-btn-primary"
              onClick={openCreate}
            >
              New Reception
            </button>
          ) : null}
        </div>
      </div>

      <div class="stock-table-wrap">
        <table class="stock-table">
          <thead>
            <tr>
              <th>Receipt #</th>
              <th>Consignment Note #</th>
              <th>Date</th>
              <th>Collection point</th>
              <th>Supplier</th>
              <th class="stock-num">Total qty</th>
              <th>Status</th>
              <th class="stock-actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} class="stock-empty-cell">
                  No receipts recorded yet.
                  {props.canDraft ? (
                    <>
                      {" "}
                      Use <span class="stock-strong">New Reception</span> to
                      create one.
                    </>
                  ) : null}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td class="stock-mono">{r.receiptNo}</td>
                  <td class="stock-mono">
                    {r.consignmentNoteNo?.trim() ? r.consignmentNoteNo : "—"}
                  </td>
                  <td class="stock-nowrap">{formatDate(r.receivedAtIso)}</td>
                  <td>{r.salesPointName}</td>
                  <td>{r.supplierLabel}</td>
                  <td class="stock-num">{trimQty(r.totalQty)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td class="stock-actions-col">
                    <div class="customers-row-actions">
                      <StockRowActionButton
                        disabled={reviewBusy}
                        title="View lines"
                        onClick={() => void openReviewById(r.id)}
                      >
                        <IconEye /> View
                      </StockRowActionButton>
                      {r.status === "DRAFT" && props.canDraft ? (
                        <StockRowActionButton
                          disabled={busy || reviewBusy}
                          title="Correct draft"
                          onClick={() => void openEditById(r.id)}
                        >
                          <IconPencil /> Edit
                        </StockRowActionButton>
                      ) : null}
                      {(r.status === "DRAFT" && props.canDraft) ||
                      (r.status === "POSTED" && props.canCancel) ? (
                        <StockRowActionButton
                          danger
                          disabled={busy}
                          onClick={() => setPendingCancel(r)}
                        >
                          <IconTrash />{" "}
                          {r.status === "DRAFT" ? "Delete" : "Cancel"}
                        </StockRowActionButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {reviewDetail && !printOpen ? (
        <DocDialog
          title={`Review receipt ${reviewDetail.receiptNo}`}
          wide
          message={modalMessage}
          onClose={closeReviewModal}
        >
          <div class="stock-review">
            <div class="stock-review-top">
              <StatusBadge status={reviewDetail.status} />
            </div>

            <div class="stock-review-grid">
              <ReviewKeyValue label="Collection point">
                {reviewDetail.salesPointName}
              </ReviewKeyValue>
              <ReviewKeyValue label="Receipt Date">
                {formatDate(reviewDetail.receivedAtIso)}
              </ReviewKeyValue>
              <ReviewKeyValue label="Mill">
                {reviewDetail.supplierLabel}
              </ReviewKeyValue>
              {reviewDetail.consignmentNoteNo ? (
                <ReviewKeyValue label="Consignment Note #">
                  <span class="stock-mono">{reviewDetail.consignmentNoteNo}</span>
                </ReviewKeyValue>
              ) : null}
              {reviewDetail.consignedBy ? (
                <ReviewKeyValue label="Consigned by">
                  {reviewDetail.consignedBy}
                  {reviewDetail.consDesign
                    ? ` (${reviewDetail.consDesign})`
                    : ""}
                  {reviewDetail.consDate ? (
                    <span class="stock-subtext">
                      {" "}
                      {formatDate(reviewDetail.consDate)}
                    </span>
                  ) : null}
                </ReviewKeyValue>
              ) : null}
              {reviewDetail.receiveBy ? (
                <ReviewKeyValue label="Received by">
                  {reviewDetail.receiveBy}
                  {reviewDetail.receiveByDesign
                    ? ` (${reviewDetail.receiveByDesign})`
                    : ""}
                  {reviewDetail.receiveDate ? (
                    <span class="stock-subtext">
                      {" "}
                      {formatDate(reviewDetail.receiveDate)}
                    </span>
                  ) : null}
                </ReviewKeyValue>
              ) : null}
              <ReviewKeyValue label="Drafted by">
                {reviewDetail.createdByName}
                <span class="stock-subtext">
                  {" "}
                  {formatDateTime(reviewDetail.createdAtIso)}
                </span>
              </ReviewKeyValue>
              {reviewDetail.postedByName ? (
                <ReviewKeyValue label="Posted by">
                  {reviewDetail.postedByName}
                  <span class="stock-subtext">
                    {" "}
                    {formatDateTime(reviewDetail.postedAtIso)}
                  </span>
                </ReviewKeyValue>
              ) : null}
              {reviewDetail.notes ? (
                <ReviewKeyValue label="Notes">
                  {reviewDetail.notes}
                </ReviewKeyValue>
              ) : null}
            </div>

            <ReviewLineTable lines={reviewDetail.lines} />

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
                class="stock-btn-secondary"
                onClick={() => setPrintOpen(true)}
              >
                Print receipt
              </button>
              {(reviewDetail.status === "DRAFT" && props.canDraft) ||
              (reviewDetail.status === "POSTED" && props.canCancel) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingCancel(reviewDetail)}
                  class="stock-btn-danger"
                >
                  {reviewDetail.status === "DRAFT"
                    ? "Delete draft"
                    : "Cancel receipt"}
                </button>
              ) : null}
              {reviewDetail.status === "DRAFT" && props.canDraft ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openEditById(reviewDetail.id)}
                  class="stock-btn-secondary"
                  title="Correct the draft before posting"
                >
                  Edit draft
                </button>
              ) : null}
              {reviewDetail.status === "DRAFT" && props.canPost ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onPost(reviewDetail.id)}
                  class="stock-btn-primary"
                >
                  Post receipt
                </button>
              ) : null}
            </div>
          </div>
        </DocDialog>
      ) : null}

      {printOpen && reviewDetail ? (
        <ReceiptPrintView
          receiptId={reviewDetail.id}
          userId={userId}
          onClose={() => setPrintOpen(false)}
        />
      ) : null}

      {open ? (
        <DocDialog
          title={editingId ? "Edit receipt" : "New Reception"}
          wide
          message={modalMessage}
          onClose={closeFormModal}
        >
          <form
            onSubmit={(event) => void onSave(event, false)}
            class="stock-form"
          >
            {bottledProducts ? (
              <label class="stock-form-row">
                <span class="stock-form-label">Consignment Note #</span>
                <input
                  class="stock-form-control stock-mono"
                  value={consignmentNoteNo}
                  onInput={(event) =>
                    setConsignmentNoteNo(
                      (event.currentTarget as HTMLInputElement).value,
                    )
                  }
                  placeholder="Mill consignment note number"
                  required
                />
              </label>
            ) : null}

            <label class="stock-form-row">
              <span class="stock-form-label">Receipt Date</span>
              <span class="stock-form-control-wrap">
                <input
                  type="date"
                  class="stock-form-control"
                  value={receivedAt}
                  min={postingPeriod?.startDate}
                  max={postingPeriod?.endDate}
                  disabled={!postingPeriod}
                  onInput={(event) =>
                    setReceivedAt(
                      clampIsoDateToRange(
                        (event.currentTarget as HTMLInputElement).value,
                        postingPeriod,
                      ),
                    )
                  }
                  required
                />
              </span>
            </label>
            {!autoGenerateReceiptNo && !editingId ? (
              <label class="stock-form-row">
                <span class="stock-form-label">Receipt number</span>
                <input
                  class="stock-form-control stock-mono"
                  value={receiptNo}
                  onInput={(event) =>
                    setReceiptNo(
                      (event.currentTarget as HTMLInputElement).value,
                    )
                  }
                  placeholder="SR-2026-000001"
                  required
                />
              </label>
            ) : null}
            {!autoGenerateReceiptNo && editingId ? (
              <label class="stock-form-row">
                <span class="stock-form-label">Receipt number</span>
                <input
                  class="stock-form-control stock-mono"
                  value={receiptNo}
                  readOnly
                  disabled
                />
              </label>
            ) : null}

            <label class="stock-form-row">
              <span class="stock-form-label">Supplier Mill</span>
              <input
                class="stock-form-control"
                value={supplierLabel}
                onInput={(event) =>
                  setSupplierLabel(
                    (event.currentTarget as HTMLInputElement).value,
                  )
                }
                placeholder="E.g IU Mondoni"
                required
              />
            </label>

            {bottledProducts ? (
              <>
                <div class="stock-transfer-signatures">
                  <div class="stock-transfer-signature-col">
                    <label class="stock-form-row">
                      <span class="stock-form-label">Consigned by</span>
                      <span class="stock-form-control-wrap">
                        <input
                          class="stock-form-control"
                          value={consignedBy}
                          onInput={(event) =>
                            setConsignedBy(
                              (event.currentTarget as HTMLInputElement).value,
                            )
                          }
                          required
                        />
                      </span>
                    </label>
                    <label class="stock-form-row">
                      <span class="stock-form-label">Designation</span>
                      <span class="stock-form-control-wrap">
                        <input
                          class="stock-form-control"
                          value={consDesign}
                          onInput={(event) =>
                            setConsDesign(
                              (event.currentTarget as HTMLInputElement).value,
                            )
                          }
                        />
                      </span>
                    </label>
                    <label class="stock-form-row">
                      <span class="stock-form-label">Date</span>
                      <span class="stock-form-control-wrap">
                        <input
                          type="date"
                          class="stock-form-control"
                          value={consDate}
                          min={postingPeriod?.startDate}
                          max={postingPeriod?.endDate}
                          disabled={!postingPeriod}
                          onInput={(event) =>
                            setConsDate(
                              clampIsoDateToRange(
                                (event.currentTarget as HTMLInputElement).value,
                                postingPeriod,
                              ),
                            )
                          }
                        />
                      </span>
                    </label>
                  </div>
                  <div class="stock-transfer-signature-col">
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
                          required
                        />
                      </span>
                    </label>
                    <label class="stock-form-row">
                      <span class="stock-form-label">Designation</span>
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
                      <span class="stock-form-label">Date</span>
                      <span class="stock-form-control-wrap">
                        <input
                          type="date"
                          class="stock-form-control"
                          value={receiveDate}
                          min={postingPeriod?.startDate}
                          max={postingPeriod?.endDate}
                          disabled={!postingPeriod}
                          onInput={(event) =>
                            setReceiveDate(
                              clampIsoDateToRange(
                                (event.currentTarget as HTMLInputElement).value,
                                postingPeriod,
                              ),
                            )
                          }
                        />
                      </span>
                    </label>
                  </div>
                </div>
              </>
            ) : null}

            {scopedSalesPointId == null || bottleReceiptAtBota ? (
              <label class="stock-form-row">
                <span class="stock-form-label">Collection point</span>
                <select
                  class="stock-form-control"
                  value={salesPointId}
                  onChange={(event) =>
                    onSalesPointChange(
                      (event.currentTarget as HTMLSelectElement).value,
                    )
                  }
                  disabled={bottleReceiptAtBota}
                  required
                >
                  <option value="">Select collection point</option>
                  {receiptSalesPoints.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {bottledLocked ? (
              viewProductFilter === "bulk" ? (
                <p class="stock-form-hint">
                  Loose products only (including Palm Kernel / Cake). Bottle Oil
                  stock is managed separately.
                </p>
              ) : null
            ) : (
              <label class="stock-form-row stock-form-row-checkbox">
                <span class="stock-form-label">Product type</span>
                <span class="stock-form-control-wrap">
                  <label class="stock-checkbox-label">
                    <input
                      type="checkbox"
                      checked={bottledProducts}
                      onChange={(event) =>
                        onBottledProductsChange(
                          (event.currentTarget as HTMLInputElement).checked,
                        )
                      }
                    />
                    Bottled products
                  </label>
                  <span class="stock-form-hint">
                    {bottledProducts
                      ? "Line products are limited to bottled items."
                      : "Line products are limited to other (non-bottled) items, including Palm Kernel / Cake (no storage location)."}
                  </span>
                </span>
              </label>
            )}
            <label class="stock-form-row">
              <span class="stock-form-label">Description</span>
              <input
                class="stock-form-control"
                value={notes}
                onInput={(event) =>
                  setNotes((event.currentTarget as HTMLInputElement).value)
                }
                placeholder="Notes about the receipt"
              />
            </label>

            <ReceiptLineEditor
              products={modalProducts}
              lines={lines}
              onChange={setLines}
              locationOptions={locationsForReceiptAtSalesPoint(
                storageLocations,
                salesPointId,
                bottledProducts,
              )}
              defaultLocationId={defaultReceiptLocationId(
                storageLocations,
                salesPointId,
                bottledProducts,
              )}
              onHand={onHand}
              salesPointId={salesPointId}
              stockIntakeOilGrouping={
                stockIntakeOilGrouping && !bottledProducts
              }
            />

            <div class="stock-modal-actions">
              {editingId ? (
                <button type="submit" disabled={busy} class="stock-btn-primary">
                  Save changes
                </button>
              ) : (
                <>
                  {props.canDirectPost ? (
                    <button
                      type="button"
                      disabled={busy}
                      class="stock-btn-primary"
                      onClick={(event) => void onSave(event, true)}
                    >
                      Post receipt
                    </button>
                  ) : null}
                  {props.canDraft ? (
                    <button
                      type={props.canDirectPost ? "button" : "submit"}
                      disabled={busy}
                      class={
                        props.canDirectPost
                          ? "stock-btn-secondary"
                          : "stock-btn-primary"
                      }
                      onClick={
                        props.canDirectPost
                          ? (event) => void onSave(event, false)
                          : undefined
                      }
                    >
                      {props.canDirectPost ? "Save as draft" : "Create draft"}
                    </button>
                  ) : null}
                </>
              )}
              <button
                type="button"
                onClick={closeFormModal}
                disabled={busy}
                class="stock-btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </DocDialog>
      ) : null}

      {pendingCancel ? (
        <ConfirmDialog
          title={
            pendingCancel.status === "DRAFT"
              ? "Delete this receipt?"
              : "Cancel posted receipt?"
          }
          description={
            pendingCancel.status === "DRAFT"
              ? `Draft receipt ${pendingCancel.receiptNo} will be removed.`
              : `Receipt ${pendingCancel.receiptNo} is already posted. Cancelling will write compensating movements that reverse every line. This cannot be undone.`
          }
          confirmLabel={
            pendingCancel.status === "DRAFT" ? "Delete" : "Cancel receipt"
          }
          busy={busy}
          message={modalMessage}
          onCancel={closeCancelModal}
          onConfirm={onCancel}
        />
      ) : null}
    </section>
  );
}
