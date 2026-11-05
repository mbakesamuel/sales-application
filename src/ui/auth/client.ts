import type { ElectronAppApi } from "../types/electron.d.ts";
import { createHttpAppApi, isHttpApiMode } from "../api/httpAppApi.ts";
import { AUTH_TOKEN_KEY } from "./session.ts";

let httpApiSingleton: ElectronAppApi | null = null;

function getHttpApi(): ElectronAppApi {
  if (!httpApiSingleton) {
    httpApiSingleton = createHttpAppApi({
      getSessionToken: () => sessionStorage.getItem(AUTH_TOKEN_KEY),
    });
  }
  return httpApiSingleton;
}

/**
 * Application API: HTTP when VITE_API_BASE_URL is set (thin client),
 * otherwise Electron preload IPC (legacy migration bridge).
 *
 * Thin Electron still exposes print/report windows via preload; those are
 * merged inside createHttpAppApi when window.api is present.
 */
export function getAppApi(): ElectronAppApi {
  if (isHttpApiMode()) {
    return getHttpApi();
  }

  const api = window.api;
  if (!api?.auth || !api?.db || !api?.stock) {
    throw new Error(
      "No API available. Set VITE_API_BASE_URL for HTTP mode, or use the Electron window.",
    );
  }
  return api;
}

/** @deprecated Prefer getAppApi() — kept for existing call sites during cutover. */
export function getElectronApi(): ElectronAppApi {
  return getAppApi();
}
