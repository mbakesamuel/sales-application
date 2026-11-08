-- Per collection-point (and central/head-office) open posting months.
-- Catalog months stay on FinancialMonth; live OPEN/CLOSED lives here.
-- salesPointId NULL = central company month for unscoped (head-office) users.

CREATE TABLE IF NOT EXISTS SalesPointPostingMonth (
  id TEXT PRIMARY KEY NOT NULL,
  salesPointId INTEGER REFERENCES SalesPoint(id) ON DELETE CASCADE,
  financialYearPeriodId TEXT NOT NULL REFERENCES FinancialYearPeriod(id) ON DELETE CASCADE,
  calendarMonth INTEGER NOT NULL CHECK (calendarMonth BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('OPEN', 'CLOSED')),
  openedAt TEXT,
  closedAt TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS SalesPointPostingMonth_central_month_uidx
  ON SalesPointPostingMonth (financialYearPeriodId, calendarMonth)
  WHERE salesPointId IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS SalesPointPostingMonth_point_month_uidx
  ON SalesPointPostingMonth (salesPointId, financialYearPeriodId, calendarMonth)
  WHERE salesPointId IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS SalesPointPostingMonth_one_open_central_uidx
  ON SalesPointPostingMonth (financialYearPeriodId)
  WHERE status = 'OPEN' AND salesPointId IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS SalesPointPostingMonth_one_open_point_uidx
  ON SalesPointPostingMonth (salesPointId)
  WHERE status = 'OPEN' AND salesPointId IS NOT NULL;

CREATE INDEX IF NOT EXISTS SalesPointPostingMonth_period_status_idx
  ON SalesPointPostingMonth (financialYearPeriodId, status);

-- Seed from legacy global OPEN FinancialMonth into central + each active sales point.
INSERT INTO SalesPointPostingMonth (
  id, salesPointId, financialYearPeriodId, calendarMonth, status, openedAt, closedAt
)
SELECT
  lower(hex(randomblob(8))) || lower(hex(randomblob(8))),
  NULL,
  m.financialYearPeriodId,
  m.calendarMonth,
  'OPEN',
  m.openedAt,
  NULL
FROM FinancialMonth m
INNER JOIN FinancialYearPeriod y ON y.id = m.financialYearPeriodId
WHERE y.status = 'OPEN' AND m.status = 'OPEN'
  AND NOT EXISTS (
    SELECT 1 FROM SalesPointPostingMonth spm
    WHERE spm.salesPointId IS NULL
      AND spm.financialYearPeriodId = m.financialYearPeriodId
      AND spm.calendarMonth = m.calendarMonth
  );

INSERT INTO SalesPointPostingMonth (
  id, salesPointId, financialYearPeriodId, calendarMonth, status, openedAt, closedAt
)
SELECT
  lower(hex(randomblob(8))) || lower(hex(randomblob(8))),
  sp.id,
  m.financialYearPeriodId,
  m.calendarMonth,
  'OPEN',
  m.openedAt,
  NULL
FROM FinancialMonth m
INNER JOIN FinancialYearPeriod y ON y.id = m.financialYearPeriodId
INNER JOIN SalesPoint sp ON COALESCE(sp.isActive, 1) = 1
WHERE y.status = 'OPEN' AND m.status = 'OPEN'
  AND NOT EXISTS (
    SELECT 1 FROM SalesPointPostingMonth spm
    WHERE spm.salesPointId = sp.id
      AND spm.financialYearPeriodId = m.financialYearPeriodId
      AND spm.calendarMonth = m.calendarMonth
  );
