-- Durable audit trail for auth + thin-client RPC actions.
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  user_id TEXT NULL REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  role TEXT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE')),
  summary TEXT NULL,
  entity_kind TEXT NULL,
  entity_id TEXT NULL,
  ip TEXT NULL,
  user_agent TEXT NULL
);

CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_idx ON audit_logs (occurred_at);
CREATE INDEX IF NOT EXISTS audit_logs_user_occurred_idx ON audit_logs (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS audit_logs_action_occurred_idx ON audit_logs (action, occurred_at);

-- ADMIN-only route access for the printable audit trail report.
INSERT INTO role_route_permissions (role, route_id, access)
VALUES ('ADMIN', 'audit-trail-report', 'WRITE')
ON CONFLICT (role, route_id) DO UPDATE SET access = EXCLUDED.access;

INSERT INTO role_route_permissions (role, route_id, access)
SELECT DISTINCT r.role, 'audit-trail-report', 'NONE'
FROM role_route_permissions r
WHERE r.role <> 'ADMIN'
ON CONFLICT (role, route_id) DO NOTHING;
