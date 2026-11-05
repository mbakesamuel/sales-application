import { getDatabase } from "../db/index.js";
import { getSyncState } from "../sync/syncOutbox.js";
import { getSyncService } from "../sync/syncService.js";

export class CommandApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "CommandApiError";
    this.status = status;
    this.body = body;
  }
}

export function getCommandApiBaseUrl(): string | null {
  try {
    const state = getSyncState(getDatabase());
    const url = state.syncServerUrl?.trim();
    if (!url) return null;
    return url.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/** True when a sync/command server URL is configured (online-only mode for writes). */
export function isCommandApiEnabled(): boolean {
  return Boolean(getCommandApiBaseUrl());
}

export function getCommandApiToken(): string | null {
  try {
    const state = getSyncState(getDatabase());
    return state.apiToken?.trim() || null;
  } catch {
    return null;
  }
}

export async function commandApiFetch<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const baseUrl = getCommandApiBaseUrl();
  if (!baseUrl) {
    throw new CommandApiError(
      "Command API is not configured. Set the sync server URL.",
      0,
    );
  }

  const token = getCommandApiToken();
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
  } catch (err) {
    throw new CommandApiError(
      err instanceof Error
        ? err.message
        : "Server unreachable. Check the network and try again.",
      0,
    );
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
        : `Command API error (HTTP ${response.status})`;
    throw new CommandApiError(message, response.status, body);
  }

  return body as T;
}

export async function ensureCommandApiReachable(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  if (!isCommandApiEnabled()) {
    return { ok: false, error: "Command API is not configured." };
  }

  const monitor = getSyncService()?.getNetworkMonitor();
  if (monitor) {
    const health = await monitor.checkHealth(4000);
    if (!health.ok) {
      return {
        ok: false,
        error:
          health.error ||
          "Server unreachable. Check the network and try again.",
      };
    }
    return { ok: true };
  }

  try {
    await commandApiFetch("/api/health");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Server unreachable. Check the network and try again.",
    };
  }
}
