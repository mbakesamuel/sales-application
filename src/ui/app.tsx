import { useCallback, useEffect, useState } from "preact/hooks";
import type { RolePermissionsSnapshot } from "../shared/permissions.types.ts";
import {
  AUTH_TOKEN_KEY,
  type AuthUser,
} from "./auth/session.ts";
import { getElectronApi } from "./auth/client.ts";
import { useIdleSessionTimeout } from "./auth/useIdleSessionTimeout.ts";
import { AppErrorBoundary } from "./components/AppErrorBoundary.tsx";
import { AppLoadingShell } from "./components/AppLoadingShell.tsx";
import { ChangePasswordScreen } from "./pages/ChangePasswordScreen.tsx";
import { HomeScreen } from "./pages/HomeScreen.tsx";
import { LoginScreen } from "./pages/LoginScreen.tsx";
import { ReportWindowApp } from "./pages/ReportWindowApp.tsx";
import { WelcomeScreen } from "./pages/WelcomeScreen.tsx";
import { parseReportWindowHash } from "../shared/reportWindow.ts";
import {
  applyUiTheme,
  fetchCompanyThemePreset,
  loadAndApplyCompanyTheme,
  readCachedUiTheme,
  writeCachedUiTheme,
} from "./theme/applyUiTheme.ts";
import "./app.css";

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function MainApp() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<RolePermissionsSnapshot | null>(
    null,
  );
  const [sessionIdleTimeoutMinutes, setSessionIdleTimeoutMinutes] = useState(0);
  const [entryScreen, setEntryScreen] = useState<"welcome" | "login">("welcome");
  // Only show a restore shell when a token already exists at first paint.
  const [isRestoringSession, setIsRestoringSession] = useState(
    () => Boolean(readStoredToken()),
  );

  const handleLogout = useCallback(async () => {
    const token = readStoredToken();
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    setIsRestoringSession(false);
    setUser(null);
    setPermissions(null);
    setSessionIdleTimeoutMinutes(0);
    setEntryScreen("login");

    if (token) {
      try {
        await getElectronApi().auth.logout(token);
      } catch {
        // Session already cleared locally.
      }
    }
  }, []);

  useIdleSessionTimeout(
    user ? sessionIdleTimeoutMinutes : 0,
    () => {
      void handleLogout();
    },
  );

  useEffect(() => {
    // Paint last known theme immediately so boot does not flash agro → dark.
    applyUiTheme(readCachedUiTheme() ?? "agro");
    void fetchCompanyThemePreset()
      .then((preset) => {
        writeCachedUiTheme(preset);
        applyUiTheme(preset);
      })
      .catch(() => {
        applyUiTheme(readCachedUiTheme() ?? "agro");
      });

    const token = readStoredToken();
    if (!token) {
      setIsRestoringSession(false);
      return;
    }

    let cancelled = false;

    void getElectronApi()
      .auth.getSession(token)
      .then((session) => {
        if (cancelled) {
          return;
        }
        if (session) {
          setUser(session.user);
          setPermissions(session.permissions);
          setSessionIdleTimeoutMinutes(session.sessionIdleTimeoutMinutes);
        } else {
          sessionStorage.removeItem(AUTH_TOKEN_KEY);
        }
      })
      .catch(() => {
        sessionStorage.removeItem(AUTH_TOKEN_KEY);
      })
      .finally(() => {
        if (!cancelled) {
          setIsRestoringSession(false);
        }
      });

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setIsRestoringSession(false);
      }
    }, 4000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, []);

  function handleLoginSuccess(
    nextUser: AuthUser,
    token: string,
    nextPermissions: RolePermissionsSnapshot,
    idleTimeoutMinutes: number,
  ) {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    // Never re-enter the restore shell after a successful interactive login.
    setIsRestoringSession(false);
    setUser(nextUser);
    setPermissions(nextPermissions);
    setSessionIdleTimeoutMinutes(idleTimeoutMinutes);
    void loadAndApplyCompanyTheme().catch(() => {
      applyUiTheme("agro");
    });
  }

  function handlePasswordChanged(
    nextUser: AuthUser,
    nextPermissions: RolePermissionsSnapshot,
  ) {
    setUser(nextUser);
    setPermissions(nextPermissions);
  }

  // Restore shell only before we know whether a stored token is valid.
  // After login, user/permissions are set and we skip this even if restore was pending.
  if (isRestoringSession && !user) {
    return <AppLoadingShell status="Restoring session…" />;
  }

  if (!user || !permissions) {
    if (entryScreen === "welcome") {
      return <WelcomeScreen onContinue={() => setEntryScreen("login")} />;
    }
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  if (user.mustChangePassword) {
    return (
      <ChangePasswordScreen
        user={user}
        onPasswordChanged={handlePasswordChanged}
        onLogout={() => void handleLogout()}
      />
    );
  }

  return (
    <AppErrorBoundary>
      <HomeScreen
        user={user}
        permissions={permissions}
        onPermissionsSaved={setPermissions}
        onLogout={() => void handleLogout()}
      />
    </AppErrorBoundary>
  );
}

export function App() {
  if (parseReportWindowHash()) {
    return <ReportWindowApp />;
  }
  return <MainApp />;
}
