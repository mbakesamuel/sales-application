/**
 * Thin-client handlers for desktop-only features (SQLite backups).
 * Carry-forward stock/commitments and transport cost live in dedicated modules.
 */
import * as carryForwardStockRpc from "./carryForwardStockRpc.js";
import * as carryForwardCommitmentsRpc from "./carryForwardCommitmentsRpc.js";

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
