import { prisma } from "../db/prisma.js";

const ACTION_KEYS = [
  "validate_sales",
  "direct_validate_sales",
  "cancel_validated_sales",
  "delete_validated_sales",
  "validate_delivery_orders",
  "cancel_validated_delivery_order",
  "transfer_delivery_order_balance",
  "validate_vehicle_consignment_notes",
  "manage_permissions",
  "draft_stock_receipts",
  "post_stock_receipts",
  "draft_stock_transfers",
  "post_stock_transfers",
  "receive_stock_transfers",
  "draft_stock_adjustments",
  "post_stock_adjustments",
  "direct_post_stock_receipts",
  "direct_post_stock_transfers",
  "validate_stock_documents",
  "validate_document_booklets",
] as const;

const ACTION_LABELS: Record<string, string> = {
  validate_sales: "Validate sales",
  direct_validate_sales: "Direct-validate sales",
  cancel_validated_sales: "Cancel validated sales",
  delete_validated_sales: "Delete validated sales",
  validate_delivery_orders: "Validate delivery orders",
  cancel_validated_delivery_order: "Cancel validated delivery orders",
  transfer_delivery_order_balance: "Transfer DO balance",
  validate_vehicle_consignment_notes: "Validate consignment notes",
  manage_permissions: "Manage permissions",
  draft_stock_receipts: "Draft stock receipts",
  post_stock_receipts: "Post stock receipts",
  draft_stock_transfers: "Draft stock transfers",
  post_stock_transfers: "Post stock transfers",
  receive_stock_transfers: "Receive stock transfers",
  draft_stock_adjustments: "Draft stock adjustments",
  post_stock_adjustments: "Post stock adjustments",
  direct_post_stock_receipts: "Direct-post stock receipts",
  direct_post_stock_transfers: "Direct-post stock transfers",
  validate_stock_documents: "Validate stock documents",
  validate_document_booklets: "Validate document booklets",
};

// Keep route list soft-coded from DB usage + common modules.
const FALLBACK_ROUTES = [
  { routeId: "sales", label: "Sales Invoice", sectionId: "sales" },
  { routeId: "delivery-orders", label: "Delivery Orders", sectionId: "delivery-orders" },
  { routeId: "stock", label: "Stock", sectionId: "stock" },
  { routeId: "customers", label: "Customers", sectionId: "customers" },
  { routeId: "products", label: "Products", sectionId: "products" },
  { routeId: "permissions", label: "Permissions", sectionId: "organization" },
  { routeId: "roles", label: "Roles", sectionId: "organization" },
  { routeId: "users", label: "Users", sectionId: "organization" },
  { routeId: "financial-years", label: "Financial years", sectionId: "organization" },
  { routeId: "company-settings", label: "Company settings", sectionId: "organization" },
  { routeId: "dashboard", label: "Dashboard", sectionId: "overview" },
];

function normalizeAccess(value: unknown): "none" | "read" | "write" {
  const v = String(value ?? "NONE").toUpperCase();
  if (v === "WRITE") return "write";
  if (v === "READ") return "read";
  return "none";
}

export async function listRoles() {
  const roles = await prisma.roles.findMany({
    orderBy: [{ sort_order: "asc" }, { label: "asc" }],
  });
  const counts = await prisma.users.groupBy({
    by: ["role"],
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.role, c._count._all]));
  return roles.map((role) => ({
    id: role.id,
    label: role.label,
    isSystem: Boolean(role.is_system),
    sortOrder: role.sort_order,
    userCount: countMap.get(role.id) ?? 0,
  }));
}

export async function getPermissionMatrix() {
  const roles = await listRoles();
  const roleIds = roles.map((r) => r.id);
  const [routePerms, actionPerms, knownRoutes] = await Promise.all([
    prisma.role_route_permissions.findMany(),
    prisma.role_action_permissions.findMany(),
    prisma.role_route_permissions.findMany({
      distinct: ["route_id"],
      select: { route_id: true },
    }),
  ]);

  const routeIds = new Set([
    ...FALLBACK_ROUTES.map((r) => r.routeId),
    ...knownRoutes.map((r) => r.route_id),
  ]);
  const routes = [...routeIds].map((routeId) => {
    const fallback = FALLBACK_ROUTES.find((r) => r.routeId === routeId);
    return {
      routeId,
      label: fallback?.label ?? routeId,
      sectionId: fallback?.sectionId ?? "other",
    };
  });

  const routeAccess: Record<string, Record<string, "none" | "read" | "write">> =
    {};
  const actionAccess: Record<string, Record<string, boolean>> = {};
  for (const roleId of roleIds) {
    routeAccess[roleId] = {};
    actionAccess[roleId] = {};
    for (const route of routes) routeAccess[roleId]![route.routeId] = "none";
    for (const key of ACTION_KEYS) actionAccess[roleId]![key] = false;
  }
  for (const row of routePerms) {
    if (!routeAccess[row.role]) routeAccess[row.role] = {};
    routeAccess[row.role]![row.route_id] = normalizeAccess(row.access);
  }
  for (const row of actionPerms) {
    if (!actionAccess[row.role]) actionAccess[row.role] = {};
    actionAccess[row.role]![row.action_key] = Boolean(row.allowed);
  }

  return {
    roles: roleIds,
    roleLabels: Object.fromEntries(roles.map((r) => [r.id, r.label])),
    roleIsSystem: Object.fromEntries(roles.map((r) => [r.id, r.isSystem])),
    routes,
    routeAccess,
    actions: ACTION_KEYS.map((key) => ({
      key,
      label: ACTION_LABELS[key] ?? key,
    })),
    actionAccess,
  };
}

export async function savePermissionMatrix(input: {
  routeAccess?: Record<string, Record<string, string>>;
  actionAccess?: Record<string, Record<string, boolean>>;
}) {
  const routeAccess = input.routeAccess ?? {};
  const actionAccess = input.actionAccess ?? {};
  await prisma.$transaction(async (tx) => {
    const roleIds = new Set([
      ...Object.keys(routeAccess),
      ...Object.keys(actionAccess),
    ]);
    for (const role of roleIds) {
      await tx.role_route_permissions.deleteMany({ where: { role } });
      await tx.role_action_permissions.deleteMany({ where: { role } });
      const routes = routeAccess[role] ?? {};
      const actions = actionAccess[role] ?? {};
      const routeRows = Object.entries(routes).map(([routeId, access]) => ({
        role,
        route_id: routeId,
        access: normalizeAccess(access).toUpperCase(),
      }));
      const actionRows = Object.entries(actions).map(([actionKey, allowed]) => ({
        role,
        action_key: actionKey,
        allowed: Boolean(allowed),
      }));
      if (routeRows.length) {
        await tx.role_route_permissions.createMany({ data: routeRows });
      }
      if (actionRows.length) {
        await tx.role_action_permissions.createMany({ data: actionRows });
      }
    }
  });
  return { ok: true as const };
}

export async function createRole(input: {
  label?: string;
  id?: string | null;
  copyFromRoleId?: string | null;
}) {
  const label = String(input.label ?? "").trim();
  if (!label) return { ok: false as const, error: "Role label is required." };
  const id =
    String(input.id ?? "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]+/g, "_") ||
    label
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  const existing = await prisma.roles.findUnique({ where: { id } });
  if (existing) return { ok: false as const, error: "Role id already exists." };

  const maxSort = await prisma.roles.aggregate({ _max: { sort_order: true } });
  const sortOrder = (maxSort._max.sort_order ?? 0) + 10;
  await prisma.roles.create({
    data: {
      id,
      label,
      is_system: false,
      sort_order: sortOrder,
    },
  });

  const copyFrom = input.copyFromRoleId?.trim() || "STORE_KEEPER";
  const [routes, actions] = await Promise.all([
    prisma.role_route_permissions.findMany({ where: { role: copyFrom } }),
    prisma.role_action_permissions.findMany({ where: { role: copyFrom } }),
  ]);
  if (routes.length) {
    await prisma.role_route_permissions.createMany({
      data: routes.map((r) => ({
        role: id,
        route_id: r.route_id,
        access: r.access,
      })),
      skipDuplicates: true,
    });
  }
  if (actions.length) {
    await prisma.role_action_permissions.createMany({
      data: actions.map((a) => ({
        role: id,
        action_key: a.action_key,
        allowed: a.allowed,
      })),
      skipDuplicates: true,
    });
  }

  const roles = await listRoles();
  const role = roles.find((r) => r.id === id);
  if (!role) return { ok: false as const, error: "Failed to create role." };
  return { ok: true as const, role };
}

export async function updateRole(input: { id?: string; label?: string }) {
  const id = String(input.id ?? "").trim();
  const label = String(input.label ?? "").trim();
  if (!id || !label) return { ok: false as const, error: "Role id and label required." };
  const existing = await prisma.roles.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, error: "Role not found." };
  await prisma.roles.update({
    where: { id },
    data: { label, updated_at: new Date() },
  });
  const roles = await listRoles();
  const role = roles.find((r) => r.id === id);
  if (!role) return { ok: false as const, error: "Role not found." };
  return { ok: true as const, role };
}

export async function deleteRole(input: { id?: string }) {
  const id = String(input.id ?? "").trim();
  if (!id) return { ok: false as const, error: "Role id required." };
  const existing = await prisma.roles.findUnique({ where: { id } });
  if (!existing) return { ok: false as const, error: "Role not found." };
  if (existing.is_system) {
    return { ok: false as const, error: "System roles cannot be deleted." };
  }
  const users = await prisma.users.count({ where: { role: id } });
  if (users > 0) {
    return {
      ok: false as const,
      error: `Role is assigned to ${users} user(s).`,
    };
  }
  await prisma.$transaction([
    prisma.role_route_permissions.deleteMany({ where: { role: id } }),
    prisma.role_action_permissions.deleteMany({ where: { role: id } }),
    prisma.roles.delete({ where: { id } }),
  ]);
  return { ok: true as const };
}
