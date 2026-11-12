/**
 * Fallback handlers for every ElectronAppApi method that might still be
 * unregistered. Explicit handlers in appRpc.ts always win.
 */
import { prisma } from "../db/prisma.js";
import { sql } from "../db/index.js";
import { clearOperationalTables } from "../db/clearOperationalData.js";
import {
  getCompanySettings,
  listCustomers,
  listProducts,
  listSalesPoints,
} from "./mastersQueries.js";
import { getOpenPostingPeriod } from "./financialYearsService.js";
import {
  queryTable,
  getCompanySettingsRow,
} from "./tableQuery.js";
import {
  deleteRow,
  getTableSchema,
  insertRow,
  updateRow,
} from "./tableMutations.js";
import { TABLE_MAP } from "./tableMeta.js";
import * as booklets from "./bookletsRpc.js";
import * as permissions from "./permissionsRpc.js";
import * as salesExtras from "./salesRpcExtras.js";
import * as doExtras from "./deliveryOrdersRpcExtras.js";
import { getBalanceQty } from "./stockMovements.js";
import { loadRpcActor } from "./rpcActor.js";

type Ctx = { userId: string; salesPointId: number | null };
type Handler = (args: unknown[], ctx: Ctx) => Promise<unknown>;

const THIN = "Not available in thin-client (shared API) mode.";

function firstObject(args: unknown[]): Record<string, unknown> {
  for (const arg of args) {
    if (arg && typeof arg === "object" && !Array.isArray(arg)) {
      return arg as Record<string, unknown>;
    }
  }
  return {};
}

function argString(args: unknown[], index: number): string {
  return String(args[index] ?? "");
}

async function emptyStockBootstrap(ctx: Ctx, productFilter?: unknown) {
  const [salesPoints, products, storage] = await Promise.all([
    listSalesPoints(),
    listProducts(),
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
  return {
    productFilter: productFilter ?? "ALL",
    canManageReceipts: true,
    canInitiateTransfers: true,
    canDispatchTransfers: true,
    canReceiveTransfers: true,
    canCancelTransfers: true,
    canPostAdjustments: true,
    canReclassifyStock: true,
    canCancelDocuments: true,
    canDraftReceipts: true,
    canDraftTransfers: true,
    canDraftAdjustments: true,
    canDirectPostReceipts: true,
    canDirectPostTransfers: true,
    scopedSalesPointId: ctx.salesPointId,
    salesPoints,
    storageLocations: storage.map((s) => ({
      id: s.id,
      name: s.locations?.location_name ?? `Storage #${s.id}`,
      salesPointId: s.sales_point_id,
      isDefault: s.is_default,
      isSalesTank: s.is_sales_tank,
    })),
    products,
    receiptProducts: products,
    autoGenerateReceiptNo: true,
    autoGenerateTransferNo: true,
    transferReceiveUsesDocumentDate: true,
    loosePalmOilAllowInterSalesPointTransfer: false,
    stockIntakeOilGrouping: false,
    onHand: [],
    movements: [],
    receipts: [],
    transfers: [],
    adjustments: [],
  };
}

const backupDisabled = {
  getInfo: async () => ({
    userDataDir: "",
    dbPath: "(postgres)",
    dbSizeBytes: 0,
    walSizeBytes: 0,
    lastBackupAt: null,
    lastBackupPath: null,
    lastBackupSizeBytes: null,
  }),
  create: async () => ({ ok: false as const, error: THIN }),
  restore: async () => ({ ok: false as const, error: THIN }),
  getSchedule: async () => ({
    config: {
      enabled: false,
      destinationDir: null,
      timeOfDay: "02:00",
      retentionCount: 7,
    },
    lastAutoBackupAt: null,
    lastAutoBackupPath: null,
    lastAutoBackupError: null,
    nextRunAt: null,
  }),
  updateSchedule: async () => ({ ok: false as const, error: THIN }),
  chooseDestinationFolder: async () => ({
    ok: false as const,
    cancelled: true,
  }),
  runScheduledNow: async () => ({ ok: false as const, error: THIN }),
};

export const coverageHandlers: Record<string, Handler> = {
  // ---- db ----
  "db.getSchemaSummary": async () => {
    const tables = Object.keys(TABLE_MAP).sort();
    return { tableCount: tables.length, tables };
  },
  "db.getTableSchema": async (args) => {
    const input = firstObject(args);
    const table = String(input.table ?? args[0] ?? "");
    return getTableSchema(table);
  },
  "db.insertRow": async (args) => {
    const input = firstObject(args);
    return insertRow({
      table: String(input.table ?? ""),
      values: (input.values ?? {}) as Record<string, unknown>,
    });
  },
  "db.updateRow": async (args) => {
    const input = firstObject(args);
    return updateRow({
      table: String(input.table ?? ""),
      primaryKey: (input.primaryKey ?? {}) as Record<string, unknown>,
      values: (input.values ?? {}) as Record<string, unknown>,
    });
  },
  "db.deleteRow": async (args) => {
    const input = firstObject(args);
    await deleteRow({
      table: String(input.table ?? ""),
      primaryKey: (input.primaryKey ?? {}) as Record<string, unknown>,
    });
  },
  "db.setCompanyUiTheme": async (args) => {
    const input = firstObject(args);
    const preset = input.uiThemePreset ?? input.preset ?? args[0];
    const resolved =
      preset === "dark" ? "dark" : preset === "agro" ? "agro" : null;
    if (!resolved) return { ok: false, error: "Invalid theme preset." };
    await prisma.company_settings.update({
      where: { id: "default" },
      data: { ui_theme_preset: resolved, updated_at: new Date() },
    });
    return { ok: true, uiThemePreset: resolved };
  },
  "db.clearOperationalData": async (args, ctx) => {
    const input = firstObject(args);
    const actor = await loadRpcActor(ctx.userId);
    if (!actor || actor.role !== "ADMIN") {
      return {
        ok: false as const,
        error: "Only Administrators can clear operational data.",
      };
    }
    if (String(input.confirm ?? "") !== "CLEAR") {
      return {
        ok: false as const,
        error: 'Confirmation required: confirm must be "CLEAR".',
      };
    }

    const result = await clearOperationalTables(sql);
    return {
      ok: true as const,
      deleted: result.deleted,
      sequences: result.sequences,
      // Thin client already clears the shared Postgres — no separate sync DB.
      syncCleared: true,
      syncTables: result.tables,
    };
  },
  "db.queryTable": async (args) => {
    const input = firstObject(args);
    return queryTable({
      table: String(input.table ?? ""),
      limit: input.limit as number | undefined,
      offset: input.offset as number | undefined,
      search: input.search as string | undefined,
    });
  },
  "db.getCompanySettings": async () =>
    (await getCompanySettingsRow()) ?? (await getCompanySettings()),

  // ---- permissions ----
  "permissions.getMatrix": async () => permissions.getPermissionMatrix(),
  "permissions.saveMatrix": async (args) =>
    permissions.savePermissionMatrix(firstObject(args) as never),
  "permissions.listRoles": async () => permissions.listRoles(),
  "permissions.createRole": async (args) =>
    permissions.createRole(firstObject(args) as never),
  "permissions.updateRole": async (args) =>
    permissions.updateRole(firstObject(args) as never),
  "permissions.deleteRole": async (args) =>
    permissions.deleteRole(firstObject(args) as never),

  // ---- sales extras ----
  "sales.getTaxRatesAsOf": async (args) =>
    salesExtras.getTaxRatesAsOf(String(args[0] ?? "")),
  "sales.listAvailableDeliveryOrders": async (args) =>
    salesExtras.listAvailableDeliveryOrders(firstObject(args) as never),
  "sales.lookupDeliveryOrder": async (args) =>
    salesExtras.lookupDeliveryOrder(firstObject(args) as never),
  "sales.loadSalePrintById": async (args) =>
    salesExtras.loadSalePrintById(String(args[0] ?? "")),
  "sales.previewUnitPrice": async (args) =>
    salesExtras.previewUnitPrice(firstObject(args) as never),
  "sales.listStorageLocationsWithBalance": async (args) =>
    salesExtras.listStorageLocationsWithBalance(firstObject(args) as never),

  // ---- delivery orders extras ----
  "deliveryOrders.loadByNo": async (args) =>
    doExtras.loadByNo(String(args[0] ?? "")),
  "deliveryOrders.loadPrintById": async (args) =>
    doExtras.loadPrintById(String(args[0] ?? "")),
  "deliveryOrders.trackByNo": async (args) =>
    doExtras.trackByNo(String(args[0] ?? "")),
  "deliveryOrders.transferBalance": async (args, ctx) =>
    doExtras.transferBalance({
      ...firstObject(args),
      userId: ctx.userId,
    }),
  "deliveryOrders.listPending": async (_args, ctx) => doExtras.listPending(ctx),
  "deliveryOrders.listOrders": async (args, ctx) =>
    doExtras.listOrders(firstObject(args), ctx),
  "deliveryOrders.deleteOrder": async (args) =>
    doExtras.deleteOrder(firstObject(args) as never),
  "deliveryOrders.cancelValidated": async (args, ctx) =>
    doExtras.cancelValidated(firstObject(args) as never, ctx.userId),
  "deliveryOrders.previewTaxes": async (args) =>
    doExtras.previewTaxes(firstObject(args) as never),
  "deliveryOrders.previewUnitPrice": async (args) =>
    doExtras.previewUnitPriceDo(firstObject(args)),
  "deliveryOrders.previewStockOnHand": async (args) =>
    doExtras.previewStockOnHand(firstObject(args) as never),
  "deliveryOrders.validateMany": async (args, ctx) =>
    doExtras.validateMany(firstObject(args) as never, ctx.userId),

  // ---- booklets ----
  "booklets.listBooklets": async (args) => {
    const filters =
      args[1] && typeof args[1] === "object"
        ? (args[1] as never)
        : (firstObject(args) as never);
    return booklets.listBooklets(filters);
  },
  "booklets.createBooklet": async (args, ctx) => {
    const input =
      args[1] && typeof args[1] === "object"
        ? (args[1] as never)
        : (firstObject(args) as never);
    return booklets.createBooklet(ctx.userId, input);
  },
  "booklets.validateBooklet": async (args, ctx) => {
    const id =
      typeof args[1] === "string" ? args[1] : String(args[0] ?? "");
    return booklets.validateBooklet(ctx.userId, id);
  },
  "booklets.rejectBooklet": async (args, ctx) => {
    const id =
      typeof args[1] === "string" ? args[1] : String(args[0] ?? "");
    const reason =
      typeof args[2] === "string"
        ? args[2]
        : typeof args[1] === "string" && typeof args[0] === "string"
          ? args[1]
          : undefined;
    return booklets.rejectBooklet(ctx.userId, id, reason);
  },
  "booklets.validateManyBooklets": async (args, ctx) => {
    const ids = Array.isArray(args[1])
      ? (args[1] as string[])
      : Array.isArray(args[0])
        ? (args[0] as string[])
        : [];
    return booklets.validateManyBooklets(ctx.userId, ids);
  },
  "booklets.cancelBooklet": async (args, ctx) => {
    const id =
      typeof args[1] === "string" ? args[1] : String(args[0] ?? "");
    const reason =
      typeof args[2] === "string"
        ? args[2]
        : typeof args[1] === "string" && typeof args[0] === "string"
          ? args[1]
          : undefined;
    return booklets.cancelBooklet(ctx.userId, id, reason);
  },
  "booklets.validateSerial": async (args) =>
    booklets.validateSerial(firstObject(args) as never),

  // ---- stock ----
  "stock.getBootstrap": async (args, ctx) =>
    emptyStockBootstrap(ctx, args[1] ?? args[0]),
  "stock.listOnHandAsOf": async (args, ctx) => {
    const payload = firstObject(args);
    const salesPointId = Number(
      payload.salesPointId ?? ctx.salesPointId ?? NaN,
    );
    const productId = Number(payload.productId ?? NaN);
    if (!Number.isFinite(salesPointId) || !Number.isFinite(productId)) return [];
    const qty = await getBalanceQty(
      prisma,
      salesPointId,
      productId,
      null,
      "SELLABLE",
    );
    return [
      {
        salesPointId,
        productId,
        storageLocationId: null,
        condition: "SELLABLE",
        qty: String(qty),
      },
    ];
  },
  "stock.getBinCard": async () => ({
    lines: [],
    openingQty: "0",
    closingQty: "0",
    productId: null,
    salesPointId: null,
    asAtIso: new Date().toISOString().slice(0, 10),
  }),
  "stock.cancelReceipt": async () => ({ ok: false, error: THIN }),
  "stock.findReceiptByNumber": async () => ({
    ok: false,
    error: "Receipt not found.",
  }),
  "stock.findReceiptByConsignmentNoteNo": async () => ({
    ok: false,
    error: "Receipt not found.",
  }),
  "stock.loadReceiptForReview": async () => ({
    ok: false,
    error: "Receipt not found.",
  }),
  "stock.loadReceiptPrintById": async () => null,
  "stock.loadTransferPrintById": async () => null,
  "stock.dispatchTransfer": async () => ({ ok: false, error: THIN }),
  "stock.cancelTransfer": async () => ({ ok: false, error: THIN }),
  "stock.findTransferByNumber": async () => ({
    ok: false,
    error: "Transfer not found.",
  }),
  "stock.loadTransferForReview": async () => ({
    ok: false,
    error: "Transfer not found.",
  }),
  "stock.cancelAdjustment": async () => ({ ok: false, error: THIN }),
  "stock.findAdjustmentByNumber": async () => ({
    ok: false,
    error: "Adjustment not found.",
  }),
  "stock.loadAdjustmentForReview": async () => ({
    ok: false,
    error: "Adjustment not found.",
  }),
  "stock.listReceiveQueue": async (_args, ctx) => ({
    rows: [],
    storageLocations: [],
    transferReceiveUsesDocumentDate: true,
    scopedSalesPointId: ctx.salesPointId,
  }),
  "stock.validateMany": async () => ({
    ok: true,
    validated: 0,
    errors: [],
  }),
  // stock.getIntakeOilGroupingStatus / applyIntakeOilGrouping — appRpc via stockRpcExtras

  // vehicleConsignmentNotes.* — implemented in appRpc via vehicleConsignmentNotesRpc

  // carryForward.* / carryForwardStock.* — appRpc via thinClientStubs

  // ---- transport cost ----
  "transportCost.getFormOptions": async () => {
    const [customers, salesPoints, products, openPeriod] = await Promise.all([
      listCustomers(),
      listSalesPoints(),
      listProducts(),
      getOpenPostingPeriod(),
    ]);
    return {
      customers,
      salesPoints,
      products: products.map((p) => ({
        productId: p.productId,
        productName: p.productName,
        productCode: "",
      })),
      openPeriod,
      transportCostMoliweOnlyPolicy: false,
      policyNotice: null,
    };
  },
  "transportCost.compute": async (args) => {
    const input = firstObject(args.length > 1 ? args.slice(1) : args);
    const openPeriod = await getOpenPostingPeriod();
    if (!openPeriod) {
      return { ok: false, error: "Open a financial month first." };
    }
    return {
      period: openPeriod,
      asAtIso: openPeriod.endDate,
      customerId: Number(input.customerId ?? 0),
      customerName: "",
      salesPointId: Number(input.salesPointId ?? 0),
      salesPointName: "",
      productId: Number(input.productId ?? 0),
      productName: "",
      lines: [],
      totalQtyKg: 0,
      totalCost: 0,
      warnings: ["Transport rate schedules are not yet on the shared API."],
    };
  },

  // ---- backup ----
  "backup.getInfo": async () => backupDisabled.getInfo(),
  "backup.create": async () => backupDisabled.create(),
  "backup.restore": async () => backupDisabled.restore(),
  "backup.getSchedule": async () => backupDisabled.getSchedule(),
  "backup.updateSchedule": async () => backupDisabled.updateSchedule(),
  "backup.chooseDestinationFolder": async () =>
    backupDisabled.chooseDestinationFolder(),
  "backup.runScheduledNow": async () => backupDisabled.runScheduledNow(),
};

export function resolveHandler(
  key: string,
  primary: Record<string, Handler>,
): Handler | undefined {
  return primary[key] ?? coverageHandlers[key];
}

// silence unused in case of tree-shake
void argString;
