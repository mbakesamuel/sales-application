-- Online-only command API foundation:
-- 1) document_sequences for server-authoritative number allocation
-- 2) delivery_orders.id TEXT/UUID (was BIGINT) for multi-device merge safety

CREATE TABLE IF NOT EXISTS document_sequences (
  sales_point_id INTEGER NOT NULL REFERENCES sales_points(id),
  document_kind TEXT NOT NULL,
  financial_year INTEGER NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sales_point_id, document_kind, financial_year)
);

-- Convert delivery_orders.id BIGINT -> TEXT when still numeric.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'delivery_orders'
      AND column_name = 'id'
      AND data_type = 'bigint'
  ) THEN
    ALTER TABLE delivery_order_details
      DROP CONSTRAINT IF EXISTS delivery_order_details_delivery_order_id_fkey;
    ALTER TABLE delivery_order_payment_details
      DROP CONSTRAINT IF EXISTS delivery_order_payment_details_delivery_order_id_fkey;

    ALTER TABLE delivery_order_details
      ALTER COLUMN delivery_order_id TYPE TEXT USING delivery_order_id::text;
    ALTER TABLE delivery_order_payment_details
      ALTER COLUMN delivery_order_id TYPE TEXT USING delivery_order_id::text;
    ALTER TABLE delivery_orders
      ALTER COLUMN id TYPE TEXT USING id::text;

    ALTER TABLE delivery_order_details
      ADD CONSTRAINT delivery_order_details_delivery_order_id_fkey
      FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE;
    ALTER TABLE delivery_order_payment_details
      ADD CONSTRAINT delivery_order_payment_details_delivery_order_id_fkey
      FOREIGN KEY (delivery_order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE;
  END IF;
END $$;
