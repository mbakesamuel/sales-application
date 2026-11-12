export type SaleStatus = "PENDING" | "VALIDATED" | "REJECTED";

export type PaymentMethodKind =
  | "SIMPLE"
  | "CHEQUE"
  | "TRAITE"
  | "CREDIT"
  | "BANK_TRANSFER"
  | "PUBLIC_RELATION";

export type SaleProductMode = "LOOSE" | "BOTTLE";

export type SaleDisposition =
  | "NORMAL"
  | "RATION"
  | "PUBLIC_RELATION"
  | "RETAIL";

export interface SalesCustomerOption {
  id: number;
  name: string;
  taxRegimeId: string | null;
  taxRegimeName: string | null;
  taxRegimeKind: string | null;
  residency: string;
  taxpayerId: string | null;
  vatApplies: boolean;
  salesTaxExempt: boolean;
  salesTaxRate: number;
}

export interface SalesProductOption {
  productId: number;
  productName: string;
  productCat: string;
  /** ProductCat.productCode — used for storage-location exceptions (PKCP/PKP). */
  productCatCode: string;
  /** True when this product is loose LPO (product code LPO), not other SKUs in the main category. */
  isMain: boolean;
  /** When true, stock is tracked at collection-point level (no storage location). */
  omitsStorageLocation: boolean;
  /** When true, unit price is entered manually (negotiated); schedule is not used. */
  requiresManualUnitPrice: boolean;
  /** When true, sales skip stock availability checks and do not post stock movements. */
  nonStockable: boolean;
}

export interface SalesPaymentMethodOption {
  id: string;
  code: string;
  name: string;
  kind: PaymentMethodKind;
}

export interface SalesPointOption {
  id: number;
  name: string;
}

export interface StorageLocationOption {
  id: number;
  salesPointId: number;
  name: string;
  isDefault: boolean;
  isSalesTank: boolean;
}

/** Storage locations with live SELLABLE on-hand for a product at a sales point. */
export interface SalesStorageLocationBalanceOption {
  id: number;
  name: string;
  qty: number;
}

export interface SalesFormOptions {
  customers: SalesCustomerOption[];
  looseProducts: SalesProductOption[];
  bottledProducts: SalesProductOption[];
  paymentMethods: SalesPaymentMethodOption[];
  salesPoints: SalesPointOption[];
  storageLocations: StorageLocationOption[];
  /** When set, the signed-in user is locked to this collection point. */
  scopedSalesPointId: number | null;
  vatRateDecimal: string;
  companyName: string;
  botaSalesPointId: number | null;
  bottleOilStoreLocationId: number | null;
  invoiceOnlyTaxRegimeId: string | null;
  canDirectValidate: boolean;
  canDirectValidateLoose: boolean;
  canDirectValidateBottled: boolean;
  /** Company setting: Bottle Oil invoices use directory customers when true. */
  bottleOilUseRegisteredCustomers: boolean;
  /** Company setting: Bottle Oil invoices may use Ration disposition when true. */
  bottleOilAllowRation: boolean;
  /** Company setting: loose Sales Invoicing may use Public relation when true. */
  looseSalesAllowPublicRelation: boolean;
  /** Company setting: loose normal invoices may use invoice-name-only customers when true. */
  looseSalesAllowUnregisteredCustomer: boolean;
  /** Company setting: Loose Palm Oil must use a sales tank when true (default). */
  loosePalmOilRequireSalesTank: boolean;
  /** Company setting: invoice line unit price is schedule-only (read-only) when true. */
  salesInvoiceLockUnitPrice: boolean;
  /** Company setting: system assigns INV-year-###### on create when true. */
  autoGenerateSalesInvoiceNo: boolean;
  /** Company setting: manual booklet serial must belong to an active booklet issued to the collection point. */
  enforceSalesInvoiceBookletValidation: boolean;
  /** System payment method id for Ration (deferred) disposition. */
  rationPaymentMethodId: string;
  /** System payment method id for Public relation (complimentary) disposition. */
  publicRelationPaymentMethodId: string;
}

export interface SaleLineInput {
  productId: number;
  qtyKg: string;
  qtyUnits?: string;
  unitPricePerKg: string;
  unitPricePerUnit?: string;
  storageLocationId?: number | null;
}

export interface SalePaymentInput {
  paymentMethodId: string;
  amount: string;
  chequeNo?: string;
  bank?: string;
  traiteNo?: string;
  traiteIssuedOn?: string;
  traiteMaturityOn?: string;
}

export interface CreateSaleInput {
  userId: string;
  invoiceNo?: string;
  customerId?: number | null;
  customerNameOverride?: string;
  salesPointId?: number | null;
  vehicleNumber: string;
  dateIssued: string;
  referenceNumber?: string;
  deliveryOrderNo?: string;
  saleProductMode?: SaleProductMode;
  saleDisposition?: SaleDisposition;
  /** Optional UI totals so thin-client paid amount matches server invoice gross. */
  netAmount?: string;
  vatAmount?: string;
  grossAmount?: string;
  lines: SaleLineInput[];
  payments: SalePaymentInput[];
  /** Create and validate in one step; requires direct_validate_sales. New invoices only. */
  validateImmediately?: boolean;
}

export type SaveSaleResult =
  | { ok: true; saleId: string; invoiceNo: string }
  | { ok: false; error: string };

export type SaleMutationResult =
  | { ok: true }
  | { ok: false; error: string };

export type UnitPricePreviewResult =
  | { ok: true; unitPriceExTax: string }
  | { ok: false; error: string };

export interface LoadedSaleLine {
  productId: number;
  productName: string;
  productCat: string;
  storageLocationId: number | null;
  qtyKg: string;
  qtyUnits: string | null;
  unitPricePerKg: string;
  unitPricePerUnit: string | null;
  lineNet: string;
  lineVat: string;
  lineGross: string;
}

export interface LoadedSalePayment {
  paymentMethodId: string;
  methodCode: string;
  methodName: string;
  kind: PaymentMethodKind;
  amount: string;
  chequeNo: string | null;
  bank: string | null;
  traiteNo: string | null;
  traiteIssuedOn: string | null;
  traiteMaturityOn: string | null;
  paidAtIso: string;
}

export interface LoadedSaleView {
  id: string;
  invoiceNo: string;
  soldAtIso: string;
  referenceNumber: string | null;
  salesPointId: number | null;
  salesPointName: string | null;
  customerId: number | null;
  customerName: string;
  createdByUserId: string;
  createdByName: string;
  status: SaleStatus;
  validatedAtIso: string | null;
  validatedByName: string | null;
  cancelledAtIso?: string | null;
  cancelledByName?: string | null;
  cancelReason?: string | null;
  vehicleNumber: string;
  dateIssuedIso: string;
  deliveryOrderNo: string | null;
  saleProductMode: SaleProductMode | null;
  saleDisposition: SaleDisposition | null;
  netAmount: string;
  vatAmount: string;
  grossAmount: string;
  lines: LoadedSaleLine[];
  payments: LoadedSalePayment[];
}

export interface PendingSaleRow {
  invoiceNo: string;
  soldAtIso: string;
  customerName: string;
  totalLabel: string;
  salesPointName: string | null;
}

export interface SalesValidationQueueRow {
  id: string;
  invoiceNo: string;
  soldAtIso: string;
  dateIssuedIso: string;
  customerName: string;
  salesPointName: string | null;
  createdByName: string;
  saleProductMode: SaleProductMode | null;
  totalLabel: string;
  lineCount: number;
}

export interface SalesValidationQueuePage {
  totalPending: number;
  rows: SalesValidationQueueRow[];
}

export type SalesValidateManyResult =
  | {
      ok: true;
      validated: number;
      errors: Array<{ id: string; invoiceNo?: string; error: string }>;
    }
  | { ok: false; error: string };

export interface AvailableDeliveryOrderRow {
  deliveryOrderNo: string;
  customerName: string;
  dateIssued: string;
  productId: number;
  productName: string;
  /** Remaining kg for this product only (not DO total). */
  balanceKg: string;
  isCarryForward?: boolean;
  /** Original paper/booklet DO # when this row is a carry-forward commitment. */
  sourceDocumentNo?: string | null;
}

export interface DeliveryOrderProductRow {
  productId: number;
  productName: string;
  orderQty: string;
  soldQty: string;
  balanceQty: string;
  unitPrice: string;
}

export interface DeliveryOrderLookupPayment {
  paymentMethodId: string;
  kind: PaymentMethodKind;
  chequeNo: string | null;
  bank: string | null;
  traiteNo: string | null;
  traiteIssuedOn: string | null;
  traiteMaturityOn: string | null;
}

export interface DeliveryOrderLookupResult {
  deliveryOrderNo: string;
  dateIssued: string;
  customerId: number;
  customerName: string;
  customerMatches: boolean;
  balanceKg: string;
  isCarryForward: boolean;
  sourceDocumentNo?: string | null;
  perProduct: DeliveryOrderProductRow[];
  payments: DeliveryOrderLookupPayment[];
}

export interface SalePrintLine {
  lineNo: number;
  productCode: string | null;
  productName: string;
  productCat: string;
  qty: string;
  unitLabel: string;
  unitPrice: string;
  lineNet: string;
}

export interface SalePrintPayload {
  companyName: string;
  department: string | null;
  serviceName: string | null;
  companyPhone: string | null;
  companyAddress: string | null;
  logoUrl: string | null;
  signatoryName: string;
  signatoryTitle: string;
  sale: {
    invoiceNo: string;
    status: string;
    soldAtIso: string;
    vehicleNumber: string;
    dateIssuedIso: string;
    deliveryOrderNo: string | null;
    referenceNumber: string | null;
    customerName: string;
    customerAddress: string | null;
    customerPhone: string | null;
    taxpayerId: string | null;
    salespersonName: string | null;
    salesPointName: string | null;
    saleProductMode: string | null;
    saleDisposition: string | null;
    netAmount: string;
    vatAmount: string;
    grossAmount: string;
    appliedTaxes: Array<{ label: string; ratePercent: string; amount: string }>;
    lines: SalePrintLine[];
    payments: Array<{
      methodName: string;
      amount: string;
      paymentDate: string | null;
    }>;
  };
}

export type SalesListPeriod = "month" | "year" | "all";

export interface SalesListFilters {
  /** Required for collection-point scoping of list results. */
  userId?: string;
  q?: string;
  period?: SalesListPeriod;
  productMode?: SaleProductMode;
}

export interface SalesListRow {
  id: string;
  invoiceNo: string;
  soldAtIso: string;
  salesPointName: string;
  deliveryOrderNo: string | null;
  customerName: string;
  productSummary: string;
  status: SaleStatus;
  totalQtyLabel: string;
  totalAmountXaf: string;
}

export interface SalesListResult {
  rows: SalesListRow[];
  totals: {
    count: number;
    totalQtyLabel: string;
    totalAmountXaf: string;
  };
  periodLabel: string;
}

export interface SalesApi {
  getFormOptions(userId: string): Promise<SalesFormOptions>;
  getTaxRatesAsOf(asOfDate: string): Promise<import("./taxRules.ts").TaxRatesBag>;
  listSales(filters?: SalesListFilters): Promise<SalesListResult>;
  listPendingSales(): Promise<PendingSaleRow[]>;
  listValidationQueue(userId: string): Promise<SalesValidationQueuePage>;
  validateMany(payload: {
    userId: string;
    saleIds: string[];
  }): Promise<SalesValidateManyResult>;
  loadSaleByInvoiceNo(
    invoiceNo: string,
    userId?: string,
  ): Promise<LoadedSaleView | null>;
  createSale(input: CreateSaleInput): Promise<SaveSaleResult>;
  validateSale(payload: { saleId: string; userId: string }): Promise<SaleMutationResult>;
  cancelValidatedSale(payload: {
    saleId: string;
    userId: string;
    reason: string;
  }): Promise<SaleMutationResult>;
  deleteSale(saleId: string): Promise<SaleMutationResult>;
  listAvailableDeliveryOrders(payload: {
    salesPointId: number;
    customerId: number;
  }): Promise<AvailableDeliveryOrderRow[]>;
  lookupDeliveryOrder(payload: {
    deliveryOrderNo: string;
    salesPointId: number;
    customerId: number;
  }): Promise<DeliveryOrderLookupResult | null>;
  loadSalePrintById(saleId: string): Promise<SalePrintPayload | null>;
  previewUnitPrice(payload: {
    productId: number;
    asOfDate: string;
    customerId?: number | null;
    saleDisposition?: SaleDisposition | null;
  }): Promise<UnitPricePreviewResult>;
  listStorageLocationsWithBalance(payload: {
    salesPointId: number;
    productId: number;
    asOfDate?: string | null;
  }): Promise<SalesStorageLocationBalanceOption[]>;
}
