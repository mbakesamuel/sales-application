export type UiThemePreset = "agro" | "dark";
export declare const UI_THEME_PRESETS: UiThemePreset[];
export declare const UI_THEME_LABELS: Record<UiThemePreset, string>;
export declare const UI_THEME_COLORS: Record<UiThemePreset, string>;
export declare function normalizeUiThemePreset(value: unknown): UiThemePreset;
export declare function readCachedUiTheme(): UiThemePreset | null;
export declare function writeCachedUiTheme(preset: UiThemePreset): void;
export declare function applyUiTheme(preset: unknown): UiThemePreset;
/** Fetch company theme without painting the document (safe for cancellation). */
export declare function fetchCompanyThemePreset(): Promise<UiThemePreset>;
export declare function loadAndApplyCompanyTheme(): Promise<UiThemePreset>;
