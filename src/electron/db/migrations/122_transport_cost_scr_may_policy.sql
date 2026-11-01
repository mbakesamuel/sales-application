-- Transport cost company policy: Moliwe mill + SCR MAYA invoices (enable by default).

UPDATE CompanySettings
SET transportCostMoliweOnlyPolicy = 1
WHERE id = 'default';
