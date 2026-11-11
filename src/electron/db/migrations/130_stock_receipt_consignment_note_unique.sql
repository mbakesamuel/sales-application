-- Consignment # on Bottle Oil receipts must be unique when present (case-insensitive).
-- Multiple NULLs remain allowed for loose receipts that omit the field.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_receipt_consignment_note_no_unique
ON StockReceipt (consignmentNoteNo COLLATE NOCASE)
WHERE consignmentNoteNo IS NOT NULL AND length(trim(consignmentNoteNo)) > 0;
