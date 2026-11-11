import type {
  BinCardQuery,
  BinCardReport,
  ReceiveTransferInput,
  SaveAdjustmentInput,
  SaveReceiptInput,
  SaveTransferInput,
  StockBalanceRow,
  StockBootstrap,
  StockGenericResult,
  StockMutationResult,
  StockProductFilter,
  StockValidateManyResult,
  StockValidationItem,
  StockValidationQueuePage,
  StockReceiveQueuePage,
  ApplyStockIntakeOilGroupingResult,
  StockIntakeOilGroupingStatus,
} from "../../shared/stock.types.ts";

type DocFilterPayload = {
  userId: string;
  productFilter?: StockProductFilter | null;
};

export interface StockApi {
  getBootstrap(
    userId: string,
    productFilter?: StockProductFilter | null,
  ): Promise<StockBootstrap>;
  listOnHandAsOf(
    userId: string,
    payload: {
      asOfDate: string;
      salesPointId?: number | null;
      productFilter?: StockProductFilter | null;
    },
  ): Promise<StockBalanceRow[]>;
  getBinCard(userId: string, query: BinCardQuery): Promise<BinCardReport>;
  saveReceipt(input: SaveReceiptInput): Promise<StockMutationResult>;
  postReceipt(
    payload: DocFilterPayload & { receiptId: string },
  ): Promise<StockGenericResult>;
  cancelReceipt(
    payload: DocFilterPayload & { receiptId: string },
  ): Promise<StockGenericResult>;
  findReceiptByNumber(payload: {
    userId: string;
    receiptNo: string;
  }): Promise<
    | { ok: true; detail: import("../../shared/stock.types.ts").ReceiptDetail }
    | { ok: false; error: string }
  >;
  findReceiptByConsignmentNoteNo(payload: {
    userId: string;
    consignmentNoteNo: string;
  }): Promise<
    | { ok: true; detail: import("../../shared/stock.types.ts").ReceiptDetail }
    | { ok: false; error: string }
  >;
  loadReceiptForReview(payload: {
    userId: string;
    receiptId: string;
  }): Promise<
    | { ok: true; detail: import("../../shared/stock.types.ts").ReceiptDetail }
    | { ok: false; error: string }
  >;
  loadReceiptPrintById(payload: {
    userId: string;
    receiptId: string;
  }): Promise<import("../../shared/stock.types.ts").ReceiptPrintPayload | null>;
  loadTransferPrintById(payload: {
    userId: string;
    transferId: string;
  }): Promise<import("../../shared/stock.types.ts").TransferPrintPayload | null>;
  saveTransfer(input: SaveTransferInput): Promise<StockMutationResult>;
  dispatchTransfer(
    payload: DocFilterPayload & { transferId: string },
  ): Promise<StockGenericResult>;
  postInternalTransfer(
    payload: DocFilterPayload & { transferId: string },
  ): Promise<StockGenericResult>;
  receiveTransfer(input: ReceiveTransferInput): Promise<StockGenericResult>;
  cancelTransfer(
    payload: DocFilterPayload & { transferId: string },
  ): Promise<StockGenericResult>;
  findTransferByNumber(payload: {
    userId: string;
    transferNo: string;
  }): Promise<
    | { ok: true; detail: import("../../shared/stock.types.ts").TransferDetail }
    | { ok: false; error: string }
  >;
  loadTransferForReview(payload: {
    userId: string;
    transferId: string;
  }): Promise<
    | { ok: true; detail: import("../../shared/stock.types.ts").TransferDetail }
    | { ok: false; error: string }
  >;
  saveAdjustment(input: SaveAdjustmentInput): Promise<StockMutationResult>;
  postAdjustment(
    payload: DocFilterPayload & { adjustmentId: string },
  ): Promise<StockGenericResult>;
  cancelAdjustment(
    payload: DocFilterPayload & { adjustmentId: string },
  ): Promise<StockGenericResult>;
  findAdjustmentByNumber(payload: {
    userId: string;
    adjustmentNo: string;
  }): Promise<
    | { ok: true; detail: import("../../shared/stock.types.ts").AdjustmentDetail }
    | { ok: false; error: string }
  >;
  loadAdjustmentForReview(payload: {
    userId: string;
    adjustmentId: string;
  }): Promise<
    | { ok: true; detail: import("../../shared/stock.types.ts").AdjustmentDetail }
    | { ok: false; error: string }
  >;
  listValidationQueue(userId: string): Promise<StockValidationQueuePage>;
  listReceiveQueue(userId: string): Promise<StockReceiveQueuePage>;
  validateMany(payload: {
    userId: string;
    items: StockValidationItem[];
  }): Promise<StockValidateManyResult>;
  getIntakeOilGroupingStatus(): Promise<StockIntakeOilGroupingStatus>;
  applyIntakeOilGrouping(payload: {
    userId: string;
    enabled: boolean;
  }): Promise<ApplyStockIntakeOilGroupingResult>;
}
