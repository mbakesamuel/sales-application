-- DO Industry/Wholesale pricing vs Retail invoice.
-- Column adds are applied from runMigrations (idempotent) before this file runs
-- when needed; this SQL focuses on seeds + Sale disposition CHECK rebuild.
-- Sale.id is TEXT (UUID), not INTEGER.

INSERT INTO CustomerTypeDefinition (id, code, name, sortOrder, isActive, isSystem)
SELECT 'seed-ct-industry', 'INDUSTRY', 'Industry', 10, 1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM CustomerTypeDefinition
  WHERE UPPER(code) LIKE '%INDUSTR%' OR UPPER(name) LIKE '%INDUSTR%'
);

INSERT INTO CustomerTypeDefinition (id, code, name, sortOrder, isActive, isSystem)
SELECT 'seed-ct-wholesale', 'WHOLESALE', 'Wholesale', 20, 1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM CustomerTypeDefinition
  WHERE UPPER(code) LIKE '%WHOLESALE%' OR UPPER(name) LIKE '%WHOLESALE%'
);

INSERT INTO CustomerTypeDefinition (id, code, name, sortOrder, isActive, isSystem)
SELECT 'seed-ct-retail', 'RETAIL', 'Retail', 0, 1, 1
WHERE NOT EXISTS (
  SELECT 1 FROM CustomerTypeDefinition
  WHERE UPPER(code) LIKE '%RETAIL%' OR UPPER(name) LIKE '%RETAIL%'
);

-- Copy Retail schedule prices onto Wholesale / Industry when missing.
INSERT INTO ProductUnitPriceSchedule (id, productId, unitPriceExTax, effectiveFrom, customerTypeId)
SELECT
  printf('seed-price-ws-%d-%s', r.productId, r.effectiveFrom),
  r.productId,
  r.unitPriceExTax,
  r.effectiveFrom,
  (
    SELECT id FROM CustomerTypeDefinition
    WHERE isActive = 1
      AND (UPPER(code) LIKE '%WHOLESALE%' OR UPPER(name) LIKE '%WHOLESALE%')
    ORDER BY sortOrder ASC
    LIMIT 1
  )
FROM ProductUnitPriceSchedule r
WHERE r.customerTypeId IN (
  SELECT id FROM CustomerTypeDefinition
  WHERE UPPER(code) LIKE '%RETAIL%' OR UPPER(name) LIKE '%RETAIL%'
)
AND NOT EXISTS (
  SELECT 1 FROM ProductUnitPriceSchedule w
  WHERE w.productId = r.productId
    AND w.effectiveFrom = r.effectiveFrom
    AND w.customerTypeId IN (
      SELECT id FROM CustomerTypeDefinition
      WHERE UPPER(code) LIKE '%WHOLESALE%' OR UPPER(name) LIKE '%WHOLESALE%'
    )
)
AND (
  SELECT id FROM CustomerTypeDefinition
  WHERE isActive = 1
    AND (UPPER(code) LIKE '%WHOLESALE%' OR UPPER(name) LIKE '%WHOLESALE%')
  ORDER BY sortOrder ASC
  LIMIT 1
) IS NOT NULL;

INSERT INTO ProductUnitPriceSchedule (id, productId, unitPriceExTax, effectiveFrom, customerTypeId)
SELECT
  printf('seed-price-ind-%d-%s', r.productId, r.effectiveFrom),
  r.productId,
  r.unitPriceExTax,
  r.effectiveFrom,
  (
    SELECT id FROM CustomerTypeDefinition
    WHERE isActive = 1
      AND (UPPER(code) LIKE '%INDUSTR%' OR UPPER(name) LIKE '%INDUSTR%')
    ORDER BY sortOrder ASC
    LIMIT 1
  )
FROM ProductUnitPriceSchedule r
WHERE r.customerTypeId IN (
  SELECT id FROM CustomerTypeDefinition
  WHERE UPPER(code) LIKE '%RETAIL%' OR UPPER(name) LIKE '%RETAIL%'
)
AND NOT EXISTS (
  SELECT 1 FROM ProductUnitPriceSchedule i
  WHERE i.productId = r.productId
    AND i.effectiveFrom = r.effectiveFrom
    AND i.customerTypeId IN (
      SELECT id FROM CustomerTypeDefinition
      WHERE UPPER(code) LIKE '%INDUSTR%' OR UPPER(name) LIKE '%INDUSTR%'
    )
)
AND (
  SELECT id FROM CustomerTypeDefinition
  WHERE isActive = 1
    AND (UPPER(code) LIKE '%INDUSTR%' OR UPPER(name) LIKE '%INDUSTR%')
  ORDER BY sortOrder ASC
  LIMIT 1
) IS NOT NULL;

-- Expand Sale.saleDisposition CHECK to include RETAIL (SQLite requires rebuild).
PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS Sale__retail_disp;

CREATE TABLE Sale__retail_disp (
  id TEXT PRIMARY KEY NOT NULL,
  invoiceNo TEXT NOT NULL UNIQUE,
  soldAt TEXT NOT NULL DEFAULT (datetime('now')),
  customerId INTEGER REFERENCES Customer(id),
  createdByUserId TEXT NOT NULL REFERENCES User(id),
  customerNameSnapshot TEXT NOT NULL,
  taxRegimeId TEXT REFERENCES TaxRegime(id) ON DELETE RESTRICT,
  vatRateSnapshot TEXT NOT NULL,
  netAmount TEXT NOT NULL,
  vatAmount TEXT NOT NULL,
  grossAmount TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
  financialYear INTEGER,
  financialMonth INTEGER,
  referenceNumber TEXT,
  salesPointId INTEGER REFERENCES SalesPoint(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VALIDATED','REJECTED')),
  validatedAt TEXT,
  validatedByUserId TEXT REFERENCES User(id),
  vehicleNumber TEXT NOT NULL,
  dateIssued TEXT NOT NULL,
  deliveryOrderNo TEXT,
  postingCalendarYear INTEGER,
  commercialServiceId TEXT REFERENCES CommercialService(id),
  issuerPhoneSnapshot TEXT,
  issuerAddressSnapshot TEXT,
  commercialServiceNameSnapshot TEXT,
  saleProductMode TEXT CHECK (saleProductMode IS NULL OR saleProductMode IN ('LOOSE','BOTTLE')),
  saleDisposition TEXT DEFAULT 'NORMAL' CHECK (
    saleDisposition IS NULL
    OR saleDisposition IN ('NORMAL','RATION','PUBLIC_RELATION','RETAIL')
  ),
  cancelledAt TEXT,
  cancelledByUserId TEXT REFERENCES User(id),
  cancelReason TEXT
);

INSERT INTO Sale__retail_disp (
  id, invoiceNo, soldAt, customerId, createdByUserId, customerNameSnapshot,
  taxRegimeId, vatRateSnapshot, netAmount, vatAmount, grossAmount,
  createdAt, updatedAt, financialYear, financialMonth, referenceNumber,
  salesPointId, status, validatedAt, validatedByUserId, vehicleNumber,
  dateIssued, deliveryOrderNo, postingCalendarYear, commercialServiceId,
  issuerPhoneSnapshot, issuerAddressSnapshot, commercialServiceNameSnapshot,
  saleProductMode, saleDisposition, cancelledAt, cancelledByUserId, cancelReason
)
SELECT
  id, invoiceNo, soldAt, customerId, createdByUserId, customerNameSnapshot,
  taxRegimeId, vatRateSnapshot, netAmount, vatAmount, grossAmount,
  createdAt, updatedAt, financialYear, financialMonth, referenceNumber,
  salesPointId, status, validatedAt, validatedByUserId, vehicleNumber,
  dateIssued, deliveryOrderNo, postingCalendarYear, commercialServiceId,
  issuerPhoneSnapshot, issuerAddressSnapshot, commercialServiceNameSnapshot,
  saleProductMode, saleDisposition, cancelledAt, cancelledByUserId, cancelReason
FROM Sale;

DROP TABLE Sale;
ALTER TABLE Sale__retail_disp RENAME TO Sale;

CREATE INDEX IF NOT EXISTS Sale_soldAt_idx ON Sale (soldAt);
CREATE INDEX IF NOT EXISTS Sale_customer_soldAt_idx ON Sale (customerId, soldAt);
CREATE INDEX IF NOT EXISTS Sale_createdBy_soldAt_idx ON Sale (createdByUserId, soldAt);
CREATE INDEX IF NOT EXISTS Sale_taxRegime_soldAt_idx ON Sale (taxRegimeId, soldAt);
CREATE INDEX IF NOT EXISTS Sale_fy_posting_idx ON Sale (financialYear, postingCalendarYear, financialMonth);
CREATE INDEX IF NOT EXISTS Sale_status_soldAt_idx ON Sale (status, soldAt);
CREATE INDEX IF NOT EXISTS Sale_status_cancelled_idx ON Sale (status, cancelledAt);
CREATE INDEX IF NOT EXISTS Sale_deliveryOrderNo_idx ON Sale (deliveryOrderNo);
CREATE INDEX IF NOT EXISTS Sale_commercialService_idx ON Sale (commercialServiceId);

PRAGMA foreign_keys = ON;
