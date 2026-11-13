-- Retire leftover central SalesPointPostingMonth (salesPointId IS NULL).
-- Head-office open months are personal UserPostingMonth rows only.

DELETE FROM SalesPointPostingMonth
WHERE salesPointId IS NULL;
