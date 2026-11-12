-- Products with negotiated / consultation prices: clerk enters unit price on sale/DO.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS requires_manual_unit_price BOOLEAN NOT NULL DEFAULT false;
