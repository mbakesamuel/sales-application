-- Bottle Oil intake is Reception (consignment note) at Bota, not receive-transfers.
-- Grant Store Keepers receipt draft/post (and adjustments) on Bottle Stock.
-- Safe to re-run.

INSERT OR IGNORE INTO RoleActionPermission (role, actionKey, allowed) VALUES
  ('STORE_KEEPER', 'draft_stock_receipts', 1),
  ('STORE_KEEPER', 'post_stock_receipts', 1),
  ('STORE_KEEPER', 'direct_post_stock_receipts', 1),
  ('STORE_KEEPER', 'draft_stock_adjustments', 1),
  ('STORE_KEEPER', 'post_stock_adjustments', 1),
  ('STORE_KEEPER', 'receive_stock_transfers', 0);

UPDATE RoleActionPermission
SET allowed = 1
WHERE role = 'STORE_KEEPER'
  AND actionKey IN (
    'draft_stock_receipts',
    'post_stock_receipts',
    'direct_post_stock_receipts',
    'draft_stock_adjustments',
    'post_stock_adjustments'
  );

UPDATE RoleActionPermission
SET allowed = 0
WHERE role = 'STORE_KEEPER'
  AND actionKey = 'receive_stock_transfers';

INSERT OR IGNORE INTO RoleRoutePermission (role, routeId, access)
VALUES ('STORE_KEEPER', 'receive-transfers', 'NONE');

UPDATE RoleRoutePermission
SET access = 'NONE'
WHERE role = 'STORE_KEEPER'
  AND routeId = 'receive-transfers';
