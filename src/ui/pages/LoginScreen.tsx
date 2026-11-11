import { useState } from "preact/hooks";
import { getElectronApi } from "../auth/client.ts";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import type { AuthUser } from "../auth/session.ts";
import "./LoginScreen.css";
import "./WelcomeScreen.css";

interface LoginScreenProps {
  onLoginSuccess: (
    user: AuthUser,
    token: string,
    permissions: RolePermissionsSnapshot,
    sessionIdleTimeoutMinutes: number,
  ) => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: Event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const trimmedUsername = username.trim();

    if (!trimmedUsername || !password) {
      setError("Please enter both username and password.");
      setIsSubmitting(false);
      return;
    }

    try {
      const result = await getElectronApi().auth.login({
        username: trimmedUsername,
        password,
      });

      if ("error" in result) {
        setError(result.error ?? "Invalid username or password.");
        return;
      }

      onLoginSuccess(
        result.user,
        result.token,
        result.permissions,
        result.sessionIdleTimeoutMinutes,
      );
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Invalid username or password.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main class="login-screen">
     {/*  <header class="auth-heading">
        <h1 class="auth-title">Sales Management Application</h1>
        <p class="auth-subtitle">provide your credentials to continue</p>
      </header> */}

      <section class="login-card">
        <h2 class="login-card-title">Sign in</h2>
        <p class="login-card-subtitle">Use your application account to continue.</p>

        <form class="login-form" onSubmit={(event) => void handleSubmit(event)}>
          <label class="login-field">
            <span>Username</span>
            <input
              type="text"
              name="username"
              autocomplete="username"
              value={username}
              onInput={(event) =>
                setUsername((event.currentTarget as HTMLInputElement).value)
              }
              disabled={isSubmitting}
            />
          </label>

          <label class="login-field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autocomplete="current-password"
              value={password}
              onInput={(event) =>
                setPassword((event.currentTarget as HTMLInputElement).value)
              }
              disabled={isSubmitting}
            />
          </label>

          {error ? <p class="login-error">{error}</p> : null}

          <button type="submit" class="login-button" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
