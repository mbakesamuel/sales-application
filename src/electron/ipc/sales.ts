import { ipcMain } from "electron";
import type {
  CreateSaleInput,
  DeliveryOrderLookupResult,
  LoadedSaleView,
  PendingSaleRow,
  SalesFormOptions,
  SalesListFilters,
  SalesListResult,
  SalesStorageLocationBalanceOption,
  SalesValidateManyResult,
  SalesValidationQueuePage,
  SaveSaleResult,
  SaleDisposition,
  SaleMutationResult,
  SalePrintPayload,
  AvailableDeliveryOrderRow,
  UnitPricePreviewResult,
} from "../../shared/sales.types.js";
import type { TaxRatesBag } from "../../shared/taxRules.js";
import {
  listAvailableDeliveryOrders,
  lookupDeliveryOrder,
} from "../sales/deliveryOrders.js";
import { loadSalePrintById } from "../sales/print.js";
import {
  cancelValidatedSale,
  createSale,
  deleteSale,
  getSalesFormOptions,
  listPendingSales,
  listSales,
  listSalesValidationQueue,
  listStorageLocationsWithBalance,
  loadSaleByInvoiceNo,
  previewSaleUnitPrice,
  validateManySales,
  validateSale,
} from "../sales/service.js";
import { loadTaxRatesAsOf } from "../tax/resolveRates.js";

export function registerSalesHandlers(): void {
  ipcMain.handle(
    "sales:getFormOptions",
    (_event, userId: string): SalesFormOptions => {
      if (typeof userId !== "string" || !userId.trim()) {
        throw new Error("Login required.");
      }
      return getSalesFormOptions(userId);
    },
  );

  ipcMain.handle(
    "sales:getTaxRatesAsOf",
    (_event, asOfDate: string): TaxRatesBag => {
      return loadTaxRatesAsOf(
        typeof asOfDate === "string" ? asOfDate : undefined,
      );
    },
  );

  ipcMain.handle(
    "sales:listSales",
    (_event, filters: SalesListFilters): SalesListResult => {
      return listSales(filters ?? {});
    },
  );

  ipcMain.handle("sales:listPendingSales", (): PendingSaleRow[] => {
    return listPendingSales();
  });

  ipcMain.handle(
    "sales:listValidationQueue",
    (_event, userId: string): SalesValidationQueuePage => {
      if (typeof userId !== "string" || !userId.trim()) {
        throw new Error("Login required.");
      }
      return listSalesValidationQueue(userId);
    },
  );

  ipcMain.handle(
    "sales:validateMany",
    (
      _event,
      payload: { userId: string; saleIds: string[] },
    ): SalesValidateManyResult => {
      if (!payload?.userId) {
        return { ok: false, error: "Login required." };
      }
      return validateManySales(payload.saleIds ?? [], payload.userId);
    },
  );

  ipcMain.handle(
    "sales:loadSaleByInvoiceNo",
    (_event, invoiceNo: string, userId?: string): LoadedSaleView | null => {
      if (typeof invoiceNo !== "string") {
        return null;
      }

      return loadSaleByInvoiceNo(
        invoiceNo,
        typeof userId === "string" ? userId : undefined,
      );
    },
  );

  ipcMain.handle(
    "sales:createSale",
    async (_event, input: CreateSaleInput): Promise<SaveSaleResult> => {
      if (!input || typeof input.userId !== "string") {
        return { ok: false, error: "Login required." };
      }

      return createSale(input);
    },
  );

  ipcMain.handle(
    "sales:validateSale",
    (_event, payload: { saleId: string; userId: string }): SaleMutationResult => {
      if (!payload?.saleId || !payload.userId) {
        return { ok: false, error: "Invalid request." };
      }

      return validateSale(payload.saleId, payload.userId);
    },
  );

  ipcMain.handle(
    "sales:cancelValidatedSale",
    (
      _event,
      payload: { saleId: string; userId: string; reason: string },
    ): SaleMutationResult => {
      if (!payload?.saleId || !payload?.userId || !payload?.reason) {
        return { ok: false, error: "Invalid request." };
      }

      return cancelValidatedSale(payload.saleId, payload.userId, payload.reason);
    },
  );

  ipcMain.handle(
    "sales:deleteSale",
    (_event, payload: { saleId: string; userId: string }): SaleMutationResult => {
      if (!payload?.saleId || !payload?.userId) {
        return { ok: false, error: "Invalid request." };
      }

      return deleteSale(payload.saleId, payload.userId);
    },
  );

  ipcMain.handle(
    "sales:listAvailableDeliveryOrders",
    (
      _event,
      payload: { salesPointId: number; customerId: number },
    ): AvailableDeliveryOrderRow[] => {
      if (
        typeof payload?.salesPointId !== "number" ||
        typeof payload?.customerId !== "number"
      ) {
        return [];
      }

      return listAvailableDeliveryOrders(payload.salesPointId, payload.customerId);
    },
  );

  ipcMain.handle(
    "sales:lookupDeliveryOrder",
    (
      _event,
      payload: { deliveryOrderNo: string; salesPointId: number; customerId: string },
    ): DeliveryOrderLookupResult | null => {
      if (!payload?.deliveryOrderNo || typeof payload.salesPointId !== "number") {
        return null;
      }

      return lookupDeliveryOrder(
        payload.deliveryOrderNo,
        payload.salesPointId,
        payload.customerId ?? "",
      );
    },
  );

  ipcMain.handle(
    "sales:loadSalePrintById",
    (_event, saleId: string): SalePrintPayload | null => {
      if (typeof saleId !== "string") {
        return null;
      }

      return loadSalePrintById(saleId);
    },
  );

  ipcMain.handle(
    "sales:previewUnitPrice",
    (
      _event,
      payload: {
        productId: number;
        asOfDate: string;
        customerId?: number | null;
        saleDisposition?: SaleDisposition | null;
      },
    ): UnitPricePreviewResult => {
      if (!payload || typeof payload.productId !== "number") {
        return { ok: false, error: "Product is required." };
      }

      return previewSaleUnitPrice(payload);
    },
  );

  ipcMain.handle(
    "sales:listStorageLocationsWithBalance",
    (
      _event,
      payload: {
        salesPointId: number;
        productId: number;
        asOfDate?: string | null;
      },
    ): SalesStorageLocationBalanceOption[] => {
      if (
        !payload ||
        typeof payload.salesPointId !== "number" ||
        typeof payload.productId !== "number"
      ) {
        return [];
      }

      const asOfDate =
        typeof payload.asOfDate === "string" ? payload.asOfDate : null;

      return listStorageLocationsWithBalance(
        payload.salesPointId,
        payload.productId,
        asOfDate,
      );
    },
  );
}
