import type { ElectronAppApi } from "../types/electron.d.ts";
type SessionTokenGetter = () => string | null;
export declare function isHttpApiMode(explicitBaseUrl?: string | null): boolean;
/**
 * True when PDF bytes can be produced — Electron preload or HTTP thin-client
 * (server Chromium).
 */
export declare function canExportPdf(explicitBaseUrl?: string | null): boolean;
/** @deprecated Prefer canExportPdf — kept for existing call sites. */
export declare function hasNativePdfExport(): boolean;
/**
 * HTTP implementation of ElectronAppApi for browser + thin Electron clients.
 */
export declare function createHttpAppApi(options?: {
    baseUrl?: string | null;
    getSessionToken?: SessionTokenGetter;
}): ElectronAppApi;
export {};
