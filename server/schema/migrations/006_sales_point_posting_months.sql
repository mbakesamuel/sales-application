-- Per collection-point (and central/head-office) open posting months.
-- Catalog months stay on financial_months; live OPEN/CLOSED lives here.
-- sales_point_id NULL = central company month for unscoped (head-office) users.

CREATE TABLE IF NOT EXISTS sales_point_posting_months (
  id TEXT PRIMARY KEY,
  sales_point_id INTEGER REFERENCES sales_points(id) ON DELETE CASCADE,
  financial_year_period_id TEXT NOT NULL REFERENCES financial_year_periods(id) ON DELETE CASCADE,
  calendar_month INTEGER NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_point_posting_months_central_month_uidx
  ON sales_point_posting_months (financial_year_period_id, calendar_month)
  WHERE sales_point_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_point_posting_months_point_month_uidx
  ON sales_point_posting_months (sales_point_id, financial_year_period_id, calendar_month)
  WHERE sales_point_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_point_posting_months_one_open_central_uidx
  ON sales_point_posting_months (financial_year_period_id)
  WHERE status = 'OPEN' AND sales_point_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_point_posting_months_one_open_point_uidx
  ON sales_point_posting_months (sales_point_id)
  WHERE status = 'OPEN' AND sales_point_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_point_posting_months_period_status_idx
  ON sales_point_posting_months (financial_year_period_id, status);

-- Seed from legacy global OPEN financial_months into central + each active sales point.
INSERT INTO sales_point_posting_months (
  id, sales_point_id, financial_year_period_id, calendar_month, status, opened_at, closed_at
)
SELECT
  md5(random()::text || clock_timestamp()::text || m.id || 'central'),
  NULL,
  m.financial_year_period_id,
  m.calendar_month,
  'OPEN',
  m.opened_at,
  NULL
FROM financial_months m
INNER JOIN financial_year_periods y ON y.id = m.financial_year_period_id
WHERE y.status = 'OPEN' AND m.status = 'OPEN'
  AND NOT EXISTS (
    SELECT 1 FROM sales_point_posting_months spm
    WHERE spm.sales_point_id IS NULL
      AND spm.financial_year_period_id = m.financial_year_period_id
      AND spm.calendar_month = m.calendar_month
  );

INSERT INTO sales_point_posting_months (
  id, sales_point_id, financial_year_period_id, calendar_month, status, opened_at, closed_at
)
SELECT
  md5(random()::text || clock_timestamp()::text || m.id || sp.id::text),
  sp.id,
  m.financial_year_period_id,
  m.calendar_month,
  'OPEN',
  m.opened_at,
  NULL
FROM financial_months m
INNER JOIN financial_year_periods y ON y.id = m.financial_year_period_id
INNER JOIN sales_points sp ON sp.is_active = true
WHERE y.status = 'OPEN' AND m.status = 'OPEN'
  AND NOT EXISTS (
    SELECT 1 FROM sales_point_posting_months spm
    WHERE spm.sales_point_id = sp.id
      AND spm.financial_year_period_id = m.financial_year_period_id
      AND spm.calendar_month = m.calendar_month
  );
