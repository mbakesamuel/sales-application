-- Flag products that must not appear on delivery orders (e.g. sludge oil, palm kernel).

ALTER TABLE Product ADD COLUMN excludeFromDeliveryOrders INTEGER NOT NULL DEFAULT 0
  CHECK (excludeFromDeliveryOrders IN (0, 1));

UPDATE Product
SET excludeFromDeliveryOrders = 1
WHERE COALESCE(excludeFromDeliveryOrders, 0) = 0
  AND (
    productCatId IN (
      SELECT productCatId FROM ProductCat
      WHERE UPPER(TRIM(productCode)) IN ('PKCP', 'PKP')
    )
    OR UPPER(TRIM(COALESCE(stockIntakeGroup, ''))) IN ('PALM_KERNEL', 'SLUDGE_OIL')
    OR UPPER(productName) LIKE '%SLUDGE%'
    OR UPPER(productName) LIKE '%PALM KERNEL%'
  );
