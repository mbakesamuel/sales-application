import type { PermissionActionKey, RolePermissionsSnapshot } from "./permissions.types.ts";
import type { RouteAccess } from "./roles.ts";
import { canAccessBottledStockModule, canAccessStockModule } from "./stockModule.js";

export function getRouteAccessFromSnapshot(
  snapshot: RolePermissionsSnapshot,
  routeId: string,
): RouteAccess {
  return snapshot.routes[routeId] ?? "none";
}

export function canAccessRouteFromSnapshot(
  snapshot: RolePermissionsSnapshot,
  routeId: string,
): boolean {
  return getRouteAccessFromSnapshot(snapshot, routeId) !== "none";
}

export function canWriteRouteFromSnapshot(
  snapshot: RolePermissionsSnapshot,
  routeId: string,
): boolean {
  return getRouteAccessFromSnapshot(snapshot, routeId) === "write";
}

export function canPerformActionFromSnapshot(
  snapshot: RolePermissionsSnapshot,
  actionKey: PermissionActionKey,
): boolean {
  return snapshot.actions[actionKey] ?? false;
}

/** Sidebar label: bottled-only keepers see "Stock" for bottled-stock. */
export function stockNavLabelForRoute(
  snapshot: RolePermissionsSnapshot,
  routeId: string,
  defaultLabel: string,
): string {
  if (routeId !== "bottled-stock") {
    return defaultLabel;
  }
  const hasBulk = canAccessStockModule(snapshot);
  const hasBottled = canAccessBottledStockModule(snapshot);
  if (hasBottled && !hasBulk) {
    return "Stock";
  }
  return defaultLabel;
}

export function filterSectionsForPermissions<
  TSection extends {
    routes: readonly { id: string; label?: string }[];
    groups?: readonly {
      id: string;
      label: string;
      routes: readonly { id: string; label?: string }[];
    }[];
  },
>(sections: readonly TSection[], snapshot: RolePermissionsSnapshot): TSection[] {
  function canAccessRoute(routeId: string): boolean {
    if (routeId === "stock") {
      return canAccessStockModule(snapshot);
    }
    if (routeId === "bottled-stock") {
      return canAccessBottledStockModule(snapshot);
    }
    return canAccessRouteFromSnapshot(snapshot, routeId);
  }

  function withNavLabel<T extends { id: string; label?: string }>(route: T): T {
    if (!("label" in route) || route.label == null) {
      return route;
    }
    return {
      ...route,
      label: stockNavLabelForRoute(snapshot, route.id, route.label),
    };
  }

  return sections
    .map((section) => {
      if (section.groups?.length) {
        const groups = section.groups
          .map((group) => ({
            ...group,
            routes: group.routes
              .filter((route) => canAccessRoute(route.id))
              .map((route) => withNavLabel(route)),
          }))
          .filter((group) => group.routes.length > 0);
        return {
          ...section,
          groups,
          routes: groups.flatMap((group) => [...group.routes]),
        };
      }

      return {
        ...section,
        routes: section.routes
          .filter((route) => canAccessRoute(route.id))
          .map((route) => withNavLabel(route)),
      };
    })
    .filter((section) => section.routes.length > 0);
}
