/**
 * Thin-client handlers for features that are desktop-only (SQLite backups)
 * or still stubbed (transport rates). Carry-forward stock and commitments
 * are implemented in dedicated RPC modules.
 */
import { getOpenPostingPeriod } from "./financialYearsService.js";
import {
  listCustomers,
  listProducts,
  listSalesPoints,
} from "./mastersQueries.js";
import * as carryForwardStockRpc from "./carryForwardStockRpc.js";
import * as carryForwardCommitmentsRpc from "./carryForwardCommitmentsRpc.js";

const TRANSPORT_RATES_UNAVAILABLE =
  "Transport cost rates are not configured on the server (no transport rate table).";
const BACKUP_UNAVAILABLE =
  "SQLite backups are not used in thin-client API mode.";

// ---------------------------------------------------------------- carryForward

export const carryForwardStubs = {
  getFormOptions: () => carryForwardCommitmentsRpc.getFormOptions(),
  list: () => carryForwardCommitmentsRpc.list(),
  listPending: (userId: string) =>
    carryForwardCommitmentsRpc.listPending(userId),
  upsert: (input: carryForwardCommitmentsRpc.UpsertCarryForwardInput) =>
    carryForwardCommitmentsRpc.upsert(input),
  upsertBatch: (
    input: carryForwardCommitmentsRpc.UpsertCarryForwardBatchInput,
  ) => carryForwardCommitmentsRpc.upsertBatch(input),
  delete: (input: { userId: string; detailId: number }) =>
    carryForwardCommitmentsRpc.deleteCommitment(input),
};

// ----------------------------------------------------------- carryForwardStock

export const carryForwardStockStubs = {
  getFormOptions: () => carryForwardStockRpc.getFormOptions(),
  list: () => carryForwardStockRpc.list(),
  listPending: (userId: string) => carryForwardStockRpc.listPending(userId),
  listOnHand: (salesPointId: number, productId: number) =>
    carryForwardStockRpc.listOnHand(salesPointId, productId),
  upsertBatch: (input: carryForwardStockRpc.UpsertCarryForwardStockBatchInput) =>
    carryForwardStockRpc.upsertBatch(input),
};

// ---------------------------------------------------------------- transportCost

export async function transportCostGetFormOptions() {
  const [customers, salesPoints, products, openPeriod] = await Promise.all([
    listCustomers(),
    listSalesPoints(),
    listProducts(),
    getOpenPostingPeriod().catch(() => null),
  ]);
  return {
    customers,
    salesPoints,
    products: products.map((p) => ({
      productId: p.productId,
      productName: p.productName,
    })),
    openPeriod,
    transportCostMoliweOnlyPolicy: false,
    policyNotice: TRANSPORT_RATES_UNAVAILABLE,
  };
}

/**
 * TransportCostComputeResult has no `ok` flag; the UI treats a rejected call
 * as the error path. Throwing makes appRpc respond 400 `{ ok:false, error }`,
 * which the HTTP client surfaces as an Error with this message.
 */
export async function transportCostCompute(): Promise<never> {
  throw new Error(TRANSPORT_RATES_UNAVAILABLE);
}

// ---------------------------------------------------------------------- backup

export const backupStubs = {
  getInfo: async () => ({
    userDataDir: "N/A",
    dbPath: "N/A",
    dbSizeBytes: 0,
    walSizeBytes: 0,
    lastBackupAt: null,
    lastBackupPath: null,
    lastBackupSizeBytes: null,
  }),
  create: async () => ({ ok: false as const, error: BACKUP_UNAVAILABLE }),
  restore: async () => ({ ok: false as const, error: BACKUP_UNAVAILABLE }),
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
  updateSchedule: async () => ({ ok: false as const, error: BACKUP_UNAVAILABLE }),
  chooseDestinationFolder: async () => ({
    ok: false as const,
    error: BACKUP_UNAVAILABLE,
  }),
  runScheduledNow: async () => ({
    ok: false as const,
    error: BACKUP_UNAVAILABLE,
  }),
};
