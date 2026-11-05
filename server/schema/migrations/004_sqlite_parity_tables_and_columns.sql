-- Port remaining SQLite app-domain tables/columns into Postgres.
-- Skips SyncOutbox / SyncState / MobileRefreshToken (desktop-only).
-- Stock balances remain derived from stock_movements (no StockBalance cache).

-- ---------------------------------------------------------------------------
-- Columns on existing tables
-- ---------------------------------------------------------------------------

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS auto_generate_stock_receipt_no BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_generate_stock_transfer_no BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bottle_oil_use_registered_customers BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bottle_oil_allow_ration BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_transfer_receive_uses_document_date BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS loose_sales_allow_public_relation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS loose_sales_allow_unregistered_customer BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS loose_palm_oil_require_sales_tank BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS loose_palm_oil_allow_inter_sales_point_transfer BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stock_intake_oil_grouping BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sales_invoice_lock_unit_price BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS transport_cost_moliwe_only_policy BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS session_idle_timeout_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_generate_sales_invoice_no BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_generate_delivery_order_no BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enforce_sales_invoice_booklet_validation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enforce_delivery_order_booklet_validation BOOLEAN NOT NULL DEFAULT false;

UPDATE company_settings
SET transport_cost_moliwe_only_policy = true
WHERE id = 'default'
  AND transport_cost_moliwe_only_policy IS DISTINCT FROM true;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS stock_intake_group TEXT,
  ADD COLUMN IF NOT EXISTS stock_pool_product_id INTEGER,
  ADD COLUMN IF NOT EXISTS exclude_from_sales BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS omits_storage_location BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exclude_from_delivery_orders BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_intake_group_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_stock_intake_group_check
      CHECK (
        stock_intake_group IS NULL
        OR stock_intake_group IN ('PALM_OIL', 'SLUDGE_OIL', 'PALM_KERNEL')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_pool_product_id_fkey'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_stock_pool_product_id_fkey
      FOREIGN KEY (stock_pool_product_id) REFERENCES products(product_id);
  END IF;
END $$;

ALTER TABLE storage_locations
  ADD COLUMN IF NOT EXISTS allows_multi_product BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE customer_type_definitions
  ADD COLUMN IF NOT EXISTS exempt_from_sales_tax BOOLEAN NOT NULL DEFAULT false;

UPDATE customer_type_definitions
SET exempt_from_sales_tax = true
WHERE code = 'INDUSTRY';

INSERT INTO customer_type_definitions (id, code, name, sort_order, is_active, is_system)
SELECT v.id, v.code, v.name, v.sort_order, v.is_active, v.is_system
FROM (
  VALUES
    ('seed-ct-industry', 'INDUSTRY', 'Industry', 10, true, true),
    ('seed-ct-wholesale', 'WHOLESALE', 'Wholesale', 20, true, true),
    ('seed-ct-retail', 'RETAIL', 'Retail', 30, true, true)
) AS v(id, code, name, sort_order, is_active, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM customer_type_definitions existing
  WHERE existing.id = v.id OR existing.code = v.code
);

UPDATE customer_type_definitions
SET exempt_from_sales_tax = true
WHERE code = 'INDUSTRY';

ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS transferred_from_delivery_order_id TEXT,
  ADD COLUMN IF NOT EXISTS source_document_no TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'delivery_orders_transferred_from_fkey'
  ) THEN
    ALTER TABLE delivery_orders
      ADD CONSTRAINT delivery_orders_transferred_from_fkey
      FOREIGN KEY (transferred_from_delivery_order_id) REFERENCES delivery_orders(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS delivery_orders_transferred_from_idx
  ON delivery_orders (transferred_from_delivery_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_orders_cf_source_document_no_unique
  ON delivery_orders (source_document_no)
  WHERE source_kind = 'CARRY_FORWARD'
    AND status IN ('PENDING', 'VALIDATED')
    AND source_document_no IS NOT NULL
    AND length(trim(source_document_no)) > 0;

ALTER TABLE delivery_order_details
  ADD COLUMN IF NOT EXISTS pricing_customer_type_id TEXT;

ALTER TABLE delivery_order_payment_details
  ADD COLUMN IF NOT EXISTS traite_no TEXT,
  ADD COLUMN IF NOT EXISTS traite_issued_on TEXT,
  ADD COLUMN IF NOT EXISTS traite_maturity_on TEXT;

-- Allow draft transfers without a dispatch timestamp.
ALTER TABLE stock_transfers
  ALTER COLUMN dispatched_at DROP NOT NULL;

INSERT INTO payment_method_definitions (id, code, name, kind, sort_order, is_active, is_system)
SELECT v.id, v.code, v.name, v.kind, v.sort_order, v.is_active, v.is_system
FROM (
  VALUES
    ('sys-pm-bank-transfer', 'BANK_TRANSFER', 'Bank transfer', 'BANK_TRANSFER', 40, true, true),
    ('sys-pm-ration', 'RATION', 'Ration', 'CREDIT', 90, true, true),
    ('sys-pm-public-relation', 'PUBLIC_RELATION', 'Public relation', 'PUBLIC_RELATION', 91, true, true)
) AS v(id, code, name, kind, sort_order, is_active, is_system)
WHERE NOT EXISTS (
  SELECT 1 FROM payment_method_definitions existing
  WHERE existing.id = v.id OR existing.code = v.code
);

CREATE INDEX IF NOT EXISTS stock_movements_balance_idx
  ON stock_movements (sales_point_id, product_id, storage_location_id, condition);

-- ---------------------------------------------------------------------------
-- New domain tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS report_signatories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  effective_from DATE NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO report_signatories (id, name, title, effective_from)
VALUES (
  'seed-signatory-default',
  'NYAKE VICTORINE Epse MBUA',
  'Manager, Palm Oil Sales',
  '2000-01-01'
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS transport_rate_schedules (
  id TEXT PRIMARY KEY,
  sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  rate_per_kg TEXT NOT NULL,
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sales_point_id, product_id, effective_from)
);

CREATE INDEX IF NOT EXISTS transport_rate_schedules_point_product_from_idx
  ON transport_rate_schedules (sales_point_id, product_id, effective_from);

CREATE TABLE IF NOT EXISTS product_sales_budgets (
  id TEXT PRIMARY KEY,
  financial_year INTEGER NOT NULL,
  product_cat_id INTEGER NOT NULL REFERENCES product_cats(product_cat_id),
  annual_qty_kg TEXT NOT NULL,
  budget_unit_price_per_kg TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (financial_year, product_cat_id)
);

CREATE INDEX IF NOT EXISTS product_sales_budgets_year_idx
  ON product_sales_budgets (financial_year);

CREATE TABLE IF NOT EXISTS product_sales_budget_month_phase_profiles (
  id TEXT PRIMARY KEY,
  financial_year INTEGER NOT NULL,
  product_cat_id INTEGER NOT NULL REFERENCES product_cats(product_cat_id) ON DELETE CASCADE,
  pct_m01 TEXT NOT NULL,
  pct_m02 TEXT NOT NULL,
  pct_m03 TEXT NOT NULL,
  pct_m04 TEXT NOT NULL,
  pct_m05 TEXT NOT NULL,
  pct_m06 TEXT NOT NULL,
  pct_m07 TEXT NOT NULL,
  pct_m08 TEXT NOT NULL,
  pct_m09 TEXT NOT NULL,
  pct_m10 TEXT NOT NULL,
  pct_m11 TEXT NOT NULL,
  pct_m12 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (financial_year, product_cat_id)
);

CREATE INDEX IF NOT EXISTS product_sales_budget_month_phase_profiles_year_idx
  ON product_sales_budget_month_phase_profiles (financial_year);

CREATE TABLE IF NOT EXISTS consignment_details (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  consigner_name TEXT NOT NULL,
  consigner_designation TEXT NOT NULL,
  date_of_consignment DATE NOT NULL,
  receiver_name TEXT NOT NULL,
  receiver_nic_no TEXT,
  receiver_nic_place_of_issue TEXT,
  received_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS consignment_details_sale_idx
  ON consignment_details (sale_id);

CREATE TABLE IF NOT EXISTS vehicle_consignment_notes (
  id TEXT PRIMARY KEY,
  consignment_note_no TEXT NOT NULL UNIQUE,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
  destination TEXT NOT NULL,
  date_of_lifting DATE NOT NULL,
  vehicle_number TEXT NOT NULL,
  consignment_details_id TEXT NOT NULL UNIQUE REFERENCES consignment_details(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'VALIDATED', 'REJECTED')),
  validated_at TIMESTAMPTZ,
  validated_by_user_id TEXT REFERENCES users(id),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  origin_device_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vehicle_consignment_notes_status_idx
  ON vehicle_consignment_notes (status);

CREATE TABLE IF NOT EXISTS delivery_order_transfers (
  id TEXT PRIMARY KEY,
  from_delivery_order_id TEXT NOT NULL REFERENCES delivery_orders(id),
  to_delivery_order_id TEXT NOT NULL UNIQUE REFERENCES delivery_orders(id),
  from_sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  to_sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  transferred_at TIMESTAMPTZ NOT NULL,
  transferred_by_user_id TEXT NOT NULL REFERENCES users(id),
  notes TEXT,
  origin_device_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS delivery_order_transfers_from_idx
  ON delivery_order_transfers (from_delivery_order_id);

CREATE TABLE IF NOT EXISTS delivery_order_transfer_lines (
  id BIGSERIAL PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES delivery_order_transfers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  qty_kg INTEGER NOT NULL CHECK (qty_kg > 0)
);

CREATE INDEX IF NOT EXISTS delivery_order_transfer_lines_transfer_idx
  ON delivery_order_transfer_lines (transfer_id);

CREATE TABLE IF NOT EXISTS factories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  commercial_service_id TEXT NOT NULL REFERENCES commercial_services(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commercial_service_id, name)
);

CREATE INDEX IF NOT EXISTS factories_service_active_idx
  ON factories (commercial_service_id, is_active);

CREATE TABLE IF NOT EXISTS commercial_invoice_sequences (
  commercial_service_id TEXT NOT NULL REFERENCES commercial_services(id) ON DELETE CASCADE,
  calendar_year INTEGER NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (commercial_service_id, calendar_year)
);

CREATE TABLE IF NOT EXISTS vehicle_consignment_note_sequences (
  id TEXT PRIMARY KEY DEFAULT 'default',
  next_number INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO vehicle_consignment_note_sequences (id, next_number)
VALUES ('default', 1)
ON CONFLICT (id) DO NOTHING;
