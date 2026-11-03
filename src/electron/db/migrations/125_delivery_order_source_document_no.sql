-- Original paper/booklet DO number for carry-forward commitments (audit / Pick DO).
ALTER TABLE DeliveryOrder ADD COLUMN sourceDocumentNo TEXT;

-- One open CF commitment per original document number.
CREATE UNIQUE INDEX IF NOT EXISTS DeliveryOrder_cf_sourceDocumentNo_unique
  ON DeliveryOrder (sourceDocumentNo)
  WHERE sourceKind = 'CARRY_FORWARD'
    AND status IN ('PENDING', 'VALIDATED')
    AND sourceDocumentNo IS NOT NULL
    AND length(trim(sourceDocumentNo)) > 0;
