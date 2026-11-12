-- Drop "(complimentary)" from the Public relation payment method label.
UPDATE payment_method_definitions
SET
  name = 'Public relation',
  updated_at = NOW()
WHERE id = 'sys-pm-public-relation'
  AND name = 'Public relation (complimentary)';
