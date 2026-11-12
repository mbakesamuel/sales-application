-- ===========================================================================
-- Sales Central - PostgreSQL 16+ Production Schema
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Registered Terminals / Devices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sales_point_id INTEGER,
  api_key TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Organization & Configuration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  company_name TEXT NOT NULL,
  department TEXT,
  vat_rate TEXT NOT NULL,
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
  logo_url TEXT,
  ui_theme_preset TEXT NOT NULL DEFAULT 'agro',
  hide_zero_report_rows BOOLEAN NOT NULL DEFAULT true,
  stock_commitment_report_comments TEXT,
  report_comments_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  delivery_order_block_retail_quantity BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_points (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  attached_to_mill BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commercial_services (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  invoice_prefix TEXT NOT NULL UNIQUE,
  phone TEXT,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  site_kind TEXT NOT NULL DEFAULT 'SALES_POINT',
  enabled_modules JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  location_name TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS storage_locations (
  id SERIAL PRIMARY KEY,
  sales_point_id INTEGER NOT NULL REFERENCES sales_points(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_sales_tank BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sales_point_id, location_id)
);

-- ---------------------------------------------------------------------------
-- Auth & Permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL REFERENCES roles(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  username TEXT NOT NULL UNIQUE,
  password_plain TEXT,
  sales_point_id INTEGER REFERENCES sales_points(id),
  password_hash TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  commercial_service_id TEXT REFERENCES commercial_services(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_route_permissions (
  role TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'NONE',
  PRIMARY KEY (role, route_id)
);

CREATE TABLE IF NOT EXISTS role_action_permissions (
  role TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  action_key TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (role, action_key)
);

-- ---------------------------------------------------------------------------
-- Catalog & Customers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_cats (
  product_cat_id SERIAL PRIMARY KEY,
  product_cat TEXT NOT NULL,
  product_code TEXT NOT NULL,
  is_main BOOLEAN NOT NULL DEFAULT false,
  is_bottled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_type_definitions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  product_id SERIAL PRIMARY KEY,
  product_name TEXT NOT NULL,
  product_code TEXT,
  product_cat_id INTEGER NOT NULL REFERENCES product_cats(product_cat_id),
  commercial_service_id TEXT REFERENCES commercial_services(id),
  uom TEXT NOT NULL DEFAULT 'Kg',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_unit_price_schedules (
  id TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  unit_price_ex_tax TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  customer_type_id TEXT REFERENCES customer_type_definitions(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tax_regimes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'SIMPLIFIED',
  commercial_service_id TEXT REFERENCES commercial_services(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commercial_service_id, name)
);

CREATE TABLE IF NOT EXISTS tax_rate_schedules (
  id TEXT PRIMARY KEY,
  rate_kind TEXT NOT NULL,
  rate TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rate_kind, effective_from)
);

CREATE TABLE IF NOT EXISTS payment_method_definitions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_regime_id TEXT REFERENCES tax_regimes(id) ON DELETE RESTRICT,
  taxpayer_id TEXT,
  residency TEXT NOT NULL DEFAULT 'LOCAL',
  has_taxpayer_id BOOLEAN NOT NULL DEFAULT false,
  is_pos_placeholder BOOLEAN NOT NULL DEFAULT false,
  commercial_service_id TEXT REFERENCES commercial_services(id),
  customer_type_id TEXT REFERENCES customer_type_definitions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_booklets (
  id TEXT PRIMARY KEY,
  document_kind TEXT NOT NULL,
  booklet_code TEXT,
  start_serial TEXT NOT NULL,
  end_serial TEXT NOT NULL,
  sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by_user_id TEXT,
  validated_at TIMESTAMPTZ,
  validated_by_user_id TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Operational / Transactional Tables (Sync Targets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  customer_id INTEGER,
  created_by_user_id TEXT NOT NULL,
  customer_name_snapshot TEXT NOT NULL,
  tax_regime_id TEXT,
  vat_rate_snapshot TEXT NOT NULL,
  net_amount TEXT NOT NULL,
  vat_amount TEXT NOT NULL,
  gross_amount TEXT NOT NULL,
  financial_year INTEGER,
  financial_month INTEGER,
  reference_number TEXT,
  sales_point_id INTEGER REFERENCES sales_points(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  validated_at TIMESTAMPTZ,
  validated_by_user_id TEXT,
  vehicle_number TEXT NOT NULL,
  date_issued TEXT NOT NULL,
  delivery_order_no TEXT,
  posting_calendar_year INTEGER,
  commercial_service_id TEXT,
  issuer_phone_snapshot TEXT,
  issuer_address_snapshot TEXT,
  commercial_service_name_snapshot TEXT,
  sale_product_mode TEXT,
  sale_disposition TEXT DEFAULT 'NORMAL',
  cancelled_at TIMESTAMPTZ,
  cancelled_by_user_id TEXT,
  cancel_reason TEXT,
  origin_device_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sale_lines (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  qty_kg TEXT NOT NULL,
  unit_price_per_kg TEXT NOT NULL,
  line_net TEXT NOT NULL,
  line_vat TEXT NOT NULL,
  line_gross TEXT NOT NULL,
  qty_units TEXT,
  unit_price_per_unit TEXT,
  storage_location_id INTEGER
);

CREATE TABLE IF NOT EXISTS sale_applied_taxes (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  tax_type_id TEXT,
  code_snapshot TEXT NOT NULL,
  label_snapshot TEXT NOT NULL,
  rate_snapshot TEXT NOT NULL,
  amount TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  amount TEXT NOT NULL,
  cheque_no TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bank TEXT,
  traite_no TEXT,
  traite_issued_on TEXT,
  traite_maturity_on TEXT,
  payment_method_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_sequences (
  sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  document_kind TEXT NOT NULL,
  financial_year INTEGER NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sales_point_id, document_kind, financial_year)
);

CREATE TABLE IF NOT EXISTS delivery_orders (
  id TEXT PRIMARY KEY,
  delivery_order_no TEXT NOT NULL UNIQUE,
  date_issued TEXT NOT NULL,
  customer_id INTEGER,
  order_ref TEXT,
  sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  financial_year INTEGER,
  financial_month INTEGER,
  created_by_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  validated_at TIMESTAMPTZ,
  validated_by_user_id TEXT,
  posting_calendar_year INTEGER,
  commercial_service_id TEXT,
  issuer_phone_snapshot TEXT,
  issuer_address_snapshot TEXT,
  commercial_service_name_snapshot TEXT,
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by_user_id TEXT,
  cancel_reason TEXT,
  source_kind TEXT NOT NULL DEFAULT 'NORMAL',
  origin_device_id TEXT,
  destination_pending BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_order_details (
  id BIGSERIAL PRIMARY KEY,
  delivery_order_id TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  order_qty INTEGER NOT NULL,
  order_unit TEXT,
  unit_price TEXT,
  pricing_customer_type_id TEXT,
  amount TEXT,
  line_subtotal_ex_tax TEXT,
  vat_rate TEXT,
  vat_amount TEXT,
  other_tax_label TEXT,
  other_tax_amount TEXT
);

CREATE TABLE IF NOT EXISTS delivery_order_payment_details (
  id BIGSERIAL PRIMARY KEY,
  delivery_order_id TEXT NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  cheque_no TEXT,
  bank TEXT,
  cash_receipt_no TEXT,
  receipt_date TEXT,
  payment_method_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_receipts (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  received_at TIMESTAMPTZ NOT NULL,
  supplier_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  consignment_note_no TEXT,
  consigned_by TEXT,
  cons_design TEXT,
  cons_date TEXT,
  receive_by TEXT,
  receive_by_design TEXT,
  receive_date TEXT,
  created_by_user_id TEXT NOT NULL,
  posted_by_user_id TEXT,
  posted_at TIMESTAMPTZ,
  origin_device_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_receipt_lines (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES stock_receipts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  qty TEXT NOT NULL,
  storage_location_id INTEGER
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id TEXT PRIMARY KEY,
  transfer_no TEXT NOT NULL UNIQUE,
  from_sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  to_sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  dispatched_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by_user_id TEXT NOT NULL,
  posted_by_user_id TEXT,
  posted_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  received_by_user_id TEXT,
  consigned_by TEXT,
  cons_design TEXT,
  cons_date TEXT,
  receive_by TEXT,
  receive_by_design TEXT,
  receive_date TEXT,
  origin_device_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
  id TEXT PRIMARY KEY,
  transfer_id TEXT NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  qty TEXT NOT NULL,
  from_storage_location_id INTEGER,
  to_storage_location_id INTEGER
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  adjustment_no TEXT NOT NULL UNIQUE,
  sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  occurred_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by_user_id TEXT NOT NULL,
  posted_by_user_id TEXT,
  posted_at TIMESTAMPTZ,
  source_kind TEXT NOT NULL DEFAULT 'NORMAL',
  origin_device_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_adjustment_lines (
  id TEXT PRIMARY KEY,
  adjustment_id TEXT NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  delta_qty TEXT NOT NULL,
  storage_location_id INTEGER,
  from_condition TEXT,
  to_condition TEXT
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  product_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  qty TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  user_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  notes TEXT,
  storage_location_id INTEGER,
  condition TEXT NOT NULL DEFAULT 'SELLABLE',
  origin_device_id TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
