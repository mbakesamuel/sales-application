-- Products with negotiated / consultation prices: clerk enters unit price on sale/DO.

ALTER TABLE Product ADD COLUMN requiresManualUnitPrice INTEGER NOT NULL DEFAULT 0
  CHECK (requiresManualUnitPrice IN (0, 1));
