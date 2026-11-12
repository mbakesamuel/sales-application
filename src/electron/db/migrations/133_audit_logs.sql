-- Durable audit trail for auth (local) + future action logging.
CREATE TABLE IF NOT EXISTS AuditLog (
  id TEXT PRIMARY KEY NOT NULL,
  occurredAt TEXT NOT NULL,
  userId TEXT NULL REFERENCES User(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  role TEXT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE')),
  summary TEXT NULL,
  entityKind TEXT NULL,
  entityId TEXT NULL,
  ip TEXT NULL,
  userAgent TEXT NULL
);

CREATE INDEX IF NOT EXISTS AuditLog_occurredAt_idx ON AuditLog (occurredAt);
CREATE INDEX IF NOT EXISTS AuditLog_user_occurred_idx ON AuditLog (userId, occurredAt);
CREATE INDEX IF NOT EXISTS AuditLog_action_occurred_idx ON AuditLog (action, occurredAt);

-- ADMIN-only route access for the printable audit trail report.
INSERT OR IGNORE INTO RoleRoutePermission (role, routeId, access)
VALUES ('ADMIN', 'audit-trail-report', 'WRITE');

UPDATE RoleRoutePermission
SET access = 'WRITE'
WHERE role = 'ADMIN' AND routeId = 'audit-trail-report';

INSERT OR IGNORE INTO RoleRoutePermission (role, routeId, access)
SELECT role, 'audit-trail-report', 'NONE'
FROM RoleRoutePermission
WHERE routeId = 'role-permissions' AND role != 'ADMIN';
