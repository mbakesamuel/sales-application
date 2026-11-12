-- Products that are sold without inventory (e.g. negotiated services / non-stock items).
-- Sales invoices skip stock availability checks and do not post stock movements.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS non_stockable BOOLEAN NOT NULL DEFAULT false;
