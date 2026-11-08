-- Bottle Stock Reception captures mill consignment paperwork (parity with transfer fields).
-- Safe to re-run via ADD COLUMN IF NOT EXISTS pattern is not available in older SQLite;
-- use ALTER and ignore duplicate-column failures via migration runner, or check pragma.

ALTER TABLE StockReceipt ADD COLUMN consignmentNoteNo TEXT;
ALTER TABLE StockReceipt ADD COLUMN consignedBy TEXT;
ALTER TABLE StockReceipt ADD COLUMN consDesign TEXT;
ALTER TABLE StockReceipt ADD COLUMN consDate TEXT;
ALTER TABLE StockReceipt ADD COLUMN receiveBy TEXT;
ALTER TABLE StockReceipt ADD COLUMN receiveByDesign TEXT;
ALTER TABLE StockReceipt ADD COLUMN receiveDate TEXT;
