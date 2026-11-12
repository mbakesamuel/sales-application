SELECT MAX(id) AS customers_max_id, (SELECT last_value FROM customers_id_seq) AS customers_seq_before FROM customers;

DO $$
DECLARE
  r RECORD;
  max_id BIGINT;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name,
           pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) AS seq
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%'
  LOOP
    IF r.seq IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT COALESCE(MAX(%I), 0) FROM %I.%I', r.column_name, r.schema_name, r.table_name)
      INTO max_id;
    IF max_id > 0 THEN
      PERFORM setval(r.seq, max_id, true);
      RAISE NOTICE 'reset %.% -> %', r.table_name, r.column_name, max_id;
    END IF;
  END LOOP;
END $$;

SELECT MAX(id) AS customers_max_id, (SELECT last_value FROM customers_id_seq) AS customers_seq_after FROM customers;