import type { ElectronAppApi } from "../types/electron.d.ts";
import type { SyncProgressState } from "../../shared/sync.types.ts";

type SessionTokenGetter = () => string | null;

function thinClientSyncStatus(): SyncProgressState {
  const now = new Date().toISOString();
  return {
    status: "ONLINE",
    isOnline: true,
    isSyncing: false,
    pendingCount: 0,
    failedCount: 0,
    lastPushedAt: now,
    lastPulledAt: now,
    lastError: null,
    syncServerUrl: "",
    deviceId: "thin-client",
  };
}

function resolveBaseUrl(explicit?: string | null): string {
  const fromEnv =
    typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: Record<string, string> }).env
      ?.VITE_API_BASE_URL;
  const url = (explicit || fromEnv || "").trim().replace(/\/+$/, "");
  return url;
}

export function isHttpApiMode(explicitBaseUrl?: string | null): boolean {
  return Boolean(resolveBaseUrl(explicitBaseUrl));
}

async function httpJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return body as T;
}

/**
 * Prefer Electron preload for print / report windows when present (thin
 * Electron + HTTP API). Fall back to browser stubs only in a real browser tab.
 */
function createShellAdapters(): Pick<
  ElectronAppApi,
  "dialog" | "print" | "windows" | "reportWindow"
> {
  const electron = window.api;
  if (
    electron?.print?.htmlToPdf &&
    electron?.windows?.openReport &&
    electron?.reportWindow
  ) {
    return {
      dialog: electron.dialog,
      print: electron.print,
      windows: electron.windows,
      reportWindow: electron.reportWindow,
    };
  }

  return {
    dialog: {
      confirm: (message: string) => window.confirm(message),
      alert: (message: string) => {
        window.alert(message);
      },
    },
    print: {
      // Browser has no Chromium printToPDF; DocumentPreview uses HTML preview
      // and printHtml / print dialog ("Save as PDF") instead.
      htmlToPdf: async () => {
        throw new Error("BROWSER_HTML_PREVIEW");
      },
      printHtml: async (html: string) => {
        await printHtmlInBrowser(html);
        return { ok: true };
      },
      printPdf: async () => {
        throw new Error(
          "Use Print and choose “Save as PDF” in the browser print dialog.",
        );
      },
      savePdf: async () => {
        throw new Error(
          "Use Print and choose “Save as PDF” in the browser print dialog.",
        );
      },
    },
    windows: {
      openReport: async (_authToken, reportId, query) => {
        const params = new URLSearchParams();
        params.set("reportId", reportId);
        if (query != null) {
          params.set("query", JSON.stringify(query));
        }
        const url = `${window.location.origin}${window.location.pathname}#/report?${params.toString()}`;
        window.open(url, "_blank", "noopener,noreferrer");
        return { ok: true as const };
      },
      onReportClosed: () => () => {},
    },
    reportWindow: {
      getBootstrap: async () => null,
      onBootstrap: () => () => {},
    },
  };
}

function printHtmlInBrowser(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";

    let settled = false;
    const cleanup = () => {
      frame.remove();
    };
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err != null) {
        reject(err instanceof Error ? err : new Error("Print failed."));
        return;
      }
      resolve();
    };

    frame.onload = () => {
      try {
        const win = frame.contentWindow;
        if (!win) {
          finish(new Error("Could not open print preview."));
          return;
        }
        win.addEventListener("afterprint", () => finish(), { once: true });
        // Safari / some Chromium builds may not fire afterprint reliably.
        window.setTimeout(() => finish(), 2000);
        win.focus();
        win.print();
      } catch (err) {
        finish(err);
      }
    };

    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

/** True when Electron preload PDF generation is available. */
export function hasNativePdfExport(): boolean {
  return Boolean(window.api?.print?.htmlToPdf);
}

function createNamespaceProxy(
  baseUrl: string,
  namespace: string,
  getToken: SessionTokenGetter,
): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return new Proxy(
    {},
    {
      get(_target, method: string | symbol) {
        if (typeof method !== "string") return undefined;
        return async (...args: unknown[]) => {
          return httpJson(baseUrl, `/api/app/${namespace}/${method}`, {
            method: "POST",
            token: getToken(),
            body: JSON.stringify({ args }),
          });
        };
      },
    },
  );
}

/**
 * HTTP implementation of ElectronAppApi for browser + thin Electron clients.
 */
export function createHttpAppApi(options?: {
  baseUrl?: string | null;
  getSessionToken?: SessionTokenGetter;
}): ElectronAppApi {
  const baseUrl = resolveBaseUrl(options?.baseUrl);
  if (!baseUrl) {
    throw new Error("VITE_API_BASE_URL (or baseUrl) is required for HTTP API mode.");
  }

  let sessionToken: string | null = null;
  const getToken: SessionTokenGetter = () =>
    options?.getSessionToken?.() ?? sessionToken;

  // Resolve on each access so Electron preload is used once it is present
  // (thin Electron + HTTP API), instead of permanently caching browser stubs.
  const api = {
    get dialog() {
      return createShellAdapters().dialog;
    },
    get print() {
      return createShellAdapters().print;
    },
    get windows() {
      return createShellAdapters().windows;
    },
    get reportWindow() {
      return createShellAdapters().reportWindow;
    },
    auth: {
      login: async (data: { username: string; password: string }) => {
        const result = await httpJson<
          | {
              token: string;
              user: unknown;
              permissions: unknown;
              sessionIdleTimeoutMinutes: number;
            }
          | { error: string }
        >(baseUrl, "/api/auth/login", {
          method: "POST",
          body: JSON.stringify(data),
        });
        if ("token" in result && result.token) {
          sessionToken = result.token;
        }
        return result;
      },
      getSession: async (token: string) => {
        sessionToken = token;
        return httpJson(baseUrl, "/api/auth/session", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
      },
      logout: async (token: string) => {
        await httpJson(baseUrl, "/api/auth/logout", {
          method: "POST",
          body: JSON.stringify({ token }),
        });
        sessionToken = null;
      },
      changePassword: async (data: {
        authToken: string;
        currentPassword: string;
        newPassword: string;
      }) => {
        return httpJson(baseUrl, "/api/auth/change-password", {
          method: "POST",
          token: data.authToken,
          body: JSON.stringify(data),
        });
      },
    },
    db: createNamespaceProxy(baseUrl, "db", getToken),
    permissions: createNamespaceProxy(baseUrl, "permissions", getToken),
    sales: createNamespaceProxy(baseUrl, "sales", getToken),
    deliveryOrders: createNamespaceProxy(baseUrl, "deliveryOrders", getToken),
    carryForward: createNamespaceProxy(baseUrl, "carryForward", getToken),
    carryForwardStock: createNamespaceProxy(
      baseUrl,
      "carryForwardStock",
      getToken,
    ),
    transportCost: createNamespaceProxy(baseUrl, "transportCost", getToken),
    stock: createNamespaceProxy(baseUrl, "stock", getToken),
    vehicleConsignmentNotes: createNamespaceProxy(
      baseUrl,
      "vehicleConsignmentNotes",
      getToken,
    ),
    financialYears: createNamespaceProxy(baseUrl, "financialYears", getToken),
    reports: createNamespaceProxy(baseUrl, "reports", getToken),
    dashboard: createNamespaceProxy(baseUrl, "dashboard", getToken),
    booklets: createNamespaceProxy(baseUrl, "booklets", getToken),
    backup: createNamespaceProxy(baseUrl, "backup", getToken),
    // Thin client has no SQLite outbox — keep sync online locally so
    // connectivity gates and badges do not hit missing RPC methods.
    sync: {
      getStatus: async () => thinClientSyncStatus(),
      triggerNow: async () => ({
        ok: true,
        message: "Thin client — data is already on the shared API.",
      }),
      backfillAllData: async () => ({
        ok: true,
        message: "Thin client — no local outbox to backfill.",
        enqueuedCount: 0,
        summary: {},
      }),
      getConfig: async () => ({
        id: "default",
        syncServerUrl: "",
        apiToken: null,
        salesPointId: null,
        deviceId: "thin-client",
        lastPulledAt: null,
        lastPushedAt: null,
        autoSyncEnabled: false,
      }),
      saveConfig: async () => ({
        ok: false as const,
        error: "Sync settings are not used in thin-client (HTTP API) mode.",
      }),
      getPendingList: async () => [],
      testConnection: async () => ({
        ok: true,
        latencyMs: 0,
        serverVersion: "thin-client",
      }),
      onStatusChanged: (callback: (status: SyncProgressState) => void) => {
        callback(thinClientSyncStatus());
        return () => {};
      },
    },
  } as unknown as ElectronAppApi;

  return api;
}
