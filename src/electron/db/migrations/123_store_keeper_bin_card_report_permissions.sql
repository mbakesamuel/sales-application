-- Store Keeper opens bin card from Bottled Stock, but the printable report route
-- was never seeded for them (and stock-bin-card-report was missing for roles that
-- only had stock-bin-card via earlier migrations). Safe to re-run.

INSERT OR IGNORE INTO RoleRoutePermission (role, routeId, access)
VALUES
  ('STORE_KEEPER', 'stock-bin-card', 'WRITE'),
  ('STORE_KEEPER', 'stock-bin-card-report', 'WRITE');

UPDATE RoleRoutePermission
SET access = 'WRITE'
WHERE role = 'STORE_KEEPER'
  AND routeId IN ('stock-bin-card', 'stock-bin-card-report')
  AND access = 'NONE';

-- Anyone with stock-bin-card should open the printable report.
INSERT OR IGNORE INTO RoleRoutePermission (role, routeId, access)
SELECT role, 'stock-bin-card-report', access
FROM RoleRoutePermission
WHERE routeId = 'stock-bin-card'
  AND access IN ('READ', 'WRITE');

UPDATE RoleRoutePermission
SET access = (
  SELECT src.access
  FROM RoleRoutePermission src
  WHERE src.role = RoleRoutePermission.role
    AND src.routeId = 'stock-bin-card'
)
WHERE routeId = 'stock-bin-card-report'
  AND access = 'NONE'
  AND EXISTS (
    SELECT 1
    FROM RoleRoutePermission src
    WHERE src.role = RoleRoutePermission.role
      AND src.routeId = 'stock-bin-card'
      AND src.access IN ('READ', 'WRITE')
  );

-- Bottled-stock operators (including custom roles copied from Store Keeper).
INSERT OR IGNORE INTO RoleRoutePermission (role, routeId, access)
SELECT role, 'stock-bin-card', access
FROM RoleRoutePermission
WHERE routeId = 'bottled-stock'
  AND access IN ('READ', 'WRITE');

UPDATE RoleRoutePermission
SET access = (
  SELECT src.access
  FROM RoleRoutePermission src
  WHERE src.role = RoleRoutePermission.role
    AND src.routeId = 'bottled-stock'
)
WHERE routeId = 'stock-bin-card'
  AND access = 'NONE'
  AND EXISTS (
    SELECT 1
    FROM RoleRoutePermission src
    WHERE src.role = RoleRoutePermission.role
      AND src.routeId = 'bottled-stock'
      AND src.access IN ('READ', 'WRITE')
  );

INSERT OR IGNORE INTO RoleRoutePermission (role, routeId, access)
SELECT role, 'stock-bin-card-report', access
FROM RoleRoutePermission
WHERE routeId = 'bottled-stock'
  AND access IN ('READ', 'WRITE');

UPDATE RoleRoutePermission
SET access = (
  SELECT src.access
  FROM RoleRoutePermission src
  WHERE src.role = RoleRoutePermission.role
    AND src.routeId = 'bottled-stock'
)
WHERE routeId = 'stock-bin-card-report'
  AND access = 'NONE'
  AND EXISTS (
    SELECT 1
    FROM RoleRoutePermission src
    WHERE src.role = RoleRoutePermission.role
      AND src.routeId = 'bottled-stock'
      AND src.access IN ('READ', 'WRITE')
  );
