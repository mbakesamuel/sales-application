import { getDatabase } from "../db/index.js";
import { isLooseLpoProduct } from "../../shared/looseLpoProduct.js";

export type ResolveUnitPriceResult =
  | { ok: true; unitPriceExTax: string; productName: string }
  | { ok: false; error: string };

function normalizeAsOfDay(asOfDate: string): string {
  const trimmed = asOfDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return trimmed.slice(0, 10);
}

export function getCustomerTypeIdForCustomer(customerId: number): string | null {
  const row = getDatabase()
    .prepare(`SELECT customerTypeId FROM Customer WHERE id = ?`)
    .get(customerId) as { customerTypeId: string | null } | undefined;

  return row?.customerTypeId ?? null;
}

export function getCustomerTypeLabel(customerTypeId: string): string {
  const row = getDatabase()
    .prepare(`SELECT name, code FROM CustomerTypeDefinition WHERE id = ?`)
    .get(customerTypeId) as { name: string; code: string } | undefined;

  return row?.name ?? row?.code ?? customerTypeId;
}

/** Staff/Worker (CDC workers) type — used for Ration disposition pricing. */
export function getStaffWorkerCustomerTypeId(): string | null {
  const row = getDatabase()
    .prepare(
      `SELECT id FROM CustomerTypeDefinition
       WHERE isActive = 1
         AND (
           UPPER(code) LIKE '%STAFF%'
           OR UPPER(name) LIKE '%STAFF%'
           OR UPPER(code) LIKE '%WORKER%'
           OR UPPER(name) LIKE '%WORKER%'
           OR UPPER(code) LIKE '%RATION%'
           OR UPPER(name) LIKE '%RATION%'
         )
       ORDER BY sortOrder ASC
       LIMIT 1`,
    )
    .get() as { id: string } | undefined;

  return row?.id ?? null;
}

/** Retail type — used for Public relation disposition pricing (no walk-in placeholder). */
export function getRetailCustomerTypeId(): string | null {
  const row = getDatabase()
    .prepare(
      `SELECT id FROM CustomerTypeDefinition
       WHERE isActive = 1
         AND (
           UPPER(code) LIKE '%RETAIL%'
           OR UPPER(name) LIKE '%RETAIL%'
         )
       ORDER BY sortOrder ASC
       LIMIT 1`,
    )
    .get() as { id: string } | undefined;

  return row?.id ?? null;
}

/**
 * Latest schedule row with effectiveFrom <= transaction calendar day.
 * Bottled products use a single direct price (customerTypeId null).
 * Loose LPO (product code LPO) uses the customer's type; others use direct price.
 */
export function resolveUnitPriceExTax(
  productId: number,
  customerTypeId: string | null,
  asOfDate: string,
): ResolveUnitPriceResult {
  const dayIso = normalizeAsOfDay(asOfDate);

  const product = getDatabase()
    .prepare(
      `SELECT p.productName, p.productCode, pc.isBottled
       FROM Product p
       INNER JOIN ProductCat pc ON pc.productCatId = p.productCatId
       WHERE p.productId = ?`,
    )
    .get(productId) as
    | { productName: string; productCode: string | null; isBottled: number }
    | undefined;

  if (!product) {
    return { ok: false, error: `Product ${productId} was not found.` };
  }

  const isLooseLpo = isLooseLpoProduct({
    productCode: product.productCode,
    productName: product.productName,
    isBottled: product.isBottled,
  });
  const isBottled = product.isBottled === 1;

  if (isLooseLpo && !isBottled && !customerTypeId) {
    return {
      ok: false,
      error: `Select a registered customer to resolve the price for "${product.productName}".`,
    };
  }

  const row = isBottled
    ? (getDatabase()
        .prepare(
          `SELECT unitPriceExTax FROM ProductUnitPriceSchedule
           WHERE productId = ?
             AND effectiveFrom <= ?
             AND customerTypeId IS NULL
           ORDER BY effectiveFrom DESC
           LIMIT 1`,
        )
        .get(productId, dayIso) as { unitPriceExTax: string } | undefined)
    : isLooseLpo
      ? (getDatabase()
          .prepare(
            `SELECT unitPriceExTax FROM ProductUnitPriceSchedule
             WHERE productId = ?
               AND effectiveFrom <= ?
               AND customerTypeId = ?
             ORDER BY effectiveFrom DESC
             LIMIT 1`,
          )
          .get(productId, dayIso, customerTypeId) as { unitPriceExTax: string } | undefined)
      : (getDatabase()
          .prepare(
            `SELECT unitPriceExTax FROM ProductUnitPriceSchedule
             WHERE productId = ?
               AND effectiveFrom <= ?
               AND customerTypeId IS NULL
             ORDER BY effectiveFrom DESC
             LIMIT 1`,
          )
          .get(productId, dayIso) as { unitPriceExTax: string } | undefined);

  if (!row) {
    if (isBottled) {
      return {
        ok: false,
        error: `No unit price scheduled for "${product.productName}" on or before ${dayIso}. Add a price in Product pricing (setup).`,
      };
    }

    if (isLooseLpo) {
      const typeLabel = customerTypeId
        ? getCustomerTypeLabel(customerTypeId)
        : "customer type";
      return {
        ok: false,
        error: `No unit price scheduled for "${product.productName}" (${typeLabel}) on or before ${dayIso}. Add a price in Product pricing (setup).`,
      };
    }

    return {
      ok: false,
      error: `No unit price scheduled for "${product.productName}" on or before ${dayIso}. Add a direct price in Product pricing (setup).`,
    };
  }

  return {
    ok: true,
    unitPriceExTax: row.unitPriceExTax,
    productName: product.productName,
  };
}
