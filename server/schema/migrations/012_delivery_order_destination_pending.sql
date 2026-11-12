-- DO raised at a holding CP (typically Bota) before fulfillment CP is decided.
ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS destination_pending BOOLEAN NOT NULL DEFAULT false;
