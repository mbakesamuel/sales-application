import type { Context, Next } from "hono";
import {
  getUserSession,
  type AuthUserDto,
  type RolePermissionsSnapshot,
} from "../services/userAuth.js";

export type AuthenticatedUser = AuthUserDto & {
  permissions: RolePermissionsSnapshot;
};

declare module "hono" {
  interface ContextVariableMap {
    user: AuthenticatedUser;
    sessionToken: string;
  }
}

export async function sessionAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;

  if (!token) {
    return c.json({ ok: false, error: "Unauthorized: missing session token" }, 401);
  }

  const session = await getUserSession(token);
  if (!session) {
    return c.json({ ok: false, error: "Unauthorized: invalid or expired session" }, 401);
  }

  c.set("user", {
    ...session.user,
    permissions: session.permissions,
  });
  c.set("sessionToken", token);
  return next();
}

/** Optional auth: attaches user when present, otherwise continues. */
export async function optionalSessionAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  if (token) {
    const session = await getUserSession(token);
    if (session) {
      c.set("user", {
        ...session.user,
        permissions: session.permissions,
      });
      c.set("sessionToken", token);
    }
  }
  return next();
}
