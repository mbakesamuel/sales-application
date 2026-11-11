import { Hono } from "hono";
import { sessionAuthMiddleware } from "../middleware/sessionAuth.js";
import { createSaleCommand } from "../services/salesCommands.js";
import {
  createDeliveryOrderCommand,
  updateDeliveryOrderCommand,
} from "../services/deliveryOrderCommands.js";
import {
  cancelSaleCommand,
  deleteSaleCommand,
  listSales,
  listSalesValidationQueue,
  loadSaleByInvoiceNo,
  validateManySalesCommand,
  validateSaleCommand,
} from "../services/salesQueries.js";
import {
  createAdjustmentCommand,
  createReceiptCommand,
  createTransferCommand,
  postAdjustmentCommand,
  postReceiptCommand,
  postTransferCommand,
  receiveTransferCommand,
} from "../services/stockCommands.js";
import { prisma } from "../db/prisma.js";
import {
  getCompanySettings,
  listCustomers,
  listProducts,
  listSalesFormProducts,
  listSalesPoints,
} from "../services/mastersQueries.js";
import { getDashboardSummary } from "../services/dashboardSummary.js";
import {
  closeYear,
  getOpenPostingPeriodForActor,
  listMonthsForOpenYearForActor,
  listYears,
  openYear,
  setMonthStatusForActor,
} from "../services/financialYearsService.js";
import { queryTable } from "../services/tableQuery.js";
import {
  thinClientSyncConfig,
  thinClientSyncStatus,
} from "../services/syncStubs.js";
import {
  deleteReportSignatory,
  getReportSignatory,
  listReportSignatories,
  saveReportComments,
  upsertReportSignatory,
} from "../services/reportCompany.js";
import * as stockExtras from "../services/stockRpcExtras.js";
import * as bookletsRpc from "../services/bookletsRpc.js";
import * as vcnRpc from "../services/vehicleConsignmentNotesRpc.js";
import { getOpenMonthWeekChoices } from "../services/reports/weekChoices.js";
import { getRevenueTaxesReport } from "../services/reports/revenueTaxesReport.js";
import { getStockReport } from "../services/reports/stockReport.js";
import { getBottleOilStockSalesReport } from "../services/reports/bottleOilStockSalesReport.js";
import { getBottledWeeklyIssuesReport } from "../services/reports/bottledWeeklyIssuesReport.js";
import { getBottledPalmOilSalesReturnReport } from "../services/reports/bottledPalmOilSalesReturnReport.js";
import { getMonthlyBottledOilReport } from "../services/reports/monthlyBottledOilReport.js";
import { getLooseLpoStockSummaryReport } from "../services/reports/looseLpoStockSummaryReport.js";
import { getMonthlyPalmOilSalesReport } from "../services/reports/monthlyPalmOilSalesReport.js";
import { getPalmOilSalesActivityReport } from "../services/reports/palmOilSalesActivityReport.js";
import { getMonthlyStockReconciliationReport } from "../services/reports/monthlyStockReconciliationReport.js";
import { getCommitmentReport } from "../services/reports/commitmentReport.js";
import { getStockCommitmentReport } from "../services/reports/stockCommitmentReport.js";
import { getDailySalesReport } from "../services/reports/dailySalesReport.js";
import { getDailySalesMatrixReport } from "../services/reports/dailySalesMatrixReport.js";
import { getWeeklyDeliveriesReport } from "../services/reports/weeklyDeliveriesReport.js";
import { getMonthlyDeliveryReport } from "../services/reports/monthlyDeliveryReport.js";
import { getMonthlyPaymentDeliveryReport } from "../services/reports/monthlyPaymentDeliveryReport.js";
import { getTransportCostReport } from "../services/reports/transportCostReport.js";
import { getMonthlyDeliveriesByDestinationReport } from "../services/reports/monthlyDeliveriesByDestinationReport.js";
import { getIndustryProductMonthlySalesReport } from "../services/reports/industryProductMonthlySalesReport.js";
import { getOtherProductSalesDeliveriesReport } from "../services/reports/otherProductSalesDeliveriesReport.js";
import { getSalesBudgetMonthlyCrosstabReport } from "../services/reports/salesBudgetMonthlyCrosstab.js";
import { getSalesBudgetWeeklyCrosstabReport } from "../services/reports/salesBudgetWeeklyCrosstab.js";
import { getSalesBudgetMonthlyRevenueCrosstabReport } from "../services/reports/salesBudgetMonthlyRevenueCrosstab.js";
import { getSalesBudgetWeeklyRevenueCrosstabReport } from "../services/reports/salesBudgetWeeklyRevenueCrosstab.js";
import {
  backupStubs,
  carryForwardStockStubs,
  carryForwardStubs,
} from "../services/thinClientStubs.js";
import {
  computeTransportCost,
  getTransportCostFormOptions,
  parseTransportCostComputeArgs,
} from "../services/transportCostService.js";
import { resolveHandler } from "../services/rpcCoverage.js";
import {
  canPerformAction,
  canWriteRoute,
  loadRpcActor,
} from "../services/rpcActor.js";

type Handler = (
  args: unknown[],
  ctx: { userId: string; salesPointId: number | null },
) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  "sales.createSale": async (args, ctx) => {
    const input = (args[0] ?? {}) as Record<string, unknown>;
    return createSaleCommand({
      ...(input as Parameters<typeof createSaleCommand>[0]),
      userId: ctx.userId,
      salesPointId: Number(input.salesPointId ?? ctx.salesPointId),
    });
  },
  "sales.validateSale": async (args, ctx) => {
    const payload = (args[0] ?? {}) as { saleId?: string; userId?: string };
    return validateSaleCommand({
      saleId: String(payload.saleId ?? ""),
      userId: ctx.userId,
    });
  },
  "sales.cancelValidatedSale": async (args, ctx) => {
    const payload = (args[0] ?? {}) as {
      saleId?: string;
      reason?: string;
    };
    return cancelSaleCommand({
      saleId: String(payload.saleId ?? ""),
      userId: ctx.userId,
      reason: String(payload.reason ?? ""),
    });
  },
  "sales.deleteSale": async (args) => {
    const payload = (args[0] ?? {}) as { saleId?: string };
    return deleteSaleCommand({ saleId: String(payload.saleId ?? "") });
  },
  "sales.listSales": async (args, ctx) => {
    const filters = (args[0] ?? {}) as Record<string, unknown>;
    return listSales({
      ...filters,
      salesPointId:
        filters.salesPointId != null
          ? Number(filters.salesPointId)
          : ctx.salesPointId,
    });
  },
  "sales.listValidationQueue": async (_args, ctx) => {
    return listSalesValidationQueue({
      userId: ctx.userId,
      salesPointId: ctx.salesPointId,
    });
  },
  "sales.listPendingSales": async (_args, ctx) => {
    const queue = await listSalesValidationQueue({
      userId: ctx.userId,
      salesPointId: ctx.salesPointId,
    });
    return queue.rows.map((row) => ({
      invoiceNo: row.invoiceNo,
      soldAtIso: row.soldAtIso,
      customerName: row.customerName,
      totalLabel: row.totalLabel,
      salesPointName: row.salesPointName,
    }));
  },
  "sales.validateMany": async (args, ctx) => {
    const payload = (args[0] ?? {}) as { saleIds?: string[] };
    return validateManySalesCommand({
      saleIds: payload.saleIds ?? [],
      userId: ctx.userId,
    });
  },
  "sales.loadSaleByInvoiceNo": async (args) => {
    return loadSaleByInvoiceNo(String(args[0] ?? ""));
  },
  "deliveryOrders.save": async (args, ctx) => {
    const input = (args[0] ?? {}) as Record<string, unknown>;
    const salesPointId = Number(input.salesPointId ?? ctx.salesPointId);
    const id =
      input.id == null || input.id === ""
        ? null
        : String(input.id).trim() || null;
    const result = id
      ? await updateDeliveryOrderCommand({
          ...(input as Parameters<typeof updateDeliveryOrderCommand>[0]),
          id,
          userId: ctx.userId,
          salesPointId,
        })
      : await createDeliveryOrderCommand({
          ...(input as Parameters<typeof createDeliveryOrderCommand>[0]),
          userId: ctx.userId,
          salesPointId,
        });
    if (!result.ok) return result;
    return {
      ok: true,
      id: result.deliveryOrderId,
      deliveryOrderNo: result.deliveryOrderNo,
    };
  },
  "stock.saveReceipt": async (args, ctx) => {
    const input = (args[0] ?? {}) as Record<string, unknown>;
    if (input.id) {
      return { ok: false, error: "Updating receipts via API is not yet supported." };
    }
    return createReceiptCommand({
      ...(input as Parameters<typeof createReceiptCommand>[0]),
      userId: ctx.userId,
      salesPointId: Number(input.salesPointId ?? ctx.salesPointId),
    });
  },
  "stock.postReceipt": async (args, ctx) => {
    const payload = (args[0] ?? {}) as { receiptId?: string };
    return postReceiptCommand({
      receiptId: String(payload.receiptId ?? args[1] ?? ""),
      userId: ctx.userId,
    });
  },
  "stock.saveTransfer": async (args, ctx) => {
    const input = (args[0] ?? {}) as Record<string, unknown>;
    if (input.id) {
      return {
        ok: false,
        error: "Updating transfers via API is not yet supported.",
      };
    }
    return createTransferCommand({
      ...(input as Parameters<typeof createTransferCommand>[0]),
      userId: ctx.userId,
    });
  },
  "stock.postInternalTransfer": async (args, ctx) => {
    const payload = (args[0] ?? {}) as { transferId?: string };
    return postTransferCommand({
      transferId: String(payload.transferId ?? ""),
      userId: ctx.userId,
    });
  },
  "stock.receiveTransfer": async (args, ctx) => {
    const input = (args[0] ?? {}) as Parameters<typeof receiveTransferCommand>[0];
    return receiveTransferCommand({ ...input, userId: ctx.userId });
  },
  "stock.saveAdjustment": async (args, ctx) => {
    const input = (args[0] ?? {}) as Record<string, unknown>;
    if (input.id) {
      return {
        ok: false,
        error: "Updating adjustments via API is not yet supported.",
      };
    }
    return createAdjustmentCommand({
      ...(input as Parameters<typeof createAdjustmentCommand>[0]),
      userId: ctx.userId,
      salesPointId: Number(input.salesPointId ?? ctx.salesPointId),
    });
  },
  "stock.postAdjustment": async (args, ctx) => {
    const payload = (args[0] ?? {}) as { adjustmentId?: string };
    return postAdjustmentCommand({
      adjustmentId: String(payload.adjustmentId ?? ""),
      userId: ctx.userId,
    });
  },

  // --- Stock extras (server/src/services/stockRpcExtras.ts) ---------------
  // Client signatures mirror preload.cjs: (userId, filter) / (userId, query)
  // or a single payload object. The acting user always comes from the session.
  "stock.getBootstrap": async (args, ctx) =>
    stockExtras.getBootstrap(
      ctx.userId,
      (args[1] ?? null) as stockExtras.StockProductFilter | null,
    ),
  "stock.listOnHandAsOf": async (args, ctx) =>
    stockExtras.listOnHandAsOf(
      ctx.userId,
      (args[1] ?? args[0] ?? null) as Parameters<typeof stockExtras.listOnHandAsOf>[1],
    ),
  "stock.getBinCard": async (args, ctx) =>
    stockExtras.getBinCard(
      ctx.userId,
      (args[1] ?? args[0] ?? {}) as stockExtras.BinCardQuery,
    ),
  "stock.cancelReceipt": async (args, ctx) => {
    const p = (args[0] ?? {}) as {
      receiptId?: string;
      productFilter?: stockExtras.StockProductFilter | null;
    };
    return stockExtras.cancelReceipt(ctx.userId, String(p.receiptId ?? ""), p.productFilter);
  },
  "stock.findReceiptByNumber": async (args, ctx) => {
    const p = (args[0] ?? {}) as { receiptNo?: string };
    return stockExtras.findReceiptByNumber(ctx.userId, String(p.receiptNo ?? ""));
  },
  "stock.findReceiptByConsignmentNoteNo": async (args, ctx) => {
    const p = (args[0] ?? {}) as { consignmentNoteNo?: string };
    return stockExtras.findReceiptByConsignmentNoteNo(
      ctx.userId,
      String(p.consignmentNoteNo ?? ""),
    );
  },
  "stock.loadReceiptForReview": async (args, ctx) => {
    const p = (args[0] ?? {}) as { receiptId?: string };
    return stockExtras.loadReceiptForReview(ctx.userId, String(p.receiptId ?? ""));
  },
  "stock.loadReceiptPrintById": async (args, ctx) => {
    const p = (args[0] ?? {}) as { receiptId?: string };
    return stockExtras.loadReceiptPrintById(ctx.userId, String(p.receiptId ?? ""));
  },
  "stock.loadTransferPrintById": async (args, ctx) => {
    const p = (args[0] ?? {}) as { transferId?: string };
    return stockExtras.loadTransferPrintById(ctx.userId, String(p.transferId ?? ""));
  },
  "stock.dispatchTransfer": async (args, ctx) => {
    const p = (args[0] ?? {}) as {
      transferId?: string;
      productFilter?: stockExtras.StockProductFilter | null;
    };
    return stockExtras.dispatchTransfer(ctx.userId, String(p.transferId ?? ""), p.productFilter);
  },
  "stock.cancelTransfer": async (args, ctx) => {
    const p = (args[0] ?? {}) as {
      transferId?: string;
      productFilter?: stockExtras.StockProductFilter | null;
    };
    return stockExtras.cancelTransfer(ctx.userId, String(p.transferId ?? ""), p.productFilter);
  },
  "stock.findTransferByNumber": async (args, ctx) => {
    const p = (args[0] ?? {}) as { transferNo?: string };
    return stockExtras.findTransferByNumber(ctx.userId, String(p.transferNo ?? ""));
  },
  "stock.loadTransferForReview": async (args, ctx) => {
    const p = (args[0] ?? {}) as { transferId?: string };
    return stockExtras.loadTransferForReview(ctx.userId, String(p.transferId ?? ""));
  },
  "stock.cancelAdjustment": async (args, ctx) => {
    const p = (args[0] ?? {}) as {
      adjustmentId?: string;
      productFilter?: stockExtras.StockProductFilter | null;
    };
    return stockExtras.cancelAdjustment(
      ctx.userId,
      String(p.adjustmentId ?? ""),
      p.productFilter,
    );
  },
  "stock.findAdjustmentByNumber": async (args, ctx) => {
    const p = (args[0] ?? {}) as { adjustmentNo?: string };
    return stockExtras.findAdjustmentByNumber(ctx.userId, String(p.adjustmentNo ?? ""));
  },
  "stock.loadAdjustmentForReview": async (args, ctx) => {
    const p = (args[0] ?? {}) as { adjustmentId?: string };
    return stockExtras.loadAdjustmentForReview(ctx.userId, String(p.adjustmentId ?? ""));
  },
  "stock.listReceiveQueue": async (_args, ctx) => stockExtras.listReceiveQueue(ctx.userId),
  "stock.validateMany": async (args, ctx) => {
    const p = (args[0] ?? {}) as { items?: stockExtras.StockValidationItem[] };
    return stockExtras.validateMany(ctx.userId, p.items ?? []);
  },
  "stock.getIntakeOilGroupingStatus": async () => stockExtras.getIntakeOilGroupingStatus(),
  "stock.applyIntakeOilGrouping": async (args, ctx) => {
    const p = (args[0] ?? {}) as { enabled?: boolean };
    return stockExtras.applyIntakeOilGrouping(ctx.userId, Boolean(p.enabled));
  },

  // --- Document booklets (server/src/services/bookletsRpc.ts) -------------
  // Client signatures: (authToken, ...) except validateSerial(input).
  "booklets.listBooklets": async (args, ctx) =>
    bookletsRpc.listBooklets(
      ctx.userId,
      (args[1] ?? null) as bookletsRpc.DocumentBookletFilters | null,
    ),
  "booklets.createBooklet": async (args, ctx) =>
    bookletsRpc.createBooklet(
      ctx.userId,
      (args[1] ?? {}) as bookletsRpc.CreateDocumentBookletInput,
    ),
  "booklets.validateBooklet": async (args, ctx) =>
    bookletsRpc.validateBooklet(ctx.userId, String(args[1] ?? "")),
  "booklets.rejectBooklet": async (args, ctx) =>
    bookletsRpc.rejectBooklet(
      ctx.userId,
      String(args[1] ?? ""),
      typeof args[2] === "string" ? args[2] : null,
    ),
  "booklets.validateManyBooklets": async (args, ctx) =>
    bookletsRpc.validateManyBooklets(
      ctx.userId,
      Array.isArray(args[1]) ? (args[1] as string[]) : [],
    ),
  "booklets.cancelBooklet": async (args, ctx) =>
    bookletsRpc.cancelBooklet(
      ctx.userId,
      String(args[1] ?? ""),
      typeof args[2] === "string" ? args[2] : null,
    ),
  "booklets.validateSerial": async (args) =>
    bookletsRpc.validateSerial(
      (args[0] ?? {}) as bookletsRpc.ValidateSerialForSalesPointInput,
    ),

  "dashboard.getSummary": async (_args, ctx) => getDashboardSummary(ctx.userId),

  "vehicleConsignmentNotes.loadSaleByInvoice": async (args) =>
    vcnRpc.loadSaleForConsignmentByInvoice(String(args[0] ?? "")),
  "vehicleConsignmentNotes.loadByVcnNo": async (args) =>
    vcnRpc.loadConsignmentByVcnNo(String(args[0] ?? "")),
  "vehicleConsignmentNotes.save": async (args, ctx) => {
    const input = (args[0] ?? {}) as vcnRpc.SaveConsignmentNoteInput;
    return vcnRpc.saveConsignmentNote(ctx.userId, input);
  },
  "vehicleConsignmentNotes.delete": async (args, ctx) => {
    const payload = (args[0] ?? {}) as { id?: string };
    return vcnRpc.deleteConsignmentNote(ctx.userId, String(payload.id ?? ""));
  },
  "vehicleConsignmentNotes.validate": async (args, ctx) => {
    const payload = (args[0] ?? {}) as { id?: string };
    return vcnRpc.validateConsignmentNote(
      ctx.userId,
      String(payload.id ?? ""),
    );
  },
  "vehicleConsignmentNotes.loadPrintById": async (args) =>
    vcnRpc.getConsignmentPrintPayload(String(args[0] ?? "")),
  "vehicleConsignmentNotes.listValidationQueue": async (_args, ctx) =>
    vcnRpc.listConsignmentValidationQueue(ctx.userId),
  "vehicleConsignmentNotes.validateMany": async (args, ctx) => {
    const payload = (args[0] ?? {}) as { noteIds?: string[] };
    return vcnRpc.validateManyConsignmentNotes(
      ctx.userId,
      Array.isArray(payload.noteIds) ? payload.noteIds : [],
    );
  },

  // Reports — real ports where available; shells for the rest.
  "reports.getStockReport": async (args, ctx) => {
    const hideZero =
      typeof args[1] === "boolean"
        ? args[1]
        : args[1] === 0 || args[1] === 1
          ? Boolean(args[1])
          : undefined;
    const asAtIso = typeof args[2] === "string" ? args[2] : undefined;
    return getStockReport(ctx.userId, hideZero, asAtIso);
  },
  "reports.getStockCommitment": async (args, ctx) => {
    const hideZero =
      typeof args[1] === "boolean"
        ? args[1]
        : args[1] === 0 || args[1] === 1
          ? Boolean(args[1])
          : undefined;
    const asAtIso = typeof args[2] === "string" ? args[2] : undefined;
    return getStockCommitmentReport(ctx.userId, hideZero, asAtIso);
  },
  "reports.getCommitmentReport": async (args, ctx) => {
    const hideZero =
      typeof args[1] === "boolean"
        ? args[1]
        : args[1] === 0 || args[1] === 1
          ? Boolean(args[1])
          : undefined;
    return getCommitmentReport(ctx.userId, hideZero);
  },
  "reports.getBottleOilStockSales": async (args, ctx) => {
    const hideZero =
      typeof args[1] === "boolean"
        ? args[1]
        : args[1] === 0 || args[1] === 1
          ? Boolean(args[1])
          : undefined;
    const asAtIso = typeof args[2] === "string" ? args[2] : undefined;
    return getBottleOilStockSalesReport(ctx.userId, hideZero, asAtIso);
  },
  "reports.getBottledWeeklyIssues": async (args, ctx) => {
    const estimateBasis =
      typeof args[1] === "string" ? args[1] : undefined;
    const weekMondayIso =
      typeof args[2] === "string" ? args[2] : undefined;
    return getBottledWeeklyIssuesReport(
      ctx.userId,
      estimateBasis,
      weekMondayIso,
    );
  },
  "reports.getWeekChoices": async () => getOpenMonthWeekChoices(),
  "reports.getWeeklyDeliveries": async (args, ctx) => {
    const weekMondayIso =
      typeof args[1] === "string" ? args[1] : undefined;
    return getWeeklyDeliveriesReport(ctx.userId, weekMondayIso);
  },
  "reports.getMonthlyDelivery": async (args, ctx) => {
    // Client calls (half, authToken) — half is first.
    const halfRaw = args[0] === 2 || args[0] === "2" ? 2 : 1;
    return getMonthlyDeliveryReport(ctx.userId, halfRaw);
  },
  "reports.getMonthlyStockReconciliation": async (args, ctx) => {
    const hideZero =
      typeof args[1] === "boolean"
        ? args[1]
        : args[1] === 0 || args[1] === 1
          ? Boolean(args[1])
          : undefined;
    return getMonthlyStockReconciliationReport(ctx.userId, hideZero);
  },
  "reports.getLooseLpoStockSummary": async (_args, ctx) =>
    getLooseLpoStockSummaryReport(ctx.userId),
  "reports.getMonthlyPaymentDelivery": async (_args, ctx) =>
    getMonthlyPaymentDeliveryReport(ctx.userId),
  "reports.getTransportCost": async (_args, ctx) =>
    getTransportCostReport(ctx.userId),
  "reports.getMonthlyDeliveriesByDestination": async (_args, ctx) =>
    getMonthlyDeliveriesByDestinationReport(ctx.userId),
  "reports.getMonthlyPalmOilSales": async (_args, ctx) =>
    getMonthlyPalmOilSalesReport(ctx.userId),
  "reports.getPalmOilSalesActivity": async (_args, ctx) =>
    getPalmOilSalesActivityReport(ctx.userId),
  "reports.getIndustryProductMonthlySales": async (_args, ctx) =>
    getIndustryProductMonthlySalesReport(ctx.userId),
  "reports.getBottledPalmOilSalesReturn": async (_args, ctx) =>
    getBottledPalmOilSalesReturnReport(ctx.userId),
  "reports.getOtherProductSalesDeliveries": async (_args, ctx) =>
    getOtherProductSalesDeliveriesReport(ctx.userId),
  "reports.getMonthlyBottledOil": async (_args, ctx) =>
    getMonthlyBottledOilReport(ctx.userId),
  "reports.getRevenueTaxes": async (args, ctx) => {
    const period =
      args[1] === "year" || args[1] === "month"
        ? (String(args[1]) as "year" | "month")
        : "month";
    const salesPointId =
      typeof args[2] === "number"
        ? args[2]
        : args[2] == null || args[2] === ""
          ? null
          : Number(args[2]);
    return getRevenueTaxesReport(
      ctx.userId,
      period,
      Number.isFinite(salesPointId as number) ? (salesPointId as number) : null,
    );
  },
  "reports.getSalesBudgetMonthlyCrosstab": async (args, ctx) => {
    const year =
      typeof args[1] === "number" ? args[1] : Number(args[1] ?? NaN);
    return getSalesBudgetMonthlyCrosstabReport(
      ctx.userId,
      Number.isFinite(year) ? year : undefined,
    );
  },
  "reports.getSalesBudgetWeeklyCrosstab": async (args, ctx) => {
    const year =
      typeof args[1] === "number" ? args[1] : Number(args[1] ?? NaN);
    return getSalesBudgetWeeklyCrosstabReport(
      ctx.userId,
      Number.isFinite(year) ? year : undefined,
    );
  },
  "reports.getSalesBudgetMonthlyRevenueCrosstab": async (args, ctx) => {
    const year =
      typeof args[1] === "number" ? args[1] : Number(args[1] ?? NaN);
    return getSalesBudgetMonthlyRevenueCrosstabReport(
      ctx.userId,
      Number.isFinite(year) ? year : undefined,
    );
  },
  "reports.getSalesBudgetWeeklyRevenueCrosstab": async (args, ctx) => {
    const year =
      typeof args[1] === "number" ? args[1] : Number(args[1] ?? NaN);
    return getSalesBudgetWeeklyRevenueCrosstabReport(
      ctx.userId,
      Number.isFinite(year) ? year : undefined,
    );
  },
  "reports.getDailySales": async (args, ctx) => {
    const reportDateIso = String(args[1] ?? args[0] ?? "");
    const salesPointId =
      args[2] === null || args[2] === undefined
        ? null
        : Number(args[2]);
    return getDailySalesReport(
      ctx.userId,
      reportDateIso,
      Number.isFinite(salesPointId as number) ? (salesPointId as number) : null,
    );
  },
  "reports.getDailySalesMatrix": async (args, ctx) => {
    const salesPointId =
      args[1] === null || args[1] === undefined
        ? null
        : Number(args[1]);
    const productId =
      args[2] === null || args[2] === undefined
        ? null
        : Number(args[2]);
    return getDailySalesMatrixReport(
      ctx.userId,
      Number.isFinite(salesPointId as number) ? (salesPointId as number) : null,
      Number.isFinite(productId as number) ? (productId as number) : null,
    );
  },
  "reports.saveReportComments": async (args) => {
    const input = (args[1] ?? args[0] ?? {}) as {
      reportId?: string;
      text?: string | null;
    };
    return saveReportComments(
      String(input.reportId ?? ""),
      input.text ?? null,
    );
  },
  "reports.listSignatories": async () => listReportSignatories(),
  "reports.getSignatory": async (args) => {
    const asAt =
      typeof args[1] === "string"
        ? args[1]
        : typeof args[0] === "string"
          ? args[0]
          : null;
    return getReportSignatory(asAt);
  },
  "reports.upsertSignatory": async (args, ctx) => {
    const input = (args[1] ?? args[0] ?? {}) as {
      id?: string | null;
      name: string;
      title: string;
      effectiveFrom: string;
    };
    return upsertReportSignatory(ctx.userId, input);
  },
  "reports.deleteSignatory": async (args, ctx) => {
    const id =
      typeof args[1] === "string" ? args[1] : String(args[0] ?? "");
    return deleteReportSignatory(ctx.userId, id);
  },

  "financialYears.getOpenPostingPeriod": async (_args, ctx) => {
    // Actor-scoped: HO → personal UserPostingMonth; CP → sales-point month.
    return getOpenPostingPeriodForActor(ctx.userId);
  },
  "financialYears.listYears": async () => listYears(),
  "financialYears.openYear": async (args) => {
    // Authenticated wrappers pass (authToken, financialYear).
    const year =
      typeof args[0] === "number"
        ? args[0]
        : Number(args[1] ?? args[0]);
    return openYear(year);
  },
  "financialYears.closeYear": async (args) => {
    const periodId =
      typeof args[1] === "string" ? args[1] : String(args[0] ?? "");
    return closeYear(periodId);
  },
  "financialYears.listMonthsForOpenYear": async (_args, ctx) => {
    return listMonthsForOpenYearForActor(ctx.userId);
  },
  "financialYears.listMonthsForPeriod": async (args, ctx) => {
    const periodId =
      typeof args[1] === "string" ? args[1] : String(args[0] ?? "");
    const { year, months } = await listMonthsForOpenYearForActor(ctx.userId);
    if (!year || year.id !== periodId) {
      return [];
    }
    return months;
  },
  "financialYears.setMonthStatus": async (args, ctx) => {
    // (authToken, monthId, status, salesPointId?)
    const monthId =
      typeof args[2] === "string" || args[2] === "OPEN" || args[2] === "CLOSED"
        ? String(args[1] ?? "")
        : String(args[0] ?? "");
    const statusRaw =
      typeof args[2] === "string" ? args[2] : String(args[1] ?? "CLOSED");
    return setMonthStatusForActor(
      ctx.userId,
      monthId,
      statusRaw === "OPEN" ? "OPEN" : "CLOSED",
    );
  },
  "db.getCompanySettings": async () => getCompanySettings(),
  "db.queryTable": async (args) => {
    const input = (args[0] ?? {}) as {
      table?: string;
      limit?: number;
      offset?: number;
      search?: string;
    };
    return queryTable({
      table: String(input.table ?? ""),
      limit: input.limit,
      offset: input.offset,
      search: input.search,
    });
  },
  "sync.getStatus": async () => thinClientSyncStatus(),
  "sync.triggerNow": async () => ({
    ok: true,
    message: "Thin client — data is already on the shared API.",
  }),
  "sync.backfillAllData": async () => ({
    ok: true,
    message: "Thin client — no local outbox to backfill.",
    enqueuedCount: 0,
    summary: {},
  }),
  "sync.getConfig": async () => thinClientSyncConfig(),
  "sync.saveConfig": async () => ({
    ok: false,
    error: "Sync settings are not used in thin-client (HTTP API) mode.",
  }),
  "sync.getPendingList": async () => [],
  "sync.testConnection": async () => ({
    ok: true,
    latencyMs: 0,
    serverVersion: "thin-client",
  }),
  "carryForward.getFormOptions": async () => carryForwardStubs.getFormOptions(),
  "carryForward.list": async () => carryForwardStubs.list(),
  "carryForward.listPending": async (_args, ctx) =>
    carryForwardStubs.listPending(ctx.userId),
  "carryForward.upsert": async (args, ctx) => {
    const input = (args[0] ?? {}) as Record<string, unknown>;
    return carryForwardStubs.upsert({
      ...(input as Parameters<typeof carryForwardStubs.upsert>[0]),
      userId: ctx.userId,
    });
  },
  "carryForward.upsertBatch": async (args, ctx) => {
    const input = (args[0] ?? {}) as Record<string, unknown>;
    return carryForwardStubs.upsertBatch({
      ...(input as Parameters<typeof carryForwardStubs.upsertBatch>[0]),
      userId: ctx.userId,
    });
  },
  "carryForward.delete": async (args, ctx) => {
    const input = (args[0] ?? {}) as { detailId?: number };
    return carryForwardStubs.delete({
      userId: ctx.userId,
      detailId: Number(input.detailId),
    });
  },
  "carryForwardStock.getFormOptions": async () =>
    carryForwardStockStubs.getFormOptions(),
  "carryForwardStock.list": async () => carryForwardStockStubs.list(),
  "carryForwardStock.listPending": async (_args, ctx) =>
    carryForwardStockStubs.listPending(ctx.userId),
  "carryForwardStock.listOnHand": async (args) => {
    const salesPointId = Number(args[0]);
    const productId = Number(args[1]);
    return carryForwardStockStubs.listOnHand(salesPointId, productId);
  },
  "carryForwardStock.upsertBatch": async (args, ctx) => {
    const input = (args[0] ?? {}) as Record<string, unknown>;
    return carryForwardStockStubs.upsertBatch({
      ...(input as Parameters<typeof carryForwardStockStubs.upsertBatch>[0]),
      userId: ctx.userId,
    });
  },
  "transportCost.getFormOptions": async () => getTransportCostFormOptions(),
  "transportCost.compute": async (args, ctx) =>
    computeTransportCost(parseTransportCostComputeArgs(args), ctx.userId),
  "backup.getInfo": async () => backupStubs.getInfo(),
  "backup.create": async () => backupStubs.create(),
  "backup.restore": async () => backupStubs.restore(),
  "backup.getSchedule": async () => backupStubs.getSchedule(),
  "backup.updateSchedule": async () => backupStubs.updateSchedule(),
  "backup.chooseDestinationFolder": async () =>
    backupStubs.chooseDestinationFolder(),
  "backup.runScheduledNow": async () => backupStubs.runScheduledNow(),
  "customers.list": async () => listCustomers(),
  "products.list": async () => listProducts(),
  "salesPoints.list": async () => listSalesPoints(),
  "sales.getFormOptions": async (_args, ctx) => {
    const [
      actor,
      customers,
      salesProducts,
      salesPoints,
      company,
      paymentMethods,
      storage,
    ] = await Promise.all([
      loadRpcActor(ctx.userId),
      listCustomers(),
      listSalesFormProducts(),
      listSalesPoints(),
      getCompanySettings(),
      prisma.payment_method_definitions.findMany({
        where: { is_active: true },
        orderBy: { sort_order: "asc" },
      }),
      prisma.storage_locations.findMany({
        where: {
          is_active: true,
          ...(ctx.salesPointId != null
            ? { sales_point_id: ctx.salesPointId }
            : {}),
        },
        include: { locations: { select: { location_name: true } } },
        take: 500,
      }),
    ]);
    const mappedLocations = storage.map((s) => ({
      id: s.id,
      name: s.locations?.location_name ?? `Storage #${s.id}`,
      salesPointId: s.sales_point_id,
      isDefault: Boolean(s.is_default),
      isSalesTank: s.is_sales_tank,
    }));
    const botaSalesPoint =
      salesPoints.find((point) =>
        String(point.name ?? "")
          .toUpperCase()
          .includes("BOTA"),
      ) ?? null;
    const bottleOilStoreLocation =
      mappedLocations.find(
        (location) =>
          botaSalesPoint != null &&
          location.salesPointId === botaSalesPoint.id &&
          location.name.toLowerCase().includes("bottle"),
      ) ?? null;
    const canDirect = canPerformAction(actor, "direct_validate_sales");
    const canDirectValidateLoose =
      canWriteRoute(actor, "sales") && canDirect;
    const canDirectValidateBottled =
      canWriteRoute(actor, "bottle-oil-sales") && canDirect;
    return {
      customers,
      looseProducts: salesProducts.looseProducts,
      bottledProducts: salesProducts.bottledProducts,
      salesPoints,
      paymentMethods: paymentMethods.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        kind: p.kind,
      })),
      storageLocations: mappedLocations,
      scopedSalesPointId: ctx.salesPointId,
      companyName: company?.companyName ?? "",
      vatRateDecimal: company?.vatRate ?? "0",
      autoGenerateSalesInvoiceNo: company?.autoGenerateSalesInvoiceNo === true,
      canDirectValidateLoose,
      canDirectValidateBottled,
      canDirectValidate: canDirectValidateLoose || canDirectValidateBottled,
      enforceSalesInvoiceBookletValidation:
        company?.enforceSalesInvoiceBookletValidation === true,
      salesInvoiceLockUnitPrice: company?.salesInvoiceLockUnitPrice !== false,
      loosePalmOilRequireSalesTank:
        company?.loosePalmOilRequireSalesTank !== false,
      botaSalesPointId: botaSalesPoint?.id ?? null,
      bottleOilStoreLocationId: bottleOilStoreLocation?.id ?? null,
    };
  },
  "deliveryOrders.getFormOptions": async (_args, ctx) => {
    const [customers, products, salesPoints, company, paymentMethods] =
      await Promise.all([
        listCustomers(),
        listProducts(),
        listSalesPoints(),
        getCompanySettings(),
        prisma.payment_method_definitions.findMany({
          where: { is_active: true },
          orderBy: { sort_order: "asc" },
        }),
      ]);
    return {
      customers,
      products,
      salesPoints,
      paymentMethods: paymentMethods.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        kind: p.kind,
      })),
      scopedSalesPointId: ctx.salesPointId,
      companyName: company?.companyName ?? "",
      autoGenerateDeliveryOrderNo:
        company?.autoGenerateDeliveryOrderNo === true,
      enforceDeliveryOrderBookletValidation:
        company?.enforceDeliveryOrderBookletValidation === true,
      deliveryOrderBlockRetailQuantity: true,
      retailWholesaleThresholdKg: 3000,
      vatRateDecimal: company?.vatRate ?? "0",
    };
  },
  "deliveryOrders.listValidationQueue": async (_args, ctx) => {
    const where: {
      status: string;
      cancelled_at: null;
      sales_point_id?: number;
    } = {
      status: "PENDING",
      cancelled_at: null,
    };
    if (ctx.salesPointId != null) {
      where.sales_point_id = ctx.salesPointId;
    }
    const [totalPending, rows] = await Promise.all([
      prisma.delivery_orders.count({ where }),
      prisma.delivery_orders.findMany({
        where,
        orderBy: [{ date_issued: "asc" }, { delivery_order_no: "asc" }],
        take: 200,
        include: {
          sales_points: { select: { name: true } },
          delivery_order_details: { select: { amount: true } },
        },
      }),
    ]);
    const customerIds = [
      ...new Set(
        rows
          .map((row) => row.customer_id)
          .filter((id): id is number => id != null),
      ),
    ];
    const customers =
      customerIds.length > 0
        ? await prisma.customers.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, name: true },
          })
        : [];
    const customerName = new Map(customers.map((c) => [c.id, c.name]));
    return {
      totalPending,
      rows: rows.map((row) => {
        const totalAmount = row.delivery_order_details.reduce((sum, detail) => {
          const amount = Number.parseFloat(String(detail.amount ?? "0"));
          return sum + (Number.isFinite(amount) ? amount : 0);
        }, 0);
        return {
          id: row.id,
          deliveryOrderNo: row.delivery_order_no,
          dateIssuedIso: String(row.date_issued).slice(0, 10),
          salesPointName: row.sales_points?.name ?? "",
          customerName:
            row.customer_id != null
              ? (customerName.get(row.customer_id) ?? "")
              : "",
          totalAmountXaf:
            totalAmount > 0
              ? `${Math.round(totalAmount).toLocaleString()} XAF`
              : "",
        };
      }),
    };
  },
  "deliveryOrders.validateOrder": async (args, ctx) => {
    const payload = (args[0] ?? {}) as { orderId?: string | number };
    const id = String(payload.orderId ?? "");
    const existing = await prisma.delivery_orders.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Delivery order not found." };
    if (existing.status === "VALIDATED") return { ok: true };
    if (existing.status !== "PENDING") {
      return {
        ok: false,
        error: `Cannot validate a delivery order in status ${existing.status}.`,
      };
    }
    await prisma.delivery_orders.update({
      where: { id },
      data: {
        status: "VALIDATED",
        validated_at: new Date(),
        validated_by_user_id: ctx.userId,
      },
    });
    return { ok: true };
  },
  "stock.listValidationQueue": async (_args, ctx) =>
    stockExtras.listValidationQueue(ctx.userId),
};

export const appRpcRoute = new Hono();

appRpcRoute.use("*", sessionAuthMiddleware);

appRpcRoute.post("/:namespace/:method", async (c) => {
  const namespace = c.req.param("namespace");
  const method = c.req.param("method");
  const key = `${namespace}.${method}`;
  const body = await c.req.json().catch(() => ({}));
  const args = Array.isArray(body?.args) ? body.args : [];

  const user = c.get("user");
  const ctx = {
    userId: user.id,
    salesPointId: user.salesPointId,
  };

  if (key === "permissions.getSnapshot") {
    return c.json(user.permissions);
  }

  const handler = resolveHandler(key, handlers);
  if (!handler) {
    return c.json(
      {
        ok: false,
        error: `API method not implemented yet: ${key}`,
        code: "NOT_IMPLEMENTED",
      },
      501,
    );
  }

  try {
    const result = await handler(args, ctx);
    return c.json(result ?? null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed.";
    return c.json({ ok: false, error: message }, 400);
  }
});
