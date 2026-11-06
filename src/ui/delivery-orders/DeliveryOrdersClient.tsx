import { useEffect, useMemo, useState } from "preact/hooks";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type { AuthUser } from "../auth/session.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import { canPerformActionFromSnapshot } from "../../shared/permissionUtils.ts";
import type {
  DeliveryOrdersFormOptions,
  DeliveryOrdersPaymentMethodOption,
  DeliveryOrderTaxPreview,
  PendingDeliveryOrderRow,
} from "./types.ts";
import {
  isValidBookletSerial,
  validateBookletSerial,
} from "../../shared/bookletSerial.ts";
import { useServerConnectivity } from "../hooks/useServerConnectivity.ts";
import "../sales/sales.css";
import "./deliveryOrders.css";

function clampDateToPeriod(
  isoDate: string,
  period: OpenPostingPeriod | null,
): string {
  if (!period) return isoDate;
  if (isoDate < period.startDate) return period.startDate;
  if (isoDate > period.endDate) return period.endDate;
  return isoDate;
}

interface DeliveryOrdersClientProps {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  initialLookupNo?: string;
  /** Close the hosting modal (list refresh is handled by the parent). */
  onClose?: () => void;
}

type LineRow = {
  productId: string;
  orderQty: string;
  orderUnit: string;
  unitPrice: string;
};

type PaymentRow = {
  paymentMethodId: string;
  paymentDate: string;
  chequeNo: string;
  bank: string;
  cashReceiptNo: string;
  receiptDate: string;
  traiteNo: string;
  traiteIssuedOn: string;
  traiteMaturityOn: string;
};

function paymentsMissingTraiteDetails(
  payments: PaymentRow[],
  methods: DeliveryOrdersPaymentMethodOption[],
): boolean {
  return payments.some((payment) => {
    if (!payment.paymentMethodId.trim()) {
      return false;
    }
    const method = methods.find((item) => item.id === payment.paymentMethodId);
    if (method?.kind !== "TRAITE") {
      return false;
    }
    return (
      !payment.traiteNo.trim() ||
      !payment.traiteIssuedOn.trim() ||
      !payment.traiteMaturityOn.trim()
    );
  });
}

function emptyPaymentExtras(): Pick<
  PaymentRow,
  | "chequeNo"
  | "bank"
  | "cashReceiptNo"
  | "receiptDate"
  | "traiteNo"
  | "traiteIssuedOn"
  | "traiteMaturityOn"
> {
  return {
    chequeNo: "",
    bank: "",
    cashReceiptNo: "",
    receiptDate: "",
    traiteNo: "",
    traiteIssuedOn: "",
    traiteMaturityOn: "",
  };
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyPayment(): PaymentRow {
  return {
    paymentMethodId: "",
    paymentDate: todayIsoDate(),
    ...emptyPaymentExtras(),
  };
}

function parseDec(value: string): number {
  const parsed = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmount(value: number): string {
  return Math.round(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function statusPillClass(status: string | null): string {
  if (status === "VALIDATED") return "sales-status-pill is-validated";
  if (status === "REJECTED") return "sales-status-pill is-rejected";
  if (status === "PENDING") return "sales-status-pill is-pending";
  return "sales-status-pill";
}

export function DeliveryOrdersClient({
  user,
  permissions,
  initialLookupNo = "",
  onClose,
}: DeliveryOrdersClientProps) {
  const { mutationsBlocked } = useServerConnectivity();
  const [options, setOptions] = useState<DeliveryOrdersFormOptions | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [orderId, setOrderId] = useState<number | string | null>(null);
  const [deliveryOrderNo, setDeliveryOrderNo] = useState(initialLookupNo);
  const [confirmedDeliveryOrderNo, setConfirmedDeliveryOrderNo] = useState<
    string | null
  >(null);
  const [docStatus, setDocStatus] = useState<string | null>(null);
  const [validatedByName, setValidatedByName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dateIssued, setDateIssued] = useState(todayIsoDate());
  const [postingPeriod, setPostingPeriod] = useState<OpenPostingPeriod | null>(
    null,
  );
  const [orderRef, setOrderRef] = useState("");
  const [salesPointId, setSalesPointId] = useState("");
  const [lines, setLines] = useState<LineRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([emptyPayment()]);
  const [pendingDos, setPendingDos] = useState<PendingDeliveryOrderRow[]>([]);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [taxPreview, setTaxPreview] = useState<DeliveryOrderTaxPreview | null>(
    null,
  );
  const [taxPreviewError, setTaxPreviewError] = useState<string | null>(null);
  const [linePriceErrors, setLinePriceErrors] = useState<
    Record<number, string>
  >({});
  const [lineOnHand, setLineOnHand] = useState<Record<number, string>>({});
  const [allowAutoUnitPrice, setAllowAutoUnitPrice] = useState(true);
  const [bookletStatus, setBookletStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const isReadOnly = docStatus === "VALIDATED" || docStatus === "REJECTED";
  const autoGenerateDeliveryOrderNo =
    options?.autoGenerateDeliveryOrderNo === true;
  const orderReady =
    orderId != null ||
    autoGenerateDeliveryOrderNo ||
    (confirmedDeliveryOrderNo !== null &&
      confirmedDeliveryOrderNo === deliveryOrderNo.trim() &&
      isValidBookletSerial(deliveryOrderNo));
  const isAwaitingOrder = !orderId && !orderReady;
  const isFormEditable = !isReadOnly && orderReady;
  const canValidate = canPerformActionFromSnapshot(
    permissions,
    "validate_delivery_orders",
  );
  const paymentMethods = useMemo(
    () => options?.paymentMethods ?? [],
    [options],
  );

  const lineSummaries = useMemo(() => {
    const vatRate = taxPreview ? parseDec(taxPreview.vatRate) : 0;
    const otherRate = taxPreview ? parseDec(taxPreview.otherRate) : 0;

    return lines.map((line) => {
      const qty = Number.parseInt(line.orderQty, 10) || 0;
      const unit = parseDec(line.unitPrice);
      const net = Math.round(qty * unit * 100) / 100;
      const vat = Math.round(net * vatRate * 100) / 100;
      const other = Math.round(net * otherRate * 100) / 100;
      const total = Math.round((net + vat + other) * 100) / 100;
      return { net, vat, other, total };
    });
  }, [lines, taxPreview]);

  const totalsPreview = useMemo(
    () =>
      lineSummaries.reduce(
        (acc, summary) => ({
          net: acc.net + summary.net,
          vat: acc.vat + summary.vat,
          other: acc.other + summary.other,
          total: acc.total + summary.total,
        }),
        { net: 0, vat: 0, other: 0, total: 0 },
      ),
    [lineSummaries],
  );

  function emptyLine(): LineRow {
    return { productId: "", orderQty: "0", orderUnit: "kg", unitPrice: "" };
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        const [formOptions, period] = await Promise.all([
          getElectronApi().deliveryOrders.getFormOptions(user.id),
          getAuthenticatedFinancialYears().getOpenPostingPeriod(),
        ]);
        setOptions(formOptions);
        setPostingPeriod(period);
        setDateIssued((current) => clampDateToPeriod(current, period));
        setCustomerId("");
        setSalesPointId(
          formOptions.scopedSalesPointId != null
            ? String(formOptions.scopedSalesPointId)
            : "",
        );
        setLines(formOptions.products.length > 0 ? [emptyLine()] : []);
        setPayments([emptyPayment()]);
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load delivery order options.",
        );
      }
    }

    void bootstrap();
  }, [user.id]);

  useEffect(() => {
    if (initialLookupNo.trim()) {
      void loadOrder(initialLookupNo.trim());
    }
  }, [initialLookupNo]);

  useEffect(() => {
    if (!canValidate) {
      setPendingDos([]);
      return;
    }

    void getElectronApi()
      .deliveryOrders.listPending()
      .then(setPendingDos)
      .catch(() => setPendingDos([]));
  }, [canValidate, orderId]);

  useEffect(() => {
    if (!customerId) {
      setTaxPreview(null);
      setTaxPreviewError(null);
      return;
    }

    let cancelled = false;
    void getElectronApi()
      .deliveryOrders.previewTaxes({
        customerId: Number.parseInt(customerId, 10),
        dateIssued,
      })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok === false) {
          setTaxPreview(null);
          setTaxPreviewError(result.error);
          return;
        }
        setTaxPreview(result.preview);
        setTaxPreviewError(null);
      });

    return () => {
      cancelled = true;
    };
  }, [customerId, dateIssued]);

  useEffect(() => {
    if (!allowAutoUnitPrice || !customerId || !options) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const errors: Record<number, string> = {};
      const prices: Record<number, string> = {};

      await Promise.all(
        lines.map(async (line, index) => {
          const productId = Number.parseInt(line.productId, 10);
          if (!Number.isFinite(productId)) {
            return;
          }

          const result = await getElectronApi().deliveryOrders.previewUnitPrice(
            {
              customerId: Number.parseInt(customerId, 10),
              productId,
              dateIssued,
              orderQty: line.orderQty,
            },
          );

          if (cancelled) {
            return;
          }

          if (result.ok === false) {
            errors[index] = result.error;
            return;
          }
          prices[index] = result.unitPriceExTax;
        }),
      );

      if (cancelled) {
        return;
      }

      setLinePriceErrors(errors);
      setLines((current) =>
        current.map((line, index) =>
          prices[index] != null ? { ...line, unitPrice: prices[index]! } : line,
        ),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [
    allowAutoUnitPrice,
    customerId,
    dateIssued,
    lines.map((l) => `${l.productId}:${l.orderQty}`).join(","),
  ]);

  useEffect(() => {
    const spId = Number.parseInt(salesPointId, 10);
    if (!Number.isFinite(spId)) {
      setLineOnHand({});
      return;
    }

    let cancelled = false;
    void (async () => {
      const next: Record<number, string> = {};
      await Promise.all(
        lines.map(async (line, index) => {
          const productId = Number.parseInt(line.productId, 10);
          if (!Number.isFinite(productId)) {
            return;
          }

          const result =
            await getElectronApi().deliveryOrders.previewStockOnHand({
              salesPointId: spId,
              productId,
            });

          if (!cancelled && result.ok) {
            next[index] = result.onHand;
          }
        }),
      );

      if (!cancelled) {
        setLineOnHand(next);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [salesPointId, lines.map((l) => l.productId).join(",")]);

  useEffect(() => {
    if (
      autoGenerateDeliveryOrderNo ||
      orderId ||
      !confirmedDeliveryOrderNo ||
      !salesPointId ||
      !options?.enforceDeliveryOrderBookletValidation
    ) {
      setBookletStatus(null);
      return;
    }

    const spId = Number.parseInt(salesPointId, 10);
    if (!Number.isFinite(spId)) {
      setBookletStatus(null);
      return;
    }

    let cancelled = false;
    getElectronApi()
      .booklets.validateSerial({
        documentKind: "DELIVERY_ORDER",
        serial: confirmedDeliveryOrderNo,
        salesPointId: spId,
      })
      .then((res) => {
        if (!cancelled) {
          if (res.ok) {
            setBookletStatus({
              ok: true,
              message: res.bookletCode
                ? `Active booklet: ${res.bookletCode}`
                : "Active booklet verified",
            });
          } else {
            setBookletStatus({ ok: false, message: res.error });
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBookletStatus(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    autoGenerateDeliveryOrderNo,
    orderId,
    confirmedDeliveryOrderNo,
    salesPointId,
    options?.enforceDeliveryOrderBookletValidation,
  ]);

  function resetNew() {
    if (!options) {
      return;
    }

    setOrderId(null);
    setDeliveryOrderNo("");
    setConfirmedDeliveryOrderNo(null);
    setDocStatus(null);
    setValidatedByName("");
    setCustomerId("");
    setDateIssued(todayIsoDate());
    setOrderRef("");
    setSalesPointId(
      options.scopedSalesPointId != null
        ? String(options.scopedSalesPointId)
        : "",
    );
    setLines(options.products.length > 0 ? [emptyLine()] : []);
    setPayments([emptyPayment()]);
    setAllowAutoUnitPrice(true);
    setLinePriceErrors({});
    setBanner(null);
  }

  useEffect(() => {
    if (!options || !isFormEditable || options.scopedSalesPointId == null) {
      return;
    }
    setSalesPointId(String(options.scopedSalesPointId));
  }, [options, isFormEditable]);

  async function loadOrder(
    rawNo?: string,
    loadOptions?: { notFoundMode?: "error" | "silent" },
  ) {
    const notFoundMode = loadOptions?.notFoundMode ?? "error";
    const no = (rawNo ?? deliveryOrderNo).trim();
    if (!no) {
      return;
    }

    setBusy("load");
    setBanner(null);

    try {
      const data = await getElectronApi().deliveryOrders.loadByNo(no, user.id);
      if (!data) {
        if (notFoundMode === "error") {
          setBanner({ type: "error", text: "Delivery order not found." });
        } else {
          setOrderId(null);
          setDocStatus(null);
          setValidatedByName("");
          setConfirmedDeliveryOrderNo(no);
        }
        return;
      }

      setOrderId(data.id);
      setDeliveryOrderNo(data.deliveryOrderNo);
      setConfirmedDeliveryOrderNo(data.deliveryOrderNo);
      setDocStatus(data.status);
      setValidatedByName(data.validatedByName ?? "");
      setCustomerId(String(data.customerId));
      setDateIssued(data.dateIssued);
      setOrderRef(data.orderRef ?? "");
      setSalesPointId(String(data.salesPointId));
      setAllowAutoUnitPrice(false);
      setLinePriceErrors({});
      setLines(
        data.lines.length > 0
          ? data.lines.map((line) => ({
              productId: String(line.productId),
              orderQty: String(line.orderQty),
              orderUnit: line.orderUnit || "kg",
              unitPrice: line.unitPrice,
            }))
          : [emptyLine()],
      );
      setPayments(
        data.payments.length > 0
          ? data.payments.map((payment) => ({
              paymentMethodId: payment.paymentMethodId ?? "",
              paymentDate: payment.paymentDate || todayIsoDate(),
              chequeNo: payment.chequeNo ?? "",
              bank: payment.bank ?? "",
              cashReceiptNo: payment.cashReceiptNo ?? "",
              receiptDate: payment.receiptDate ?? "",
              traiteNo: payment.traiteNo ?? "",
              traiteIssuedOn: payment.traiteIssuedOn ?? "",
              traiteMaturityOn: payment.traiteMaturityOn ?? "",
            }))
          : [emptyPayment()],
      );
    } catch (error) {
      setBanner({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to load delivery order.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function tryLoadOrderOnEnter() {
    if (busy !== null || orderId || !deliveryOrderNo.trim()) {
      return;
    }

    if (autoGenerateDeliveryOrderNo) {
      if (
        confirmedDeliveryOrderNo !== null &&
        confirmedDeliveryOrderNo === deliveryOrderNo.trim()
      ) {
        return;
      }
      await loadOrder(undefined, { notFoundMode: "silent" });
      return;
    }

    if (
      confirmedDeliveryOrderNo !== null &&
      confirmedDeliveryOrderNo === deliveryOrderNo.trim() &&
      isValidBookletSerial(deliveryOrderNo)
    ) {
      return;
    }

    const validation = validateBookletSerial(deliveryOrderNo);
    if (validation.ok === false) {
      setBanner({ type: "error", text: validation.error });
      return;
    }

    await loadOrder(undefined, { notFoundMode: "silent" });
  }

  async function saveOrder() {
    if (!options) {
      return;
    }

    setBusy("save");
    setBanner(null);

    try {
      const spId = Number.parseInt(salesPointId, 10);
      if (!customerId.trim()) {
        setBanner({ type: "error", text: "Select a customer." });
        return;
      }
      if (!Number.isFinite(spId)) {
        setBanner({ type: "error", text: "Select a collection point." });
        return;
      }
      if (paymentsMissingTraiteDetails(payments, paymentMethods)) {
        setBanner({
          type: "error",
          text: "Enter trait no #, issued date, and maturity date for traite payments.",
        });
        return;
      }

      if (
        orderId == null &&
        !autoGenerateDeliveryOrderNo &&
        options?.enforceDeliveryOrderBookletValidation
      ) {
        const bookletCheck = await getElectronApi().booklets.validateSerial({
          documentKind: "DELIVERY_ORDER",
          serial: deliveryOrderNo.trim(),
          salesPointId: spId,
        });
        if (!bookletCheck.ok) {
          setBanner({ type: "error", text: bookletCheck.error });
          return;
        }
      }

      if (!postingPeriod) {
        setBanner({
          type: "error",
          text: "No open posting period. Open a financial month first.",
        });
        return;
      }

      const manualNo = deliveryOrderNo.trim();
      if (orderId == null && !autoGenerateDeliveryOrderNo && !manualNo) {
        setBanner({
          type: "error",
          text: "Enter a delivery order number.",
        });
        return;
      }

      const result = await getElectronApi().deliveryOrders.save({
        userId: user.id,
        id: orderId,
        // Blank + auto-generate → server allocates. Any typed value is kept.
        deliveryOrderNo:
          orderId == null && manualNo ? manualNo : undefined,
        customerId: Number.parseInt(customerId, 10),
        dateIssued,
        orderRef: orderRef || undefined,
        salesPointId: spId,
        financialYear: postingPeriod.financialYear,
        financialMonth: postingPeriod.calendarMonth,
        postingCalendarYear: postingPeriod.financialYear,
        lines: lines
          .filter((line) => line.productId)
          .map((line) => ({
            productId: Number.parseInt(line.productId, 10),
            orderQty: Number.parseInt(line.orderQty, 10) || 0,
            orderUnit: line.orderUnit,
            unitPrice: line.unitPrice || undefined,
          })),
        payments: payments
          .filter((payment) => payment.paymentMethodId)
          .map((payment) => ({
            paymentMethodId: payment.paymentMethodId,
            paymentDate: payment.paymentDate,
            chequeNo: payment.chequeNo || undefined,
            bank: payment.bank || undefined,
            cashReceiptNo: payment.cashReceiptNo || undefined,
            receiptDate: payment.receiptDate || undefined,
            traiteNo: payment.traiteNo || undefined,
            traiteIssuedOn: payment.traiteIssuedOn || undefined,
            traiteMaturityOn: payment.traiteMaturityOn || undefined,
          })),
      });

      if (result.ok === false) {
        setBanner({ type: "error", text: result.error });
        return;
      }

      const wasCreate = orderId == null;
      setOrderId(result.id);
      setDeliveryOrderNo(result.deliveryOrderNo);
      setConfirmedDeliveryOrderNo(result.deliveryOrderNo);
      setDocStatus("PENDING");
      await loadOrder(result.deliveryOrderNo);
      setBanner({
        type: "ok",
        text: wasCreate
          ? `Created ${result.deliveryOrderNo}.`
          : "Delivery order updated.",
      });
    } catch (error) {
      setBanner({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to save delivery order.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function validateOrder() {
    if (orderId == null) {
      return;
    }

    setBusy("validate");
    setBanner(null);

    try {
      const result = await getElectronApi().deliveryOrders.validateOrder({
        orderId,
        userId: user.id,
      });

      if (result.ok === false) {
        setBanner({ type: "error", text: result.error });
        return;
      }

      setDocStatus("VALIDATED");
      setBanner({ type: "ok", text: "Delivery order validated." });
      await loadOrder(deliveryOrderNo);
    } catch (error) {
      setBanner({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to validate delivery order.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function deleteOrder() {
    if (orderId == null) {
      return;
    }

    if (!window.confirm(`Delete ${deliveryOrderNo || `DO #${orderId}`}?`)) {
      return;
    }

    setBusy("delete");
    setBanner(null);

    try {
      const result = await getElectronApi().deliveryOrders.deleteOrder({
        orderId,
        userId: user.id,
      });
      if (result.ok === false) {
        setBanner({ type: "error", text: result.error });
        return;
      }

      resetNew();
      setBanner({ type: "ok", text: "Delivery order deleted." });
    } catch (error) {
      setBanner({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to delete delivery order.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return <p class="sales-error">{loadError}</p>;
  }

  if (!options) {
    return <p class="sales-muted">Loading delivery order screen…</p>;
  }

  const setupRequired =
    options.customers.length === 0 ||
    options.products.length === 0 ||
    options.salesPoints.length === 0;

  const canSave =
    busy === null &&
    !mutationsBlocked &&
    isFormEditable &&
    customerId.trim() &&
    salesPointId.trim() &&
    !taxPreviewError &&
    taxPreview != null &&
    lines.some(
      (line) => line.productId && Number.parseInt(line.orderQty, 10) > 0,
    );

  if (setupRequired) {
    return (
      <div class="sales-setup">
        <h3>Setup required</h3>
        <ul>
          {options.customers.length === 0 ? (
            <li>Add at least one customer.</li>
          ) : null}
          {options.products.length === 0 ? (
            <li>Add at least one product.</li>
          ) : null}
          {options.salesPoints.length === 0 ? (
            <li>Add at least one collection point.</li>
          ) : null}
        </ul>
      </div>
    );
  }

  return (
    <div class="sales-client sales-client-compact do-client">
      {banner ? (
        <div class={`sales-banner sales-banner-${banner.type}`}>
          {banner.text}
        </div>
      ) : null}

      {mutationsBlocked ? (
        <div class="sales-banner sales-banner-error">
          Server unreachable — saving is disabled until the connection is restored.
        </div>
      ) : null}

      <section class="sales-panel sales-doc-panel">
        <div class="sales-doc-header">
          <div class="sales-doc-identity">
            <p class="sales-doc-kicker">Delivery order</p>
            <div class="sales-doc-identity-row">
              {orderId ? (
                <div class="sales-doc-invoice-value">
                  {deliveryOrderNo || "—"}
                </div>
              ) : (
                <input
                  class="sales-doc-invoice-input"
                  type="text"
                  inputMode={autoGenerateDeliveryOrderNo ? "text" : "numeric"}
                  pattern={autoGenerateDeliveryOrderNo ? undefined : "\\d*"}
                  value={deliveryOrderNo}
                  placeholder={
                    autoGenerateDeliveryOrderNo
                      ? "DO no. (or leave blank)"
                      : "DO no."
                  }
                  disabled={busy !== null}
                  onInput={(event) =>
                    setDeliveryOrderNo(
                      (event.currentTarget as HTMLInputElement).value,
                    )
                  }
                  onBlur={() => void tryLoadOrderOnEnter()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void tryLoadOrderOnEnter();
                    }
                  }}
                />
              )}
              {docStatus ? (
                <span class={statusPillClass(docStatus)}>{docStatus}</span>
              ) : (
                <span class="sales-status-pill">New</span>
              )}
              {canValidate && pendingDos.length > 0 ? (
                <button
                  type="button"
                  class="sales-btn-secondary"
                  disabled={busy !== null}
                  onClick={() => setPendingOpen((open) => !open)}
                >
                  {pendingDos.length} pending {pendingOpen ? "▴" : "▾"}
                </button>
              ) : null}
            </div>
            {validatedByName ? (
              <p class="sales-hint">Validated by {validatedByName}</p>
            ) : null}
            {isAwaitingOrder ? (
              <p class="sales-hint">
                Enter DO no., then press Enter or leave the field to continue.
              </p>
            ) : null}
            {!orderId && autoGenerateDeliveryOrderNo ? (
              <p class="sales-hint">
                Leave blank to auto-assign on save, type a new number to use
                it, or enter an existing DO number and press Enter to open it.
              </p>
            ) : null}
          </div>
          {orderId ? (
            <button
              type="button"
              class="sales-btn-secondary"
              disabled={busy !== null}
              onClick={resetNew}
            >
              New order
            </button>
          ) : null}
        </div>

        {pendingOpen && pendingDos.length > 0 ? (
          <ul class="sales-pending-list do-pending-list">
            {pendingDos.map((pending) => (
              <li key={pending.deliveryOrderNo}>
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryOrderNo(pending.deliveryOrderNo);
                    setPendingOpen(false);
                    void loadOrder(pending.deliveryOrderNo);
                  }}
                >
                  <strong>{pending.deliveryOrderNo}</strong>
                  <span>
                    {pending.customerName} ·{" "}
                    {formatDisplayDate(pending.dateIssued)}
                    {pending.totalLabel ? ` · ${pending.totalLabel}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div
          class={`sales-meta-grid${isAwaitingOrder ? " sales-form-locked" : ""}`}
        >
          <label class="sales-field">
            <span>Customer</span>
            <select
              value={customerId}
              disabled={!isFormEditable}
              onChange={(event) => {
                setAllowAutoUnitPrice(true);
                setCustomerId(
                  (event.currentTarget as HTMLSelectElement).value,
                );
              }}
            >
              <option value="">Select customer</option>
              {options.customers.map((customer) => (
                <option key={customer.id} value={String(customer.id)}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>

          <label class="sales-field">
            <span>Date issued</span>
            <input
              type="date"
              value={dateIssued}
              min={postingPeriod?.startDate}
              max={postingPeriod?.endDate}
              disabled={!isFormEditable || !postingPeriod}
              onInput={(event) => {
                setAllowAutoUnitPrice(true);
                setDateIssued(
                  (event.currentTarget as HTMLInputElement).value,
                );
              }}
            />
          </label>

          <label class="sales-field">
            <span>Ref. no. (optional)</span>
            <input
              type="text"
              value={orderRef}
              disabled={!isFormEditable}
              placeholder="PO / contract ref"
              onInput={(event) =>
                setOrderRef((event.currentTarget as HTMLInputElement).value)
              }
            />
          </label>

          <label class="sales-field">
            <span>Collection point</span>
            <select
              value={salesPointId}
              disabled={!isFormEditable || options.scopedSalesPointId != null}
              onChange={(event) =>
                setSalesPointId(
                  (event.currentTarget as HTMLSelectElement).value,
                )
              }
            >
              <option value="">Select collection point</option>
              {options.salesPoints.map((point) => (
                <option key={point.id} value={String(point.id)}>
                  {point.name}
                </option>
              ))}
            </select>
            {bookletStatus ? (
              <span
                class={
                  bookletStatus.ok
                    ? "sales-hint sales-hint-ok"
                    : "sales-hint sales-hint-error"
                }
              >
                {bookletStatus.ok ? "✓ " : "⚠ "}
                {bookletStatus.message}
              </span>
            ) : null}
          </label>

          <div class="sales-field sales-field-span-full sales-tax-hint-row">
            <span
              class={`sales-hint${taxPreviewError ? " sales-hint-warn" : ""}`}
            >
              {taxPreviewError
                ? taxPreviewError
                : taxPreview
                  ? `VAT ${taxPreview.vatPercentLabel}% · Sales tax ${taxPreview.otherPercentLabel}%`
                  : "Select a customer and date to load tax rates."}
            </span>
          </div>
        </div>
      </section>

      <section
        class={`sales-panel sales-items-panel${isAwaitingOrder ? " sales-panel-locked" : ""}`}
      >
        <div class="sales-section-header">
          <div>
            <h3>Lines · {lines.length}</h3>
          </div>
          {isFormEditable ? (
            <button
              type="button"
              class="sales-btn-secondary"
              onClick={() => {
                setAllowAutoUnitPrice(true);
                setLines((current) => [...current, emptyLine()]);
              }}
            >
              Add line
            </button>
          ) : null}
        </div>

        <div class="sales-lines-list">
          {lines.map((line, index) => {
            const summary = lineSummaries[index] ?? {
              net: 0,
              vat: 0,
              other: 0,
              total: 0,
            };

            return (
              <div class="sales-line-card" key={index}>
                <label class="sales-field">
                  <span>Product</span>
                  <select
                    value={line.productId}
                    disabled={!isFormEditable}
                    onChange={(event) => {
                      setAllowAutoUnitPrice(true);
                      const productId = (
                        event.currentTarget as HTMLSelectElement
                      ).value;
                      const lineIndex = index;
                      setLines((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === lineIndex
                            ? { ...item, productId, unitPrice: "" }
                            : item,
                        ),
                      );
                      setLinePriceErrors((current) => {
                        if (!current[lineIndex]) {
                          return current;
                        }
                        const next = { ...current };
                        delete next[lineIndex];
                        return next;
                      });

                      if (productId && customerId) {
                        const parsedCustomerId = Number.parseInt(customerId, 10);
                        const parsedProductId = Number.parseInt(productId, 10);
                        if (
                          Number.isFinite(parsedCustomerId) &&
                          Number.isFinite(parsedProductId)
                        ) {
                          void getElectronApi()
                            .deliveryOrders.previewUnitPrice({
                              customerId: parsedCustomerId,
                              productId: parsedProductId,
                              dateIssued,
                              orderQty: lines[lineIndex]?.orderQty,
                            })
                            .then((result) => {
                              if (result.ok === false) {
                                setLinePriceErrors((current) => ({
                                  ...current,
                                  [lineIndex]: result.error,
                                }));
                                return;
                              }
                              setLines((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === lineIndex &&
                                  item.productId === productId
                                    ? {
                                        ...item,
                                        unitPrice: result.unitPriceExTax,
                                      }
                                    : item,
                                ),
                              );
                            });
                        }
                      }

                      if (productId) {
                        setTimeout(() => {
                          const qtyInput = document.getElementById(
                            `do-line-qty-${lineIndex}`,
                          ) as HTMLInputElement | null;
                          qtyInput?.focus();
                          qtyInput?.select();
                        }, 0);
                      }
                    }}
                  >
                    <option value="">Select product</option>
                    {options.products.map((product) => (
                      <option
                        key={product.productId}
                        value={String(product.productId)}
                      >
                        {product.productName}
                      </option>
                    ))}
                  </select>
                </label>

                <div class="sales-line-grid">
                  <label class="sales-field">
                    <span>Qty</span>
                    <input
                      id={`do-line-qty-${index}`}
                      type="text"
                      inputMode="numeric"
                      value={line.orderQty}
                      disabled={!isFormEditable}
                      onInput={(event) =>
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  orderQty: (
                                    event.currentTarget as HTMLInputElement
                                  ).value,
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    {lineOnHand[index] != null ? (
                      <span class="sales-hint">
                        On hand: {lineOnHand[index]} {line.orderUnit}
                      </span>
                    ) : null}
                  </label>

                  <label class="sales-field">
                    <span>Unit</span>
                    <input
                      type="text"
                      value={line.orderUnit}
                      disabled={!isFormEditable}
                      onInput={(event) =>
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  orderUnit: (
                                    event.currentTarget as HTMLInputElement
                                  ).value,
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>

                  <label class="sales-field">
                    <span>Unit price (ex VAT)</span>
                    <input
                      type="text"
                      value={
                        line.unitPrice
                          ? formatAmount(parseDec(line.unitPrice))
                          : ""
                      }
                      readOnly
                      disabled={!isFormEditable}
                    />
                    {linePriceErrors[index] ? (
                      <span class="sales-hint sales-hint-warn">
                        {linePriceErrors[index]}
                      </span>
                    ) : null}
                  </label>

                  <label class="sales-field">
                    <span>Line total (ex VAT)</span>
                    <input
                      type="text"
                      value={formatAmount(summary.net)}
                      readOnly
                      disabled
                    />
                  </label>
                </div>

                {isFormEditable && lines.length > 1 ? (
                  <button
                    type="button"
                    class="sales-btn-link"
                    onClick={() =>
                      setLines((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    Remove line
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

      </section>

      <section
        class={`sales-panel sales-payments-panel${isAwaitingOrder ? " sales-panel-locked" : ""}`}
      >
        <div class="sales-section-header">
          <div>
            <h3>Payments · {payments.length}</h3>
          </div>
          {isFormEditable ? (
            <button
              type="button"
              class="sales-btn-secondary"
              onClick={() =>
                setPayments((current) => [...current, emptyPayment()])
              }
            >
              Add payment
            </button>
          ) : null}
        </div>

        <div class="sales-payments-form">
            {payments.map((payment, index) => {
              const method = paymentMethods.find(
                (item) => item.id === payment.paymentMethodId,
              );
              const isCheque = method?.kind === "CHEQUE";
              const isTraite = method?.kind === "TRAITE";
              const isBankTransfer = method?.kind === "BANK_TRANSFER";
              const fieldCount = isTraite ? 6 : isCheque ? 4 : 3;
              const gridClass = isTraite
                ? "sales-payment-grid sales-payment-grid--cols-6"
                : `sales-payment-grid sales-payment-grid--cols-${fieldCount}`;

              return (
                <div class="sales-payment-row" key={index}>
                  <div
                    class={gridClass}
                    style={{ "--sales-payment-cols": String(fieldCount) }}
                  >
                    <label class="sales-field">
                      <span>Method</span>
                      <select
                        value={payment.paymentMethodId}
                        disabled={!isFormEditable}
                        onChange={(event) =>
                          setPayments((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    paymentMethodId: (
                                      event.currentTarget as HTMLSelectElement
                                    ).value,
                                    ...emptyPaymentExtras(),
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="">Select payment method</option>
                        {paymentMethods.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label class="sales-field">
                      <span>Date</span>
                      <input
                        type="date"
                        value={payment.paymentDate}
                        min={postingPeriod?.startDate}
                        max={postingPeriod?.endDate}
                        disabled={!isFormEditable || !postingPeriod}
                        onInput={(event) =>
                          setPayments((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    paymentDate: (
                                      event.currentTarget as HTMLInputElement
                                    ).value,
                                  }
                                : item,
                            ),
                          )
                        }
                      />
                    </label>

                    {isTraite ? (
                      <>
                        <label class="sales-field">
                          <span>Trait no #</span>
                          <input
                            type="text"
                            value={payment.traiteNo}
                            disabled={!isFormEditable}
                            placeholder="Trait number"
                            onInput={(event) =>
                              setPayments((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        traiteNo: (
                                          event.currentTarget as HTMLInputElement
                                        ).value,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <label class="sales-field">
                          <span>Issued on</span>
                          <input
                            type="date"
                            value={payment.traiteIssuedOn}
                            disabled={!isFormEditable}
                            onInput={(event) =>
                              setPayments((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        traiteIssuedOn: (
                                          event.currentTarget as HTMLInputElement
                                        ).value,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <label class="sales-field">
                          <span>Maturity on</span>
                          <input
                            type="date"
                            value={payment.traiteMaturityOn}
                            disabled={!isFormEditable}
                            onInput={(event) =>
                              setPayments((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        traiteMaturityOn: (
                                          event.currentTarget as HTMLInputElement
                                        ).value,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <label class="sales-field">
                          <span>Bank</span>
                          <input
                            type="text"
                            value={payment.bank}
                            disabled={!isFormEditable}
                            placeholder="Bank name"
                            onInput={(event) =>
                              setPayments((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        bank: (
                                          event.currentTarget as HTMLInputElement
                                        ).value,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                      </>
                    ) : isCheque ? (
                      <>
                        <label class="sales-field">
                          <span>Cheque no.</span>
                          <input
                            type="text"
                            value={payment.chequeNo}
                            disabled={!isFormEditable}
                            onInput={(event) =>
                              setPayments((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        chequeNo: (
                                          event.currentTarget as HTMLInputElement
                                        ).value,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                        <label class="sales-field">
                          <span>Bank</span>
                          <input
                            type="text"
                            value={payment.bank}
                            disabled={!isFormEditable}
                            onInput={(event) =>
                              setPayments((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? {
                                        ...item,
                                        bank: (
                                          event.currentTarget as HTMLInputElement
                                        ).value,
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </label>
                      </>
                    ) : isBankTransfer ? (
                      <label class="sales-field">
                        <span>Bank</span>
                        <input
                          type="text"
                          value={payment.bank}
                          disabled={!isFormEditable}
                          onInput={(event) =>
                            setPayments((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      bank: (
                                        event.currentTarget as HTMLInputElement
                                      ).value,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    ) : (
                      <label class="sales-field">
                        <span>Cash receipt no.</span>
                        <input
                          type="text"
                          value={payment.cashReceiptNo}
                          disabled={!isFormEditable}
                          onInput={(event) =>
                            setPayments((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      cashReceiptNo: (
                                        event.currentTarget as HTMLInputElement
                                      ).value,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                    )}
                  </div>

                  {isFormEditable ? (
                    <button
                      type="button"
                      class="sales-btn-secondary sales-payment-remove"
                      disabled={payments.length === 1}
                      onClick={() =>
                        setPayments((current) =>
                          current.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
      </section>

      <div class="sales-footer">
        <div class="sales-footer-totals">
          <div class="sales-footer-total">
            <span>Net</span>
            <strong>{formatAmount(totalsPreview.net)} XAF</strong>
          </div>
          <div class="sales-footer-total">
            <span>{taxPreview?.vatLabel ?? "VAT"}</span>
            <strong>{formatAmount(totalsPreview.vat)} XAF</strong>
          </div>
          <div class="sales-footer-total">
            <span>{taxPreview?.otherLabel ?? "Sales tax"}</span>
            <strong>{formatAmount(totalsPreview.other)} XAF</strong>
          </div>
          <div class="sales-footer-total is-emphasis">
            <span>Total</span>
            <strong>{formatAmount(totalsPreview.total)} XAF</strong>
          </div>
        </div>

        <div class="sales-actions">
          {isFormEditable ? (
            <button
              type="button"
              class="sales-btn-primary"
              disabled={!canSave}
              onClick={() => void saveOrder()}
            >
              {busy === "save"
                ? "Saving…"
                : orderId != null
                  ? "Update delivery order"
                  : "Save delivery order"}
            </button>
          ) : null}

          {orderId != null && docStatus === "PENDING" && canValidate ? (
            <button
              type="button"
              class="sales-btn-secondary"
              disabled={busy !== null}
              onClick={() => void validateOrder()}
            >
              {busy === "validate" ? "Validating…" : "Validate"}
            </button>
          ) : null}

          {orderId != null && docStatus === "PENDING" && !isReadOnly ? (
            <button
              type="button"
              class="sales-btn-danger"
              disabled={busy !== null}
              onClick={() => void deleteOrder()}
            >
              Delete order
            </button>
          ) : null}

          {onClose ? (
            <button
              type="button"
              class="sales-btn-secondary"
              disabled={busy !== null}
              onClick={onClose}
            >
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
