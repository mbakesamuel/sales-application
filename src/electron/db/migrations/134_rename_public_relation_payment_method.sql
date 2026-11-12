-- Drop "(complimentary)" from the Public relation payment method label.
UPDATE PaymentMethodDefinition
SET
  name = 'Public relation',
  updatedAt = datetime('now')
WHERE id = 'sys-pm-public-relation'
  AND name = 'Public relation (complimentary)';
