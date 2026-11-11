-- Demo seed for PostgreSQL sales_central (idempotent).
-- Credentials:
--   admin / admin123
--   manager / manager123
--   supervisor / supervisor123
--   clerk / clerk123
--   bota_clerk / clerk123

INSERT INTO roles (id, label, is_system, sort_order)
SELECT v.id, v.label, true, v.sort_order
FROM (
  VALUES
    ('ADMIN', 'Admin', 10),
    ('MANAGER', 'Manager', 20),
    ('SENIOR_SALES_SUPERVISOR', 'Senior sales supervisor', 30),
    ('STATISTICS_CLERK', 'Statistics clerk', 40),
    ('STATISTICS_SUPERVISOR', 'Statistics supervisor', 45),
    ('STORE_KEEPER', 'Store Keeper', 50)
) AS v(id, label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = v.id);

INSERT INTO company_settings (id, company_name, department, vat_rate, fiscal_year_start_month)
SELECT 'default', 'Sales Electron Demo', 'Commercial', '0.1925', 1
WHERE NOT EXISTS (SELECT 1 FROM company_settings WHERE id = 'default');

INSERT INTO commercial_services (id, code, name, invoice_prefix, is_active, sort_order, site_kind)
SELECT 'seed-cs-001', 'MAIN', 'Main Commercial Service', 'INV', true, 0, 'SALES_POINT'
WHERE NOT EXISTS (SELECT 1 FROM commercial_services WHERE id = 'seed-cs-001');

INSERT INTO sales_points (id, name)
SELECT 1, 'Main Sales Point'
WHERE NOT EXISTS (SELECT 1 FROM sales_points WHERE id = 1);

INSERT INTO sales_points (id, name)
SELECT 2, 'BOTA Outlet'
WHERE NOT EXISTS (SELECT 1 FROM sales_points WHERE id = 2);

SELECT setval(
  pg_get_serial_sequence('sales_points', 'id'),
  GREATEST((SELECT COALESCE(MAX(id), 1) FROM sales_points), 1)
);

INSERT INTO product_cats (product_cat_id, product_cat, product_code, is_main, is_bottled)
SELECT 1, 'Palm Oil', 'PO', true, false
WHERE NOT EXISTS (SELECT 1 FROM product_cats WHERE product_cat_id = 1);

INSERT INTO product_cats (product_cat_id, product_cat, product_code, is_main, is_bottled)
SELECT 2, 'Bottled Oil', 'BO', false, true
WHERE NOT EXISTS (SELECT 1 FROM product_cats WHERE product_cat_id = 2);

SELECT setval(
  pg_get_serial_sequence('product_cats', 'product_cat_id'),
  GREATEST((SELECT COALESCE(MAX(product_cat_id), 1) FROM product_cats), 1)
);

INSERT INTO locations (location_name)
SELECT 'Main Store'
WHERE NOT EXISTS (SELECT 1 FROM locations WHERE location_name = 'Main Store');

INSERT INTO locations (location_name)
SELECT 'Bottle Oil Store'
WHERE NOT EXISTS (SELECT 1 FROM locations WHERE location_name = 'Bottle Oil Store');

INSERT INTO locations (location_name)
SELECT 'Quarantine'
WHERE NOT EXISTS (SELECT 1 FROM locations WHERE location_name = 'Quarantine');

INSERT INTO storage_locations (sales_point_id, location_id, is_default)
SELECT
  1,
  (SELECT id FROM locations WHERE location_name = 'Main Store' LIMIT 1),
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM storage_locations sl
  INNER JOIN locations l ON l.id = sl.location_id
  WHERE sl.sales_point_id = 1 AND l.location_name = 'Main Store'
);

INSERT INTO storage_locations (sales_point_id, location_id, is_default)
SELECT
  1,
  (SELECT id FROM locations WHERE location_name = 'Quarantine' LIMIT 1),
  false
WHERE NOT EXISTS (
  SELECT 1
  FROM storage_locations sl
  INNER JOIN locations l ON l.id = sl.location_id
  WHERE sl.sales_point_id = 1 AND l.location_name = 'Quarantine'
);

INSERT INTO storage_locations (sales_point_id, location_id, is_default)
SELECT
  2,
  (SELECT id FROM locations WHERE location_name = 'Bottle Oil Store' LIMIT 1),
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM storage_locations sl
  INNER JOIN locations l ON l.id = sl.location_id
  WHERE sl.sales_point_id = 2 AND l.location_name = 'Bottle Oil Store'
);

INSERT INTO products (product_id, product_name, product_code, product_cat_id, commercial_service_id, uom)
SELECT 1, 'Grade A Palm Oil', 'PO-A', 1, 'seed-cs-001', 'Kg'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE product_id = 1);

INSERT INTO products (product_id, product_name, product_code, product_cat_id, commercial_service_id, uom)
SELECT 2, 'Grade B Palm Oil', 'PO-B', 1, 'seed-cs-001', 'Kg'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE product_id = 2);

INSERT INTO products (product_id, product_name, product_code, product_cat_id, commercial_service_id, uom)
SELECT 3, '1L Bottled Palm Oil', 'BO-1L', 2, 'seed-cs-001', 'Unit'
WHERE NOT EXISTS (SELECT 1 FROM products WHERE product_id = 3);

SELECT setval(
  pg_get_serial_sequence('products', 'product_id'),
  GREATEST((SELECT COALESCE(MAX(product_id), 1) FROM products), 1)
);

INSERT INTO users (
  id, name, role, is_active, username, password_hash,
  commercial_service_id, sales_point_id
)
SELECT
  'seed-admin-001', 'Administrator', 'ADMIN', true, 'admin',
  'scrypt$09421910787e3c18b245bf531f6ca81f$5402aa4b2c5712875dde82de540f77ec1f8190bbf3949c1a77d76bcfcc76a9da7a6e4e59d844a564164083859d643bcc4ae0976d49c9f9d5ff975d0be6409ac2',
  'seed-cs-001', NULL
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'admin');

INSERT INTO users (
  id, name, role, is_active, username, password_hash,
  commercial_service_id, sales_point_id
)
SELECT
  'seed-manager-001', 'Site Manager', 'MANAGER', true, 'manager',
  'scrypt$12288f6ad293024461d18cf10693f970$a7e610263638aea44a3084594ad32551edbcb357942cb8171b204f26d460c586d61f88362952f9f6066ff31fe1a6269e2d39044a2ee4fae63a38d8ae06e73d5c',
  'seed-cs-001', 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'manager');

INSERT INTO users (
  id, name, role, is_active, username, password_hash,
  commercial_service_id, sales_point_id
)
SELECT
  'seed-supervisor-001', 'Sales Supervisor', 'SENIOR_SALES_SUPERVISOR', true, 'supervisor',
  'scrypt$28508f919ff8259a5ee8b757c6123597$77df77c45613816b77d8cfe1d273d78447554f995ffb7d99122d0aefb3fd8f981815e905bdcc6562841672bf0ae32587616af619c9544ce0aefe2e1416461a80',
  'seed-cs-001', 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'supervisor');

INSERT INTO users (
  id, name, role, is_active, username, password_hash,
  commercial_service_id, sales_point_id
)
SELECT
  'seed-clerk-001', 'Main Sales Clerk', 'STORE_KEEPER', true, 'clerk',
  'scrypt$41ea3979fd2d52e9bbf8c0f19f695be5$4f26ee04439884109e1f2f8b02fa85115f37ac1d4ad52e036667b8ac969238adcf60b81c4590cbd9543147a05363d5ef41b00241bf98693847b48b3106a4997a',
  'seed-cs-001', 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'clerk');

INSERT INTO users (
  id, name, role, is_active, username, password_hash,
  commercial_service_id, sales_point_id
)
SELECT
  'seed-clerk-bota-001', 'BOTA Sales Clerk', 'STORE_KEEPER', true, 'bota_clerk',
  'scrypt$41ea3979fd2d52e9bbf8c0f19f695be5$4f26ee04439884109e1f2f8b02fa85115f37ac1d4ad52e036667b8ac969238adcf60b81c4590cbd9543147a05363d5ef41b00241bf98693847b48b3106a4997a',
  'seed-cs-001', 2
WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = 'bota_clerk');
