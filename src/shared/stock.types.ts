export type StockDocStatus = "DRAFT" | "POSTED" | "DISPATCHED" | "RECEIVED" | "CANCELLED";
export type StockCondition = "SELLABLE" | "UNSELLABLE";
export type StockMovementKind =
  | "RECEIPT"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "SALE"
  | "SALE_REVERSAL"
  | "ADJUSTMENT";

export type StockMutationResult =
  | { ok: true; id: string; documentNo: string; posted?: boolean }
  | { ok: false; error: string };

export type StockGenericResult = { ok: true } | { ok: false; error: string };

export interface SalesPointOption {
  id: number;
  name: string;
  /** When true, collection point can receive mill stock receipts. */
  attachedToMill: boolean;
}

export interface StorageLocationOption {
  id: number;
  salesPointId: number;
  name: string;
  isDefault: boolean;
  /** When true, location is used for POS/sales invoicing only (not goods-in receipts). */
  isSalesTank: boolean;
  /** When true, multiple bulk products may share this location (e.g. drums). */
  allowsMultiProduct: boolean;
}

export interface ProductOption {
  productId: number;
  productName: string;
  uom: string;
  isBottled: boolean;
  /** Non-bottled Palm Oil (ProductCat.isMain). */
  isLoosePalmOil: boolean;
  /** Per-product flag — no storage location on stock docs. */
  omitsStorageLocation: boolean;
  /** Palm Oil / Sludge Oil intake grouping label when stockIntakeOilGrouping is on. */
  stockIntakeGroup?: "PALM_OIL" | "SLUDGE_OIL" | "PALM_KERNEL" | null;
  /** When set, stock ops use this product's balance instead (sludge grades). */
  stockPoolProductId?: number | null;
  /** Stock-only product — hidden from invoice pickers. */
  excludeFromSales?: boolean;
  /** Canonical Sludge Oil pool product. */
  isStockPool?: boolean;
}

export interface StockBalanceRow {
  salesPointId: number;
  salesPointName: string;
  storageLocationId: number | null;
  storageLocationName: string;
  productId: number;
  productName: string;
  uom: string;
  condition: StockCondition;
  qty: string;
}

export interface StockMovementRow {
  id: string;
  occurredAtIso: string;
  salesPointId: number;
  salesPointName: string;
  storageLocationId: number | null;
  storageLocationName: string;
  productId: number;
  productName: string;
  uom: string;
  kind: StockMovementKind;
  condition: StockCondition;
  qty: string;
  signedQty: string;
  sourceKind: string;
  sourceId: string;
  documentNo: string | null;
  userId: string;
  userName: string;
  notes: string | null;
  createdAtIso: string;
  /** True when movement comes from a carry-forward stock adjustment. */
  isCarryForward?: boolean;
}

export interface ReceiptListRow {
  id: string;
  receiptNo: string;
  salesPointId: number;
  salesPointName: string;
  receivedAtIso: string;
  supplierLabel: string;
  /** Mill/paper consignment note number (independent of system receiptNo). */
  consignmentNoteNo: string | null;
  status: StockDocStatus;
  totalQty: string;
  lineCount: number;
  createdByName: string;
  postedByName: string | null;
  postedAtIso: string | null;
  createdAtIso: string;
}

export interface ReceiptDetail extends ReceiptListRow {
  notes: string | null;
  consignedBy: string | null;
  consDesign: string | null;
  consDate: string | null;
  receiveBy: string | null;
  receiveByDesign: string | null;
  receiveDate: string | null;
  lines: Array<{
    id: string;
    productId: number;
    productName: string;
    uom: string;
    qty: string;
    storageLocationId: number | null;
    storageLocationName: string;
  }>;
}

export interface ReceiptPrintPayload {
  companyName: string;
  department: string | null;
  serviceName: string | null;
  signatoryName: string | null;
  signatoryTitle: string;
  receipt: ReceiptDetail;
}

export interface TransferPrintPayload {
  companyName: string;
  department: string | null;
  serviceName: string | null;
  signatoryName: string | null;
  signatoryTitle: string;
  transfer: TransferDetail;
}

export interface TransferConsignmentFields {
  consignedBy: string | null;
  consDesign: string | null;
  consDate: string | null;
  receiveBy: string | null;
  receiveByDesign: string | null;
  receiveDate: string | null;
}

export interface TransferListRow {
  id: string;
  transferNo: string;
  transferMode: import("./stockTransferMode.ts").TransferMode;
  locationSummary: string | null;
  /** Deduped product names on matching lines, for list search. */
  productSummary: string | null;
  fromSalesPointId: number;
  fromSalesPointName: string;
  toSalesPointId: number;
  toSalesPointName: string;
  dispatchedAtIso: string | null;
  receivedAtIso: string | null;
  status: StockDocStatus;
  totalQty: string;
  lineCount: number;
  createdByName: string;
  dispatchedByName: string | null;
  receivedByName: string | null;
  createdAtIso: string;
}

export interface TransferDetail extends TransferListRow, TransferConsignmentFields {
  notes: string | null;
  lines: Array<{
    id: string;
    productId: number;
    productName: string;
    uom: string;
    qty: string;
    fromStorageLocationId: number;
    fromStorageLocationName: string;
    toStorageLocationId: number | null;
    toStorageLocationName: string | null;
  }>;
}

export interface AdjustmentListRow {
  id: string;
  adjustmentNo: string;
  salesPointId: number;
  salesPointName: string;
  occurredAtIso: string;
  reason: string;
  status: StockDocStatus;
  sourceKind: "NORMAL" | "CARRY_FORWARD";
  lineCount: number;
  createdByName: string;
  postedByName: string | null;
  postedAtIso: string | null;
  createdAtIso: string;
}

export interface AdjustmentDetail extends AdjustmentListRow {
  lines: Array<{
    id: string;
    productId: number;
    productName: string;
    uom: string;
    deltaQty: string;
    storageLocationId: number;
    storageLocationName: string;
    fromCondition: StockCondition | null;
    toCondition: StockCondition | null;
  }>;
}

export type StockProductFilter = "bulk" | "bottled" | "all";

/** Dispatched inter-site transfers awaiting receive at the user's collection point. */
export interface StockReceiveQueueRow {
  id: string;
  transferNo: string;
  fromSalesPointId: number;
  fromSalesPointName: string;
  toSalesPointId: number;
  toSalesPointName: string;
  dispatchedAtIso: string | null;
  totalQty: string;
  lineCount: number;
  createdByName: string;
  dispatchedByName: string | null;
}

export interface StockReceiveQueuePage {
  rows: StockReceiveQueueRow[];
  storageLocations: StorageLocationOption[];
  transferReceiveUsesDocumentDate: boolean;
  scopedSalesPointId: number | null;
}

export interface StockBootstrap {
  productFilter: StockProductFilter;
  canManageReceipts: boolean;
  canInitiateTransfers: boolean;
  canDispatchTransfers: boolean;
  canReceiveTransfers: boolean;
  canCancelTransfers: boolean;
  canPostAdjustments: boolean;
  canReclassifyStock: boolean;
  canCancelDocuments: boolean;
  canDraftReceipts: boolean;
  canDraftTransfers: boolean;
  canDraftAdjustments: boolean;
  canDirectPostReceipts: boolean;
  canDirectPostTransfers: boolean;
  scopedSalesPointId: number | null;
  /** Bota collection point (bottle oil hub); null if not configured. */
  botaSalesPointId: number | null;
  salesPoints: SalesPointOption[];
  storageLocations: StorageLocationOption[];
  products: ProductOption[];
  /** All products for Stock receipt modal (bottled + loose); UI filters by document type. */
  receiptProducts: ProductOption[];
  autoGenerateReceiptNo: boolean;
  autoGenerateTransferNo: boolean;
  /** When true, transfer receive posts stock on the user Date (open month). */
  transferReceiveUsesDocumentDate: boolean;
  /** When true, loose Palm Oil may transfer between collection points. */
  loosePalmOilAllowInterSalesPointTransfer: boolean;
  /** When true, bulk receipts group Palm Oil / Sludge Oil and sludge grades share one tank. */
  stockIntakeOilGrouping: boolean;
  onHand: StockBalanceRow[];
  movements: StockMovementRow[];
  receipts: ReceiptListRow[];
  transfers: TransferListRow[];
  adjustments: AdjustmentListRow[];
}

export type ReceiptReviewResult =
  | { ok: true; detail: ReceiptDetail }
  | { ok: false; error: string };

export type TransferReviewResult =
  | { ok: true; detail: TransferDetail }
  | { ok: false; error: string };

export type AdjustmentReviewResult =
  | { ok: true; detail: AdjustmentDetail }
  | { ok: false; error: string };

export interface SaveReceiptInput {
  userId: string;
  productFilter?: StockProductFilter | null;
  id?: string | null;
  receiptNo?: string | null;
  salesPointId: number;
  supplierLabel: string;
  receivedAt: string;
  notes?: string | null;
  consignmentNoteNo?: string | null;
  consignedBy?: string | null;
  consDesign?: string | null;
  consDate?: string | null;
  receiveBy?: string | null;
  receiveByDesign?: string | null;
  receiveDate?: string | null;
  lines: Array<{
    productId: number;
    qty: string;
    storageLocationId: number | null;
  }>;
  /** Create and post in one step; requires direct_post_stock_receipts. New documents only. */
  postImmediately?: boolean;
}

export interface SaveTransferInput {
  userId: string;
  productFilter?: StockProductFilter | null;
  id?: string | null;
  transferNo?: string | null;
  fromSalesPointId: number;
  toSalesPointId: number;
  dispatchedAt: string;
  notes?: string | null;
  consignedBy?: string | null;
  consDesign?: string | null;
  consDate?: string | null;
  receiveBy?: string | null;
  receiveByDesign?: string | null;
  receiveDate?: string | null;
  lines: Array<{
    productId: number;
    qty: string;
    fromStorageLocationId: number;
    toStorageLocationId?: number | null;
  }>;
  /** Create and finalize in one step; requires direct_post_stock_transfers. New documents only. */
  postImmediately?: boolean;
}

export interface ReceiveTransferInput {
  userId: string;
  productFilter?: StockProductFilter | null;
  transferId: string;
  lines: Array<{
    lineId: string;
    toStorageLocationId: number;
  }>;
  receiveBy?: string | null;
  receiveByDesign?: string | null;
  receiveDate?: string | null;
}

export interface SaveAdjustmentInput {
  userId: string;
  productFilter?: StockProductFilter | null;
  id?: string | null;
  salesPointId: number;
  reason: string;
  occurredAt: string;
  lines: Array<{
    productId: number;
    deltaQty: string;
    storageLocationId: number;
    fromCondition?: StockCondition | null;
    toCondition?: StockCondition | null;
  }>;
}

export interface StockUserActionInput {
  userId: string;
  id: string;
  productFilter?: StockProductFilter | null;
}

export type BinCardConditionFilter = StockCondition | "ALL";

export interface BinCardQuery {
  productId: number;
  salesPointId?: number | null;
  storageLocationId?: number | null;
  condition?: BinCardConditionFilter;
  fromIso: string;
  toIso: string;
  productFilter?: StockProductFilter | null;
}

export interface BinCardLine {
  id: string;
  occurredAtIso: string;
  reference: string;
  particulars: string;
  kind: StockMovementKind;
  condition: StockCondition;
  salesPointName: string;
  storageLocationName: string;
  qtyIn: number;
  qtyOut: number;
  balance: number;
  documentNo: string | null;
  notes: string | null;
  isCarryForward: boolean;
}

export interface BinCardReport {
  productId: number;
  productName: string;
  uom: string;
  isBottled: boolean;
  salesPointId: number | null;
  salesPointLabel: string;
  storageLocationId: number | null;
  storageLocationLabel: string;
  condition: BinCardConditionFilter;
  fromIso: string;
  toIso: string;
  openingBalance: number;
  closingBalance: number;
  lines: BinCardLine[];
  truncated: boolean;
  companyName: string;
  department: string | null;
  serviceName: string | null;
}

export type StockValidationDocKind = "RECEIPT" | "TRANSFER" | "ADJUSTMENT";

export interface StockValidationQueueRow {
  kind: StockValidationDocKind;
  id: string;
  documentNo: string;
  productFilter: StockProductFilter;
  /** Intra transfers post; inter transfers dispatch. Null for receipts/adjustments. */
  transferMode: "INTER_SALES_POINT" | "INTRA_SALES_POINT" | null;
  fromSalesPointName: string;
  toSalesPointName: string | null;
  documentDateIso: string;
  createdByName: string;
  lineCount: number;
  totalQty: string;
}

export interface StockValidationQueuePage {
  totalPending: number;
  rows: StockValidationQueueRow[];
}

export interface StockValidationItem {
  kind: StockValidationDocKind;
  id: string;
}

export type StockValidateManyResult =
  | {
      ok: true;
      validated: number;
      errors: Array<{ kind: StockValidationDocKind; id: string; error: string }>;
    }
  | { ok: false; error: string };

export interface StockIntakeOilGroupingStatus {
  enabled: boolean;
  poolTotalQty: number;
}

export type ApplyStockIntakeOilGroupingResult =
  | { ok: true }
  | { ok: false; error: string };
