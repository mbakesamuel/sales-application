-- Bottle Stock Reception: mill consignment paperwork fields (parity with stock_transfers).

ALTER TABLE stock_receipts
  ADD COLUMN IF NOT EXISTS consignment_note_no TEXT,
  ADD COLUMN IF NOT EXISTS consigned_by TEXT,
  ADD COLUMN IF NOT EXISTS cons_design TEXT,
  ADD COLUMN IF NOT EXISTS cons_date TEXT,
  ADD COLUMN IF NOT EXISTS receive_by TEXT,
  ADD COLUMN IF NOT EXISTS receive_by_design TEXT,
  ADD COLUMN IF NOT EXISTS receive_date TEXT;
