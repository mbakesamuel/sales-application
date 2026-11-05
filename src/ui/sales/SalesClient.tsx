import { useEffect, useMemo, useState } from "preact/hooks";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedFinancialYears } from "../auth/financialYears.ts";
import type { AuthUser } from "../auth/session.ts";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import { canPerformActionFromSnapshot } from "../../shared/permissionUtils.ts";
import {
  saleProductModeForVariant,
  type SalesModuleVariant,
} from "../../shared/salesModule.ts";
import type { OpenPostingPeriod } from "../../shared/financialYears.types.ts";
import {
  FALLBACK_TAX_RATES,
  resolveCustomerTaxProfile,
  type TaxRatesBag,
} from "../../shared/taxRules.ts";
import {
  isValidBookletSerial,
  validateBookletSerial,
} from "../../shared/bookletSerial.ts";
import { paymentMethodIdForDisposition } from "../../shared/dispositionPaymentMethods.ts";
import { SalePrintView } from "./SalePrintView.tsx";
import { SalesLineModal, type SalesLineDraft } from "./SalesLineModal.tsx";
import { useServerConnectivity } from "../hooks/useServerConnectivity.ts";
import type {
  AvailableDeliveryOrderRow,
  DeliveryOrderLookupResult,
  LoadedSaleView,
  SaleDisposition,
  SaleProductMode,
  SalesFormOptions,
  SalesPaymentMethodOption,
  SalesProductOption,
  StorageLocationOption,
} from "./types.ts";
import "./sales.css";

interface SalesClientProps {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  variant?: SalesModuleVariant;
  onClose: () => void;
  initialInvoiceNo?: string;
}

type PaymentDraft = {
  paymentMethodId: string;
  amount: string;
  chequeNo?: string;
  bank?: string;
  traiteNo?: string;
  traiteIssuedOn?: string;
  traiteMaturityOn?: string;
};

function parseDec(value: string): number {
  const normalized = String(value ?? "")
    .replace(/[\s,\u00a0]/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatAmountInput(value: string): string {
  if (!value.trim()) {
    return "";
  }
  return formatAmount(parseDec(value));
}

function clampDateToPeriod(isoDate: string, period: OpenPostingPeriod | null): string {
  if (!period) return isoDate;
  if (isoDate < period.startDate) return period.startDate;
  if (isoDate > period.endDate) return period.endDate;
  return isoDate;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function dispositionPaymentMethodName(
  options: SalesFormOptions | null,
  paymentMethodId: string,
): string | null {
  if (!options) {
    return null;
  }
  if (paymentMethodId === options.rationPaymentMethodId) {
    return "Ration (deferred)";
  }
  if (paymentMethodId === options.publicRelationPaymentMethodId) {
    return "Public relation (complimentary)";
  }
  return null;
}

function cashOnlyPaymentMethods(
  methods: SalesPaymentMethodOption[],
): SalesPaymentMethodOption[] {
  const cash = methods.filter(
    (method) =>
      method.code.toUpperCase() === "CASH" ||
      method.name.trim().toUpperCase() === "CASH",
  );
  return cash.length > 0 ? cash : methods;
}

function nonCashPaymentMethods(
  methods: SalesPaymentMethodOption[],
): SalesPaymentMethodOption[] {
  const nonCash = methods.filter(
    (method) =>
      method.code.toUpperCase() !== "CASH" &&
      method.name.trim().toUpperCase() !== "CASH",
  );
  return nonCash.length > 0 ? nonCash : methods;
}

function defaultPaymentMethodId(
  methods: SalesPaymentMethodOption[],
  preferCash = true,
): string {
  if (preferCash) {
    return (
      methods.find(
        (method) =>
          method.code.toUpperCase() === "CASH" ||
          method.name.trim().toUpperCase() === "CASH",
      )?.id ??
      methods[0]?.id ??
      ""
    );
  }
  return (
    methods.find(
      (method) =>
        method.code.toUpperCase() !== "CASH" &&
        method.name.trim().toUpperCase() !== "CASH",
    )?.id ??
    methods[0]?.id ??
    ""
  );
}

function paymentsMissingMethod(payments: PaymentDraft[]): boolean {
  return payments.some(
    (payment) =>
      parseDec(payment.amount) > 0 && !payment.paymentMethodId.trim(),
  );
}

function paymentsMissingTraiteDetails(
  payments: PaymentDraft[],
  methods: SalesPaymentMethodOption[],
): boolean {
  return payments.some((payment) => {
    if (parseDec(payment.amount) <= 0) {
      return false;
    }
    const method = methods.find((item) => item.id === payment.paymentMethodId);
    if (method?.kind !== "TRAITE") {
      return false;
    }
    return (
      !String(payment.traiteNo ?? "").trim() ||
      !String(payment.traiteIssuedOn ?? "").trim() ||
      !String(payment.traiteMaturityOn ?? "").trim()
    );
  });
}

function emptyPaymentExtras(): Pick<
  PaymentDraft,
  "chequeNo" | "bank" | "traiteNo" | "traiteIssuedOn" | "traiteMaturityOn"
> {
  return {
    chequeNo: "",
    bank: "",
    traiteNo: "",
    traiteIssuedOn: "",
    traiteMaturityOn: "",
  };
}

const DO_AUTO_FILL_PAYMENT_KINDS = new Set([
  "CHEQUE",
  "TRAITE",
  "BANK_TRANSFER",
]);

function paymentDraftsFromDeliveryOrder(
  result: DeliveryOrderLookupResult,
): PaymentDraft[] | null {
  if (result.isCarryForward) {
    return null;
  }

  const eligible = result.payments.filter((payment) =>
    DO_AUTO_FILL_PAYMENT_KINDS.has(payment.kind),
  );
  if (eligible.length === 0) {
    return null;
  }

  return eligible.map((payment) => ({
    paymentMethodId: payment.paymentMethodId,
    amount: "0",
    chequeNo: payment.chequeNo ?? "",
    bank: payment.bank ?? "",
    traiteNo: payment.traiteNo ?? "",
    traiteIssuedOn: payment.traiteIssuedOn ?? "",
    traiteMaturityOn: payment.traiteMaturityOn ?? "",
  }));
}

function statusClass(status: LoadedSaleView["status"]): string {
  if (status === "VALIDATED") {
    return "sales-status sales-status-validated";
  }
  if (status === "REJECTED") {
    return "sales-status sales-status-rejected";
  }
  return "sales-status sales-status-pending";
}

function defaultStorageLocationId(
  options: SalesFormOptions,
  salesPointId: string,
  isBottleMode: boolean,
): string {
  if (isBottleMode && options.bottleOilStoreLocationId != null) {
    return String(options.bottleOilStoreLocationId);
  }

  const spId = Number.parseInt(salesPointId, 10);
  const defaultLocation =
    options.storageLocations.find(
      (location) => location.salesPointId === spId && location.isDefault,
    ) ??
    options.storageLocations.find((location) => location.salesPointId === spId);

  return defaultLocation ? String(defaultLocation.id) : "";
}

function formatAmount(value: number): string {
  return Math.round(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function getProductLabel(
  productId: string,
  products: SalesProductOption[],
): string {
  const product = products.find((item) => String(item.productId) === productId);
  return product ? `${product.productName} (${product.productCat})` : "—";
}

function getLocationLabel(
  storageLocationId: string,
  locations: StorageLocationOption[],
): string {
  const location = locations.find(
    (item) => String(item.id) === storageLocationId,
  );
  return location?.name ?? "—";
}

function getLineQuantity(line: SalesLineDraft, isBottleMode: boolean): string {
  return isBottleMode ? line.qtyUnits : line.qtyKg;
}

function getLineUnitPrice(
  line: SalesLineDraft,
  isBottleMode: boolean,
  _isSpecialDisposition: boolean,
): string {
  return isBottleMode ? line.unitPricePerUnit : line.unitPricePerKg;
}

function getLineSubtotal(
  line: SalesLineDraft,
  isBottleMode: boolean,
  isSpecialDisposition: boolean,
): number {
  return Math.round(
    parseDec(getLineQuantity(line, isBottleMode)) *
      parseDec(getLineUnitPrice(line, isBottleMode, isSpecialDisposition)),
  );
}

function emptyLine(
  options: SalesFormOptions,
  salesPointId: string,
  isBottleMode: boolean,
): SalesLineDraft {
  return {
    productId: "",
    qtyKg: "0",
    qtyUnits: "0",
    unitPricePerKg: "0",
    unitPricePerUnit: "0",
    storageLocationId: defaultStorageLocationId(
      options,
      salesPointId,
      isBottleMode,
    ),
  };
}

function defaultUseRegisteredCustomer(
  options: SalesFormOptions,
  isBottleVariant: boolean,
): boolean {
  if (options.customers.length === 0) {
    return false;
  }
  if (isBottleVariant) {
    return Boolean(options.bottleOilUseRegisteredCustomers);
  }
  return !options.looseSalesAllowUnregisteredCustomer;
}

type DoLinePrefill = {
  productId: number;
  qtyKg: string;
  unitPrice: string;
};

export function SalesClient({
  user,
  permissions,
  variant = "loose",
  onClose,
  initialInvoiceNo = "",
}: SalesClientProps) {
  const isBottleVariant = variant === "bottled";
  const defaultProductMode = saleProductModeForVariant(variant);
  const canValidate = canPerformActionFromSnapshot(
    permissions,
    "validate_sales",
  );
  const canCancelValidated = canPerformActionFromSnapshot(
    permissions,
    "cancel_validated_sales",
  );
  const canDeleteValidated = canPerformActionFromSnapshot(
    permissions,
    "delete_validated_sales",
  );
  const { mutationsBlocked } = useServerConnectivity();
  const [options, setOptions] = useState<SalesFormOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    type: "ok" | "error";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [saleId, setSaleId] = useState<string | null>(null);
  const [invoiceNo, setInvoiceNo] = useState(initialInvoiceNo);
  const [confirmedInvoiceNo, setConfirmedInvoiceNo] = useState<string | null>(
    null,
  );
  const [saleStatus, setSaleStatus] = useState<LoadedSaleView["status"] | null>(
    null,
  );
  const [validatedByName, setValidatedByName] = useState("");
  const [cancelledByName, setCancelledByName] = useState("");
  const [cancelledAtIso, setCancelledAtIso] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReasonInput, setCancelReasonInput] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [printOpen, setPrintOpen] = useState(false);

  const [customerId, setCustomerId] = useState("");
  const [invoiceCustomerName, setInvoiceCustomerName] = useState("");
  const [useRegisteredCustomer, setUseRegisteredCustomer] = useState(
    !isBottleVariant,
  );
  const [salesPointId, setSalesPointId] = useState("");
  const [saleProductMode, setSaleProductMode] =
    useState<SaleProductMode>(defaultProductMode);
  const [saleDisposition, setSaleDisposition] =
    useState<SaleDisposition>("NORMAL");
  const [dispositionChosen, setDispositionChosen] = useState(
    Boolean(initialInvoiceNo.trim()),
  );
  const [referenceNumber, setReferenceNumber] = useState("");
  const [deliveryOrderNo, setDeliveryOrderNo] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [transactionDate, setTransactionDate] = useState(todayIsoDate());
  const [postingPeriod, setPostingPeriod] = useState<OpenPostingPeriod | null>(null);
  const [taxRates, setTaxRates] = useState<TaxRatesBag>(FALLBACK_TAX_RATES);
  const [lines, setLines] = useState<SalesLineDraft[]>([]);
  const [payments, setPayments] = useState<PaymentDraft[]>([
    { paymentMethodId: "", amount: "0", ...emptyPaymentExtras() },
  ]);

  const [availableDos, setAvailableDos] = useState<AvailableDeliveryOrderRow[]>(
    [],
  );
  const [doLinePrefill, setDoLinePrefill] = useState<DoLinePrefill | null>(null);
  const [doPickerOpen, setDoPickerOpen] = useState(false);
  const [bookletStatus, setBookletStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [lineModal, setLineModal] = useState<{
    mode: "add" | "edit";
    index: number | null;
    line: SalesLineDraft;
  } | null>(null);

  const isReadOnly = saleId != null;
  const autoGenerateInvoiceNo = options?.autoGenerateSalesInvoiceNo === true;
  const invoiceReady =
    saleId != null ||
    autoGenerateInvoiceNo ||
    (confirmedInvoiceNo !== null &&
      confirmedInvoiceNo === invoiceNo.trim() &&
      isValidBookletSerial(invoiceNo));
  const isAwaitingInvoice = !saleId && !invoiceReady;
  const canEditDisposition = !isReadOnly && busy === null;
  const canEnterInvoiceNo =
    !isReadOnly && dispositionChosen && busy === null;
  const isFormEditable = !isReadOnly && dispositionChosen && invoiceReady;
  const isBottleMode = isBottleVariant;
  const isSpecialDisposition =
    saleDisposition === "RATION" || saleDisposition === "PUBLIC_RELATION";
  /** Ration / Public relation / Retail: name on invoice only (no directory customer). */
  const isInvoiceOnlyDisposition =
    isSpecialDisposition || saleDisposition === "RETAIL";
  const isInvoiceOnlyCustomer =
    isInvoiceOnlyDisposition || !useRegisteredCustomer;
  const activeProducts = isBottleMode
    ? (options?.bottledProducts ?? [])
    : isSpecialDisposition
      ? (options?.looseProducts ?? []).filter((product) => product.isMain)
      : (options?.looseProducts ?? []);
  const paymentMethodOptions = useMemo(() => {
    if (isSpecialDisposition) {
      return [];
    }
    const methods = options?.paymentMethods ?? [];
    if (isBottleMode) {
      return cashOnlyPaymentMethods(methods);
    }
    // Retail may use Cash (cash receipt); other loose sales hide Cash.
    if (saleDisposition === "RETAIL") {
      return methods;
    }
    return nonCashPaymentMethods(methods);
  }, [
    options?.paymentMethods,
    isBottleMode,
    isSpecialDisposition,
    saleDisposition,
  ]);
  const dispositionPaymentMethodId = useMemo(() => {
    if (!options || !isSpecialDisposition) {
      return "";
    }
    return paymentMethodIdForDisposition(saleDisposition) ?? "";
  }, [options, isSpecialDisposition, saleDisposition]);
  const lockPaymentAmount = true;
  const salesPointLocations = locationsForSalesPoint(salesPointId);
  const catalogProducts = useMemo(
    () => [
      ...(options?.looseProducts ?? []),
      ...(options?.bottledProducts ?? []),
    ],
    [options],
  );
  const itemsSubtotal = useMemo(
    () =>
      lines.reduce(
        (sum, line) =>
          sum + getLineSubtotal(line, isBottleMode, isSpecialDisposition),
        0,
      ),
    [lines, isBottleMode, isSpecialDisposition],
  );

  const customer = !isInvoiceOnlyCustomer
    ? options?.customers.find((item) => String(item.id) === customerId)
    : undefined;
  const skipTax = isBottleMode || isSpecialDisposition;
  const taxProfile =
    !skipTax && customer
      ? resolveCustomerTaxProfile({
          residency: customer.residency,
          taxRegimeKind: customer.taxRegimeKind,
          taxpayerId: customer.taxpayerId,
          salesTaxExempt: customer.salesTaxExempt,
          rates: taxRates,
        })
      : null;
  const vatRate = taxProfile?.vatApplies ? taxProfile.vatRate : 0;
  const salesTaxRate = taxProfile?.salesTaxRate ?? 0;

  const totals = useMemo(() => {
    if (isBottleMode) {
      const gross = Math.round(
        lines.reduce(
          (sum, line) =>
            sum + parseDec(line.qtyUnits) * parseDec(line.unitPricePerUnit),
          0,
        ),
      );
      const paid = Math.round(
        payments.reduce((sum, payment) => sum + parseDec(payment.amount), 0),
      );
      return { net: gross, vat: 0, salesTax: 0, gross, paid };
    }

    const net = Math.round(
      lines.reduce(
        (sum, line) =>
          sum + parseDec(line.qtyKg) * parseDec(line.unitPricePerKg),
        0,
      ),
    );
    const vat = Math.round(net * vatRate);
    const salesTax = Math.round(net * salesTaxRate);
    const gross = net + vat + salesTax;
    const paid = Math.round(
      payments.reduce((sum, payment) => sum + parseDec(payment.amount), 0),
    );
    return { net, vat, salesTax, gross, paid };
  }, [lines, payments, vatRate, salesTaxRate, isBottleMode]);

  useEffect(() => {
    let cancelled = false;
    void getElectronApi()
      .sales.getTaxRatesAsOf(transactionDate)
      .then((rates) => {
        if (!cancelled) {
          setTaxRates(rates);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTaxRates(FALLBACK_TAX_RATES);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [transactionDate]);

  useEffect(() => {
    if (!isFormEditable) {
      return;
    }

    setPayments((current) => {
      if (current.length === 0) {
        return current;
      }

      const next = [...current];
      next[0] = { ...next[0], amount: String(totals.gross) };
      return next;
    });
  }, [totals.gross, isFormEditable]);

  // Bottle Oil: keep a single Cash payment line (skip for Ration / Public relation).
  useEffect(() => {
    if (!options || !isBottleMode || isSpecialDisposition) {
      return;
    }
    const cashMethods = cashOnlyPaymentMethods(options.paymentMethods);
    const cashId = defaultPaymentMethodId(cashMethods, true);
    if (!cashId) {
      return;
    }
    setPayments((current) => {
      if (
        current.length === 1 &&
        current[0]?.paymentMethodId === cashId
      ) {
        return current;
      }
      return [
        {
          paymentMethodId: cashId,
          amount: String(totals.gross),
          ...emptyPaymentExtras(),
        },
      ];
    });
  }, [options, isBottleMode, isSpecialDisposition, totals.gross]);

  // Ration / Public relation: single locked disposition payment line.
  useEffect(() => {
    if (!options || !isFormEditable || !isSpecialDisposition || !dispositionPaymentMethodId) {
      return;
    }
    setPayments((current) => {
      if (
        current.length === 1 &&
        current[0]?.paymentMethodId === dispositionPaymentMethodId
      ) {
        return current;
      }
      return [
        {
          paymentMethodId: dispositionPaymentMethodId,
          amount: String(totals.gross),
          ...emptyPaymentExtras(),
        },
      ];
    });
  }, [
    options,
    isFormEditable,
    isSpecialDisposition,
    dispositionPaymentMethodId,
    totals.gross,
  ]);

  // Loose (non-Retail) sales: drop Cash if it was selected (Cash is hidden from the list).
  useEffect(() => {
    if (
      !options ||
      !isFormEditable ||
      isBottleMode ||
      isSpecialDisposition ||
      saleDisposition === "RETAIL"
    ) {
      return;
    }
    const allowed = new Set(
      nonCashPaymentMethods(options.paymentMethods).map((method) => method.id),
    );
    setPayments((current) => {
      let changed = false;
      const next = current.map((payment) => {
        if (
          payment.paymentMethodId &&
          !allowed.has(payment.paymentMethodId)
        ) {
          changed = true;
          return {
            ...payment,
            paymentMethodId: "",
            ...emptyPaymentExtras(),
          };
        }
        return payment;
      });
      return changed ? next : current;
    });
  }, [
    options,
    isFormEditable,
    isBottleMode,
    isSpecialDisposition,
    saleDisposition,
  ]);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [formOptions, period] = await Promise.all([
          getElectronApi().sales.getFormOptions(user.id),
          getAuthenticatedFinancialYears().getOpenPostingPeriod(),
        ]);
        setOptions(formOptions);
        setPostingPeriod(period);
        setTransactionDate((current) => clampDateToPeriod(current, period));

        setUseRegisteredCustomer(
          defaultUseRegisteredCustomer(formOptions, isBottleVariant),
        );
        setCustomerId("");
        setInvoiceCustomerName("");
        setSalesPointId(
          formOptions.scopedSalesPointId != null
            ? String(formOptions.scopedSalesPointId)
            : isBottleVariant && formOptions.botaSalesPointId != null
              ? String(formOptions.botaSalesPointId)
              : "",
        );
        setLines([]);
        setPayments([{ paymentMethodId: "", amount: "0", ...emptyPaymentExtras() }]);
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load sales options.",
        );
      }
    }

    void bootstrap();
  }, [user.id, isBottleVariant]);

  useEffect(() => {
    if (initialInvoiceNo.trim()) {
      void loadSale(initialInvoiceNo.trim());
    }
  }, [initialInvoiceNo]);

  useEffect(() => {
    if (
      !options ||
      !isFormEditable ||
      isBottleMode ||
      isSpecialDisposition ||
      !useRegisteredCustomer
    ) {
      setAvailableDos([]);
      setDoPickerOpen(false);
      return;
    }

    const spId = Number.parseInt(salesPointId, 10);
    const custId = Number.parseInt(customerId, 10);
    if (!Number.isFinite(spId) || !Number.isFinite(custId)) {
      setAvailableDos([]);
      setDoPickerOpen(false);
      return;
    }

    let cancelled = false;

    getElectronApi()
      .sales.listAvailableDeliveryOrders({
        salesPointId: spId,
        customerId: custId,
      })
      .then((rows) => {
        if (!cancelled) {
          setAvailableDos(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableDos([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    options,
    salesPointId,
    customerId,
    isBottleMode,
    isSpecialDisposition,
    isFormEditable,
    useRegisteredCustomer,
  ]);

  useEffect(() => {
    if (!options || !isFormEditable) {
      return;
    }

    if (
      saleDisposition === "RATION" ||
      saleDisposition === "PUBLIC_RELATION" ||
      saleDisposition === "RETAIL"
    ) {
      setUseRegisteredCustomer(false);
      setCustomerId("");
      setDeliveryOrderNo("");
      setDoLinePrefill(null);
      if (saleDisposition === "RETAIL") {
        setVehicleNumber("");
      }
    }
  }, [saleDisposition, options, isFormEditable]);

  useEffect(() => {
    if (
      autoGenerateInvoiceNo ||
      saleId ||
      !confirmedInvoiceNo ||
      !salesPointId ||
      !options?.enforceSalesInvoiceBookletValidation
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
        documentKind: "SALES_INVOICE",
        serial: confirmedInvoiceNo,
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
    autoGenerateInvoiceNo,
    saleId,
    confirmedInvoiceNo,
    salesPointId,
    options?.enforceSalesInvoiceBookletValidation,
  ]);

  useEffect(() => {
    if (!options || !isFormEditable || isBottleVariant) {
      return;
    }
    if (saleDisposition !== "RATION" && saleDisposition !== "PUBLIC_RELATION") {
      return;
    }

    const allowedIds = new Set(
      options.looseProducts
        .filter((product) => product.isMain)
        .map((product) => String(product.productId)),
    );
    setLines((current) => {
      const next = current.filter((line) => allowedIds.has(line.productId));
      return next.length === current.length ? current : next;
    });
  }, [options, isFormEditable, isBottleVariant, saleDisposition]);

  useEffect(() => {
    if (!options || !isFormEditable) {
      return;
    }

    if (options.scopedSalesPointId != null) {
      setSalesPointId(String(options.scopedSalesPointId));
      return;
    }

    if (isBottleVariant && options.botaSalesPointId != null) {
      setSalesPointId(String(options.botaSalesPointId));
    }
  }, [options, isFormEditable, isBottleVariant]);

  useEffect(() => {
    if (!options || !isFormEditable || saleId != null) {
      return;
    }

    if (
      !isBottleVariant &&
      saleDisposition === "PUBLIC_RELATION" &&
      !options.looseSalesAllowPublicRelation
    ) {
      setSaleDisposition("NORMAL");
    }
  }, [
    options,
    isFormEditable,
    isBottleVariant,
    saleId,
    saleDisposition,
  ]);

  useEffect(() => {
    if (!options || !isFormEditable || isBottleVariant || saleId != null) {
      return;
    }

    if (
      saleDisposition === "RATION" ||
      saleDisposition === "PUBLIC_RELATION" ||
      saleDisposition === "RETAIL"
    ) {
      setUseRegisteredCustomer(false);
      return;
    }

    const next = defaultUseRegisteredCustomer(options, false);
    setUseRegisteredCustomer(next);
    if (next) {
      setInvoiceCustomerName("");
    } else {
      setCustomerId("");
      setDeliveryOrderNo("");
      setDoLinePrefill(null);
    }
  }, [options, isFormEditable, isBottleVariant, saleId, saleDisposition]);

  useEffect(() => {
    if (!options || !isFormEditable || !isBottleVariant || saleId != null) {
      return;
    }

    if (saleDisposition === "RATION" || saleDisposition === "PUBLIC_RELATION") {
      if (saleDisposition === "RATION" && !options.bottleOilAllowRation) {
        setSaleDisposition("NORMAL");
        return;
      }
      setUseRegisteredCustomer(false);
      return;
    }

    setUseRegisteredCustomer(defaultUseRegisteredCustomer(options, true));
    if (!options.bottleOilUseRegisteredCustomers) {
      setCustomerId("");
    }
  }, [options, isFormEditable, isBottleVariant, saleId, saleDisposition]);

  useEffect(() => {
    if (!options || !isFormEditable) {
      return;
    }

    setLines((current) =>
      current.map((line) => ({
        ...line,
        storageLocationId: defaultStorageLocationId(
          options,
          salesPointId,
          isBottleMode,
        ),
        productId: activeProducts.some(
          (product) => String(product.productId) === line.productId,
        )
          ? line.productId
          : String(activeProducts[0]?.productId ?? ""),
      })),
    );
  }, [isBottleMode, salesPointId, options, isFormEditable, activeProducts.length]);

  function resetNew() {
    if (!options) {
      return;
    }

    setSaleId(null);
    setInvoiceNo("");
    setConfirmedInvoiceNo(null);
    setSaleStatus(null);
    setValidatedByName("");
    setCancelledByName("");
    setCancelledAtIso("");
    setCancelReason("");
    setCancelModalOpen(false);
    setCancelReasonInput("");
    setCancelError(null);
    setPrintOpen(false);
    setUseRegisteredCustomer(defaultUseRegisteredCustomer(options, isBottleVariant));
    setCustomerId("");
    setInvoiceCustomerName("");
    setSalesPointId(
      options.scopedSalesPointId != null
        ? String(options.scopedSalesPointId)
        : isBottleVariant && options.botaSalesPointId != null
          ? String(options.botaSalesPointId)
          : "",
    );
    setSaleProductMode(defaultProductMode);
    setSaleDisposition("NORMAL");
    setDispositionChosen(false);
    setReferenceNumber("");
    setDeliveryOrderNo("");
    setVehicleNumber("");
    setTransactionDate(clampDateToPeriod(todayIsoDate(), postingPeriod));
    setLines([]);
    setPayments([{ paymentMethodId: "", amount: "0", ...emptyPaymentExtras() }]);
    setDoLinePrefill(null);
    setDoPickerOpen(false);
    setLineModal(null);
    setBanner(null);
  }

  function lineDraftFromDoPrefill(
    prefill: DoLinePrefill | null,
  ): SalesLineDraft {
    const base = emptyLine(options!, salesPointId, isBottleMode);
    if (!prefill || isBottleMode) {
      return base;
    }

    return {
      ...base,
      productId: String(prefill.productId),
      qtyKg: prefill.qtyKg,
      qtyUnits: "0",
      unitPricePerKg: prefill.unitPrice,
      unitPricePerUnit: prefill.unitPrice,
      storageLocationId: "",
    };
  }

  function openAddLineModal() {
    if (!options || !isFormEditable) {
      return;
    }

    setLineModal({
      mode: "add",
      index: null,
      line: lineDraftFromDoPrefill(doLinePrefill),
    });
  }

  function openEditLineModal(index: number) {
    setLineModal({
      mode: "edit",
      index,
      line: lines[index],
    });
  }

  function saveLineModal(line: SalesLineDraft) {
    if (!lineModal) {
      return;
    }

    if (lineModal.mode === "add") {
      setLines((current) => [...current, line]);
      setDoLinePrefill(null);
    } else if (lineModal.index != null) {
      setLines((current) =>
        current.map((item, index) => (index === lineModal.index ? line : item)),
      );
    }

    setLineModal(null);
  }

  function removeLine(index: number) {
    setLines((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  function populateSaleFromLoaded(sale: LoadedSaleView) {
    setSaleId(sale.id);
    setInvoiceNo(sale.invoiceNo);
    setConfirmedInvoiceNo(sale.invoiceNo);
    setSaleStatus(sale.status);
    setValidatedByName(sale.validatedByName ?? "");
    setCancelledByName(sale.cancelledByName ?? "");
    setCancelledAtIso(sale.cancelledAtIso ?? "");
    setCancelReason(sale.cancelReason ?? "");
    const registered = sale.customerId != null;
    setUseRegisteredCustomer(registered);
    setCustomerId(registered ? String(sale.customerId) : "");
    setInvoiceCustomerName(registered ? "" : sale.customerName);
    setSalesPointId(
      sale.salesPointId != null ? String(sale.salesPointId) : "",
    );
    setSaleProductMode(sale.saleProductMode ?? "LOOSE");
    setSaleDisposition(sale.saleDisposition ?? "NORMAL");
    setDispositionChosen(true);
    setReferenceNumber(sale.referenceNumber ?? "");
    setDeliveryOrderNo(sale.deliveryOrderNo ?? "");
    setDoLinePrefill(null);
    setVehicleNumber(sale.vehicleNumber);
    setTransactionDate(sale.dateIssuedIso.slice(0, 10));
    setLines(
      sale.lines.map((line) => ({
        productId: String(line.productId),
        qtyKg: line.qtyKg,
        qtyUnits: line.qtyUnits ?? line.qtyKg,
        unitPricePerKg: line.unitPricePerKg,
        unitPricePerUnit: line.unitPricePerUnit ?? line.unitPricePerKg,
        storageLocationId: line.storageLocationId
          ? String(line.storageLocationId)
          : "",
      })),
    );
    setPayments(
      sale.payments.length > 0
        ? sale.payments.map((payment) => ({
            paymentMethodId: payment.paymentMethodId,
            amount: payment.amount,
            chequeNo: payment.chequeNo ?? "",
            bank: payment.bank ?? "",
            traiteNo: payment.traiteNo ?? "",
            traiteIssuedOn: payment.traiteIssuedOn ?? "",
            traiteMaturityOn: payment.traiteMaturityOn ?? "",
          }))
        : [
            {
              paymentMethodId: defaultPaymentMethodId(
                isBottleMode
                  ? cashOnlyPaymentMethods(options?.paymentMethods ?? [])
                  : nonCashPaymentMethods(options?.paymentMethods ?? []),
                isBottleMode,
              ),
              amount: "0",
              ...emptyPaymentExtras(),
            },
          ],
    );
    setLineModal(null);
  }

  async function loadSale(
    rawNo?: string,
    loadOptions?: { notFoundMode?: "error" | "silent" },
  ) {
    const invoice = (rawNo ?? invoiceNo).trim();
    if (!invoice) {
      return;
    }

    const notFoundMode = loadOptions?.notFoundMode ?? "error";

    setBusy("load");
    setBanner(null);

    try {
      const sale = await getElectronApi().sales.loadSaleByInvoiceNo(
        invoice,
        user.id,
      );
      if (!sale) {
        if (notFoundMode === "error") {
          setBanner({ type: "error", text: "Invoice not found." });
        } else {
          setSaleId(null);
          setSaleStatus(null);
          setValidatedByName("");
          setConfirmedInvoiceNo(invoice);
        }
        return;
      }

      const loadedMode = sale.saleProductMode ?? "LOOSE";
      const expectedMode = defaultProductMode;
      if (loadedMode !== expectedMode) {
        setBanner({
          type: "error",
          text:
            expectedMode === "BOTTLE"
              ? "This is a loose-product invoice. Open it on Sales Invoicing."
              : "This is a Bottle Oil invoice. Open it on Bottle Oil sales.",
        });
        return;
      }

      populateSaleFromLoaded(sale);
    } catch (error) {
      setBanner({
        type: "error",
        text:
          error instanceof Error ? error.message : "Failed to load invoice.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function tryLoadInvoiceOnEnter() {
    if (busy !== null || saleId || !invoiceNo.trim()) {
      return;
    }

    if (autoGenerateInvoiceNo) {
      if (confirmedInvoiceNo !== null && confirmedInvoiceNo === invoiceNo.trim()) {
        return;
      }
      await loadSale(undefined, { notFoundMode: "silent" });
      return;
    }

    if (
      confirmedInvoiceNo !== null &&
      confirmedInvoiceNo === invoiceNo.trim() &&
      isValidBookletSerial(invoiceNo)
    ) {
      return;
    }

    const validation = validateBookletSerial(invoiceNo);
    if (validation.ok === false) {
      setBanner({ type: "error", text: validation.error });
      return;
    }

    await loadSale(undefined, { notFoundMode: "silent" });
  }

  function linkDeliveryOrder(
    result: DeliveryOrderLookupResult,
    productId?: number,
  ) {
    setUseRegisteredCustomer(true);
    setCustomerId(String(result.customerId));
    setInvoiceCustomerName("");
    setDeliveryOrderNo(result.deliveryOrderNo);

    const remaining = result.perProduct.filter(
      (row) => parseDec(row.balanceQty) > 0,
    );
    const preferred =
      productId != null
        ? remaining.find((row) => row.productId === productId)
        : remaining.length === 1
          ? remaining[0]
          : undefined;

    if (preferred) {
      setDoLinePrefill({
        productId: preferred.productId,
        qtyKg: preferred.balanceQty,
        unitPrice: preferred.unitPrice,
      });
    } else {
      setDoLinePrefill(null);
    }

    const paymentDrafts = paymentDraftsFromDeliveryOrder(result);
    if (paymentDrafts) {
      setPayments(paymentDrafts);
    }

    setBanner({
      type: "ok",
      text: preferred
        ? `Linked ${result.deliveryOrderNo} · ${preferred.productName}. Review qty and location in Add line.`
        : `Linked ${result.deliveryOrderNo} · ${result.customerName} · balance ${result.balanceKg} kg. Add products with Add line.`,
    });

    return preferred ?? null;
  }

  async function lookupDo() {
    if (!isFormEditable) {
      return;
    }

    const trimmed = deliveryOrderNo.trim();
    const spId = Number.parseInt(salesPointId, 10);

    if (!trimmed || !Number.isFinite(spId)) {
      setBanner({ type: "error", text: "Enter a delivery order number." });
      return;
    }

    setBusy("do-lookup");
    setBanner(null);

    try {
      const result = await getElectronApi().sales.lookupDeliveryOrder({
        deliveryOrderNo: trimmed,
        salesPointId: spId,
        customerId: Number.parseInt(customerId, 10),
      });

      if (!result) {
        setBanner({ type: "error", text: "Delivery order not found." });
        return;
      }

      linkDeliveryOrder(result);
    } catch (error) {
      setBanner({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Failed to lookup delivery order.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function selectDeliveryOrder(doNo: string, productId: number) {
    const spId = Number.parseInt(salesPointId, 10);
    const custId = Number.parseInt(customerId, 10);

    setDoPickerOpen(false);
    setDeliveryOrderNo(doNo);

    if (!Number.isFinite(spId) || !Number.isFinite(custId)) {
      setBanner({
        type: "error",
        text: "Select a collection point and customer before picking a delivery order.",
      });
      return;
    }

    setBusy("do-lookup");
    setBanner(null);

    try {
      const result = await getElectronApi().sales.lookupDeliveryOrder({
        deliveryOrderNo: doNo,
        salesPointId: spId,
        customerId: custId,
      });

      if (!result) {
        setBanner({ type: "error", text: "Delivery order not found." });
        return;
      }

      const preferred = linkDeliveryOrder(result, productId);
      if (preferred && options && !isBottleMode) {
        setLineModal({
          mode: "add",
          index: null,
          line: lineDraftFromDoPrefill({
            productId: preferred.productId,
            qtyKg: preferred.balanceQty,
            unitPrice: preferred.unitPrice,
          }),
        });
      }
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

  async function saveSale(validateImmediately = false) {
    if (!options) {
      return;
    }
    if (validateImmediately && !canDirectValidate) {
      return;
    }

    if (!postingPeriod) {
      setBanner({
        type: "error",
        text: "Open a financial month before posting.",
      });
      return;
    }
    if (
      transactionDate < postingPeriod.startDate ||
      transactionDate > postingPeriod.endDate
    ) {
      setBanner({
        type: "error",
        text: `Sale date must be within the open month (${postingPeriod.monthName} ${postingPeriod.financialYear}).`,
      });
      return;
    }

    if (paymentsMissingMethod(payments)) {
      setBanner({ type: "error", text: "Select a payment method." });
      return;
    }

    if (paymentsMissingTraiteDetails(payments, options.paymentMethods)) {
      setBanner({
        type: "error",
        text: "Enter trait no #, issued date, and maturity date for traite payments.",
      });
      return;
    }

    if (
      !autoGenerateInvoiceNo &&
      options.enforceSalesInvoiceBookletValidation &&
      !saleId
    ) {
      const spId = Number.parseInt(salesPointId, 10);
      if (!Number.isFinite(spId)) {
        setBanner({ type: "error", text: "Select a collection point." });
        return;
      }
      const bookletCheck = await getElectronApi().booklets.validateSerial({
        documentKind: "SALES_INVOICE",
        serial: invoiceNo.trim(),
        salesPointId: spId,
      });
      if (!bookletCheck.ok) {
        setBanner({ type: "error", text: bookletCheck.error });
        return;
      }
    }

    setBusy(validateImmediately ? "validate" : "save");
    setBanner(null);

    try {
      const filteredLines = lines
        .filter((line) => line.productId)
        .filter((line) =>
          isBottleMode ? parseDec(line.qtyUnits) > 0 : parseDec(line.qtyKg) > 0,
        );

      const result = await getElectronApi().sales.createSale({
        userId: user.id,
        ...(autoGenerateInvoiceNo ? {} : { invoiceNo }),
        validateImmediately: validateImmediately || undefined,
        customerId:
          !isInvoiceOnlyCustomer && useRegisteredCustomer
            ? Number.parseInt(customerId, 10)
            : null,
        customerNameOverride: isInvoiceOnlyCustomer
          ? invoiceCustomerName.trim() || undefined
          : undefined,
        salesPointId: salesPointId ? Number.parseInt(salesPointId, 10) : null,
        vehicleNumber,
        dateIssued: transactionDate,
        referenceNumber: referenceNumber || undefined,
        deliveryOrderNo:
          !isBottleMode &&
          !isInvoiceOnlyDisposition &&
          useRegisteredCustomer &&
          deliveryOrderNo.trim()
            ? deliveryOrderNo.trim()
            : undefined,
        saleProductMode: defaultProductMode,
        saleDisposition,
        lines: filteredLines.map((line) => ({
          productId: Number.parseInt(line.productId, 10),
          qtyKg: line.qtyKg,
          qtyUnits: isBottleMode ? line.qtyUnits : undefined,
          unitPricePerKg: line.unitPricePerKg,
          unitPricePerUnit: isBottleMode ? line.unitPricePerUnit : undefined,
          storageLocationId: line.storageLocationId
            ? Number.parseInt(line.storageLocationId, 10)
            : null,
        })),
        payments: payments
          .filter((payment) => parseDec(payment.amount) > 0)
          .map((payment) => ({
            paymentMethodId: payment.paymentMethodId,
            amount: payment.amount,
            chequeNo: payment.chequeNo,
            bank: payment.bank,
            traiteNo: payment.traiteNo,
            traiteIssuedOn: payment.traiteIssuedOn,
            traiteMaturityOn: payment.traiteMaturityOn,
          })),
      });

      if (result.ok === false) {
        setBanner({ type: "error", text: result.error });
        return;
      }

      setBanner({
        type: "ok",
        text: validateImmediately
          ? `Invoice ${result.invoiceNo} validated.`
          : `Sale saved as ${result.invoiceNo}.`,
      });
      await loadSale(result.invoiceNo);
    } catch (error) {
      setBanner({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to save sale.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function validateLoadedSale() {
    if (!saleId) {
      return;
    }

    setBusy("validate");
    setBanner(null);

    try {
      const result = await getElectronApi().sales.validateSale({
        saleId,
        userId: user.id,
      });
      if (result.ok === false) {
        setBanner({ type: "error", text: result.error });
        return;
      }

      setBanner({ type: "ok", text: "Invoice validated." });
      await loadSale(invoiceNo);
    } catch (error) {
      setBanner({
        type: "error",
        text:
          error instanceof Error ? error.message : "Failed to validate sale.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleCancelSale() {
    const trimmed = cancelReasonInput.trim();
    if (!trimmed) {
      setCancelError("Please provide a reason for cancelling this invoice.");
      return;
    }
    if (!saleId) {
      return;
    }

    setBusy("cancel");
    setCancelError(null);
    try {
      const res = await getElectronApi().sales.cancelValidatedSale({
        saleId,
        userId: user.id,
        reason: trimmed,
      });

      if (!res.ok) {
        setCancelError(res.error ?? "Failed to cancel invoice.");
        setBusy(null);
        return;
      }

      setSaleStatus("REJECTED");
      setCancelledByName(user.name);
      setCancelledAtIso(new Date().toISOString());
      setCancelReason(trimmed);
      setCancelModalOpen(false);
      setCancelReasonInput("");
      setBanner({
        type: "ok",
        text: `Invoice ${invoiceNo} has been cancelled successfully. Stock movements reversed.`,
      });
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : "Failed to cancel invoice.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function deleteLoadedSale() {
    if (!saleId) {
      return;
    }

    const isVal = saleStatus === "VALIDATED";
    const isRej = saleStatus === "REJECTED";
    const confirmMessage = isVal
      ? `PERMANENTLY delete validated invoice ${invoiceNo || saleId}? This will reverse deducted stock and remove the invoice completely from the system. This cannot be undone.`
      : isRej
        ? `PERMANENTLY delete cancelled invoice ${invoiceNo || saleId}? This cannot be undone.`
        : `Delete invoice ${invoiceNo || saleId}? This cannot be undone.`;

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) {
      return;
    }

    setBusy("delete");
    setBanner(null);

    try {
      const result = await getElectronApi().sales.deleteSale({
        saleId,
        userId: user.id,
      });
      if (result.ok === false) {
        setBanner({ type: "error", text: result.error });
        return;
      }

      setBanner({ type: "ok", text: "Invoice deleted." });
      resetNew();
    } catch (error) {
      setBanner({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to delete sale.",
      });
    } finally {
      setBusy(null);
    }
  }

  function locationsForSalesPoint(spId: string) {
    if (!options) {
      return [];
    }

    const id = Number.parseInt(spId, 10);
    return options.storageLocations.filter(
      (location) => location.salesPointId === id,
    );
  }

  if (loadError) {
    return <p class="sales-error">{loadError}</p>;
  }

  if (!options) {
    return <p class="sales-muted">Loading sales screen…</p>;
  }

  // Loose Retail / Ration / Public relation use invoice-only names — do not
  // block the whole Sales Invoice screen when the customer directory is empty.
  const setupRequired =
    (isBottleVariant
      ? options.bottledProducts.length === 0
      : options.looseProducts.length === 0) ||
    options.paymentMethods.length === 0 ||
    (isBottleVariant &&
      options.bottleOilUseRegisteredCustomers &&
      options.customers.length === 0);

  const vehicleRequired =
    !isBottleMode && !isSpecialDisposition && saleDisposition !== "RETAIL";
  const showDeliveryOrders =
    !isBottleMode &&
    !isInvoiceOnlyDisposition &&
    useRegisteredCustomer;
  const showPayments = true;
  const hasCustomer = isInvoiceOnlyCustomer
    ? invoiceCustomerName.trim().length > 0
    : customerId.trim().length > 0;
  const canSave =
    isFormEditable &&
    busy === null &&
    !mutationsBlocked &&
    hasCustomer &&
    (autoGenerateInvoiceNo || isValidBookletSerial(invoiceNo)) &&
    (!vehicleRequired || vehicleNumber.trim()) &&
    totals.paid === totals.gross &&
    !paymentsMissingMethod(payments);
  const canDirectValidate = isBottleVariant
    ? options.canDirectValidateBottled
    : options.canDirectValidateLoose;

  if (setupRequired) {
    return (
      <div class="sales-setup">
        <h3>Setup required</h3>
        <ul>
          {(isBottleVariant
            ? options.bottledProducts.length === 0
            : options.looseProducts.length === 0) ? (
            <li>
              Add at least one {isBottleVariant ? "bottled" : "loose"} product.
            </li>
          ) : null}
          {options.paymentMethods.length === 0 ? (
            <li>Activate at least one payment method.</li>
          ) : null}
          {isBottleVariant &&
          options.bottleOilUseRegisteredCustomers &&
          options.customers.length === 0 ? (
            <li>
              Add at least one customer, or turn off “Use registered customers”
              under App settings → Bottle Oil sales.
            </li>
          ) : null}
        </ul>
        <p class="sales-muted">
          Run database reset or apply migrations 003–005 to load demo POS data.
        </p>
      </div>
    );
  }

  return (
    <div class="sales-client sales-client-compact">
      {printOpen && saleId ? (
        <SalePrintView saleId={saleId} onClose={() => setPrintOpen(false)} />
      ) : null}

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

      {saleStatus === "REJECTED" ? (
        <div class="sales-banner sales-banner-error" style={{ marginBottom: "16px" }}>
          <div style={{ fontWeight: 600, fontSize: "14px" }}>
            Invoice Cancelled / Voided
            {cancelledAtIso ? ` on ${cancelledAtIso.slice(0, 10)}` : ""}
            {cancelledByName ? ` by ${cancelledByName}` : ""}
          </div>
          {cancelReason ? (
            <div style={{ marginTop: "4px" }}>
              <strong>Reason:</strong> {cancelReason}
            </div>
          ) : null}
          <div style={{ marginTop: "4px", fontSize: "12px", opacity: 0.9 }}>
            Stock movements have been reversed and Delivery Order allocations released. This invoice is excluded from financial and tax reports.
          </div>
        </div>
      ) : null}

      <section class="sales-panel">
        <div class="sales-invoice-header">
          <div>
            <h2>Invoice details</h2>
            <p class="sales-muted">
              Status{" "}
              {saleStatus ? (
                <span class={statusClass(saleStatus)}>{saleStatus}</span>
              ) : (
                "—"
              )}
              {validatedByName ? ` · validated by ${validatedByName}` : ""}
              {cancelledByName ? ` · cancelled by ${cancelledByName}` : ""}
              {isBottleVariant || saleProductMode === "BOTTLE"
                ? " · Bottle mode"
                : ""}
              {saleDisposition !== "NORMAL"
                ? ` · ${saleDisposition === "RETAIL" ? "Retail" : saleDisposition.replace("_", " ")}`
                : ""}
            </p>
          </div>
          {saleId ? (
            <div class="sales-invoice-header-end">
              <div class="sales-invoice-header-actions">
                <button
                  type="button"
                  class="sales-btn-secondary"
                  disabled={busy !== null}
                  onClick={resetNew}
                >
                  New sale
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div class="sales-invoice-form">
          <div class="sales-invoice-grid">
            <div class="sales-invoice-options sales-field-span-full">
              <fieldset
                class="sales-checkbox-group"
                disabled={!canEditDisposition}
              >
                <legend>Disposition</legend>
                <label class="sales-checkbox">
                  <input
                    type="checkbox"
                    checked={saleDisposition === "NORMAL"}
                    disabled={!canEditDisposition}
                    onChange={(event) => {
                      if ((event.currentTarget as HTMLInputElement).checked) {
                        setSaleDisposition("NORMAL");
                      }
                      setDispositionChosen(true);
                    }}
                  />
                  Normal
                </label>
                {!isBottleVariant || options.bottleOilAllowRation ? (
                  <label class="sales-checkbox">
                    <input
                      type="checkbox"
                      checked={saleDisposition === "RATION"}
                      disabled={!canEditDisposition}
                      onChange={(event) => {
                        setSaleDisposition(
                          (event.currentTarget as HTMLInputElement).checked
                            ? "RATION"
                            : "NORMAL",
                        );
                        setDispositionChosen(true);
                      }}
                    />
                    Ration
                  </label>
                ) : null}
                {isBottleVariant || options.looseSalesAllowPublicRelation ? (
                  <label class="sales-checkbox">
                    <input
                      type="checkbox"
                      checked={saleDisposition === "PUBLIC_RELATION"}
                      disabled={!canEditDisposition}
                      onChange={(event) => {
                        setSaleDisposition(
                          (event.currentTarget as HTMLInputElement).checked
                            ? "PUBLIC_RELATION"
                            : "NORMAL",
                        );
                        setDispositionChosen(true);
                      }}
                    />
                    Public relation
                  </label>
                ) : null}
                {!isBottleVariant ? (
                  <label class="sales-checkbox">
                    <input
                      type="checkbox"
                      checked={saleDisposition === "RETAIL"}
                      disabled={!canEditDisposition}
                      onChange={(event) => {
                        setSaleDisposition(
                          (event.currentTarget as HTMLInputElement).checked
                            ? "RETAIL"
                            : "NORMAL",
                        );
                        setDispositionChosen(true);
                      }}
                    />
                    Retail (below 3000 kg, no DO)
                  </label>
                ) : null}
              </fieldset>
              {!dispositionChosen && !isReadOnly ? (
                <p class="sales-hint">
                  Select disposition before entering the invoice number.
                </p>
              ) : null}
              {!isBottleVariant && isSpecialDisposition ? (
                <p class="sales-hint">Limited to Loose Palm Oil.</p>
              ) : null}
              {!isBottleVariant && saleDisposition === "RETAIL" ? (
                <p class="sales-hint">
                  Retail invoice: invoice-only customer (no directory); no
                  delivery order; each line must be below 3000 kg. Price uses the
                  Retail schedule.
                </p>
              ) : null}
            </div>

            <label class="sales-field sales-field-span-full sales-invoice-no-field">
              <span>Invoice #</span>
              {saleId ? (
                <div class="sales-invoice-no">{invoiceNo}</div>
              ) : (
                <input
                  type="text"
                  inputMode={autoGenerateInvoiceNo ? "text" : "numeric"}
                  pattern={autoGenerateInvoiceNo ? undefined : "\\d*"}
                  value={invoiceNo}
                  placeholder={
                    !dispositionChosen
                      ? "Select disposition first"
                      : autoGenerateInvoiceNo
                        ? "Invoice No. (or leave blank)"
                        : "Invoice No."
                  }
                  disabled={!canEnterInvoiceNo}
                  onInput={(event) =>
                    setInvoiceNo(
                      (event.currentTarget as HTMLInputElement).value,
                    )
                  }
                  onBlur={() => void tryLoadInvoiceOnEnter()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void tryLoadInvoiceOnEnter();
                    }
                  }}
                />
              )}
            </label>

            <div
              class={`sales-invoice-details-fields${
                !isFormEditable ? " sales-form-locked" : ""
              }`}
            >
            <div
              class={`sales-invoice-balance-row${vehicleRequired ? " sales-invoice-balance-row--3" : " sales-invoice-balance-row--2"}`}
            >
              <label class="sales-field">
                <span>Sale date</span>
                <input
                  type="date"
                  value={transactionDate}
                  min={postingPeriod?.startDate}
                  max={postingPeriod?.endDate}
                  disabled={!isFormEditable || !postingPeriod}
                  onInput={(event) =>
                    setTransactionDate(
                      clampDateToPeriod(
                        (event.currentTarget as HTMLInputElement).value,
                        postingPeriod,
                      ),
                    )
                  }
                />
              </label>

              <label class="sales-field">
                <span>Collection point</span>
                <select
                  value={salesPointId}
                  disabled={
                    !isFormEditable ||
                    options.scopedSalesPointId != null ||
                    (isBottleVariant && options.botaSalesPointId != null)
                  }
                  onChange={(event) => {
                    const next = (event.currentTarget as HTMLSelectElement).value;
                    setSalesPointId(next);
                  }}
                >
                  <option value="">Select collection point</option>
                  {options.salesPoints.map((point) => (
                    <option key={point.id} value={String(point.id)}>
                      {point.name}
                    </option>
                  ))}
                </select>
                {bookletStatus ? (
                  <small
                    style={{
                      display: "block",
                      marginTop: "4px",
                      fontWeight: 600,
                      color: bookletStatus.ok ? "#15803d" : "#b91c1c",
                    }}
                  >
                    {bookletStatus.ok ? "✓ " : "⚠ "}
                    {bookletStatus.message}
                  </small>
                ) : null}
              </label>

              {vehicleRequired ? (
                <label class="sales-field">
                  <span>Veh. Consign. #</span>
                  <input
                    type="text"
                    value={vehicleNumber}
                    disabled={!isFormEditable}
                    onInput={(event) =>
                      setVehicleNumber(
                        (event.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                </label>
              ) : null}
            </div>

            <label
              class={`sales-field${showDeliveryOrders ? " sales-field-span-2" : " sales-field-span-full"}`}
            >
              <span>Customer</span>
              {isInvoiceOnlyCustomer ? (
                <>
                  <input
                    type="text"
                    value={invoiceCustomerName}
                    disabled={!isFormEditable}
                    placeholder="Customer name on invoice"
                    onInput={(event) =>
                      setInvoiceCustomerName(
                        (event.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                  <span class="sales-hint">
                    Invoice-only customer · VAT exempt
                  </span>
                </>
              ) : (
                <>
                  <select
                    value={customerId}
                    disabled={!isFormEditable}
                    onChange={(event) =>
                      setCustomerId(
                        (event.currentTarget as HTMLSelectElement).value,
                      )
                    }
                  >
                    <option value="">Select customer</option>
                    {options.customers.map((item) => (
                      <option key={item.id} value={String(item.id)}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  {isBottleVariant ? (
                    <span class="sales-hint">
                      Directory customer required (App settings)
                    </span>
                  ) : options.customers.length === 0 ? (
                    <span class="sales-hint">
                      No directory customers — use Retail, Ration, or Public
                      relation, or add customers / enable unregistered customer
                      in App settings.
                    </span>
                  ) : null}
                 {/*  <span class="sales-hint">
                    Regime: {customer?.taxRegimeName ?? "—"}
                    {!skipTax && taxProfile?.vatApplies
                      ? " · VAT applies"
                      : " · VAT exempt"}
                    {!skipTax && taxProfile
                      ? ` · Sales tax ${(taxProfile.salesTaxRate * 100).toFixed(0)}%`
                      : ""}
                  </span> */}
                </>
              )}
            </label>

            {showDeliveryOrders ? (
              <label class="sales-field sales-field-span-2 sales-field-do">
                <span>Delivery order no. (optional)</span>
                <div class="sales-do-row">
                  <input
                    type="text"
                    value={deliveryOrderNo}
                    disabled={!isFormEditable}
                    placeholder="DO-2026-000001"
                    onInput={(event) => {
                      setDeliveryOrderNo(
                        (event.currentTarget as HTMLInputElement).value,
                      );
                      setDoLinePrefill(null);
                    }}
                  />
                  {isFormEditable ? (
                    <>
                      <button
                        type="button"
                        class="sales-btn-secondary sales-do-btn"
                        disabled={
                          busy !== null ||
                          !isFormEditable ||
                          !deliveryOrderNo.trim()
                        }
                        onClick={() => void lookupDo()}
                      >
                        {busy === "do-lookup" ? "…" : "Lookup"}
                      </button>
                      {availableDos.length > 0 ? (
                        <button
                          type="button"
                          class="sales-btn-secondary sales-do-btn"
                          disabled={busy !== null || !isFormEditable}
                          onClick={() => setDoPickerOpen((open) => !open)}
                        >
                          Pick DO {doPickerOpen ? "▴" : "▾"}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {doPickerOpen && availableDos.length > 0 ? (
                  <ul class="sales-do-picker">
                    {availableDos.map((row) => (
                      <li key={`${row.deliveryOrderNo}:${row.productId}`}>
                        <button
                          type="button"
                          disabled={busy !== null || !isFormEditable}
                          onClick={() =>
                            void selectDeliveryOrder(
                              row.deliveryOrderNo,
                              row.productId,
                            )
                          }
                        >
                          <strong>
                            {row.isCarryForward ? "CF · " : ""}
                            {row.deliveryOrderNo}
                            {row.isCarryForward && row.sourceDocumentNo
                              ? ` · orig ${row.sourceDocumentNo}`
                              : ""}
                          </strong>
                          <span>
                            {row.productName} · {formatDisplayDate(row.dateIssued)} ·{" "}
                            {row.balanceKg} kg left
                            {row.isCarryForward ? " · carry-forward" : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </label>
            ) : null}
            </div>
          </div>
        </div>
      </section>

      <section
        class={`sales-panel sales-items-panel${isBottleVariant ? " sales-items-panel-tall" : ""}${!isFormEditable ? " sales-panel-locked" : ""}`}
      >
        <div class="sales-section-header">
          <div>
            <h3>
              Items · {lines.length} line{lines.length === 1 ? "" : "s"} ·{" "}
              {formatAmount(itemsSubtotal)} XAF subtotal
            </h3>
          </div>
          {isFormEditable ? (
            <button
              type="button"
              class="sales-btn-secondary"
              onClick={openAddLineModal}
            >
              Add line
            </button>
          ) : null}
        </div>

        <div class="sales-table-wrap sales-items-table-wrap">
          <table class="sales-table sales-items-table">
            <thead>
              <tr>
                <th class="sales-items-col-no">#</th>
                <th>Product</th>
                {!isBottleMode ? <th>Location</th> : null}
                <th class="sales-num">
                  {isBottleMode ? "Qty (units)" : "Qty (kg)"}
                </th>
                <th class="sales-num">
                  {isBottleMode ? "Price / unit" : "Price / kg"}
                </th>
                <th class="sales-num">Amount (XAF)</th>
                {isFormEditable ? (
                  <th class="sales-items-col-actions">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      isBottleMode ? (isReadOnly ? 5 : 6) : isReadOnly ? 6 : 7
                    }
                    class="sales-items-empty"
                  >
                    <strong>No items yet</strong>
                    <span>
                      {isReadOnly
                        ? "This invoice has no line items."
                        : !dispositionChosen
                          ? "Select disposition first, then enter the invoice number."
                          : isAwaitingInvoice
                            ? "Enter invoice no. and press Enter to add items."
                            : "Use Add line to enter products for this sale."}
                    </span>
                  </td>
                </tr>
              ) : (
                lines.map((line, index) => {
                  const subtotal = getLineSubtotal(
                    line,
                    isBottleMode,
                    isSpecialDisposition,
                  );

                  return (
                    <tr key={`${line.productId}-${index}`}>
                      <td class="sales-items-col-no">{index + 1}</td>
                      <td>
                        <span class="sales-items-product">
                          {getProductLabel(line.productId, catalogProducts)}
                        </span>
                      </td>
                      {!isBottleMode ? (
                        <td>
                          {getLocationLabel(
                            line.storageLocationId,
                            salesPointLocations,
                          )}
                        </td>
                      ) : null}
                      <td class="sales-num">
                        {getLineQuantity(line, isBottleMode)}
                      </td>
                      <td class="sales-num">
                        {formatAmount(
                          parseDec(
                            getLineUnitPrice(
                              line,
                              isBottleMode,
                              isSpecialDisposition,
                            ),
                          ),
                        )}
                      </td>
                      <td class="sales-num sales-strong">
                        {formatAmount(subtotal)}
                      </td>
                      {isFormEditable ? (
                        <td class="sales-items-col-actions">
                          <div class="sales-items-actions">
                            <button
                              type="button"
                              class="sales-link-btn"
                              onClick={() => openEditLineModal(index)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              class="sales-link-btn sales-link-btn-danger"
                              onClick={() => removeLine(index)}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
            </tbody>
            {lines.length > 0 ? (
              <tfoot>
                <tr>
                  <td
                    colSpan={
                      (isBottleMode
                        ? isReadOnly
                          ? 5
                          : 6
                        : isReadOnly
                          ? 6
                          : 7) - 1
                    }
                  >
                    {lines.length} item{lines.length === 1 ? "" : "s"}
                  </td>
                  <td class="sales-num sales-strong">
                    {formatAmount(itemsSubtotal)} XAF
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>

       {/*  <hr /> */}
       {/*  <section class="sales-panel sales-totals">
          <p>Invoice Summary</p>
          <div class="sales-totals-row">
            <span>{isBottleMode ? "Total (tax inclusive)" : "Net"}</span>
            <span>{formatAmount(totals.net)} XAF</span>
          </div>
          {!isBottleMode && !isSpecialDisposition ? (
            <>
              <div class="sales-totals-row">
                <span>VAT</span>
                <span>{formatAmount(totals.vat)} XAF</span>
              </div>
              <div class="sales-totals-row">
                <span>Sales tax</span>
                <span>{formatAmount(totals.salesTax)} XAF</span>
              </div>
            </>
          ) : null}
          <div class="sales-totals-row sales-totals-strong">
            <span>Total</span>
            <span>{formatAmount(totals.gross)} XAF</span>
          </div>
          {showPayments ? (
            <>
              <div class="sales-totals-row">
                <span>Paid</span>
                <span>{formatAmount(totals.paid)} XAF</span>
              </div>
              <p class="sales-hint">No credit sales: paid must equal total.</p>
            </>
          ) : null}
        </section> */}
      </section>

      {showPayments ? (
        <section
          class={`sales-panel sales-payments-panel${!isFormEditable ? " sales-panel-locked" : ""}`}
        >
          <div class="sales-section-header">
            <div>
              <h3>
                Payments · {payments.length} payment
                {payments.length === 1 ? "" : "s"} · {formatAmount(totals.paid)}{" "}
                XAF paid
              </h3>
            </div>
            {isFormEditable && !isBottleMode && !isSpecialDisposition ? (
              <button
                type="button"
                class="sales-btn-secondary"
                onClick={() =>
                  setPayments((current) => [
                    ...current,
                    { paymentMethodId: "", amount: "0", ...emptyPaymentExtras() },
                  ])
                }
              >
                Add payment line
              </button>
            ) : null}
          </div>

          <div class="sales-payments-form">
            {payments.map((payment, index) => {
              const method =
                paymentMethodOptions.find(
                  (item) => item.id === payment.paymentMethodId,
                ) ??
                options.paymentMethods.find(
                  (item) => item.id === payment.paymentMethodId,
                );
              const methodLabel =
                method?.name ??
                dispositionPaymentMethodName(options, payment.paymentMethodId) ??
                (isBottleMode && !isSpecialDisposition ? "Cash" : null) ??
                payment.paymentMethodId ??
                "—";
              const isCheque = method?.kind === "CHEQUE";
              const isTraite = method?.kind === "TRAITE";
              const isBankTransfer = method?.kind === "BANK_TRANSFER";
              const bankEnabled = isCheque || isBankTransfer || isTraite;
              const gridClass = isTraite
                ? "sales-payment-grid sales-payment-grid--cols-6"
                : "sales-payment-grid sales-payment-grid--cols-4";

              return (
                <div class="sales-payment-row" key={index}>
                  <div class={gridClass}>
                    <label class="sales-field">
                      <span>Method</span>
                      {isReadOnly || isBottleMode || isSpecialDisposition ? (
                        <div class="sales-payment-value">
                          {methodLabel}
                        </div>
                      ) : (
                        <select
                          value={payment.paymentMethodId}
                          disabled={!isFormEditable}
                          onChange={(event) =>
                            setPayments((current) =>
                              current.map((item, i) =>
                                i === index
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
                          {paymentMethodOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>

                    <label class="sales-field">
                      <span>Amount</span>
                      {isReadOnly ? (
                        <div class="sales-payment-value">
                          {formatAmount(parseDec(payment.amount))} XAF
                        </div>
                      ) : (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatAmountInput(payment.amount)}
                          disabled={!isFormEditable || lockPaymentAmount}
                        />
                      )}
                    </label>

                    {isTraite ? (
                      <>
                        <label class="sales-field">
                          <span>Trait no #</span>
                          {isReadOnly ? (
                            <div class="sales-payment-value">
                              {payment.traiteNo ?? "—"}
                            </div>
                          ) : (
                            <input
                              type="text"
                              value={payment.traiteNo ?? ""}
                              disabled={!isFormEditable}
                              placeholder="Trait number"
                              onInput={(event) =>
                                setPayments((current) =>
                                  current.map((item, i) =>
                                    i === index
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
                          )}
                        </label>

                        <label class="sales-field">
                          <span>Issued on</span>
                          {isReadOnly ? (
                            <div class="sales-payment-value">
                              {payment.traiteIssuedOn ?? "—"}
                            </div>
                          ) : (
                            <input
                              type="date"
                              value={payment.traiteIssuedOn ?? ""}
                              disabled={!isFormEditable}
                              onInput={(event) =>
                                setPayments((current) =>
                                  current.map((item, i) =>
                                    i === index
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
                          )}
                        </label>

                        <label class="sales-field">
                          <span>Maturity on</span>
                          {isReadOnly ? (
                            <div class="sales-payment-value">
                              {payment.traiteMaturityOn ?? "—"}
                            </div>
                          ) : (
                            <input
                              type="date"
                              value={payment.traiteMaturityOn ?? ""}
                              disabled={!isFormEditable}
                              onInput={(event) =>
                                setPayments((current) =>
                                  current.map((item, i) =>
                                    i === index
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
                          )}
                        </label>
                      </>
                    ) : (
                      <label class="sales-field">
                        <span>Cheque #</span>
                        {isReadOnly ? (
                          <div class="sales-payment-value">
                            {payment.chequeNo ?? "—"}
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={payment.chequeNo ?? ""}
                            disabled={!isFormEditable || !isCheque}
                            placeholder={isCheque ? "Cheque number" : "—"}
                            onInput={(event) =>
                              setPayments((current) =>
                                current.map((item, i) =>
                                  i === index
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
                        )}
                      </label>
                    )}

                    <label class="sales-field">
                      <span>Bank</span>
                      {isReadOnly ? (
                        <div class="sales-payment-value">
                          {payment.bank ?? "—"}
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={payment.bank ?? ""}
                          disabled={!isFormEditable || !bankEnabled}
                          placeholder={bankEnabled ? "Bank name" : "—"}
                          onInput={(event) =>
                            setPayments((current) =>
                              current.map((item, i) =>
                                i === index
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
                      )}
                    </label>
                  </div>

                  {isFormEditable && !isBottleMode && !isSpecialDisposition ? (
                    <button
                      type="button"
                      class="sales-btn-secondary sales-payment-remove"
                      disabled={payments.length === 1}
                      onClick={() =>
                        setPayments((current) =>
                          current.filter((_, i) => i !== index),
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
      ) : null}

      <div class="sales-actions">
        {isFormEditable && canDirectValidate ? (
          <>
            <button
              type="button"
              class="sales-btn-primary"
              disabled={!canSave || busy !== null}
              onClick={() => void saveSale(true)}
            >
              {busy === "validate" ? "Validating…" : "Validate invoice"}
            </button>
            <button
              type="button"
              class="sales-btn-secondary"
              disabled={!canSave || busy !== null}
              onClick={() => void saveSale(false)}
            >
              {busy === "save" ? "Saving…" : "Save as pending"}
            </button>
          </>
        ) : isFormEditable ? (
          <button
            type="button"
            class="sales-btn-primary"
            disabled={!canSave}
            onClick={() => void saveSale(false)}
          >
            {busy === "save" ? "Saving…" : "Save sale (create invoice)"}
          </button>
        ) : null}

        {saleId ? (
          <button
            type="button"
            class="sales-btn-secondary"
            disabled={busy !== null}
            onClick={() => setPrintOpen(true)}
          >
            Print invoice
          </button>
        ) : null}

        {saleId && saleStatus === "PENDING" && canValidate ? (
          <button
            type="button"
            class="sales-btn-secondary"
            disabled={busy !== null}
            onClick={() => void validateLoadedSale()}
          >
            {busy === "validate" ? "Validating…" : "Validate invoice"}
          </button>
        ) : null}

        {saleId && saleStatus === "VALIDATED" && canCancelValidated ? (
          <button
            type="button"
            class="sales-btn-danger"
            disabled={busy !== null}
            onClick={() => {
              setCancelReasonInput("");
              setCancelError(null);
              setCancelModalOpen(true);
            }}
          >
            Cancel invoice
          </button>
        ) : null}

        {saleId &&
        (saleStatus === "PENDING" ||
          (canDeleteValidated &&
            (saleStatus === "VALIDATED" || saleStatus === "REJECTED"))) ? (
          <button
            type="button"
            class="sales-btn-danger"
            disabled={busy !== null}
            onClick={() => void deleteLoadedSale()}
          >
            {busy === "delete"
              ? "Deleting…"
              : saleStatus === "PENDING"
                ? "Delete invoice"
                : "Permanently delete"}
          </button>
        ) : null}

        <button
          type="button"
          class="sales-btn-secondary"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {lineModal ? (
        <SalesLineModal
          line={lineModal.line}
          products={activeProducts}
          salesPointId={(() => {
            const parsed = Number.parseInt(salesPointId, 10);
            return Number.isFinite(parsed) ? parsed : null;
          })()}
          preferredStorageLocationId={
            options
              ? defaultStorageLocationId(options, salesPointId, isBottleMode)
              : ""
          }
          isBottleMode={isBottleMode}
          saleDisposition={saleDisposition}
          useRegisteredCustomer={useRegisteredCustomer}
          customerId={customerId}
          transactionDate={transactionDate}
          loosePalmOilRequireSalesTank={
            options?.loosePalmOilRequireSalesTank ?? true
          }
          mode={lineModal.mode}
          lockUnitPriceFromSchedule={options.salesInvoiceLockUnitPrice}
          onClose={() => setLineModal(null)}
          onSave={saveLineModal}
        />
      ) : null}

      {cancelModalOpen && saleId ? (
        <div
          class="sales-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Cancel invoice"
        >
          <button
            type="button"
            class="sales-modal-backdrop"
            aria-label="Close"
            onClick={() => {
              if (busy !== "cancel") setCancelModalOpen(false);
            }}
          />
          <div class="sales-modal-panel">
            <div class="sales-modal-header">
              <div class="sales-modal-title">
                Cancel invoice {invoiceNo || saleId}
              </div>
              <button
                type="button"
                class="sales-modal-close"
                onClick={() => {
                  if (busy !== "cancel") setCancelModalOpen(false);
                }}
              >
                ✕
              </button>
            </div>
            <div class="sales-modal-body">
              <p class="sales-muted">
                Are you sure you want to cancel this validated invoice?
              </p>
              <ul
                style={{
                  margin: "8px 0",
                  paddingLeft: "20px",
                  fontSize: "13px",
                  color: "var(--text-muted)",
                }}
              >
                <li>
                  The invoice status will be changed to <strong>REJECTED</strong>.
                </li>
                <li>
                  Deducted stock will be restored to inventory via a sale reversal.
                </li>
                <li>
                  Committed quantities on any linked Delivery Order will be
                  released.
                </li>
                <li>
                  The invoice will be excluded from all sales, tax, and revenue
                  reports.
                </li>
              </ul>
              {cancelError ? (
                <div
                  class="sales-banner sales-banner-error"
                  style={{ marginBottom: "12px" }}
                >
                  {cancelError}
                </div>
              ) : null}
              <label
                class="sales-field"
                style={{ marginTop: "12px", display: "block" }}
              >
                <span class="sales-label">
                  Reason for cancellation{" "}
                  <span style={{ color: "var(--danger, #dc2626)" }}>*</span>
                </span>
                <textarea
                  class="sales-input"
                  style={{
                    width: "100%",
                    minHeight: "80px",
                    resize: "vertical",
                    marginTop: "4px",
                  }}
                  placeholder="e.g. Customer cancelled order / Incorrect pricing entered / Duplicate invoice"
                  value={cancelReasonInput}
                  onInput={(e) =>
                    setCancelReasonInput(
                      (e.target as HTMLTextAreaElement).value,
                    )
                  }
                  disabled={busy === "cancel"}
                />
              </label>
              <div class="sales-modal-actions">
                <button
                  type="button"
                  class="sales-btn-secondary"
                  onClick={() => setCancelModalOpen(false)}
                  disabled={busy === "cancel"}
                >
                  Keep invoice
                </button>
                <button
                  type="button"
                  class="sales-btn-danger"
                  onClick={() => void handleCancelSale()}
                  disabled={busy === "cancel" || !cancelReasonInput.trim()}
                >
                  {busy === "cancel" ? "Cancelling…" : "Confirm cancellation"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
