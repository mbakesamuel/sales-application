/**
 * Thin-client handlers for features that have no Postgres backing yet
 * (carry-forward commitments/stock, transport rates) or that are desktop-only
 * (SQLite backups). Shapes match src/shared/*.types.ts.
 */
import { getOpenPostingPeriod } from "./financialYearsService.js";
import {
  listCustomers,
  listProducts,
  listSalesPoints,
} from "./mastersQueries.js";

const CARRY_FORWARD_UNAVAILABLE =
  "Carry-forward commitments are not available in thin-client API mode yet (no server-side commitment tables).";
const CARRY_FORWARD_STOCK_UNAVAILABLE =
  "Carry-forward stock is not available in thin-client API mode yet (no server-side carry-forward stock support).";
const TRANSPORT_RATES_UNAVAILABLE =
  "Transport cost rates are not configured on the server (no transport rate table).";
const BACKUP_UNAVAILABLE =
  "SQLite backups are not used in thin-client API mode.";

// ---------------------------------------------------------------- carryForward

export const carryForwardStubs = {
  getFormOptions: async () => {
    const [customers, products, salesPoints] = await Promise.all([
      listCustomers(),
      listProducts(),
      listSalesPoints(),
    ]);
    return { customers, products, salesPoints };
  },
  list: async () => [] as unknown[],
  listPending: async () => [] as unknown[],
  upsert: async () => ({ ok: false as const, error: CARRY_FORWARD_UNAVAILABLE }),
  upsertBatch: async () => ({
    ok: false as const,
    error: CARRY_FORWARD_UNAVAILABLE,
  }),
  delete: async () => ({ ok: false as const, error: CARRY_FORWARD_UNAVAILABLE }),
};

// ----------------------------------------------------------- carryForwardStock

export const carryForwardStockStubs = {
  getFormOptions: async () => {
    const [products, salesPoints] = await Promise.all([
      listProducts(),
      listSalesPoints(),
    ]);
    return {
      products,
      salesPoints,
      storageLocations: [] as unknown[],
      stockIntakeOilGrouping: false,
    };
  },
  list: async () => [] as unknown[],
  listPending: async () => [] as unknown[],
  listOnHand: async () => [] as unknown[],
  upsertBatch: async () => ({
    ok: false as const,
    error: CARRY_FORWARD_STOCK_UNAVAILABLE,
  }),
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
      productCode: "",
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
