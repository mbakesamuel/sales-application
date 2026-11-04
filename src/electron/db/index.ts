import Database from "better-sqlite3";
import { app } from "electron";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedDefaultPermissions } from "../auth/permissions/service.js";
import { loadAppSettings } from "../config/appSettings.js";
import { applyStockIntakeProductBackfill } from "../stock/stockIntakeMigration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

function getMigrationsDir(): string {
  return path.join(__dirname, "migrations");
}

function isCustomerIdInteger(database: Database.Database): boolean {
  const row = database
    .prepare("SELECT type FROM pragma_table_info('Customer') WHERE name = 'id'")
    .get() as { type: string } | undefined;

  return row?.type.toUpperCase().includes("INT") ?? false;
}

function salesPointHasPeriodColumns(database: Database.Database): boolean {
  const row = database
    .prepare(
      `SELECT 1 FROM pragma_table_info('SalesPoint') WHERE name = 'workingCalendarYear' LIMIT 1`,
    )
    .get();

  return row != null;
}

function salesPointHasTimestamps(database: Database.Database): boolean {
  const columns = getTableColumns(database, "SalesPoint");
  return columns.has("createdAt") && columns.has("updatedAt");
}

function recoverSalesPointTable(database: Database.Database): void {
  const salesPoint = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'SalesPoint' LIMIT 1`,
    )
    .get();
  const salesPointNew = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'SalesPoint__new' LIMIT 1`,
    )
    .get();

  if (!salesPoint && salesPointNew) {
    database.exec(`
      ALTER TABLE SalesPoint__new RENAME TO SalesPoint;
      CREATE INDEX IF NOT EXISTS SalesPoint_mill_idx ON SalesPoint (millId);
    `);
  }
}

function getTableColumns(database: Database.Database, table: string): Set<string> {
  return new Set(
    database
      .prepare(`SELECT name FROM pragma_table_info(?)`)
      .all(table)
      .map((row) => (row as { name: string }).name),
  );
}

function tableExists(database: Database.Database, table: string): boolean {
  const row = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(table);
  return row != null;
}

function applySalesPointSimplifyMigration(database: Database.Database): void {
  recoverSalesPointTable(database);

  database.exec(`
    DROP INDEX IF EXISTS SalesPoint_workingMonthSetBy_idx;
    DROP TABLE IF EXISTS SalesPoint__new;
  `);

  const columns = getTableColumns(database, "SalesPoint");
  const periodColumns = [
    "workingCalendarYear",
    "workingCalendarMonth",
    "workingFinancialYear",
    "workingMonthSetAt",
    "workingMonthSetById",
  ];

  for (const column of periodColumns) {
    if (columns.has(column)) {
      database.exec(`ALTER TABLE SalesPoint DROP COLUMN ${column}`);
    }
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const refreshedColumns = getTableColumns(database, "SalesPoint");

  if (!refreshedColumns.has("createdAt")) {
    database.exec(`ALTER TABLE SalesPoint ADD COLUMN createdAt TEXT`);
    database.prepare(`UPDATE SalesPoint SET createdAt = ? WHERE createdAt IS NULL`).run(now);
  }

  if (!getTableColumns(database, "SalesPoint").has("updatedAt")) {
    database.exec(`ALTER TABLE SalesPoint ADD COLUMN updatedAt TEXT`);
    database.prepare(`UPDATE SalesPoint SET updatedAt = ? WHERE updatedAt IS NULL`).run(now);
  }
}

function applyLocationMasterMigration(database: Database.Database): void {
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  database.exec(`
    CREATE TABLE IF NOT EXISTS Location (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      locationName TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
      updatedAt TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'
    );
  `);

  database.prepare(
    `UPDATE Location SET createdAt = ? WHERE createdAt IS NULL OR createdAt = '1970-01-01 00:00:00'`,
  ).run(now);
  database.prepare(
    `UPDATE Location SET updatedAt = ? WHERE updatedAt IS NULL OR updatedAt = '1970-01-01 00:00:00'`,
  ).run(now);

  const storageColumns = getTableColumns(database, "StorageLocation");
  if (!storageColumns.has("name")) {
    if (!storageColumns.has("locationId")) {
      throw new Error("StorageLocation is missing both name and locationId.");
    }
    return;
  }

  const distinctNames = database
    .prepare(
      `SELECT DISTINCT name FROM StorageLocation WHERE name IS NOT NULL AND TRIM(name) != ''`,
    )
    .all() as Array<{ name: string }>;

  const insertLocation = database.prepare(`
    INSERT INTO Location (locationName, createdAt, updatedAt)
    SELECT ?, ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM Location WHERE locationName = ?)
  `);

  for (const row of distinctNames) {
    insertLocation.run(row.name, now, now, row.name);
  }

  if (!storageColumns.has("locationId")) {
    database.exec(
      `ALTER TABLE StorageLocation ADD COLUMN locationId INTEGER REFERENCES Location(id)`,
    );
  }

  database.exec(`
    UPDATE StorageLocation
    SET locationId = (
      SELECT l.id FROM Location l WHERE l.locationName = StorageLocation.name LIMIT 1
    )
    WHERE locationId IS NULL
  `);

  const orphan = database
    .prepare(`SELECT COUNT(*) AS count FROM StorageLocation WHERE locationId IS NULL`)
    .get() as { count: number };

  if (orphan.count > 0) {
    throw new Error("StorageLocation rows could not be linked to Location.");
  }

  database.pragma("foreign_keys = OFF");
  database.exec(`
    DROP TABLE IF EXISTS StorageLocation__new;
    CREATE TABLE StorageLocation__new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesPointId INTEGER NOT NULL REFERENCES SalesPoint(id) ON DELETE CASCADE,
      locationId INTEGER NOT NULL REFERENCES Location(id) ON DELETE RESTRICT,
      createdAt TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
      updatedAt TEXT NOT NULL DEFAULT '1970-01-01 00:00:00',
      isDefault INTEGER NOT NULL DEFAULT 0 CHECK (isDefault IN (0, 1)),
      isSellable INTEGER NOT NULL DEFAULT 1 CHECK (isSellable IN (0, 1)),
      UNIQUE (salesPointId, locationId)
    );

    INSERT INTO StorageLocation__new (
      id, salesPointId, locationId, createdAt, updatedAt, isDefault, isSellable
    )
    SELECT
      id,
      salesPointId,
      locationId,
      COALESCE(createdAt, datetime('now')),
      COALESCE(updatedAt, datetime('now')),
      isDefault,
      isSellable
    FROM StorageLocation;

    DROP TABLE StorageLocation;
    ALTER TABLE StorageLocation__new RENAME TO StorageLocation;
    CREATE INDEX IF NOT EXISTS StorageLocation_salesPoint_idx ON StorageLocation (salesPointId);
    CREATE INDEX IF NOT EXISTS StorageLocation_location_idx ON StorageLocation (locationId);
  `);
  database.pragma("foreign_keys = ON");
}

function locationSchemaIsCurrent(database: Database.Database): boolean {
  const locationTable = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Location' LIMIT 1`,
    )
    .get();

  if (!locationTable) {
    return false;
  }

  const storageColumns = getTableColumns(database, "StorageLocation");
  return storageColumns.has("locationId") && !storageColumns.has("name");
}

function storageLocationHasMillOwner(database: Database.Database): boolean {
  return getTableColumns(database, "StorageLocation").has("millId");
}

function applyStorageLocationMillOwnerMigration(database: Database.Database): void {
  if (storageLocationHasMillOwner(database)) {
    return;
  }

  database.pragma("foreign_keys = OFF");
  database.exec(`
    DROP TABLE IF EXISTS StorageLocation__new;
    CREATE TABLE StorageLocation__new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salesPointId INTEGER REFERENCES SalesPoint(id) ON DELETE CASCADE,
      millId INTEGER REFERENCES Mill(id) ON DELETE CASCADE,
      locationId INTEGER NOT NULL REFERENCES Location(id) ON DELETE RESTRICT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      isDefault INTEGER NOT NULL DEFAULT 0 CHECK (isDefault IN (0, 1)),
      isSellable INTEGER NOT NULL DEFAULT 1 CHECK (isSellable IN (0, 1)),
      isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1)),
      CHECK (
        (millId IS NOT NULL AND salesPointId IS NULL)
        OR (millId IS NULL AND salesPointId IS NOT NULL)
      )
    );

    INSERT INTO StorageLocation__new (
      id, salesPointId, millId, locationId, createdAt, updatedAt, isDefault, isSellable, isActive
    )
    SELECT
      id,
      salesPointId,
      NULL,
      locationId,
      COALESCE(createdAt, datetime('now')),
      COALESCE(updatedAt, datetime('now')),
      isDefault,
      isSellable,
      1
    FROM StorageLocation;

    DROP TABLE StorageLocation;
    ALTER TABLE StorageLocation__new RENAME TO StorageLocation;

    CREATE INDEX IF NOT EXISTS StorageLocation_salesPoint_idx ON StorageLocation (salesPointId);
    CREATE INDEX IF NOT EXISTS StorageLocation_mill_idx ON StorageLocation (millId);
    CREATE INDEX IF NOT EXISTS StorageLocation_location_idx ON StorageLocation (locationId);
    CREATE UNIQUE INDEX IF NOT EXISTS StorageLocation_salesPoint_location_unique
      ON StorageLocation (salesPointId, locationId)
      WHERE salesPointId IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS StorageLocation_mill_location_unique
      ON StorageLocation (millId, locationId)
      WHERE millId IS NOT NULL;
    CREATE INDEX IF NOT EXISTS StorageLocation_isActive_idx ON StorageLocation (isActive);
  `);
  database.pragma("foreign_keys = ON");
}

const LEGACY_ROLE_MAP: Record<string, string> = {
  ADMIN: "ADMIN",
  DIRECTOR: "MANAGER",
  MANAGER: "MANAGER",
  OFFICER: "STORE_KEEPER",
  SENIOR_SUPERVISOR: "SENIOR_SALES_SUPERVISOR",
  SUPERVISOR: "SENIOR_SALES_SUPERVISOR",
  CLERK: "STORE_KEEPER",
  SALES_CLERK: "STORE_KEEPER",
  STATISTICS_SUPERVISOR: "STATISTICS_CLERK",
};

function rolesSchemaIsCurrent(database: Database.Database): boolean {
  const legacyTables = [
    "GlobalRoleDefinition",
    "RolePermission",
    "GlobalRolePermission",
    "CommercialServiceRole",
    "CommercialServiceRolePermission",
  ];

  for (const tableName of legacyTables) {
    const row = database
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      )
      .get(tableName);

    if (row) {
      return false;
    }
  }

  const userColumns = getTableColumns(database, "User");
  if (
    userColumns.has("globalRoleDefinitionId") ||
    userColumns.has("commercialServiceRoleId")
  ) {
    return false;
  }

  const createSqlRow = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'User'`)
    .get() as { sql: string } | undefined;

  return createSqlRow?.sql.includes("SENIOR_SALES_SUPERVISOR") ?? false;
}

function applySimplifiedRolesMigration(database: Database.Database): void {
  for (const [oldRole, newRole] of Object.entries(LEGACY_ROLE_MAP)) {
    if (oldRole !== newRole) {
      database.prepare(`UPDATE User SET role = ? WHERE role = ?`).run(newRole, oldRole);
    }
  }

  database.prepare(`
    UPDATE User
    SET role = 'STORE_KEEPER'
    WHERE role NOT IN (
      'ADMIN',
      'MANAGER',
      'SENIOR_SALES_SUPERVISOR',
      'STATISTICS_CLERK',
      'STORE_KEEPER'
    )
  `).run();

  database.pragma("foreign_keys = OFF");
  database.exec(`
    DROP INDEX IF EXISTS User_commercialServiceRole_idx;
    DROP INDEX IF EXISTS RolePermission_key_idx;
    DROP INDEX IF EXISTS GlobalRolePermission_key_idx;
    DROP INDEX IF EXISTS CommercialServiceRolePermission_key_idx;
    DROP INDEX IF EXISTS CommercialServiceRole_service_active_idx;

    DROP TABLE IF EXISTS CommercialServiceRolePermission;
    DROP TABLE IF EXISTS GlobalRolePermission;
    DROP TABLE IF EXISTS RolePermission;
    DROP TABLE IF EXISTS GlobalRoleDefinition;
    DROP TABLE IF EXISTS CommercialServiceRole;
  `);

  const userColumns = getTableColumns(database, "User");
  if (
    userColumns.has("commercialServiceRoleId") ||
    userColumns.has("globalRoleDefinitionId") ||
    !rolesSchemaIsCurrent(database)
  ) {
    const mustChangeSelect = userColumns.has("mustChangePassword")
      ? "COALESCE(mustChangePassword, 0)"
      : "0";

    database.exec(`
      DROP TABLE IF EXISTS User__new;
      CREATE TABLE User__new (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'STORE_KEEPER' CHECK (role IN ('ADMIN','MANAGER','SENIOR_SALES_SUPERVISOR','STATISTICS_CLERK','STORE_KEEPER')),
        isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1)),
        username TEXT NOT NULL UNIQUE,
        passwordPlain TEXT,
        salesPointId INTEGER REFERENCES SalesPoint(id),
        passwordHash TEXT,
        mustChangePassword INTEGER NOT NULL DEFAULT 0 CHECK (mustChangePassword IN (0, 1)),
        commercialServiceId TEXT REFERENCES CommercialService(id),
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO User__new (
        id,
        name,
        role,
        isActive,
        username,
        passwordPlain,
        salesPointId,
        passwordHash,
        mustChangePassword,
        commercialServiceId,
        createdAt,
        updatedAt
      )
      SELECT
        id,
        name,
        role,
        isActive,
        username,
        passwordPlain,
        salesPointId,
        passwordHash,
        ${mustChangeSelect},
        commercialServiceId,
        createdAt,
        updatedAt
      FROM User;

      DROP TABLE User;
      ALTER TABLE User__new RENAME TO User;

      CREATE INDEX IF NOT EXISTS User_commercialService_idx ON User (commercialServiceId);
    `);
  }

  database.pragma("foreign_keys = ON");
}

function permissionsSchemaIsCurrent(database: Database.Database): boolean {
  const routeTable = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'RoleRoutePermission' LIMIT 1`,
    )
    .get();
  const actionTable = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'RoleActionPermission' LIMIT 1`,
    )
    .get();

  if (!routeTable || !actionTable) {
    return false;
  }

  const count = database
    .prepare(`SELECT COUNT(*) AS count FROM RoleRoutePermission`)
    .get() as { count: number };

  return count.count > 0;
}

function applyRolePermissionsMigration(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS RoleRoutePermission (
      role TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','SENIOR_SALES_SUPERVISOR','STATISTICS_CLERK','STORE_KEEPER')),
      routeId TEXT NOT NULL,
      access TEXT NOT NULL DEFAULT 'NONE' CHECK (access IN ('NONE', 'READ', 'WRITE')),
      PRIMARY KEY (role, routeId)
    );

    CREATE TABLE IF NOT EXISTS RoleActionPermission (
      role TEXT NOT NULL CHECK (role IN ('ADMIN','MANAGER','SENIOR_SALES_SUPERVISOR','STATISTICS_CLERK','STORE_KEEPER')),
      actionKey TEXT NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 0 CHECK (allowed IN (0, 1)),
      PRIMARY KEY (role, actionKey)
    );
  `);

  seedDefaultPermissions(database);
}

function applyDropEmployeeMigration(database: Database.Database): void {
  database.exec(`
    DELETE FROM RoleRoutePermission WHERE routeId = 'employees';
    DROP INDEX IF EXISTS Employee_name_idx;
    DROP INDEX IF EXISTS Employee_estate_idx;
    DROP TABLE IF EXISTS Employee;
  `);
}

function employeeTableExists(database: Database.Database): boolean {
  const row = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Employee' LIMIT 1`,
    )
    .get();

  return row != null;
}

function companySettingsThemesAreCurrent(database: Database.Database): boolean {
  return companySettingsAgroDarkAreCurrent(database);
}

function companySettingsAgroDarkAreCurrent(database: Database.Database): boolean {
  const row = database
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'CompanySettings'`,
    )
    .get() as { sql: string } | undefined;

  const sql = row?.sql ?? "";
  return sql.includes("'agro'") && !sql.includes("'solarized'");
}

function taxTablesAreCompressed(database: Database.Database): boolean {
  const taxType = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'TaxType' LIMIT 1`,
    )
    .get();
  if (taxType) {
    return false;
  }

  const columns = getTableColumns(database, "TaxRegime");
  return columns.has("kind") && !columns.has("vatApplies");
}

function applyCompressTaxTablesMigration(database: Database.Database): void {
  database.pragma("foreign_keys = OFF");

  database.exec(`
    DELETE FROM RoleRoutePermission
    WHERE routeId IN ('tax-types', 'tax-rate-schedules', 'tax-regime-taxes');
  `);

  const taxRegimeColumns = getTableColumns(database, "TaxRegime");
  const hasVatApplies = taxRegimeColumns.has("vatApplies");

  if (hasVatApplies) {
    database.exec(`
      INSERT INTO TaxRegime (id, name, vatApplies, kind, commercialServiceId, createdAt, updatedAt)
      SELECT 'tax-regime-actual', 'Actual', 1, 'REAL', NULL, datetime('now'), datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM TaxRegime WHERE id = 'tax-regime-actual');

      INSERT INTO TaxRegime (id, name, vatApplies, kind, commercialServiceId, createdAt, updatedAt)
      SELECT 'tax-regime-simplified', 'Simplified', 1, 'SIMPLIFIED', NULL, datetime('now'), datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM TaxRegime WHERE id = 'tax-regime-simplified');
    `);
  } else {
    database.exec(`
      INSERT INTO TaxRegime (id, name, kind, commercialServiceId, createdAt, updatedAt)
      SELECT 'tax-regime-actual', 'Actual', 'REAL', NULL, datetime('now'), datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM TaxRegime WHERE id = 'tax-regime-actual');

      INSERT INTO TaxRegime (id, name, kind, commercialServiceId, createdAt, updatedAt)
      SELECT 'tax-regime-simplified', 'Simplified', 'SIMPLIFIED', NULL, datetime('now'), datetime('now')
      WHERE NOT EXISTS (SELECT 1 FROM TaxRegime WHERE id = 'tax-regime-simplified');
    `);
  }

  database.exec(`
    UPDATE Customer
    SET taxRegimeId = 'tax-regime-actual'
    WHERE taxRegimeId IN (
      SELECT id FROM TaxRegime WHERE kind = 'REAL' AND id != 'tax-regime-actual'
    );

    UPDATE Customer
    SET taxRegimeId = 'tax-regime-simplified'
    WHERE taxRegimeId IN (
      SELECT id FROM TaxRegime WHERE kind = 'SIMPLIFIED' AND id != 'tax-regime-simplified'
    );

    UPDATE Customer
    SET taxRegimeId = 'tax-regime-simplified'
    WHERE taxRegimeId IS NULL
       OR taxRegimeId NOT IN (SELECT id FROM TaxRegime);

    UPDATE Sale
    SET taxRegimeId = 'tax-regime-actual'
    WHERE taxRegimeId IN (
      SELECT id FROM TaxRegime WHERE kind = 'REAL' AND id != 'tax-regime-actual'
    );

    UPDATE Sale
    SET taxRegimeId = 'tax-regime-simplified'
    WHERE taxRegimeId IS NULL
       OR taxRegimeId IN (
         SELECT id FROM TaxRegime WHERE kind = 'SIMPLIFIED' AND id != 'tax-regime-simplified'
       )
       OR taxRegimeId NOT IN ('tax-regime-actual', 'tax-regime-simplified');

    DELETE FROM TaxRegime
    WHERE id NOT IN ('tax-regime-actual', 'tax-regime-simplified');

    UPDATE TaxRegime SET name = 'Actual', kind = 'REAL' WHERE id = 'tax-regime-actual';
    UPDATE TaxRegime SET name = 'Simplified', kind = 'SIMPLIFIED' WHERE id = 'tax-regime-simplified';

    DROP TABLE IF EXISTS TaxRegimeTax;
    DROP TABLE IF EXISTS TaxRateSchedule;
    DROP TABLE IF EXISTS TaxType;
  `);

  database.exec(`
    DROP TABLE IF EXISTS SaleAppliedTax__new;
    CREATE TABLE SaleAppliedTax__new (
      id TEXT PRIMARY KEY NOT NULL,
      saleId TEXT NOT NULL REFERENCES Sale(id) ON DELETE CASCADE,
      taxTypeId TEXT,
      codeSnapshot TEXT NOT NULL,
      labelSnapshot TEXT NOT NULL,
      rateSnapshot TEXT NOT NULL,
      amount TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO SaleAppliedTax__new (
      id, saleId, taxTypeId, codeSnapshot, labelSnapshot, rateSnapshot, amount, createdAt
    )
    SELECT id, saleId, taxTypeId, codeSnapshot, labelSnapshot, rateSnapshot, amount, createdAt
    FROM SaleAppliedTax;

    DROP TABLE SaleAppliedTax;
    ALTER TABLE SaleAppliedTax__new RENAME TO SaleAppliedTax;
    CREATE INDEX IF NOT EXISTS SaleAppliedTax_sale_idx ON SaleAppliedTax (saleId);
  `);

  if (hasVatApplies || !taxTablesAreCompressed(database)) {
    database.exec(`
      DROP TABLE IF EXISTS TaxRegime__new;
      CREATE TABLE TaxRegime__new (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        kind TEXT NOT NULL DEFAULT 'SIMPLIFIED' CHECK (kind IN ('SIMPLIFIED', 'REAL')),
        commercialServiceId TEXT REFERENCES CommercialService(id),
        UNIQUE (commercialServiceId, name)
      );

      INSERT INTO TaxRegime__new (id, name, createdAt, updatedAt, kind, commercialServiceId)
      SELECT id, name, createdAt, updatedAt, kind, commercialServiceId
      FROM TaxRegime;

      DROP TABLE TaxRegime;
      ALTER TABLE TaxRegime__new RENAME TO TaxRegime;
      CREATE INDEX IF NOT EXISTS TaxRegime_service_idx ON TaxRegime (commercialServiceId);
    `);
  }

  database.pragma("foreign_keys = ON");
}

function applyCompanySettingsThemesMigration(database: Database.Database): void {
  applyCompanySettingsAgroDarkMigration(database);
}

function applyCompanySettingsAgroDarkMigration(database: Database.Database): void {
  database.pragma("foreign_keys = OFF");
  database.exec(`
    DROP TABLE IF EXISTS CompanySettings__new;
    CREATE TABLE CompanySettings__new (
      id TEXT PRIMARY KEY NOT NULL DEFAULT 'default',
      companyName TEXT NOT NULL,
      department TEXT,
      vatRate TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      fiscalYearStartMonth INTEGER NOT NULL DEFAULT 1,
      logoUrl TEXT,
      uiThemePreset TEXT NOT NULL DEFAULT 'agro'
        CHECK (uiThemePreset IN ('agro', 'dark'))
    );

    INSERT INTO CompanySettings__new (
      id,
      companyName,
      department,
      vatRate,
      createdAt,
      updatedAt,
      fiscalYearStartMonth,
      logoUrl,
      uiThemePreset
    )
    SELECT
      id,
      companyName,
      department,
      vatRate,
      createdAt,
      updatedAt,
      fiscalYearStartMonth,
      logoUrl,
      CASE uiThemePreset
        WHEN 'dark' THEN 'dark'
        ELSE 'agro'
      END
    FROM CompanySettings;

    DROP TABLE CompanySettings;
    ALTER TABLE CompanySettings__new RENAME TO CompanySettings;
  `);
  database.pragma("foreign_keys = ON");
}

const USER_TABLE_COLUMN_ORDER = [
  "id",
  "name",
  "role",
  "isActive",
  "username",
  "passwordPlain",
  "salesPointId",
  "passwordHash",
  "mustChangePassword",
  "commercialServiceId",
  "createdAt",
  "updatedAt",
] as const;

function userSchemaIsCurrent(database: Database.Database): boolean {
  const columns = database
    .prepare(`SELECT name FROM pragma_table_info('User') ORDER BY cid`)
    .all() as { name: string }[];
  const names = columns.map((column) => column.name);
  return names.join(",") === USER_TABLE_COLUMN_ORDER.join(",");
}

function manageableRolesSchemaIsCurrent(database: Database.Database): boolean {
  const roleTable = database
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Role' LIMIT 1`,
    )
    .get();
  if (!roleTable) {
    return false;
  }

  const userSql = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'User'`)
    .get() as { sql: string } | undefined;
  const routeSql = database
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'RoleRoutePermission'`,
    )
    .get() as { sql: string } | undefined;

  const userOk = Boolean(userSql?.sql) && !userSql!.sql.includes("CHECK (role IN");
  const routeOk =
    Boolean(routeSql?.sql) && !routeSql!.sql.includes("CHECK (role IN");
  return userOk && routeOk;
}

function applyManageableRolesMigration(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS Role (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      isSystem INTEGER NOT NULL DEFAULT 0 CHECK (isSystem IN (0, 1)),
      sortOrder INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const seedRole = database.prepare(`
    INSERT OR IGNORE INTO Role (id, label, isSystem, sortOrder, createdAt, updatedAt)
    VALUES (?, ?, 1, ?, datetime('now'), datetime('now'))
  `);
  const systemRoles: Array<[string, string, number]> = [
    ["ADMIN", "Admin", 10],
    ["MANAGER", "Manager", 20],
    ["SENIOR_SALES_SUPERVISOR", "Senior sales supervisor", 30],
    ["STATISTICS_CLERK", "Statistics clerk", 40],
    ["STATISTICS_SUPERVISOR", "Statistics supervisor", 45],
    ["STORE_KEEPER", "Store Keeper", 50],
  ];
  for (const [id, label, sortOrder] of systemRoles) {
    seedRole.run(id, label, sortOrder);
  }

  const userRoles = database
    .prepare(`SELECT DISTINCT role FROM User`)
    .all() as Array<{ role: string }>;
  const insertCustom = database.prepare(`
    INSERT OR IGNORE INTO Role (id, label, isSystem, sortOrder, createdAt, updatedAt)
    VALUES (?, ?, 0, ?, datetime('now'), datetime('now'))
  `);
  let customSort = 100;
  for (const row of userRoles) {
    const roleId = String(row.role ?? "").trim();
    if (!roleId) {
      continue;
    }
    const exists = database.prepare(`SELECT id FROM Role WHERE id = ?`).get(roleId);
    if (!exists) {
      insertCustom.run(roleId, roleId.replace(/_/g, " "), customSort);
      customSort += 10;
    }
  }

  database.pragma("foreign_keys = OFF");

  database.exec(`
    DROP TABLE IF EXISTS RoleRoutePermission__new;
    CREATE TABLE RoleRoutePermission__new (
      role TEXT NOT NULL REFERENCES Role(id) ON DELETE CASCADE,
      routeId TEXT NOT NULL,
      access TEXT NOT NULL DEFAULT 'NONE' CHECK (access IN ('NONE', 'READ', 'WRITE')),
      PRIMARY KEY (role, routeId)
    );
    INSERT INTO RoleRoutePermission__new (role, routeId, access)
    SELECT role, routeId, access FROM RoleRoutePermission;
    DROP TABLE RoleRoutePermission;
    ALTER TABLE RoleRoutePermission__new RENAME TO RoleRoutePermission;

    DROP TABLE IF EXISTS RoleActionPermission__new;
    CREATE TABLE RoleActionPermission__new (
      role TEXT NOT NULL REFERENCES Role(id) ON DELETE CASCADE,
      actionKey TEXT NOT NULL,
      allowed INTEGER NOT NULL DEFAULT 0 CHECK (allowed IN (0, 1)),
      PRIMARY KEY (role, actionKey)
    );
    INSERT INTO RoleActionPermission__new (role, actionKey, allowed)
    SELECT role, actionKey, allowed FROM RoleActionPermission;
    DROP TABLE RoleActionPermission;
    ALTER TABLE RoleActionPermission__new RENAME TO RoleActionPermission;
  `);

  const userColumns = getTableColumns(database, "User");
  const mustChangeSelect = userColumns.has("mustChangePassword")
    ? "COALESCE(mustChangePassword, 0)"
    : "0";

  database.exec(`
    DROP TABLE IF EXISTS User__new;
    CREATE TABLE User__new (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'STORE_KEEPER' REFERENCES Role(id),
      isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1)),
      username TEXT NOT NULL UNIQUE,
      passwordPlain TEXT,
      salesPointId INTEGER REFERENCES SalesPoint(id),
      passwordHash TEXT,
      mustChangePassword INTEGER NOT NULL DEFAULT 0 CHECK (mustChangePassword IN (0, 1)),
      commercialServiceId TEXT REFERENCES CommercialService(id),
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO User__new (
      id, name, role, isActive, username, passwordPlain, salesPointId,
      passwordHash, mustChangePassword, commercialServiceId, createdAt, updatedAt
    )
    SELECT
      id, name, role, isActive, username, passwordPlain, salesPointId,
      passwordHash, ${mustChangeSelect}, commercialServiceId, createdAt, updatedAt
    FROM User;

    DROP TABLE User;
    ALTER TABLE User__new RENAME TO User;
    CREATE INDEX IF NOT EXISTS User_commercialService_idx ON User (commercialServiceId);
  `);

  database.pragma("foreign_keys = ON");
}

/** True when ProductSalesBudget is already keyed by productCatId (fresh 001_init or migrated). */
function budgetByProductCatIsCurrent(database: Database.Database): boolean {
  const budgetCols = getTableColumns(database, "ProductSalesBudget");
  const phaseCols = getTableColumns(database, "ProductSalesBudgetMonthPhaseProfile");
  return (
    budgetCols.has("productCatId") &&
    !budgetCols.has("productId") &&
    phaseCols.has("productCatId") &&
    !phaseCols.has("productId")
  );
}

function deliveryOrderHasSourceKind(database: Database.Database): boolean {
  return getTableColumns(database, "DeliveryOrder").has("sourceKind");
}

function stockAdjustmentHasSourceKind(database: Database.Database): boolean {
  return getTableColumns(database, "StockAdjustment").has("sourceKind");
}

function companySettingsHasHideZeroReportRows(database: Database.Database): boolean {
  return getTableColumns(database, "CompanySettings").has("hideZeroReportRows");
}

function companySettingsHasStockCommitmentComments(database: Database.Database): boolean {
  return getTableColumns(database, "CompanySettings").has("stockCommitmentReportComments");
}

function companySettingsHasReportCommentsJson(database: Database.Database): boolean {
  return getTableColumns(database, "CompanySettings").has("reportCommentsJson");
}

function userHasMustChangePassword(database: Database.Database): boolean {
  return getTableColumns(database, "User").has("mustChangePassword");
}

function stockTransferHasConsignmentFields(database: Database.Database): boolean {
  return getTableColumns(database, "StockTransfer").has("consignedBy");
}

function deliveryOrderTransferSchemaIsCurrent(database: Database.Database): boolean {
  return (
    getTableColumns(database, "DeliveryOrder").has("transferredFromDeliveryOrderId") &&
    tableExists(database, "DeliveryOrderTransfer") &&
    tableExists(database, "DeliveryOrderTransferLine")
  );
}

function millHasIsActive(database: Database.Database): boolean {
  return tableExists(database, "Mill") && getTableColumns(database, "Mill").has("isActive");
}

function millLayerPresent(database: Database.Database): boolean {
  if (tableExists(database, "Mill")) {
    return true;
  }
  return (
    (tableExists(database, "SalesPoint") &&
      getTableColumns(database, "SalesPoint").has("millId")) ||
    (tableExists(database, "StorageLocation") &&
      getTableColumns(database, "StorageLocation").has("millId"))
  );
}

function deleteRowsForMillOwnedLocations(
  database: Database.Database,
  table: string,
  column: string,
): void {
  if (!tableExists(database, table) || !getTableColumns(database, table).has(column)) {
    return;
  }
  database
    .prepare(
      `DELETE FROM ${table}
       WHERE ${column} IN (SELECT id FROM StorageLocation WHERE millId IS NOT NULL)`,
    )
    .run();
}

function applyDropMillLayerMigration(database: Database.Database): void {
  if (!millLayerPresent(database)) {
    return;
  }

  database.pragma("foreign_keys = OFF");

  if (getTableColumns(database, "StorageLocation").has("millId")) {
    if (
      tableExists(database, "SaleLine") &&
      getTableColumns(database, "SaleLine").has("storageLocationId")
    ) {
      database.exec(`
        UPDATE SaleLine
        SET storageLocationId = NULL
        WHERE storageLocationId IN (
          SELECT id FROM StorageLocation WHERE millId IS NOT NULL
        )
      `);
    }

    deleteRowsForMillOwnedLocations(database, "StockBalance", "storageLocationId");
    deleteRowsForMillOwnedLocations(database, "StockMovement", "storageLocationId");
    deleteRowsForMillOwnedLocations(database, "StockReceiptLine", "storageLocationId");
    deleteRowsForMillOwnedLocations(database, "StockAdjustmentLine", "storageLocationId");
    deleteRowsForMillOwnedLocations(database, "StockTransferLine", "fromStorageLocationId");
    deleteRowsForMillOwnedLocations(database, "StockTransferLine", "toStorageLocationId");

    database.exec(`DELETE FROM StorageLocation WHERE millId IS NOT NULL`);
  }

  if (getTableColumns(database, "SalesPoint").has("millId")) {
    const hasIsActive = getTableColumns(database, "SalesPoint").has("isActive");
    database.exec(`
      DROP TABLE IF EXISTS SalesPoint__new;
      CREATE TABLE SalesPoint__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        ${hasIsActive ? "isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1))," : ""}
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO SalesPoint__new (
        id, name, ${hasIsActive ? "isActive, " : ""}createdAt, updatedAt
      )
      SELECT
        id,
        name,
        ${hasIsActive ? "COALESCE(isActive, 1)," : ""}
        COALESCE(createdAt, datetime('now')),
        COALESCE(updatedAt, datetime('now'))
      FROM SalesPoint;

      DROP TABLE SalesPoint;
      ALTER TABLE SalesPoint__new RENAME TO SalesPoint;
      ${hasIsActive ? "CREATE INDEX IF NOT EXISTS SalesPoint_isActive_idx ON SalesPoint (isActive);" : ""}
    `);
  }

  if (getTableColumns(database, "StorageLocation").has("millId")) {
    const hasIsActive = getTableColumns(database, "StorageLocation").has("isActive");
    database.exec(`
      DROP TABLE IF EXISTS StorageLocation__new;
      CREATE TABLE StorageLocation__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        salesPointId INTEGER NOT NULL REFERENCES SalesPoint(id) ON DELETE CASCADE,
        locationId INTEGER NOT NULL REFERENCES Location(id) ON DELETE RESTRICT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        isDefault INTEGER NOT NULL DEFAULT 0 CHECK (isDefault IN (0, 1)),
        ${hasIsActive ? "isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1))," : ""}
        UNIQUE (salesPointId, locationId)
      );

      INSERT INTO StorageLocation__new (
        id, salesPointId, locationId, createdAt, updatedAt, isDefault${hasIsActive ? ", isActive" : ""}
      )
      SELECT
        id,
        salesPointId,
        locationId,
        COALESCE(createdAt, datetime('now')),
        COALESCE(updatedAt, datetime('now')),
        isDefault${hasIsActive ? ", COALESCE(isActive, 1)" : ""}
      FROM StorageLocation
      WHERE salesPointId IS NOT NULL;

      DROP TABLE StorageLocation;
      ALTER TABLE StorageLocation__new RENAME TO StorageLocation;
      CREATE INDEX IF NOT EXISTS StorageLocation_salesPoint_idx ON StorageLocation (salesPointId);
      CREATE INDEX IF NOT EXISTS StorageLocation_location_idx ON StorageLocation (locationId);
      ${hasIsActive ? "CREATE INDEX IF NOT EXISTS StorageLocation_isActive_idx ON StorageLocation (isActive);" : ""}
    `);
  }

  database.exec(`DROP TABLE IF EXISTS Mill`);
  if (tableExists(database, "RoleRoutePermission")) {
    database.exec(`DELETE FROM RoleRoutePermission WHERE routeId = 'mills'`);
  }
  database.pragma("foreign_keys = ON");
}

function salesPointHasIsActive(database: Database.Database): boolean {
  return getTableColumns(database, "SalesPoint").has("isActive");
}

function locationHasIsActive(database: Database.Database): boolean {
  return getTableColumns(database, "Location").has("isActive");
}

function storageLocationHasIsActive(database: Database.Database): boolean {
  return getTableColumns(database, "StorageLocation").has("isActive");
}

function storageLocationHasIsSalesTank(database: Database.Database): boolean {
  return getTableColumns(database, "StorageLocation").has("isSalesTank");
}

function salesPointHasAttachedToMill(database: Database.Database): boolean {
  return getTableColumns(database, "SalesPoint").has("attachedToMill");
}

function saleHasCancellationColumns(database: Database.Database): boolean {
  return getTableColumns(database, "Sale").has("cancelledAt");
}

function storageLocationHasIsSellable(database: Database.Database): boolean {
  return getTableColumns(database, "StorageLocation").has("isSellable");
}

function applyDropStorageLocationIsSellableMigration(database: Database.Database): void {
  if (!storageLocationHasIsSellable(database)) {
    return;
  }

  const hasMillOwner = storageLocationHasMillOwner(database);
  const hasIsActive = storageLocationHasIsActive(database);

  database.pragma("foreign_keys = OFF");
  if (hasMillOwner) {
    database.exec(`
      DROP TABLE IF EXISTS StorageLocation__new;
      CREATE TABLE StorageLocation__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        salesPointId INTEGER REFERENCES SalesPoint(id) ON DELETE CASCADE,
        millId INTEGER REFERENCES Mill(id) ON DELETE CASCADE,
        locationId INTEGER NOT NULL REFERENCES Location(id) ON DELETE RESTRICT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        isDefault INTEGER NOT NULL DEFAULT 0 CHECK (isDefault IN (0, 1)),
        isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1)),
        CHECK (
          (millId IS NOT NULL AND salesPointId IS NULL)
          OR (millId IS NULL AND salesPointId IS NOT NULL)
        )
      );

      INSERT INTO StorageLocation__new (
        id, salesPointId, millId, locationId, createdAt, updatedAt, isDefault, isActive
      )
      SELECT
        id,
        salesPointId,
        millId,
        locationId,
        COALESCE(createdAt, datetime('now')),
        COALESCE(updatedAt, datetime('now')),
        isDefault,
        ${hasIsActive ? "COALESCE(isActive, 1)" : "1"}
      FROM StorageLocation;

      DROP TABLE StorageLocation;
      ALTER TABLE StorageLocation__new RENAME TO StorageLocation;

      CREATE INDEX IF NOT EXISTS StorageLocation_salesPoint_idx ON StorageLocation (salesPointId);
      CREATE INDEX IF NOT EXISTS StorageLocation_mill_idx ON StorageLocation (millId);
      CREATE INDEX IF NOT EXISTS StorageLocation_location_idx ON StorageLocation (locationId);
      CREATE UNIQUE INDEX IF NOT EXISTS StorageLocation_salesPoint_location_unique
        ON StorageLocation (salesPointId, locationId)
        WHERE salesPointId IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS StorageLocation_mill_location_unique
        ON StorageLocation (millId, locationId)
        WHERE millId IS NOT NULL;
      CREATE INDEX IF NOT EXISTS StorageLocation_isActive_idx ON StorageLocation (isActive);
    `);
  } else {
    database.exec(`
      DROP TABLE IF EXISTS StorageLocation__new;
      CREATE TABLE StorageLocation__new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        salesPointId INTEGER NOT NULL REFERENCES SalesPoint(id) ON DELETE CASCADE,
        locationId INTEGER NOT NULL REFERENCES Location(id) ON DELETE RESTRICT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        isDefault INTEGER NOT NULL DEFAULT 0 CHECK (isDefault IN (0, 1)),
        ${hasIsActive ? "isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1))," : ""}
        UNIQUE (salesPointId, locationId)
      );

      INSERT INTO StorageLocation__new (
        id, salesPointId, locationId, createdAt, updatedAt, isDefault${hasIsActive ? ", isActive" : ""}
      )
      SELECT
        id,
        salesPointId,
        locationId,
        COALESCE(createdAt, datetime('now')),
        COALESCE(updatedAt, datetime('now')),
        isDefault${hasIsActive ? ", COALESCE(isActive, 1)" : ""}
      FROM StorageLocation;

      DROP TABLE StorageLocation;
      ALTER TABLE StorageLocation__new RENAME TO StorageLocation;
      CREATE INDEX IF NOT EXISTS StorageLocation_salesPoint_idx ON StorageLocation (salesPointId);
      CREATE INDEX IF NOT EXISTS StorageLocation_location_idx ON StorageLocation (locationId);
      ${hasIsActive ? "CREATE INDEX IF NOT EXISTS StorageLocation_isActive_idx ON StorageLocation (isActive);" : ""}
    `);
  }
  database.pragma("foreign_keys = ON");
}

function taxRegimeHasIsActive(database: Database.Database): boolean {
  return getTableColumns(database, "TaxRegime").has("isActive");
}

function taxRateScheduleHasIsActive(database: Database.Database): boolean {
  return getTableColumns(database, "TaxRateSchedule").has("isActive");
}

function migrateLegacyStockCommitmentComments(database: Database.Database): void {
  if (!companySettingsHasReportCommentsJson(database)) {
    return;
  }
  const row = database
    .prepare(
      `SELECT reportCommentsJson, stockCommitmentReportComments
       FROM CompanySettings
       WHERE id = 'default'`,
    )
    .get() as
    | {
        reportCommentsJson: string | null;
        stockCommitmentReportComments: string | null;
      }
    | undefined;
  if (!row) {
    return;
  }
  const legacy = row.stockCommitmentReportComments?.trim() ?? "";
  if (!legacy) {
    return;
  }
  let map: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.reportCommentsJson || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      map = parsed as Record<string, string>;
    }
  } catch {
    map = {};
  }
  const existing = map["stock-commitment-report"]?.trim() ?? "";
  if (existing) {
    return;
  }
  map["stock-commitment-report"] = legacy;
  database
    .prepare(
      `UPDATE CompanySettings
       SET reportCommentsJson = ?, updatedAt = datetime('now')
       WHERE id = 'default'`,
    )
    .run(JSON.stringify(map));
}

function applyUserDropServiceFactoryMigration(database: Database.Database): void {
  if (userSchemaIsCurrent(database)) {
    return;
  }

  const userColumns = getTableColumns(database, "User");
  const mustChangeSelect = userColumns.has("mustChangePassword")
    ? "COALESCE(mustChangePassword, 0)"
    : "0";

  database.pragma("foreign_keys = OFF");
  database.exec(`
    DROP INDEX IF EXISTS User_factory_idx;
    DROP INDEX IF EXISTS User_commercialService_idx;
    DROP TABLE IF EXISTS User__new;

    CREATE TABLE User__new (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'STORE_KEEPER' CHECK (role IN ('ADMIN','MANAGER','SENIOR_SALES_SUPERVISOR','STATISTICS_CLERK','STORE_KEEPER')),
      isActive INTEGER NOT NULL DEFAULT 1 CHECK (isActive IN (0, 1)),
      username TEXT NOT NULL UNIQUE,
      passwordPlain TEXT,
      salesPointId INTEGER REFERENCES SalesPoint(id),
      passwordHash TEXT,
      mustChangePassword INTEGER NOT NULL DEFAULT 0 CHECK (mustChangePassword IN (0, 1)),
      commercialServiceId TEXT REFERENCES CommercialService(id),
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO User__new (
      id,
      name,
      role,
      isActive,
      username,
      passwordPlain,
      salesPointId,
      passwordHash,
      mustChangePassword,
      commercialServiceId,
      createdAt,
      updatedAt
    )
    SELECT
      id,
      name,
      role,
      isActive,
      username,
      passwordPlain,
      salesPointId,
      passwordHash,
      ${mustChangeSelect},
      commercialServiceId,
      createdAt,
      updatedAt
    FROM User;

    DROP TABLE User;
    ALTER TABLE User__new RENAME TO User;

    CREATE INDEX IF NOT EXISTS User_commercialService_idx ON User (commercialServiceId);
  `);
  database.pragma("foreign_keys = ON");
}

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    database
      .prepare("SELECT name FROM schema_migrations")
      .all()
      .map((row) => (row as { name: string }).name),
  );

  const migrationFiles = readdirSync(getMigrationsDir())
    .filter((file) => file.endsWith(".sql"))
    .sort();

  try {
    if (tableExists(database, "Role")) {
      const orphanRoles = database
        .prepare(
          `SELECT DISTINCT role FROM RoleRoutePermission WHERE role NOT IN (SELECT id FROM Role)
           UNION
           SELECT DISTINCT role FROM RoleActionPermission WHERE role NOT IN (SELECT id FROM Role)`,
        )
        .all() as Array<{ role: string }>;
      for (const r of orphanRoles) {
        if (r.role) {
          database
            .prepare(
              `INSERT OR IGNORE INTO Role (id, label, isSystem, sortOrder) VALUES (?, ?, 0, 999)`,
            )
            .run(r.role, r.role.replace(/_/g, " "));
        }
      }
    }
  } catch {
    // Role or permission tables might not exist yet
  }

  for (const fileName of migrationFiles) {
    if (applied.has(fileName)) {
      continue;
    }

    if (fileName === "007_customer_integer_id.sql" && isCustomerIdInteger(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "009_sales_point_simplify.sql" &&
      !salesPointHasPeriodColumns(database) &&
      salesPointHasTimestamps(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "009_sales_point_simplify.sql") {
      applySalesPointSimplifyMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "010_location_master.sql" && locationSchemaIsCurrent(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "010_location_master.sql") {
      applyLocationMasterMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "011_simplified_roles.sql" && rolesSchemaIsCurrent(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "011_simplified_roles.sql") {
      applySimplifiedRolesMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "012_role_permissions.sql" && permissionsSchemaIsCurrent(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "012_role_permissions.sql") {
      applyRolePermissionsMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "013_drop_employee.sql" && !employeeTableExists(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "013_drop_employee.sql") {
      applyDropEmployeeMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "014_company_settings_themes.sql" &&
      companySettingsThemesAreCurrent(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "014_company_settings_themes.sql") {
      applyCompanySettingsThemesMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "015_company_settings_agro_dark.sql" &&
      companySettingsAgroDarkAreCurrent(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "015_company_settings_agro_dark.sql") {
      applyCompanySettingsAgroDarkMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "016_compress_tax_tables.sql" && taxTablesAreCompressed(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "016_compress_tax_tables.sql") {
      applyCompressTaxTablesMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "019_user_drop_service_factory.sql" && userSchemaIsCurrent(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "019_user_drop_service_factory.sql") {
      applyUserDropServiceFactoryMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "025_budget_by_product_cat.sql" && budgetByProductCatIsCurrent(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "026_delivery_order_source_kind.sql" && deliveryOrderHasSourceKind(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "029_stock_adjustment_source_kind.sql" && stockAdjustmentHasSourceKind(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "031_report_settings_hide_zero.sql" &&
      companySettingsHasHideZeroReportRows(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "033_stock_commitment_report_comments.sql" &&
      companySettingsHasStockCommitmentComments(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "034_report_comments_json.sql") {
      if (!companySettingsHasReportCommentsJson(database)) {
        const sql = readFileSync(path.join(getMigrationsDir(), fileName), "utf8");
        database.exec(sql);
      }
      migrateLegacyStockCommitmentComments(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "042_user_must_change_password.sql" &&
      userHasMustChangePassword(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "045_delivery_order_transfer.sql" &&
      deliveryOrderTransferSchemaIsCurrent(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "052_mill_is_active.sql" &&
      (!tableExists(database, "Mill") || millHasIsActive(database))
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "053_sales_point_is_active.sql" && salesPointHasIsActive(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "054_storage_location_mill_owner.sql" &&
      (!tableExists(database, "Mill") || storageLocationHasMillOwner(database))
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "054_storage_location_mill_owner.sql") {
      applyStorageLocationMillOwnerMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "055_location_is_active.sql" && locationHasIsActive(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "056_storage_location_is_active.sql" &&
      storageLocationHasIsActive(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "057_tax_regime_is_active.sql" && taxRegimeHasIsActive(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "058_tax_rate_schedule_is_active.sql" &&
      taxRateScheduleHasIsActive(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "059_drop_storage_location_is_sellable.sql" &&
      !storageLocationHasIsSellable(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "059_drop_storage_location_is_sellable.sql") {
      applyDropStorageLocationIsSellableMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "060_drop_mill.sql" && !millLayerPresent(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "060_drop_mill.sql") {
      applyDropMillLayerMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "061_storage_location_is_sales_tank.sql" &&
      storageLocationHasIsSalesTank(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "066_sales_point_attached_to_mill.sql" &&
      salesPointHasAttachedToMill(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (
      fileName === "071_stock_transfer_consignment_fields.sql" &&
      stockTransferHasConsignmentFields(database)
    ) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "062_manageable_roles.sql" && manageableRolesSchemaIsCurrent(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "062_manageable_roles.sql") {
      applyManageableRolesMigration(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "098_stock_intake_oil_grouping.sql") {
      const sql = readFileSync(path.join(getMigrationsDir(), fileName), "utf8");
      try {
        database.exec(sql);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("duplicate column name")) {
          throw err;
        }
      }
      applyStockIntakeProductBackfill(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "099_palm_kernel_intake_group.sql") {
      const sql = readFileSync(path.join(getMigrationsDir(), fileName), "utf8");
      database.exec(sql);
      applyStockIntakeProductBackfill(database);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "119_sale_cancellation.sql" && saleHasCancellationColumns(database)) {
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    if (fileName === "126_do_retail_wholesale_pricing.sql") {
      // Columns may already exist from a previous failed run of this migration.
      if (!getTableColumns(database, "CompanySettings").has("deliveryOrderBlockRetailQuantity")) {
        database.exec(`
          ALTER TABLE CompanySettings
            ADD COLUMN deliveryOrderBlockRetailQuantity INTEGER NOT NULL DEFAULT 1
            CHECK (deliveryOrderBlockRetailQuantity IN (0, 1));
        `);
      }
      if (!getTableColumns(database, "DeliveryOrderDetails").has("pricingCustomerTypeId")) {
        database.exec(`
          ALTER TABLE DeliveryOrderDetails
            ADD COLUMN pricingCustomerTypeId TEXT REFERENCES CustomerTypeDefinition(id);
        `);
      }
      const sql = readFileSync(path.join(getMigrationsDir(), fileName), "utf8");
      database.exec(sql);
      database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
      continue;
    }

    const sql = readFileSync(path.join(getMigrationsDir(), fileName), "utf8");
    database.exec(sql);
    database.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(fileName);
  }
}

export function resolveDatabaseFilePath(): string {
  const settings = loadAppSettings();
  const configured = settings.databaseDir?.trim() ?? "";
  if (configured && path.isAbsolute(configured)) {
    mkdirSync(configured, { recursive: true });
    return path.join(configured, "sales.db");
  }
  if (configured) {
    console.warn(
      `[database] databaseDir "${configured}" is not an absolute path; using userData.`,
    );
  }
  return path.join(app.getPath("userData"), "sales.db");
}

export function initDatabase(): Database.Database {
  if (db) {
    return db;
  }

  const dbPath = resolveDatabaseFilePath();
  console.info(`[database] Opening ${dbPath}`);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  applyStockIntakeProductBackfill(db);
  // Fill any new route/action defaults for existing DBs (INSERT OR IGNORE).
  seedDefaultPermissions(db);

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database has not been initialized");
  }

  return db;
}

export function getDatabaseFilePath(): string {
  return resolveDatabaseFilePath();
}

export function closeDatabase(): void {
  if (!db) {
    return;
  }

  db.close();
  db = null;
}
