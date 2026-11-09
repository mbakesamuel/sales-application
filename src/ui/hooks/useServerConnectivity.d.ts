import type { SyncProgressState } from "../../shared/sync.types.ts";
export type ServerConnectivity = {
    /** True when a sync/command server URL is configured. */
    commandApiConfigured: boolean;
    isOnline: boolean;
    /** Mutations should be blocked when the command API is configured but offline. */
    mutationsBlocked: boolean;
    status: SyncProgressState | null;
};
/**
 * Tracks sync/command-server reachability for online-only mutation gates.
 * In HTTP thin-client mode the shared API is always the source of truth.
 */
export declare function useServerConnectivity(): ServerConnectivity;
