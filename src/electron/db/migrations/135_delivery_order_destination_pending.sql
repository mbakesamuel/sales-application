-- DO raised at a holding CP (typically Bota) before fulfillment CP is decided.
ALTER TABLE DeliveryOrder
  ADD COLUMN destinationPending INTEGER NOT NULL DEFAULT 0
  CHECK (destinationPending IN (0, 1));
