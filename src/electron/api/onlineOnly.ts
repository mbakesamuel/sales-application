import { getSyncService } from "../sync/syncService.js";
import {
  ensureCommandApiReachable,
  isCommandApiEnabled,
} from "./client.js";

/** Entities whose writes are owned by the command API (no SyncOutbox). */
const COMMAND_API_OWNED_ENTITIES = new Set([
  "Sale",
  "DeliveryOrder",
  "StockReceipt",
  "StockTransfer",
  "StockAdjustment",
]);

export function isCommandApiOwnedEntity(entityType: string): boolean {
  return COMMAND_API_OWNED_ENTITIES.has(entityType);
}

export function shouldSkipOutboxForEntity(entityType: string): boolean {
  return isCommandApiEnabled() && isCommandApiOwnedEntity(entityType);
}

/**
 * Fail-closed gate for business writes when a sync/command server is configured.
 * Uses a fresh health check.
 */
export async function requireCommandApiOnline(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!isCommandApiEnabled()) {
    return { ok: true };
  }
  return ensureCommandApiReachable();
}

/**
 * Sync fail-closed gate using the last NetworkMonitor poll (no await).
 * Prefer requireCommandApiOnline for create paths that can be async.
 */
export function requireCommandApiOnlineCached():
  | { ok: true }
  | { ok: false; error: string } {
  if (!isCommandApiEnabled()) {
    return { ok: true };
  }

  const monitor = getSyncService()?.getNetworkMonitor();
  if (monitor?.getOnlineStatus()) {
    return { ok: true };
  }

  return {
    ok: false,
    error: "Server unreachable. Check the network and try again.",
  };
}
