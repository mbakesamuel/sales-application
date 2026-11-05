import { ipcMain } from "electron";
import type {
  DeliveryOrdersFormOptions,
  DeliveryOrdersListFilters,
  DeliveryOrdersListResult,
  DeliveryOrderMutationResult,
  DeliveryOrderPrintPayload,
  DeliveryOrderTrackPayload,
  LoadedDeliveryOrderView,
  PendingDeliveryOrderRow,
  SaveDeliveryOrderInput,
  SaveDeliveryOrderResult,
  StockOnHandPreviewResult,
  TaxPreviewResult,
  TransferDeliveryOrderBalanceInput,
  TransferDeliveryOrderBalanceResult,
  UnitPricePreviewResult,
  ValidationQueuePage,
} from "../../shared/deliveryOrders.types.js";
import {
  cancelValidatedDeliveryOrder,
  deleteDeliveryOrder,
  getDeliveryOrdersFormOptions,
  listDeliveryOrders,
  listPendingDeliveryOrders,
  listValidationQueue,
  loadDeliveryOrderByNo,
  previewDeliveryOrderTaxes,
  previewProductUnitPrice,
  previewStockOnHand,
  saveDeliveryOrder,
  validateDeliveryOrder,
  validateManyDeliveryOrders,
} from "../deliveryOrders/service.js";
import { loadDeliveryOrderPrintById } from "../deliveryOrders/print.js";
import { trackDeliveryOrderByNo } from "../deliveryOrders/track.js";
import { transferDeliveryOrderBalance } from "../deliveryOrders/transfer.js";

export function registerDeliveryOrdersHandlers(): void {
  ipcMain.handle(
    "deliveryOrders:getFormOptions",
    (_event, userId?: string): DeliveryOrdersFormOptions => {
      return getDeliveryOrdersFormOptions(
        typeof userId === "string" ? userId : undefined,
      );
    },
  );

  ipcMain.handle(
    "deliveryOrders:loadByNo",
    (
      _event,
      deliveryOrderNo: string,
      userId?: string,
    ): LoadedDeliveryOrderView | null => {
      if (typeof deliveryOrderNo !== "string") {
        return null;
      }

      return loadDeliveryOrderByNo(
        deliveryOrderNo,
        typeof userId === "string" ? userId : undefined,
      );
    },
  );

  ipcMain.handle(
    "deliveryOrders:loadPrintById",
    (_event, orderId: number): DeliveryOrderPrintPayload | null => {
      if (typeof orderId !== "number") {
        return null;
      }

      return loadDeliveryOrderPrintById(orderId);
    },
  );

  ipcMain.handle(
    "deliveryOrders:trackByNo",
    (_event, deliveryOrderNo: string): DeliveryOrderTrackPayload | null => {
      if (typeof deliveryOrderNo !== "string") {
        return null;
      }

      return trackDeliveryOrderByNo(deliveryOrderNo);
    },
  );

  ipcMain.handle(
    "deliveryOrders:transferBalance",
    (
      _event,
      input: TransferDeliveryOrderBalanceInput,
    ): TransferDeliveryOrderBalanceResult => {
      if (!input?.userId) {
        return { ok: false, error: "Login required." };
      }

      return transferDeliveryOrderBalance(input);
    },
  );

  ipcMain.handle("deliveryOrders:listPending", (): PendingDeliveryOrderRow[] => {
    return listPendingDeliveryOrders();
  });

  ipcMain.handle(
    "deliveryOrders:listOrders",
    (_event, filters: DeliveryOrdersListFilters): DeliveryOrdersListResult => {
      return listDeliveryOrders(filters ?? {});
    },
  );

  ipcMain.handle(
    "deliveryOrders:save",
    async (
      _event,
      input: SaveDeliveryOrderInput,
    ): Promise<SaveDeliveryOrderResult> => {
      if (!input?.userId) {
        return { ok: false, error: "Login required." };
      }

      return saveDeliveryOrder(input);
    },
  );

  ipcMain.handle(
    "deliveryOrders:deleteOrder",
    (_event, payload: { orderId: number; userId: string }): DeliveryOrderMutationResult => {
      if (typeof payload?.orderId !== "number" || !payload?.userId) {
        return { ok: false, error: "Invalid delivery order." };
      }

      return deleteDeliveryOrder(payload.orderId, payload.userId);
    },
  );

  ipcMain.handle(
    "deliveryOrders:validateOrder",
    (_event, payload: { orderId: number; userId: string }): DeliveryOrderMutationResult => {
      if (!payload?.orderId || !payload.userId) {
        return { ok: false, error: "Invalid request." };
      }

      return validateDeliveryOrder(payload.orderId, payload.userId);
    },
  );

  ipcMain.handle(
    "deliveryOrders:cancelValidated",
    (
      _event,
      payload: { orderId: number; userId: string; reason: string },
    ): DeliveryOrderMutationResult => {
      if (!payload?.orderId || !payload.userId) {
        return { ok: false, error: "Invalid request." };
      }

      return cancelValidatedDeliveryOrder(payload.orderId, payload.userId, payload.reason);
    },
  );

  ipcMain.handle(
    "deliveryOrders:previewTaxes",
    (_event, payload: { customerId: string; dateIssued: string }): TaxPreviewResult => {
      if (!payload?.customerId || !payload?.dateIssued) {
        return { ok: false, error: "Customer and date are required." };
      }

      return previewDeliveryOrderTaxes(payload.customerId, payload.dateIssued);
    },
  );

  ipcMain.handle(
    "deliveryOrders:previewUnitPrice",
    (
      _event,
      payload: {
        customerId: string;
        productId: number;
        dateIssued: string;
        orderQty?: number | string;
      },
    ): UnitPricePreviewResult => {
      if (!payload?.customerId || !payload?.productId || !payload?.dateIssued) {
        return { ok: false, error: "Customer, product, and date are required." };
      }

      return previewProductUnitPrice(
        payload.customerId,
        payload.productId,
        payload.dateIssued,
        payload.orderQty,
      );
    },
  );

  ipcMain.handle(
    "deliveryOrders:previewStockOnHand",
    (_event, payload: { salesPointId: number; productId: number }): StockOnHandPreviewResult => {
      if (typeof payload?.salesPointId !== "number" || typeof payload?.productId !== "number") {
        return { ok: false, error: "Collection point and product are required." };
      }

      return previewStockOnHand(payload.salesPointId, payload.productId);
    },
  );

  ipcMain.handle(
    "deliveryOrders:listValidationQueue",
    (_event, userId?: string): ValidationQueuePage => {
      return listValidationQueue(
        typeof userId === "string" ? userId : undefined,
      );
    },
  );

  ipcMain.handle(
    "deliveryOrders:validateMany",
    (_event, payload: { orderIds: number[]; userId: string }) => {
      if (!payload?.userId || !Array.isArray(payload.orderIds)) {
        return { ok: false, error: "Invalid request." };
      }

      return validateManyDeliveryOrders(payload.orderIds, payload.userId);
    },
  );
}
