import { ipcMain } from "electron";
import type {
  BinCardQuery,
  BinCardReport,
  ReceiveTransferInput,
  ReceiptPrintPayload,
  TransferPrintPayload,
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
} from "../../shared/stock.types.js";
import { normalizeStockProductFilter } from "../../shared/stockModule.js";
import {
  cancelAdjustment,
  cancelReceipt,
  cancelTransfer,
  dispatchTransfer,
  findAdjustmentByNumber,
  findReceiptByConsignmentNoteNo,
  findReceiptByNumber,
  findTransferByNumber,
  applyStockIntakeOilGrouping,
  getStockIntakeOilGroupingStatus,
  getStockBootstrap,
  listOnHandAsOf,
  loadAdjustmentForReview,
  loadReceiptForReview,
  loadTransferForReview,
  postAdjustment,
  postInternalTransfer,
  postReceipt,
  receiveTransfer,
  saveAdjustment,
  saveReceipt,
  saveTransfer,
} from "../stock/service.js";
import {
  listStockValidationQueue,
  validateStockDocuments,
} from "../stock/validationQueue.js";
import { listReceiveQueue } from "../stock/receiveQueue.js";
import { getBinCard } from "../stock/binCard.js";
import { loadReceiptPrintById } from "../stock/receiptPrint.js";
import { loadTransferPrintById } from "../stock/transferPrint.js";

type DocActionPayload = {
  userId: string;
  productFilter?: StockProductFilter | null;
};

export function registerStockHandlers(): void {
  ipcMain.handle(
    "stock:getBootstrap",
    (
      _event,
      userId: string,
      productFilter?: StockProductFilter | null,
    ): StockBootstrap => {
      if (typeof userId !== "string" || !userId.trim()) {
        throw new Error("Login required.");
      }
      return getStockBootstrap(userId, productFilter ?? null);
    },
  );

  ipcMain.handle(
    "stock:listOnHandAsOf",
    (
      _event,
      userId: string,
      payload: {
        asOfDate: string;
        salesPointId?: number | null;
        productFilter?: StockProductFilter | null;
      },
    ): StockBalanceRow[] => {
      if (typeof userId !== "string" || !userId.trim()) {
        throw new Error("Login required.");
      }
      return listOnHandAsOf(userId, payload ?? { asOfDate: "" });
    },
  );

  ipcMain.handle(
    "stock:getBinCard",
    (_event, userId: string, query: BinCardQuery): BinCardReport => {
      if (typeof userId !== "string" || !userId.trim()) {
        throw new Error("Login required.");
      }
      return getBinCard(userId, query);
    },
  );

  ipcMain.handle(
    "stock:saveReceipt",
    async (_event, input: SaveReceiptInput): Promise<StockMutationResult> => {
      if (!input?.userId) {
        return { ok: false, error: "Login required." };
      }
      return saveReceipt(input);
    },
  );

  ipcMain.handle(
    "stock:postReceipt",
    async (
      _event,
      payload: DocActionPayload & { receiptId: string },
    ): Promise<StockGenericResult> => {
      if (!payload?.userId || !payload?.receiptId) {
        return { ok: false, error: "Invalid receipt." };
      }
      return postReceipt(payload.userId, payload.receiptId, payload.productFilter);
    },
  );

  ipcMain.handle(
    "stock:cancelReceipt",
    (
      _event,
      payload: DocActionPayload & { receiptId: string },
    ): StockGenericResult => {
      if (!payload?.userId || !payload?.receiptId) {
        return { ok: false, error: "Invalid receipt." };
      }
      return cancelReceipt(payload.userId, payload.receiptId, payload.productFilter);
    },
  );

  ipcMain.handle(
    "stock:findReceiptByNumber",
    (_event, payload: { userId: string; receiptNo: string }) => {
      if (!payload?.userId) {
        return { ok: false, error: "Login required." };
      }
      return findReceiptByNumber(payload.userId, payload.receiptNo);
    },
  );

  ipcMain.handle(
    "stock:findReceiptByConsignmentNoteNo",
    (_event, payload: { userId: string; consignmentNoteNo: string }) => {
      if (!payload?.userId) {
        return { ok: false, error: "Login required." };
      }
      return findReceiptByConsignmentNoteNo(
        payload.userId,
        payload.consignmentNoteNo,
      );
    },
  );

  ipcMain.handle(
    "stock:loadReceiptForReview",
    (_event, payload: { userId: string; receiptId: string }) => {
      if (!payload?.userId || !payload?.receiptId) {
        return { ok: false, error: "Invalid receipt." };
      }
      return loadReceiptForReview(payload.userId, payload.receiptId);
    },
  );

  ipcMain.handle(
    "stock:loadReceiptPrintById",
    (
      _event,
      payload: { userId: string; receiptId: string },
    ): ReceiptPrintPayload | null => {
      if (!payload?.userId || !payload?.receiptId) {
        return null;
      }
      return loadReceiptPrintById(payload.userId, payload.receiptId);
    },
  );

  ipcMain.handle(
    "stock:loadTransferPrintById",
    (
      _event,
      payload: { userId: string; transferId: string },
    ): TransferPrintPayload | null => {
      if (!payload?.userId || !payload?.transferId) {
        return null;
      }
      return loadTransferPrintById(payload.userId, payload.transferId);
    },
  );

  ipcMain.handle(
    "stock:saveTransfer",
    async (_event, input: SaveTransferInput): Promise<StockMutationResult> => {
      if (!input?.userId) {
        return { ok: false, error: "Login required." };
      }
      return saveTransfer(input);
    },
  );

  ipcMain.handle(
    "stock:dispatchTransfer",
    (
      _event,
      payload: DocActionPayload & { transferId: string },
    ): StockGenericResult => {
      if (!payload?.userId || !payload?.transferId) {
        return { ok: false, error: "Invalid transfer." };
      }
      return dispatchTransfer(payload.userId, payload.transferId, payload.productFilter);
    },
  );

  ipcMain.handle(
    "stock:postInternalTransfer",
    async (
      _event,
      payload: DocActionPayload & { transferId: string },
    ): Promise<StockGenericResult> => {
      if (!payload?.userId || !payload?.transferId) {
        return { ok: false, error: "Invalid transfer." };
      }
      return postInternalTransfer(
        payload.userId,
        payload.transferId,
        payload.productFilter,
      );
    },
  );

  ipcMain.handle(
    "stock:receiveTransfer",
    async (_event, input: ReceiveTransferInput): Promise<StockGenericResult> => {
      if (!input?.userId || !input?.transferId) {
        return { ok: false, error: "Invalid transfer." };
      }
      return receiveTransfer(input);
    },
  );

  ipcMain.handle(
    "stock:cancelTransfer",
    (
      _event,
      payload: DocActionPayload & { transferId: string },
    ): StockGenericResult => {
      if (!payload?.userId || !payload?.transferId) {
        return { ok: false, error: "Invalid transfer." };
      }
      return cancelTransfer(payload.userId, payload.transferId, payload.productFilter);
    },
  );

  ipcMain.handle(
    "stock:findTransferByNumber",
    (_event, payload: { userId: string; transferNo: string }) => {
      if (!payload?.userId) {
        return { ok: false, error: "Login required." };
      }
      return findTransferByNumber(payload.userId, payload.transferNo);
    },
  );

  ipcMain.handle(
    "stock:loadTransferForReview",
    (_event, payload: { userId: string; transferId: string }) => {
      if (!payload?.userId || !payload?.transferId) {
        return { ok: false, error: "Invalid transfer." };
      }
      return loadTransferForReview(payload.userId, payload.transferId);
    },
  );

  ipcMain.handle(
    "stock:saveAdjustment",
    async (_event, input: SaveAdjustmentInput): Promise<StockMutationResult> => {
      if (!input?.userId) {
        return { ok: false, error: "Login required." };
      }
      return saveAdjustment(input);
    },
  );

  ipcMain.handle(
    "stock:postAdjustment",
    async (
      _event,
      payload: DocActionPayload & { adjustmentId: string },
    ): Promise<StockGenericResult> => {
      if (!payload?.userId || !payload?.adjustmentId) {
        return { ok: false, error: "Invalid adjustment." };
      }
      return postAdjustment(
        payload.userId,
        payload.adjustmentId,
        payload.productFilter,
      );
    },
  );

  ipcMain.handle(
    "stock:cancelAdjustment",
    (
      _event,
      payload: DocActionPayload & { adjustmentId: string },
    ): StockGenericResult => {
      if (!payload?.userId || !payload?.adjustmentId) {
        return { ok: false, error: "Invalid adjustment." };
      }
      return cancelAdjustment(
        payload.userId,
        payload.adjustmentId,
        payload.productFilter,
      );
    },
  );

  ipcMain.handle(
    "stock:findAdjustmentByNumber",
    (_event, payload: { userId: string; adjustmentNo: string }) => {
      if (!payload?.userId) {
        return { ok: false, error: "Login required." };
      }
      return findAdjustmentByNumber(payload.userId, payload.adjustmentNo);
    },
  );

  ipcMain.handle(
    "stock:loadAdjustmentForReview",
    (_event, payload: { userId: string; adjustmentId: string }) => {
      if (!payload?.userId || !payload?.adjustmentId) {
        return { ok: false, error: "Invalid adjustment." };
      }
      return loadAdjustmentForReview(payload.userId, payload.adjustmentId);
    },
  );

  ipcMain.handle(
    "stock:listReceiveQueue",
    (_event, userId: string): StockReceiveQueuePage => {
      return listReceiveQueue(userId);
    },
  );

  ipcMain.handle(
    "stock:listValidationQueue",
    (_event, userId: string): StockValidationQueuePage => {
      if (typeof userId !== "string" || !userId.trim()) {
        throw new Error("Login required.");
      }
      return listStockValidationQueue(userId);
    },
  );

  ipcMain.handle(
    "stock:validateMany",
    async (
      _event,
      payload: { userId: string; items: StockValidationItem[] },
    ): Promise<StockValidateManyResult> => {
      if (!payload?.userId) {
        return { ok: false, error: "Login required." };
      }
      return validateStockDocuments(payload.userId, payload.items ?? []);
    },
  );

  ipcMain.handle("stock:getIntakeOilGroupingStatus", () => {
    return getStockIntakeOilGroupingStatus();
  });

  ipcMain.handle(
    "stock:applyIntakeOilGrouping",
    (
      _event,
      payload: { userId: string; enabled: boolean },
    ): ApplyStockIntakeOilGroupingResult => {
      if (!payload?.userId?.trim()) {
        return { ok: false, error: "Login required." };
      }
      return applyStockIntakeOilGrouping(payload.userId, Boolean(payload.enabled));
    },
  );
}
