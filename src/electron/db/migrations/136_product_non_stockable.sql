-- Products that are sold without inventory (e.g. negotiated services / non-stock items).
-- Sales invoices skip stock availability checks and do not post stock movements.

ALTER TABLE Product ADD COLUMN nonStockable INTEGER NOT NULL DEFAULT 0
  CHECK (nonStockable IN (0, 1));
