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

const SERVER_UNREACHABLE_MESSAGE = "Cannot connect to server.";

function isNetworkFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    name === "typeerror" ||
    name === "networkerror" ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("network request failed")
  );
}

function toUserFacingFetchError(error: unknown): Error {
  if (isNetworkFetchError(error)) {
    return new Error(SERVER_UNREACHABLE_MESSAGE);
  }
  return error instanceof Error ? error : new Error(String(error));
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

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    throw toUserFacingFetchError(error);
  }

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

async function fetchPdfBytes(
  baseUrl: string,
  token: string | null,
  html: string,
  options?: { landscape?: boolean; attributionFooter?: boolean },
): Promise<Uint8Array> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/print/html-to-pdf`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        html,
        landscape: options?.landscape === true,
        attributionFooter: options?.attributionFooter !== false,
      }),
    });
  } catch (error) {
    throw toUserFacingFetchError(error);
  }

  if (!response.ok) {
    const text = await response.text();
    let message = `HTTP ${response.status}`;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        message = body.error;
      }
    } catch {
      if (text.trim()) message = text.trim().slice(0, 200);
    }
    throw new Error(message);
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Prefer Electron preload for print / report windows when present (thin
 * Electron + HTTP API). Fall back to server PDF + browser helpers in a tab.
 */
function createShellAdapters(
  baseUrl: string,
  getToken: SessionTokenGetter,
): Pick<ElectronAppApi, "dialog" | "print" | "windows" | "reportWindow"> {
  const electron = window.api;
  if (
    typeof electron?.print?.htmlToPdf === "function" &&
    typeof electron?.windows?.openReport === "function" &&
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
      htmlToPdf: async (html, options) => {
        return fetchPdfBytes(baseUrl, getToken(), html, options);
      },
      printHtml: async (html: string) => {
        await printHtmlInBrowser(html);
        return { ok: true };
      },
      printPdf: async (data: Uint8Array) => {
        await printPdfInBrowser(data);
        return { ok: true };
      },
      savePdf: async (input: { defaultName: string; data: Uint8Array }) => {
        const name = sanitizePdfFileName(input.defaultName);
        downloadPdfInBrowser(name, input.data);
        return { ok: true as const, path: name };
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

function sanitizePdfFileName(value: string): string {
  const base = value.replace(/[/\\?%*:|"<>]/g, "_").trim() || "report.pdf";
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

function downloadPdfInBrowser(fileName: string, data: Uint8Array): void {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function printPdfInBrowser(data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const blob = new Blob([copy], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    // Prefer a real window — zero-size iframes are blocked/unreliable in
    // several browsers for window.print().
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          "Pop-up blocked. Allow pop-ups for this site to print, or use Save PDF.",
        ),
      );
      return;
    }

    let settled = false;
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (err != null) {
        reject(err instanceof Error ? err : new Error("Print failed."));
        return;
      }
      resolve();
    };

    const triggerPrint = () => {
      try {
        win.addEventListener("afterprint", () => finish(), { once: true });
        window.setTimeout(() => finish(), 2500);
        win.focus();
        win.print();
      } catch (err) {
        finish(err);
      }
    };

    // Some browsers fire load before PDF plugin is ready.
    window.setTimeout(triggerPrint, 500);
  });
}

function printHtmlInBrowser(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      URL.revokeObjectURL(url);
      reject(
        new Error(
          "Pop-up blocked. Allow pop-ups for this site to print, or use Save PDF.",
        ),
      );
      return;
    }

    let settled = false;
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (err != null) {
        reject(err instanceof Error ? err : new Error("Print failed."));
        return;
      }
      resolve();
    };

    const triggerPrint = () => {
      try {
        win.addEventListener("afterprint", () => finish(), { once: true });
        window.setTimeout(() => finish(), 2500);
        win.focus();
        win.print();
      } catch (err) {
        finish(err);
      }
    };

    window.setTimeout(triggerPrint, 400);
  });
}

/**
 * True when PDF bytes can be produced — Electron preload or HTTP thin-client
 * (server Chromium).
 */
export function canExportPdf(explicitBaseUrl?: string | null): boolean {
  if (typeof window.api?.print?.htmlToPdf === "function") return true;
  return isHttpApiMode(explicitBaseUrl);
}

/** @deprecated Prefer canExportPdf — kept for existing call sites. */
export function hasNativePdfExport(): boolean {
  return canExportPdf();
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
      return createShellAdapters(baseUrl, getToken).dialog;
    },
    get print() {
      return createShellAdapters(baseUrl, getToken).print;
    },
    get windows() {
      return createShellAdapters(baseUrl, getToken).windows;
    },
    get reportWindow() {
      return createShellAdapters(baseUrl, getToken).reportWindow;
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
