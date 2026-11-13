-- Retire leftover central SalesPointPostingMonth (sales_point_id IS NULL).
-- Head-office open months are personal UserPostingMonth rows only.

DELETE FROM sales_point_posting_months
WHERE sales_point_id IS NULL;
