import type { ElectronAppApi } from "../types/electron.d.ts";
/**
 * Application API: HTTP when VITE_API_BASE_URL is set (thin client),
 * otherwise Electron preload IPC (legacy migration bridge).
 *
 * Thin Electron still exposes print/report windows via preload; those are
 * merged inside createHttpAppApi when window.api is present.
 */
export declare function getAppApi(): ElectronAppApi;
/** @deprecated Prefer getAppApi() — kept for existing call sites during cutover. */
export declare function getElectronApi(): ElectronAppApi;
