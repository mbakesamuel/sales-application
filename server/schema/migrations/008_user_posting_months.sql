-- Per head-office user open posting months (users.sales_point_id IS NULL).

CREATE TABLE IF NOT EXISTS user_posting_months (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  financial_year_period_id TEXT NOT NULL REFERENCES financial_year_periods(id) ON DELETE CASCADE,
  calendar_month INTEGER NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS user_posting_months_user_month_uidx
  ON user_posting_months (user_id, financial_year_period_id, calendar_month);

CREATE UNIQUE INDEX IF NOT EXISTS user_posting_months_one_open_user_uidx
  ON user_posting_months (user_id)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS user_posting_months_period_status_idx
  ON user_posting_months (financial_year_period_id, status);

INSERT INTO user_posting_months (
  id, user_id, financial_year_period_id, calendar_month, status, opened_at, closed_at
)
SELECT
  md5(random()::text || clock_timestamp()::text || u.id),
  u.id,
  spm.financial_year_period_id,
  spm.calendar_month,
  'OPEN',
  spm.opened_at,
  NULL
FROM users u
INNER JOIN sales_point_posting_months spm
  ON spm.sales_point_id IS NULL AND spm.status = 'OPEN'
INNER JOIN financial_year_periods y
  ON y.id = spm.financial_year_period_id AND y.status = 'OPEN'
WHERE u.sales_point_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_posting_months upm
    WHERE upm.user_id = u.id AND upm.status = 'OPEN'
  );
