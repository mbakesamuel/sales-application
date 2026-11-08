import { useEffect, useMemo, useState } from "preact/hooks";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import type {
  ProductOption,
  SalesPointOption,
  StockBalanceRow,
  StockProductFilter,
  StorageLocationOption,
  TransferDetail,
  TransferListRow,
} from "../../shared/stock.types.ts";
import {
  ConfirmDialog,
  DocDialog,
  ReviewLineTable,
  StatusBadge,
  type StockDialogMessage,
} from "./StockDialogs.tsx";
import { TransferLineEditor, type TransferLineDraft } from "./LineEditors.tsx";
import {
  clampIsoDateToRange,
  defaultIntraToLocationId,
  defaultLocationId,
  formatDate,
  formatDateTime,
  locationsForIntraTransferDestination,
  locationsForSalesPoint,
  trimQty,
  utcIsoDateToday,
} from "./stockUtils.ts";
import { STOCK_DOC_STATUS_LABELS } from "./stockDisplay.ts";
import { TRANSFER_MODE_LABELS } from "../../shared/stockTransferMode.ts";
import { TransferPrintView } from "./TransferPrintView.tsx";
import {
  IconCheck,
  IconEye,
  IconPackageIn,
  IconPencil,
  IconTrash,
  StockRowActionButton,
} from "./StockRowActions.tsx";

type FormTransferMode = "inter" | "intra";

function defaultToLocationId(
  storageLocations: StorageLocationOption[],
  salesPointId: string,
  excludeLocationId: string,
): string {
  const locs = locationsForSalesPoint(storageLocations, salesPointId);
  const other = locs.find((loc) => String(loc.id) !== excludeLocationId);
  return other ? String(other.id) : "";
}

function resolveIntraToLocationId(
  storageLocations: StorageLocationOption[],
  salesPointId: string,
  excludeFromId: string,
  currentToId: string | undefined,
): string {
  const eligible = locationsForIntraTransferDestination(
    storageLocations,
    salesPointId,
  );
  const defTo = defaultIntraToLocationId(
    storageLocations,
    salesPointId,
    excludeFromId,
  );
  if (currentToId && eligible.some((loc) => String(loc.id) === currentToId)) {
    return currentToId;
  }
  return defTo;
}

function isIntraRow(row: TransferListRow): boolean {
  return row.transferMode === "INTRA_SALES_POINT";
}

function ReviewReadonlyField(props: { label: string; value: string }) {
  return (
    <label class="stock-form-row">
      <span class="stock-form-label">{props.label}</span>
      <span class="stock-form-control-wrap">
        <input
          class="stock-form-control"
          value={props.value}
          readOnly
          disabled
        />
      </span>
    </label>
  );
}

function isInterTransferProductAllowed(
  productId: string,
  products: ProductOption[],
  allowLoosePalmOilInter: boolean,
): boolean {
  if (!productId) {
    return true;
  }
  const product = products.find((p) => String(p.productId) === productId);
  if (!product) {
    return false;
  }
  if (product.isBottled) {
    return false;
  }
  return product.isLoosePalmOil && allowLoosePalmOilInter;
}

interface TransfersTabProps {
  rows: TransferListRow[];
  salesPoints: SalesPointOption[];
  storageLocations: StorageLocationOption[];
  products: ProductOption[];
  onHand: StockBalanceRow[];
  scopedSalesPointId: number | null;
  canDispatch: boolean;
  canReceive: boolean;
  canCancel: boolean;
  canDraft: boolean;
  canDirectPost: boolean;
  autoGenerateTransferNo: boolean;
  transferReceiveUsesDocumentDate: boolean;
  loosePalmOilAllowInterSalesPointTransfer: boolean;
  userId: string;
  productFilter: StockProductFilter;
  onOk: (text: string) => void;
  onErr: (text: string) => void;
}

export function TransfersTab(props: TransfersTabProps) {
  const {
    rows,
    salesPoints,
    storageLocations,
    products,
    scopedSalesPointId,
    userId,
    productFilter,
    autoGenerateTransferNo,
    transferReceiveUsesDocumentDate,
    loosePalmOilAllowInterSalesPointTransfer,
  } = props;
  const receiveOnlyMode =
    !props.canDraft &&
    !props.canDirectPost &&
    !props.canDispatch &&
    props.canReceive;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormTransferMode>("inter");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [transferNo, setTransferNo] = useState("");
  const [fromSalesPointId, setFromSalesPointId] = useState<string>(
    scopedSalesPointId != null ? String(scopedSalesPointId) : "",
  );
  const [toSalesPointId, setToSalesPointId] = useState<string>("");
  const [dispatchedAt, setDispatchedAt] = useState(utcIsoDateToday());
  const [notes, setNotes] = useState("");
  const [consignedBy, setConsignedBy] = useState("");
  const [consDesign, setConsDesign] = useState("");
  const [consDate, setConsDate] = useState("");
  const [receiveBy, setReceiveBy] = useState("");
  const [receiveByDesign, setReceiveByDesign] = useState("");
  const [receiveDate, setReceiveDate] = useState("");
  const [lines, setLines] = useState<TransferLineDraft[]>(() => [
    {
      productId: "",
      qty: "",
      fromStorageLocationId: defaultLocationId(
        storageLocations,
        scopedSalesPointId ?? "",
      ),
    },
  ]);
  const [asOfOnHand, setAsOfOnHand] = useState<StockBalanceRow[]>([]);
  const [pendingCancel, setPendingCancel] = useState<TransferListRow | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [lookupNo, setLookupNo] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [reviewDetail, setReviewDetail] = useState<TransferDetail | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [receiveDetail, setReceiveDetail] = useState<TransferDetail | null>(
    null,
  );
  const [receiveLines, setReceiveLines] = useState<
    { lineId: string; toStorageLocationId: string }[]
  >([]);
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

  function closeReceiveModal() {
    clearModalMessage();
    setReceiveDetail(null);
  }

  function closeCancelModal() {
    clearModalMessage();
    setPendingCancel(null);
  }

  useEffect(() => {
    let cancelled = false;
    void getAuthenticatedFinancialYears()
      .getOpenPostingPeriod(scopedSalesPointId)
      .then((period) => {
        if (!cancelled) {
          setPostingPeriod(period);
          setDispatchedAt((current) => clampIsoDateToRange(current, period));
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

  useEffect(() => {
    if (!open) {
      setAsOfOnHand([]);
      return;
    }
    const asOfDate = dispatchedAt.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || !userId) {
      setAsOfOnHand([]);
      return;
    }
    let cancelled = false;
    const salesPointId = fromSalesPointId
      ? Number.parseInt(fromSalesPointId, 10)
      : null;
    void getElectronApi()
      .stock.listOnHandAsOf(userId, {
        asOfDate,
        salesPointId:
          salesPointId != null && Number.isFinite(salesPointId)
            ? salesPointId
            : null,
        productFilter,
      })
      .then((rows) => {
        if (!cancelled) {
          setAsOfOnHand(rows);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setAsOfOnHand([]);
          showModalErr(
            loadError instanceof Error
              ? loadError.message
              : "Could not load on-hand balances for the transfer date.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, dispatchedAt, fromSalesPointId, userId, productFilter]);

  const transferOnHand = useMemo(() => {
    if (formMode !== "inter") {
      return asOfOnHand;
    }
    const allowedProductIds = new Set(
      products
        .filter(
          (p) =>
            !p.isBottled &&
            p.isLoosePalmOil &&
            loosePalmOilAllowInterSalesPointTransfer,
        )
        .map((p) => p.productId),
    );
    return asOfOnHand.filter((row) => allowedProductIds.has(row.productId));
  }, [
    formMode,
    asOfOnHand,
    products,
    loosePalmOilAllowInterSalesPointTransfer,
  ]);

  function defaultDispatchedAt(): string {
    return clampIsoDateToRange(utcIsoDateToday(), postingPeriod);
  }

  function resetForm() {
    setEditingId(null);
    setFormMode("inter");
    setTransferNo("");
    const from = scopedSalesPointId != null ? String(scopedSalesPointId) : "";
    setFromSalesPointId(from);
    setToSalesPointId("");
    setDispatchedAt(defaultDispatchedAt());
    setNotes("");
    setConsignedBy("");
    setConsDesign("");
    setConsDate("");
    setReceiveBy("");
    setReceiveByDesign("");
    setReceiveDate("");
    setLines([
      {
        productId: "",
        qty: "",
        fromStorageLocationId: defaultLocationId(storageLocations, from),
      },
    ]);
  }

  function onFormModeChange(nextMode: FormTransferMode) {
    setFormMode(nextMode);
    if (nextMode === "intra") {
      if (fromSalesPointId) {
        setToSalesPointId(fromSalesPointId);
      }
      const defFrom = defaultLocationId(storageLocations, fromSalesPointId);
      const defTo = defaultIntraToLocationId(
        storageLocations,
        fromSalesPointId,
        defFrom,
      );
      setLines((prev) =>
        prev.map((l) => ({
          ...l,
          toStorageLocationId: resolveIntraToLocationId(
            storageLocations,
            fromSalesPointId,
            l.fromStorageLocationId || defFrom,
            l.toStorageLocationId || defTo,
          ),
        })),
      );
    } else {
      if (toSalesPointId === fromSalesPointId) {
        setToSalesPointId("");
      }
      setLines((prev) =>
        prev
          .map(({ toStorageLocationId: _to, ...line }) => {
            if (
              isInterTransferProductAllowed(
                line.productId,
                products,
                loosePalmOilAllowInterSalesPointTransfer,
              )
            ) {
              return line;
            }
            return { ...line, productId: "", qty: "" };
          }),
      );
    }
  }

  function onFromSalesPointChange(nextId: string) {
    setFromSalesPointId(nextId);
    const defFrom = defaultLocationId(storageLocations, nextId);
    if (formMode === "intra") {
      setToSalesPointId(nextId);
    }
    setLines((prev) =>
      prev.map((l) => ({
        ...l,
        productId: "",
        fromStorageLocationId: defFrom,
        ...(formMode === "intra"
          ? {
              toStorageLocationId: resolveIntraToLocationId(
                storageLocations,
                nextId,
                defFrom,
                l.toStorageLocationId,
              ),
            }
          : {}),
      })),
    );
  }

  function openReceiveDialog(detail: TransferDetail) {
    clearModalMessage();
    setReceiveDetail(detail);
    setReceiveBy(detail.receiveBy ?? "");
    setReceiveByDesign(detail.receiveByDesign ?? "");
    setReceiveDate(
      detail.receiveDate ??
        clampIsoDateToRange(utcIsoDateToday(), postingPeriod),
    );
    setReceiveLines(
      detail.lines.map((l) => ({
        lineId: l.id,
        toStorageLocationId: defaultLocationId(
          storageLocations,
          detail.toSalesPointId,
        ),
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
    if (
      postImmediately &&
      formMode === "inter" &&
      transferReceiveUsesDocumentDate &&
      !/^\d{4}-\d{2}-\d{2}$/.test(receiveDate.trim())
    ) {
      showModalErr("Receive date is required.");
      return;
    }
    setBusy(true);
    clearModalMessage();
    try {
      const fromSp = Number.parseInt(fromSalesPointId, 10);
      const toSp =
        formMode === "intra" ? fromSp : Number.parseInt(toSalesPointId, 10);
      const res = await getElectronApi().stock.saveTransfer({
        userId,
        productFilter,
        id: editingId,
        postImmediately: postImmediately && !editingId,
        ...(autoGenerateTransferNo || editingId
          ? {}
          : { transferNo: transferNo.trim() }),
        fromSalesPointId: fromSp,
        toSalesPointId: toSp,
        dispatchedAt,
        notes: notes || null,
        consignedBy: consignedBy || null,
        consDesign: consDesign || null,
        consDate: consDate || null,
        ...(formMode === "inter"
          ? {
              receiveBy: receiveBy || null,
              receiveByDesign: receiveByDesign || null,
              receiveDate: receiveDate || null,
            }
          : {}),
        lines: lines
          .filter((l) => {
            if (!l.productId || !l.qty || !l.fromStorageLocationId)
              return false;
            if (formMode === "intra") return Boolean(l.toStorageLocationId);
            if (postImmediately && !editingId) {
              return Boolean(l.toStorageLocationId);
            }
            return true;
          })
          .map((l) => ({
            productId: Number.parseInt(l.productId, 10),
            qty: l.qty,
            fromStorageLocationId: Number.parseInt(l.fromStorageLocationId, 10),
            ...(formMode === "intra" && l.toStorageLocationId
              ? {
                  toStorageLocationId: Number.parseInt(
                    l.toStorageLocationId,
                    10,
                  ),
                }
              : {}),
            ...(formMode === "inter" &&
            postImmediately &&
            !editingId &&
            l.toStorageLocationId
              ? {
                  toStorageLocationId: Number.parseInt(
                    l.toStorageLocationId,
                    10,
                  ),
                }
              : {}),
          })),
      });
      if (res.ok === false) {
        showModalErr(res.error);
        return;
      }
      if (editingId) {
        props.onOk(`Transfer ${res.documentNo} updated.`);
      } else if (postImmediately) {
        props.onOk(
          formMode === "intra"
            ? "Location move posted; balances updated."
            : "Transfer dispatched and received; balances updated.",
        );
      } else {
        props.onOk(`Transfer ${res.documentNo} drafted.`);
      }
      closeFormModal();
      resetForm();
    } finally {
      setBusy(false);
    }
  }

  function reportActionErr(documentId: string, text: string) {
    if (reviewDetail?.id === documentId) {
      showModalErr(text);
    } else {
      props.onErr(text);
    }
  }

  async function onPost(id: string) {
    setBusy(true);
    clearModalMessage();
    try {
      const res = await getElectronApi().stock.postInternalTransfer({
        userId,
        productFilter,
        transferId: id,
      });
      if (res.ok === false) {
        reportActionErr(id, res.error);
        return;
      }
      props.onOk("Location move posted; balances updated.");
      if (reviewDetail?.id === id) closeReviewModal();
    } finally {
      setBusy(false);
    }
  }

  async function onDispatch(id: string) {
    setBusy(true);
    clearModalMessage();
    try {
      const res = await getElectronApi().stock.dispatchTransfer({
        userId,
        productFilter,
        transferId: id,
      });
      if (res.ok === false) {
        reportActionErr(id, res.error);
        return;
      }
      props.onOk("Transfer dispatched; source balance updated.");
      if (reviewDetail?.id === id) closeReviewModal();
    } finally {
      setBusy(false);
    }
  }

  async function openReceiveById(id: string) {
    setReviewBusy(true);
    try {
      const res = await getElectronApi().stock.loadTransferForReview({
        userId,
        transferId: id,
      });
      if (res.ok === false) {
        props.onErr(res.error);
        return;
      }
      openReceiveDialog(res.detail);
    } finally {
      setReviewBusy(false);
    }
  }

  async function onReceiveSubmit(event: Event) {
    event.preventDefault();
    if (!receiveDetail || busy) return;
    if (
      transferReceiveUsesDocumentDate &&
      !/^\d{4}-\d{2}-\d{2}$/.test(receiveDate.trim())
    ) {
      showModalErr("Receive date is required.");
      return;
    }
    setBusy(true);
    clearModalMessage();
    try {
      const res = await getElectronApi().stock.receiveTransfer({
        userId,
        productFilter,
        transferId: receiveDetail.id,
        lines: receiveLines
          .filter((l) => l.toStorageLocationId)
          .map((l) => ({
            lineId: l.lineId,
            toStorageLocationId: Number.parseInt(l.toStorageLocationId, 10),
          })),
        receiveBy: receiveBy || null,
        receiveByDesign: receiveByDesign || null,
        receiveDate: receiveDate || null,
      });
      if (res.ok === false) {
        showModalErr(res.error);
        return;
      }
      props.onOk("Transfer received; destination balance updated.");
      const receivedId = receiveDetail.id;
      closeReceiveModal();
      if (reviewDetail?.id === receivedId) closeReviewModal();
    } finally {
      setBusy(false);
    }
  }

  async function onCancelTransfer() {
    if (!pendingCancel) return;
    const id = pendingCancel.id;
    setBusy(true);
    clearModalMessage();
    try {
      const res = await getElectronApi().stock.cancelTransfer({
        userId,
        productFilter,
        transferId: id,
      });
      if (res.ok === false) {
        showModalErr(res.error);
        return;
      }
      props.onOk("Transfer cancelled.");
      closeCancelModal();
      if (reviewDetail?.id === id) closeReviewModal();
    } finally {
      setBusy(false);
    }
  }

  async function openReviewById(id: string) {
    setReviewBusy(true);
    try {
      const res = await getElectronApi().stock.loadTransferForReview({
        userId,
        transferId: id,
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

  function populateFormFromDetail(detail: TransferDetail) {
    const intra = detail.transferMode === "INTRA_SALES_POINT";
    setEditingId(detail.id);
    setTransferNo(detail.transferNo);
    setFormMode(intra ? "intra" : "inter");
    setFromSalesPointId(String(detail.fromSalesPointId));
    setToSalesPointId(String(detail.toSalesPointId));
    const rawDate = detail.dispatchedAtIso
      ? detail.dispatchedAtIso.length > 10
        ? detail.dispatchedAtIso.slice(0, 10)
        : detail.dispatchedAtIso
      : utcIsoDateToday();
    setDispatchedAt(clampIsoDateToRange(rawDate, postingPeriod));
    setNotes(detail.notes ?? "");
    setConsignedBy(detail.consignedBy ?? "");
    setConsDesign(detail.consDesign ?? "");
    setConsDate(detail.consDate ?? "");
    setReceiveBy(detail.receiveBy ?? "");
    setReceiveByDesign(detail.receiveByDesign ?? "");
    setReceiveDate(detail.receiveDate ?? "");
    const defFrom = defaultLocationId(
      storageLocations,
      detail.fromSalesPointId,
    );
    const defTo = defaultIntraToLocationId(
      storageLocations,
      String(detail.fromSalesPointId),
      defFrom,
    );
    setLines(
      detail.lines.length > 0
        ? detail.lines.map((l) => ({
            productId: String(l.productId),
            qty: l.qty,
            fromStorageLocationId: String(l.fromStorageLocationId),
            ...(intra
              ? {
                  toStorageLocationId: resolveIntraToLocationId(
                    storageLocations,
                    String(detail.fromSalesPointId),
                    String(l.fromStorageLocationId),
                    l.toStorageLocationId
                      ? String(l.toStorageLocationId)
                      : defTo,
                  ),
                }
              : {}),
          }))
        : [
            {
              productId: "",
              qty: "",
              fromStorageLocationId: defFrom,
              ...(intra ? { toStorageLocationId: defTo } : {}),
            },
          ],
    );
    setOpen(true);
  }

  async function openEditById(id: string) {
    setReviewBusy(true);
    const fromReview = reviewDetail?.id === id;
    try {
      const res = await getElectronApi().stock.loadTransferForReview({
        userId,
        transferId: id,
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
        const text = "Only draft transfers can be edited.";
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
      const res = await getElectronApi().stock.findTransferByNumber({
        userId,
        transferNo: n,
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

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return rows;
    }
    return rows.filter((r) => {
      const blob = [
        r.transferNo,
        r.fromSalesPointName,
        r.toSalesPointName,
        r.locationSummary ?? "",
        r.productSummary ?? "",
        STOCK_DOC_STATUS_LABELS[r.status],
        TRANSFER_MODE_LABELS[r.transferMode],
        r.createdByName,
        r.dispatchedByName ?? "",
        r.receivedByName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search]);

  return (
    <section class="stock-section">
      <div class="stock-section-header">
        <div>
          <h2>Stock transfers</h2>
        </div>
        <div class="stock-header-actions">
          {props.canDispatch ? (
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
                placeholder="ST-2026-000001"
                class="stock-lookup-input"
                aria-label="Transfer number"
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
              New transfer
            </button>
          ) : null}
        </div>
      </div>

      <div class="stock-filters">
        <label class="stock-field">
          <input
            value={search}
            onInput={(event) =>
              setSearch((event.currentTarget as HTMLInputElement).value)
            }
            placeholder="Search Transfer #, product, collection point, or status"
            aria-label="Search"
          />
        </label>
      </div>

      <div class="stock-table-wrap">
        <table class="stock-table">
          <thead>
            <tr>
              <th>Transfer #</th>
              <th>Type</th>
              <th>From</th>
              <th>To</th>
              <th class="stock-num">Total qty</th>
              <th>Status</th>
              <th class="stock-actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} class="stock-empty-cell">
                  No transfers recorded yet.
                  {props.canDraft || props.canDirectPost ? (
                    <>
                      {" "}
                      Use <span class="stock-strong">New transfer</span> to
                      create one.
                    </>
                  ) : null}
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} class="stock-empty-cell">
                  No transfers match your search.
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const intra = isIntraRow(r);
                const isSourceUser =
                  scopedSalesPointId == null ||
                  scopedSalesPointId === r.fromSalesPointId;
                const isDestUser =
                  scopedSalesPointId == null ||
                  scopedSalesPointId === r.toSalesPointId;
                return (
                  <tr key={r.id}>
                    <td class="stock-mono">{r.transferNo}</td>
                    <td>{TRANSFER_MODE_LABELS[r.transferMode]}</td>
                    <td>{r.fromSalesPointName}</td>
                    <td>
                      {intra ? (r.locationSummary ?? "—") : r.toSalesPointName}
                    </td>
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
                        {r.status === "DRAFT" &&
                        props.canDraft &&
                        isSourceUser ? (
                          <StockRowActionButton
                            disabled={busy || reviewBusy}
                            title="Correct draft"
                            onClick={() => void openEditById(r.id)}
                          >
                            <IconPencil /> Edit
                          </StockRowActionButton>
                        ) : null}
                        {r.status === "DRAFT" &&
                        props.canDispatch &&
                        isSourceUser &&
                        intra ? (
                          <StockRowActionButton
                            disabled={busy}
                            onClick={() => void onPost(r.id)}
                          >
                            <IconCheck /> Post
                          </StockRowActionButton>
                        ) : null}
                        {r.status === "DISPATCHED" &&
                        props.canReceive &&
                        isDestUser &&
                        !intra ? (
                          <StockRowActionButton
                            disabled={busy}
                            onClick={() => void openReceiveById(r.id)}
                          >
                            <IconPackageIn /> Receive
                          </StockRowActionButton>
                        ) : null}
                        {(r.status === "DRAFT" && props.canDraft) ||
                        ((r.status === "DISPATCHED" ||
                          r.status === "RECEIVED") &&
                          props.canCancel) ? (
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {filteredRows.length > 0 ? (
        <p class="stock-hint">
          Showing {filteredRows.length} transfer
          {filteredRows.length === 1 ? "" : "s"}.
        </p>
      ) : null}

      {open ? (
        <DocDialog
          title={editingId ? "Edit transfer" : "New transfer"}
          wide
          message={!pendingCancel && !receiveDetail && !reviewDetail ? modalMessage : null}
          onClose={closeFormModal}
        >
          <form
            onSubmit={(event) => void onSave(event, false)}
            class="stock-form"
          >
            {!autoGenerateTransferNo && !editingId ? (
              <label class="stock-form-row">
                <span class="stock-form-label">V.C. Number</span>
                <span class="stock-form-control-wrap">
                  <input
                    class="stock-form-control stock-mono"
                    value={transferNo}
                    onInput={(event) =>
                      setTransferNo(
                        (event.currentTarget as HTMLInputElement).value,
                      )
                    }
                    placeholder="ST-2026-000001"
                    required
                  />
                </span>
              </label>
            ) : null}
            {!autoGenerateTransferNo && editingId ? (
              <label class="stock-form-row">
                <span class="stock-form-label">V.C. Number</span>
                <span class="stock-form-control-wrap">
                  <input
                    class="stock-form-control stock-mono"
                    value={transferNo}
                    readOnly
                    disabled
                  />
                </span>
              </label>
            ) : null}
            <div class="stock-form-row">
              <span class="stock-form-label">Transfer type</span>
              <div class="stock-form-control-wrap">
                <select
                  class="stock-form-control"
                  value={formMode}
                  onChange={(event) =>
                    onFormModeChange(
                      (event.currentTarget as HTMLSelectElement)
                        .value as FormTransferMode,
                    )
                  }
                >
                  <option value="inter">Between collection points</option>
                  <option value="intra">Within collection point</option>
                </select>
              </div>
            </div>
            {formMode === "inter" ? (
              <p class="stock-form-hint">
                Between collection points: bottled products only. Loose Palm Oil
                requires the company setting or use{" "}
                <strong>Within collection point</strong>.
              </p>
            ) : null}

            {formMode === "inter" ? (
              <div class="stock-form-endpoints">
                <span class="stock-form-label">From</span>
                <span class="stock-form-control-wrap">
                  <select
                    class="stock-form-control"
                    value={fromSalesPointId}
                    onChange={(event) =>
                      onFromSalesPointChange(
                        (event.currentTarget as HTMLSelectElement).value,
                      )
                    }
                    required
                    disabled={scopedSalesPointId != null}
                  >
                    <option value="">Select collection point</option>
                    {salesPoints.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span class="stock-form-label">To</span>
                <span class="stock-form-control-wrap">
                  <select
                    class="stock-form-control"
                    value={toSalesPointId}
                    onChange={(event) =>
                      setToSalesPointId(
                        (event.currentTarget as HTMLSelectElement).value,
                      )
                    }
                    required
                  >
                    <option value="">Select collection point</option>
                    {salesPoints
                      .filter((sp) => String(sp.id) !== fromSalesPointId)
                      .map((sp) => (
                        <option key={sp.id} value={sp.id}>
                          {sp.name}
                        </option>
                      ))}
                  </select>
                </span>
              </div>
            ) : (
              <label class="stock-form-row">
                <span class="stock-form-label">Collection point</span>
                <span class="stock-form-control-wrap">
                  <select
                    class="stock-form-control"
                    value={fromSalesPointId}
                    onChange={(event) =>
                      onFromSalesPointChange(
                        (event.currentTarget as HTMLSelectElement).value,
                      )
                    }
                    required
                    disabled={scopedSalesPointId != null}
                  >
                    <option value="">Select collection point</option>
                    {salesPoints.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            )}

            <label class="stock-form-row">
              <span class="stock-form-label">
                {formMode === "intra" ? "Move date" : "Date"}
              </span>
              <span class="stock-form-control-wrap">
                <input
                  type="date"
                  class="stock-form-control"
                  value={dispatchedAt}
                  min={postingPeriod?.startDate}
                  max={postingPeriod?.endDate}
                  disabled={!postingPeriod}
                  onInput={(event) =>
                    setDispatchedAt(
                      clampIsoDateToRange(
                        (event.currentTarget as HTMLInputElement).value,
                        postingPeriod,
                      ),
                    )
                  }
                  required
                />
                {/*  {!postingPeriod ? (
                  <span class="stock-form-hint">
                    Open a financial month to set the move date.
                  </span>
                ) : (
                  <span class="stock-form-hint">
                    Open month: {postingPeriod.monthName}{" "}
                    {postingPeriod.financialYear}
                  </span>
                )} */}
              </span>
            </label>
            <label class="stock-form-row">
              <span class="stock-form-label">Description</span>
              <span class="stock-form-control-wrap">
                <input
                  class="stock-form-control"
                  value={notes}
                  onInput={(event) =>
                    setNotes((event.currentTarget as HTMLInputElement).value)
                  }
                />
              </span>
            </label>

            <TransferLineEditor
              products={products}
              lines={lines}
              onChange={setLines}
              mode={formMode}
              fromSalesPointId={fromSalesPointId}
              onHand={transferOnHand}
              asOfDate={dispatchedAt.trim().slice(0, 10)}
              requireDestinationLocation={
                props.canDirectPost && formMode === "inter" && !editingId
              }
              fromLocationOptions={locationsForSalesPoint(
                storageLocations,
                fromSalesPointId,
              )}
              toLocationOptions={
                formMode === "intra"
                  ? locationsForIntraTransferDestination(
                      storageLocations,
                      fromSalesPointId,
                    )
                  : locationsForSalesPoint(storageLocations, toSalesPointId)
              }
              defaultFromLocationId={defaultLocationId(
                storageLocations,
                fromSalesPointId,
              )}
              defaultToLocationId={
                formMode === "intra"
                  ? defaultIntraToLocationId(
                      storageLocations,
                      fromSalesPointId,
                      defaultLocationId(storageLocations, fromSalesPointId),
                    )
                  : defaultToLocationId(
                      storageLocations,
                      toSalesPointId,
                      defaultLocationId(storageLocations, fromSalesPointId),
                    )
              }
            />

            {formMode === "inter" ? (
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
                    <span class="stock-form-label">
                      Date
                      {transferReceiveUsesDocumentDate ? " *" : ""}
                    </span>
                    <span class="stock-form-control-wrap">
                      <input
                        type="date"
                        class="stock-form-control"
                        value={receiveDate}
                        min={postingPeriod?.startDate}
                        max={postingPeriod?.endDate}
                        disabled={!postingPeriod}
                        required={transferReceiveUsesDocumentDate}
                        onInput={(event) =>
                          setReceiveDate(
                            clampIsoDateToRange(
                              (event.currentTarget as HTMLInputElement).value,
                              postingPeriod,
                            ),
                          )
                        }
                      />
                      {transferReceiveUsesDocumentDate ? (
                        <span class="stock-hint">
                          This date posts destination stock (open month).
                        </span>
                      ) : null}
                    </span>
                  </label>
                </div>
              </div>
            ) : null}

            {formMode === "intra" &&
            fromSalesPointId &&
            locationsForIntraTransferDestination(
              storageLocations,
              fromSalesPointId,
            ).length < 2 ? (
              <p class="stock-hint stock-hint-warn">
                Add at least two storage locations for this collection point to
                move stock between bins.
              </p>
            ) : null}

            

            {open &&
            fromSalesPointId &&
            asOfOnHand.length === 0 &&
            /^\d{4}-\d{2}-\d{2}$/.test(dispatchedAt.trim().slice(0, 10)) ? (
              <p class="stock-hint">
                No sellable stock at the selected collection point for this date.
                Choose another source location or check on-hand balances.
              </p>
            ) : null}

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
                      Post transfer
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
              ? "Delete this transfer?"
              : "Cancel transfer?"
          }
          description={
            pendingCancel.status === "DRAFT"
              ? `Draft transfer ${pendingCancel.transferNo} will be removed.`
              : `Transfer ${pendingCancel.transferNo} is ${STOCK_DOC_STATUS_LABELS[pendingCancel.status].toLowerCase()}. Cancelling writes compensating movements to reverse every line.`
          }
          confirmLabel={
            pendingCancel.status === "DRAFT" ? "Delete" : "Cancel transfer"
          }
          busy={busy}
          message={modalMessage}
          onCancel={closeCancelModal}
          onConfirm={onCancelTransfer}
        />
      ) : null}

      {reviewDetail && !printOpen ? (
        <DocDialog
          title={`Review transfer ${reviewDetail.transferNo}`}
          wide
          message={
            !pendingCancel && !receiveDetail ? modalMessage : null
          }
          onClose={closeReviewModal}
        >
          <div class="stock-form">
            <div class="stock-form-row">
              <span class="stock-form-label">Status</span>
              <span class="stock-form-control-wrap stock-form-control-wrap-inline">
                <StatusBadge status={reviewDetail.status} />
              </span>
            </div>

            <ReviewReadonlyField
              label="Consignment #"
              value={reviewDetail.transferNo}
            />

            <ReviewReadonlyField
              label="Transfer type"
              value={
                isIntraRow(reviewDetail)
                  ? "Within collection point"
                  : "Between collection points"
              }
            />

            {isIntraRow(reviewDetail) ? (
              <label class="stock-form-row">
                <span class="stock-form-label">Collection point</span>
                <span class="stock-form-control-wrap">
                  <input
                    class="stock-form-control"
                    value={reviewDetail.fromSalesPointName}
                    readOnly
                    disabled
                  />
                  {reviewDetail.locationSummary ? (
                    <span class="stock-form-hint">
                      {reviewDetail.locationSummary}
                    </span>
                  ) : null}
                </span>
              </label>
            ) : (
              <div class="stock-form-endpoints">
                <span class="stock-form-label">From</span>
                <span class="stock-form-control-wrap">
                  <input
                    class="stock-form-control"
                    value={reviewDetail.fromSalesPointName}
                    readOnly
                    disabled
                  />
                </span>
                <span class="stock-form-label">To</span>
                <span class="stock-form-control-wrap">
                  <input
                    class="stock-form-control"
                    value={reviewDetail.toSalesPointName}
                    readOnly
                    disabled
                  />
                </span>
              </div>
            )}

            <ReviewReadonlyField
              label={isIntraRow(reviewDetail) ? "Move date" : "Date"}
              value={formatDate(reviewDetail.dispatchedAtIso)}
            />

            <ReviewReadonlyField
              label="Description"
              value={reviewDetail.notes?.trim() || "—"}
            />

            {!isIntraRow(reviewDetail) ? (
              <div class="stock-transfer-signatures">
                <div class="stock-transfer-signature-col">
                  <ReviewReadonlyField
                    label="Consigned by"
                    value={reviewDetail.consignedBy ?? ""}
                  />
                  <ReviewReadonlyField
                    label="Designation"
                    value={reviewDetail.consDesign ?? ""}
                  />
                  <ReviewReadonlyField
                    label="Date"
                    value={formatDate(reviewDetail.consDate)}
                  />
                </div>
                <div class="stock-transfer-signature-col">
                  <ReviewReadonlyField
                    label="Received by"
                    value={reviewDetail.receiveBy ?? ""}
                  />
                  <ReviewReadonlyField
                    label="Designation"
                    value={reviewDetail.receiveByDesign ?? ""}
                  />
                  <ReviewReadonlyField
                    label="Date"
                    value={formatDate(reviewDetail.receiveDate)}
                  />
                </div>
              </div>
            ) : null}

            <ReviewLineTable lines={reviewDetail.lines} />

            <div class="stock-form-audit">
              <p>
                Drafted by {reviewDetail.createdByName}
                {" · "}
                {formatDateTime(reviewDetail.createdAtIso)}
              </p>
              {reviewDetail.dispatchedByName ? (
                <p>
                  Validated by {reviewDetail.dispatchedByName}
                  {reviewDetail.dispatchedAtIso
                    ? ` · ${formatDateTime(reviewDetail.dispatchedAtIso)}`
                    : ""}
                </p>
              ) : null}
              {reviewDetail.receivedByName ? (
                <p>
                  Received in system by {reviewDetail.receivedByName}
                  {reviewDetail.receivedAtIso
                    ? ` · ${formatDateTime(reviewDetail.receivedAtIso)}`
                    : ""}
                </p>
              ) : null}
            </div>

            <div class="stock-modal-actions">
              <button
                type="button"
                class="stock-btn-secondary"
                onClick={closeReviewModal}
              >
                Close
              </button>
              {productFilter === "bottled" ? (
                <button
                  type="button"
                  class="stock-btn-secondary"
                  onClick={() => setPrintOpen(true)}
                >
                  Print transfer
                </button>
              ) : null}
              {(reviewDetail.status === "DRAFT" && props.canDraft) ||
              ((reviewDetail.status === "DISPATCHED" ||
                reviewDetail.status === "RECEIVED") &&
                props.canCancel) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPendingCancel(reviewDetail)}
                  class="stock-btn-danger"
                >
                  {reviewDetail.status === "DRAFT"
                    ? "Delete draft"
                    : "Cancel transfer"}
                </button>
              ) : null}
              {reviewDetail.status === "DRAFT" &&
              props.canDraft &&
              (scopedSalesPointId == null ||
                scopedSalesPointId === reviewDetail.fromSalesPointId) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openEditById(reviewDetail.id)}
                  class="stock-btn-secondary"
                  title="Correct the draft before dispatching"
                >
                  Edit draft
                </button>
              ) : null}
              {reviewDetail.status === "DRAFT" &&
              props.canDispatch &&
              (scopedSalesPointId == null ||
                scopedSalesPointId === reviewDetail.fromSalesPointId) &&
              isIntraRow(reviewDetail) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onPost(reviewDetail.id)}
                  class="stock-btn-primary"
                >
                  Post location move
                </button>
              ) : null}
              {reviewDetail.status === "DRAFT" &&
              props.canDispatch &&
              (scopedSalesPointId == null ||
                scopedSalesPointId === reviewDetail.fromSalesPointId) &&
              !isIntraRow(reviewDetail) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onDispatch(reviewDetail.id)}
                  class="stock-btn-primary"
                >
                  Validate
                </button>
              ) : null}
              {reviewDetail.status === "DISPATCHED" &&
              props.canReceive &&
              (scopedSalesPointId == null ||
                scopedSalesPointId === reviewDetail.toSalesPointId) &&
              !isIntraRow(reviewDetail) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => openReceiveDialog(reviewDetail)}
                  class="stock-btn-primary"
                >
                  Receive transfer
                </button>
              ) : null}
            </div>
          </div>
        </DocDialog>
      ) : null}

      {receiveDetail ? (
        <DocDialog
          title={`Receive transfer ${receiveDetail.transferNo}`}
          wide
          message={!pendingCancel ? modalMessage : null}
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
                {transferReceiveUsesDocumentDate ? " *" : ""}
              </span>
              <span class="stock-form-control-wrap">
                <input
                  type="date"
                  class="stock-form-control"
                  value={receiveDate}
                  min={postingPeriod?.startDate}
                  max={postingPeriod?.endDate}
                  disabled={!postingPeriod}
                  required={transferReceiveUsesDocumentDate}
                  onInput={(event) =>
                    setReceiveDate(
                      clampIsoDateToRange(
                        (event.currentTarget as HTMLInputElement).value,
                        postingPeriod,
                      ),
                    )
                  }
                />
                {transferReceiveUsesDocumentDate ? (
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
                      (l) => l.lineId === line.id,
                    );
                    const toLocationOptions = locationsForSalesPoint(
                      storageLocations,
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
                                prev.map((l) =>
                                  l.lineId === line.id
                                    ? { ...l, toStorageLocationId: value }
                                    : l,
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

      {printOpen && reviewDetail ? (
        <TransferPrintView
          transferId={reviewDetail.id}
          userId={userId}
          onClose={() => setPrintOpen(false)}
        />
      ) : null}
    </section>
  );
}
