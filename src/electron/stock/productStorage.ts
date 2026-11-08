import type Database from "better-sqlite3";
import { isLooseLpoProduct } from "../../shared/looseLpoProduct.js";
import { STORAGE_OMIT_STOCK_DOC_ERROR } from "../../shared/productStorageRules.js";
import { getDatabase } from "../db/index.js";

function productHasOmitsStorageLocationColumn(db: Database.Database): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(Product)`)
    .all() as Array<{ name: string }>;
  return columns.some((column) => column.name === "omitsStorageLocation");
}

export function productCatCodeForId(
  db: Database.Database,
  productId: number,
): string | null {
  const row = db
    .prepare(
      `SELECT pc.productCode
       FROM Product p
       INNER JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE p.productId = ?`,
    )
    .get(productId) as { productCode: string } | undefined;
  return row?.productCode ?? null;
}

export function productOmitsStorageLocationById(
  db: Database.Database,
  productId: number,
): boolean {
  if (!productHasOmitsStorageLocationColumn(db)) {
    return false;
  }

  const row = db
    .prepare(`SELECT omitsStorageLocation FROM Product WHERE productId = ?`)
    .get(productId) as { omitsStorageLocation: number } | undefined;

  return Number(row?.omitsStorageLocation ?? 0) !== 0;
}

export function productHasStockBalance(
  db: Database.Database,
  productId: number,
): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM StockBalance WHERE productId = ? LIMIT 1`)
    .get(productId) as { ok: number } | undefined;
  return row != null;
}

/** Block toggling omitsStorageLocation when product already has stock. */
export function assertProductOmitsStorageLocationChangeAllowed(
  db: Database.Database,
  productId: number,
  nextOmitsStorageLocation: unknown,
): void {
  if (!productHasOmitsStorageLocationColumn(db)) {
    return;
  }

  const current = db
    .prepare(`SELECT omitsStorageLocation FROM Product WHERE productId = ?`)
    .get(productId) as { omitsStorageLocation: number } | undefined;

  if (!current) {
    return;
  }

  const prev = Number(current.omitsStorageLocation ?? 0) !== 0;
  const next = Number(nextOmitsStorageLocation ?? 0) !== 0;
  if (prev === next) {
    return;
  }

  if (productHasStockBalance(db, productId)) {
    throw new Error(
      "Cannot change storage location setting while this product has stock. Clear or transfer stock first.",
    );
  }
}

/** Loose Palm Oil = product code LPO (canonical loose LPO SKU). */
export function productIsLoosePalmOilById(
  db: Database.Database,
  productId: number,
): boolean {
  const row = db
    .prepare(
      `SELECT p.productCode, p.productName, COALESCE(pc.isBottled, 0) AS isBottled
       FROM Product p
       INNER JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE p.productId = ?`,
    )
    .get(productId) as
    | { productCode: string | null; productName: string; isBottled: number }
    | undefined;

  if (!row) {
    return false;
  }

  return isLooseLpoProduct({
    productCode: row.productCode,
    productName: row.productName,
    isBottled: row.isBottled,
  });
}

export function productIsBottledById(
  db: Database.Database,
  productId: number,
): boolean {
  const row = db
    .prepare(
      `SELECT COALESCE(pc.isBottled, 0) AS isBottled
       FROM Product p
       INNER JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE p.productId = ?`,
    )
    .get(productId) as { isBottled: number } | undefined;
  return Number(row?.isBottled ?? 0) === 1;
}

export function loadLoosePalmOilAllowInterSalesPointTransfer(
  db: ReturnType<typeof getDatabase> = getDatabase(),
): boolean {
  try {
    const columns = db
      .prepare(`PRAGMA table_info(CompanySettings)`)
      .all() as Array<{ name: string }>;
    if (
      !columns.some((col) => col.name === "loosePalmOilAllowInterSalesPointTransfer")
    ) {
      return false;
    }

    const row = db
      .prepare(
        `SELECT loosePalmOilAllowInterSalesPointTransfer
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as
      | { loosePalmOilAllowInterSalesPointTransfer: number | null }
      | undefined;

    if (row?.loosePalmOilAllowInterSalesPointTransfer == null) {
      return false;
    }
    return Number(row.loosePalmOilAllowInterSalesPointTransfer) !== 0;
  } catch {
    return false;
  }
}

const BOTTLE_TRANSFER_BLOCKED_MESSAGE =
  "Bottle products are received at Bota via Reception / consignment note; transfers are not used for bottle stock.";

/** Bottle products never transfer (inter or intra) — intake is Reception at Bota. */
export function assertNoBottledTransferProducts(
  db: Database.Database,
  productIds: number[],
): void {
  for (const productId of productIds) {
    if (productIsBottledById(db, productId)) {
      throw new Error(BOTTLE_TRANSFER_BLOCKED_MESSAGE);
    }
  }
}

/** Inter transfers: loose Palm Oil only when company setting allows (never bottled). */
export function assertInterTransferProductsAllowed(
  db: Database.Database,
  productIds: number[],
): void {
  assertNoBottledTransferProducts(db, productIds);
  const allowLoosePalmOil = loadLoosePalmOilAllowInterSalesPointTransfer(db);
  for (const productId of productIds) {
    if (productIsLoosePalmOilById(db, productId)) {
      if (allowLoosePalmOil) {
        continue;
      }
      throw new Error(
        "Loose Palm Oil cannot be transferred between collection points. Use Within collection point instead.",
      );
    }
    throw new Error(
      "Only loose Palm Oil (when enabled) can be transferred between collection points. Use Within collection point for other loose products.",
    );
  }
}

export function loadLoosePalmOilRequireSalesTank(
  db: ReturnType<typeof getDatabase> = getDatabase(),
): boolean {
  try {
    const columns = db
      .prepare(`PRAGMA table_info(CompanySettings)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "loosePalmOilRequireSalesTank")) {
      return true;
    }

    const row = db
      .prepare(
        `SELECT loosePalmOilRequireSalesTank
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as { loosePalmOilRequireSalesTank: number | null } | undefined;

    if (row?.loosePalmOilRequireSalesTank == null) {
      return true;
    }
    return Number(row.loosePalmOilRequireSalesTank) !== 0;
  } catch {
    return true;
  }
}

/** True when loose sale of this product must use a sales tank. */
export function productRequiresSalesTankForLooseSale(
  db: Database.Database,
  productId: number,
): boolean {
  return (
    productIsLoosePalmOilById(db, productId) &&
    loadLoosePalmOilRequireSalesTank(db)
  );
}

/** Throws when any product omits storage locations (no location-bound stock docs). */
export function assertProductsAllowStorageLocation(
  db: Database.Database,
  productIds: number[],
): void {
  for (const productId of productIds) {
    if (productOmitsStorageLocationById(db, productId)) {
      throw new Error(STORAGE_OMIT_STOCK_DOC_ERROR);
    }
  }
}

/** Products that use storage locations must have a location; no-location products must not. */
export function assertMovementLocationRules(
  db: Database.Database,
  productId: number,
  storageLocationId: number | null,
): void {
  const omits = productOmitsStorageLocationById(db, productId);
  if (omits && storageLocationId != null) {
    throw new Error(STORAGE_OMIT_STOCK_DOC_ERROR);
  }
  if (!omits && storageLocationId == null) {
    throw new Error("Storage location is required for this product.");
  }
}

/** SQL fragment: products that use storage locations (alias for Product). */
export function storageLocationProductSql(aliasP = "p"): string {
  return `COALESCE(${aliasP}.omitsStorageLocation, 0) = 0`;
}

function storageLocationHasAllowsMultiProductColumn(db: Database.Database): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(StorageLocation)`)
    .all() as Array<{ name: string }>;
  return columns.some((column) => column.name === "allowsMultiProduct");
}

/** Drum / small-tank locations may hold multiple bulk products. */
export function storageLocationAllowsMultiProductById(
  db: Database.Database,
  storageLocationId: number,
): boolean {
  if (!storageLocationHasAllowsMultiProductColumn(db)) {
    return false;
  }

  const row = db
    .prepare(`SELECT allowsMultiProduct FROM StorageLocation WHERE id = ?`)
    .get(storageLocationId) as { allowsMultiProduct: number } | undefined;

  return Number(row?.allowsMultiProduct ?? 0) !== 0;
}

export function loadStockIntakeOilGrouping(
  db: ReturnType<typeof getDatabase> = getDatabase(),
): boolean {
  try {
    const columns = db
      .prepare(`PRAGMA table_info(CompanySettings)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "stockIntakeOilGrouping")) {
      return false;
    }

    const row = db
      .prepare(
        `SELECT stockIntakeOilGrouping
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as { stockIntakeOilGrouping: number | null } | undefined;

    return Number(row?.stockIntakeOilGrouping ?? 0) !== 0;
  } catch {
    return false;
  }
}

/** When grouping is on, invoice/sale lines on sludge grades deduct from the pool product. */
export function resolveStockProductId(
  db: Database.Database,
  productId: number,
  groupingEnabled = loadStockIntakeOilGrouping(db),
): number {
  if (!groupingEnabled) {
    return productId;
  }

  const row = db
    .prepare(`SELECT stockPoolProductId FROM Product WHERE productId = ?`)
    .get(productId) as { stockPoolProductId: number | null } | undefined;

  return row?.stockPoolProductId ?? productId;
}

export function productExcludeFromSalesById(
  db: Database.Database,
  productId: number,
): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(Product)`)
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "excludeFromSales")) {
    return false;
  }

  const row = db
    .prepare(`SELECT excludeFromSales FROM Product WHERE productId = ?`)
    .get(productId) as { excludeFromSales: number } | undefined;

  return Number(row?.excludeFromSales ?? 0) !== 0;
}
