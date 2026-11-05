-- Financial year / month posting periods (thin-client Postgres source of truth).
CREATE TABLE IF NOT EXISTS financial_year_periods (
  id TEXT PRIMARY KEY,
  financial_year INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL
);

CREATE INDEX IF NOT EXISTS financial_year_periods_status_idx
  ON financial_year_periods (status);

CREATE TABLE IF NOT EXISTS financial_months (
  id TEXT PRIMARY KEY,
  financial_year_period_id TEXT NOT NULL REFERENCES financial_year_periods(id) ON DELETE CASCADE,
  financial_year INTEGER NOT NULL,
  calendar_month INTEGER NOT NULL CHECK (calendar_month BETWEEN 1 AND 12),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('OPEN', 'CLOSED')),
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  UNIQUE (financial_year_period_id, calendar_month)
);

CREATE INDEX IF NOT EXISTS financial_months_period_status_idx
  ON financial_months (financial_year_period_id, status);

CREATE INDEX IF NOT EXISTS financial_months_year_month_idx
  ON financial_months (financial_year, calendar_month);
