-- Per head-office user open posting months (users with salesPointId NULL).
-- Collection-point users continue to use SalesPointPostingMonth.

CREATE TABLE IF NOT EXISTS UserPostingMonth (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  financialYearPeriodId TEXT NOT NULL REFERENCES FinancialYearPeriod(id) ON DELETE CASCADE,
  calendarMonth INTEGER NOT NULL CHECK (calendarMonth BETWEEN 1 AND 12),
  status TEXT NOT NULL DEFAULT 'CLOSED' CHECK (status IN ('OPEN', 'CLOSED')),
  openedAt TEXT,
  closedAt TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS UserPostingMonth_user_month_uidx
  ON UserPostingMonth (userId, financialYearPeriodId, calendarMonth);

CREATE UNIQUE INDEX IF NOT EXISTS UserPostingMonth_one_open_user_uidx
  ON UserPostingMonth (userId)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS UserPostingMonth_period_status_idx
  ON UserPostingMonth (financialYearPeriodId, status);

-- Seed each unscoped (head-office) user from the current central open month.
INSERT INTO UserPostingMonth (
  id, userId, financialYearPeriodId, calendarMonth, status, openedAt, closedAt
)
SELECT
  lower(hex(randomblob(8))) || lower(hex(randomblob(8))),
  u.id,
  spm.financialYearPeriodId,
  spm.calendarMonth,
  'OPEN',
  spm.openedAt,
  NULL
FROM User u
INNER JOIN SalesPointPostingMonth spm
  ON spm.salesPointId IS NULL AND spm.status = 'OPEN'
INNER JOIN FinancialYearPeriod y
  ON y.id = spm.financialYearPeriodId AND y.status = 'OPEN'
WHERE u.salesPointId IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM UserPostingMonth upm
    WHERE upm.userId = u.id AND upm.status = 'OPEN'
  );
