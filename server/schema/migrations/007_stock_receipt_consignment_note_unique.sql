-- Consignment # on Bottle Oil receipts must be unique when present (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS stock_receipts_consignment_note_no_uidx
ON stock_receipts (lower(btrim(consignment_note_no)))
WHERE consignment_note_no IS NOT NULL AND btrim(consignment_note_no) <> '';
