import { prisma } from "../db/prisma.js";

export type RouteAccessLevel = "none" | "read" | "write";

export type RpcActor = {
  id: string;
  name: string;
  role: string;
  salesPointId: number | null;
  routes: Record<string, RouteAccessLevel>;
  actions: Record<string, boolean>;
};

/**
 * Loads the acting user plus role permissions straight from Postgres.
 * RPC handlers only receive `{ userId, salesPointId }`, so anything that needs
 * the role (permission gates) resolves it here. The user id always comes from
 * the authenticated session, never from client-supplied payloads.
 */
export async function loadRpcActor(userId: string): Promise<RpcActor> {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      role: true,
      is_active: true,
      sales_point_id: true,
    },
  });
  if (!user || !user.is_active) {
    throw new Error("Login required.");
  }

  const [routeRows, actionRows] = await Promise.all([
    prisma.role_route_permissions.findMany({
      where: { role: user.role },
      select: { route_id: true, access: true },
    }),
    prisma.role_action_permissions.findMany({
      where: { role: user.role },
      select: { action_key: true, allowed: true },
    }),
  ]);

  const routes: Record<string, RouteAccessLevel> = {};
  for (const row of routeRows) {
    const access = String(row.access ?? "NONE").toUpperCase();
    routes[row.route_id] =
      access === "WRITE" ? "write" : access === "READ" ? "read" : "none";
  }
  const actions: Record<string, boolean> = {};
  for (const row of actionRows) {
    actions[row.action_key] = Boolean(row.allowed);
  }

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    salesPointId: user.sales_point_id ?? null,
    routes,
    actions,
  };
}

export function routeAccess(actor: RpcActor, routeId: string): RouteAccessLevel {
  return actor.routes[routeId] ?? "none";
}

export function canAccessRoute(actor: RpcActor, routeId: string): boolean {
  return routeAccess(actor, routeId) !== "none";
}

export function canWriteRoute(actor: RpcActor, routeId: string): boolean {
  return routeAccess(actor, routeId) === "write";
}

export function canPerformAction(actor: RpcActor, actionKey: string): boolean {
  return actor.actions[actionKey] === true;
}

export function assertAction(actor: RpcActor, actionKey: string, message?: string): void {
  if (!canPerformAction(actor, actionKey)) {
    throw new Error(message ?? "You do not have permission to perform this action.");
  }
}

export function assertRouteWrite(actor: RpcActor, routeId: string): void {
  if (!canWriteRoute(actor, routeId)) {
    throw new Error("You do not have write access to this module.");
  }
}
