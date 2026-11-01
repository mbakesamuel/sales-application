import { getElectronApi } from "../auth/client.ts";

export type UiThemePreset = "agro" | "dark";

export const UI_THEME_PRESETS: UiThemePreset[] = ["agro", "dark"];

export const UI_THEME_LABELS: Record<UiThemePreset, string> = {
  agro: "Agro",
  dark: "Dark",
};

export const UI_THEME_COLORS: Record<UiThemePreset, string> = {
  agro: "#d4a017",
  dark: "#1a2418",
};

const THEME_CACHE_KEY = "sales-electron.uiThemePreset";

export function normalizeUiThemePreset(value: unknown): UiThemePreset {
  return value === "dark" ? "dark" : "agro";
}

export function readCachedUiTheme(): UiThemePreset | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (raw == null) {
      return null;
    }
    return normalizeUiThemePreset(raw);
  } catch {
    return null;
  }
}

export function writeCachedUiTheme(preset: UiThemePreset): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, preset);
  } catch {
    // Ignore quota / private-mode failures; DB remains source of truth.
  }
}

export function applyUiTheme(preset: unknown): UiThemePreset {
  const resolved = normalizeUiThemePreset(preset);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme =
    resolved === "dark" ? "dark" : "light";
  return resolved;
}

/** Fetch company theme without painting the document (safe for cancellation). */
export async function fetchCompanyThemePreset(): Promise<UiThemePreset> {
  try {
    const result = await getElectronApi().db.queryTable({
      table: "CompanySettings",
      limit: 50,
    });
    const row =
      result.rows.find((item) => String(item.id) === "default") ??
      result.rows[0];
    return normalizeUiThemePreset(row?.uiThemePreset);
  } catch {
    return readCachedUiTheme() ?? "agro";
  }
}

export async function loadAndApplyCompanyTheme(): Promise<UiThemePreset> {
  const preset = await fetchCompanyThemePreset();
  writeCachedUiTheme(preset);
  return applyUiTheme(preset);
}
