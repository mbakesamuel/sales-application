import { useEffect, useRef, useState } from "preact/hooks";
import { getAuthenticatedDb } from "../auth/db.ts";
import {
  applyUiTheme,
  fetchCompanyThemePreset,
  readCachedUiTheme,
  writeCachedUiTheme,
  type UiThemePreset,
} from "./applyUiTheme.ts";
import "./AppThemeToggle.css";

export const COMPANY_THEME_CHANGED_EVENT = "company-theme-changed";

export function AppThemeToggle() {
  const [active, setActive] = useState<UiThemePreset>(() =>
    applyUiTheme(
      document.documentElement.dataset.theme || readCachedUiTheme() || "agro",
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const darkOn = active === "dark";

  useEffect(() => {
    let cancelled = false;
    const generation = ++loadGenerationRef.current;
    void fetchCompanyThemePreset().then((preset) => {
      if (cancelled || generation !== loadGenerationRef.current) {
        return;
      }
      writeCachedUiTheme(preset);
      setActive(applyUiTheme(preset));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function setTheme(preset: UiThemePreset) {
    if (busy || preset === active) {
      return;
    }
    const previous = active;
    // Invalidate any in-flight startup load so it cannot overwrite this choice.
    loadGenerationRef.current += 1;
    setBusy(true);
    setError(null);
    setActive(preset);
    applyUiTheme(preset);
    writeCachedUiTheme(preset);
    try {
      const result = await getAuthenticatedDb().setCompanyUiTheme(preset);
      if (result.ok === false) {
        throw new Error(result.error);
      }
      if (result.uiThemePreset !== preset) {
        throw new Error("Theme change did not persist.");
      }
      writeCachedUiTheme(result.uiThemePreset);
      window.dispatchEvent(
        new CustomEvent(COMPANY_THEME_CHANGED_EVENT, {
          detail: result.uiThemePreset,
        }),
      );
    } catch (saveError) {
      setActive(previous);
      applyUiTheme(previous);
      writeCachedUiTheme(previous);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save theme.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="app-theme-toggle-wrap">
      <label class={`app-theme-switch${darkOn ? " is-on" : ""}`}>
        <span class="app-theme-switch-copy">
          <strong>Dark theme</strong>
          <span>{darkOn ? "On · Dark" : "Off · Agro"}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={darkOn}
          disabled={busy}
          aria-label="Dark theme"
          onChange={(event) => {
            const next = (event.currentTarget as HTMLInputElement).checked
              ? "dark"
              : "agro";
            void setTheme(next);
          }}
        />
        <span class="app-theme-switch-track" aria-hidden="true">
          <span class="app-theme-switch-thumb" />
        </span>
      </label>
      {error ? <p class="app-theme-toggle-error">{error}</p> : null}
    </div>
  );
}
