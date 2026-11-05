import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { sql } from "../db/index.js";
import {
  createSessionToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./password.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MINUTES = 30;

export type AuthUserDto = {
  id: string;
  username: string;
  name: string;
  role: string;
  commercialServiceId: string | null;
  salesPointId: number | null;
  salesPointName: string | null;
  mustChangePassword: boolean;
};

export type RolePermissionsSnapshot = {
  role: string;
  routes: Record<string, "none" | "read" | "write">;
  actions: Record<string, boolean>;
};

function mapUser(row: {
  id: string;
  username: string;
  name: string;
  role: string;
  commercial_service_id: string | null;
  sales_point_id: number | null;
  must_change_password: boolean;
  sales_points?: { name: string } | null;
}): AuthUserDto {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    commercialServiceId: row.commercial_service_id,
    salesPointId: row.sales_point_id,
    salesPointName: row.sales_points?.name?.trim() || null,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

async function loadPermissions(roleId: string): Promise<RolePermissionsSnapshot> {
  const [routeRows, actionRows] = await Promise.all([
    prisma.role_route_permissions.findMany({
      where: { role: roleId },
      select: { route_id: true, access: true },
    }),
    prisma.role_action_permissions.findMany({
      where: { role: roleId },
      select: { action_key: true, allowed: true },
    }),
  ]);

  const routes: Record<string, "none" | "read" | "write"> = {};
  for (const row of routeRows) {
    const access = String(row.access ?? "NONE").toUpperCase();
    routes[row.route_id] =
      access === "WRITE" ? "write" : access === "READ" ? "read" : "none";
  }

  const actions: Record<string, boolean> = {};
  for (const row of actionRows) {
    actions[row.action_key] = Boolean(row.allowed);
  }

  return { role: roleId, routes, actions };
}

async function purgeExpiredSessions(): Promise<void> {
  await sql`DELETE FROM auth_sessions WHERE expires_at <= NOW()`;
}

export async function loginUser(
  username: string,
  password: string,
): Promise<
  | {
      token: string;
      user: AuthUserDto;
      permissions: RolePermissionsSnapshot;
      sessionIdleTimeoutMinutes: number;
    }
  | { error: string }
> {
  await purgeExpiredSessions();
  const normalized = username.trim().toLowerCase();
  if (!normalized || !password) {
    return { error: "Invalid username or password." };
  }

  const matched = await sql`
    SELECT id FROM users WHERE lower(username) = ${normalized} LIMIT 1
  `;
  if (matched.length === 0) {
    return { error: "Invalid username or password." };
  }

  const user = await prisma.users.findUnique({
    where: { id: String(matched[0].id) },
    include: { sales_points: { select: { name: true } } },
  });

  if (!user || !user.is_active) {
    return { error: "Invalid username or password." };
  }

  const hashOk = verifyPassword(password, user.password_hash);
  const plainOk =
    !hashOk &&
    user.password_plain != null &&
    user.password_plain === password;
  if (!hashOk && !plainOk) {
    return { error: "Invalid username or password." };
  }

  const token = createSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await sql`
    INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
    VALUES (${randomUUID()}, ${user.id}, ${tokenHash}, ${expiresAt})
  `;

  const permissions = await loadPermissions(user.role);
  return {
    token,
    user: mapUser(user),
    permissions,
    sessionIdleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
  };
}

export async function getUserSession(token: string): Promise<{
  user: AuthUserDto;
  permissions: RolePermissionsSnapshot;
  sessionIdleTimeoutMinutes: number;
} | null> {
  if (!token?.trim()) return null;
  await purgeExpiredSessions();
  const tokenHash = hashToken(token.trim());

  const rows = await sql`
    SELECT s.user_id
    FROM auth_sessions s
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > NOW()
    LIMIT 1
  `;
  if (rows.length === 0) return null;

  const user = await prisma.users.findUnique({
    where: { id: String(rows[0].user_id) },
    include: { sales_points: { select: { name: true } } },
  });
  if (!user || !user.is_active) return null;

  return {
    user: mapUser(user),
    permissions: await loadPermissions(user.role),
    sessionIdleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
  };
}

export async function logoutUser(token: string): Promise<void> {
  if (!token?.trim()) return;
  const tokenHash = hashToken(token.trim());
  await sql`DELETE FROM auth_sessions WHERE token_hash = ${tokenHash}`;
}

export async function changeUserPassword(input: {
  token: string;
  currentPassword: string;
  newPassword: string;
}): Promise<
  | {
      user: AuthUserDto;
      permissions: RolePermissionsSnapshot;
    }
  | { error: string }
> {
  const session = await getUserSession(input.token);
  if (!session) {
    return { error: "Session expired. Sign in again." };
  }

  const user = await prisma.users.findUnique({
    where: { id: session.user.id },
    include: { sales_points: { select: { name: true } } },
  });
  if (!user) {
    return { error: "User not found." };
  }

  const hashOk = verifyPassword(input.currentPassword, user.password_hash);
  const plainOk =
    !hashOk &&
    user.password_plain != null &&
    user.password_plain === input.currentPassword;
  if (!hashOk && !plainOk) {
    return { error: "Current password is incorrect." };
  }

  if (!input.newPassword || input.newPassword.length < 6) {
    return { error: "New password must be at least 6 characters." };
  }

  await prisma.users.update({
    where: { id: user.id },
    data: {
      password_hash: hashPassword(input.newPassword),
      password_plain: null,
      must_change_password: false,
      updated_at: new Date(),
    },
  });

  const refreshed = await prisma.users.findUnique({
    where: { id: user.id },
    include: { sales_points: { select: { name: true } } },
  });

  return {
    user: mapUser(refreshed!),
    permissions: await loadPermissions(refreshed!.role),
  };
}
