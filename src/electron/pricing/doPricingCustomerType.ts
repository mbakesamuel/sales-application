import { getDatabase } from "../db/index.js";
import {
  classifyDoPricingKind,
  type DoPricingKind,
  isIndustryCustomerType,
  retailQuantityBlockedOnDoMessage,
} from "../../shared/doPricingCustomerType.js";
import {
  getRetailCustomerTypeId,
  resolveUnitPriceExTax,
  type ResolveUnitPriceResult,
} from "./resolveUnitPrice.js";

export type DoLinePricingResult =
  | {
      ok: true;
      pricingKind: DoPricingKind;
      pricingCustomerTypeId: string;
      unitPriceExTax: string;
      productName: string;
    }
  | { ok: false; error: string };

function getCustomerTypeMeta(customerTypeId: string | null): {
  code: string;
  name: string;
} | null {
  if (!customerTypeId) {
    return null;
  }

  const row = getDatabase()
    .prepare(`SELECT code, name FROM CustomerTypeDefinition WHERE id = ?`)
    .get(customerTypeId) as { code: string; name: string } | undefined;

  return row ?? null;
}

export function getWholesaleCustomerTypeId(): string | null {
  const row = getDatabase()
    .prepare(
      `SELECT id FROM CustomerTypeDefinition
       WHERE isActive = 1
         AND (
           UPPER(code) LIKE '%WHOLESALE%'
           OR UPPER(name) LIKE '%WHOLESALE%'
         )
       ORDER BY sortOrder ASC
       LIMIT 1`,
    )
    .get() as { id: string } | undefined;

  return row?.id ?? null;
}

export function getIndustryCustomerTypeId(): string | null {
  const row = getDatabase()
    .prepare(
      `SELECT id FROM CustomerTypeDefinition
       WHERE isActive = 1
         AND (
           UPPER(code) LIKE '%INDUSTR%'
           OR UPPER(name) LIKE '%INDUSTR%'
         )
       ORDER BY sortOrder ASC
       LIMIT 1`,
    )
    .get() as { id: string } | undefined;

  return row?.id ?? null;
}

export function loadDeliveryOrderBlockRetailQuantity(): boolean {
  try {
    const columns = getDatabase()
      .prepare(`PRAGMA table_info(CompanySettings)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((col) => col.name === "deliveryOrderBlockRetailQuantity")) {
      return true;
    }

    const row = getDatabase()
      .prepare(
        `SELECT deliveryOrderBlockRetailQuantity
         FROM CompanySettings
         WHERE id = 'default'`,
      )
      .get() as { deliveryOrderBlockRetailQuantity: number | null } | undefined;

    return Number(row?.deliveryOrderBlockRetailQuantity ?? 1) !== 0;
  } catch {
    return true;
  }
}

export function resolveDoPricingCustomerTypeId(
  kind: DoPricingKind,
): string | null {
  if (kind === "INDUSTRY") {
    return getIndustryCustomerTypeId();
  }
  if (kind === "WHOLESALE") {
    return getWholesaleCustomerTypeId();
  }
  return getRetailCustomerTypeId();
}

export function customerIsIndustry(customerTypeId: string | null): boolean {
  const meta = getCustomerTypeMeta(customerTypeId);
  return isIndustryCustomerType(meta?.code, meta?.name);
}

/**
 * Resolve DO line unit price from Industry / Wholesale / (legacy) Retail schedule
 * using qty + customer Industry flag. Enforces retail-qty block when setting is on.
 */
export function resolveDoLineUnitPrice(input: {
  productId: number;
  customerTypeId: string | null;
  orderQtyKg: number;
  asOfDate: string;
  blockRetailQuantity?: boolean;
}): DoLinePricingResult {
  const blockRetailQuantity =
    input.blockRetailQuantity ?? loadDeliveryOrderBlockRetailQuantity();
  const isIndustry = customerIsIndustry(input.customerTypeId);
  const pricingKind = classifyDoPricingKind({
    isIndustryCustomer: isIndustry,
    orderQtyKg: input.orderQtyKg,
    blockRetailQuantity,
  });

  if (blockRetailQuantity && !isIndustry && pricingKind === "RETAIL") {
    return { ok: false, error: retailQuantityBlockedOnDoMessage() };
  }

  const pricingCustomerTypeId = resolveDoPricingCustomerTypeId(pricingKind);
  if (!pricingCustomerTypeId) {
    return {
      ok: false,
      error: `No active ${pricingKind.toLowerCase()} customer type is configured. Add it under Customer types.`,
    };
  }

  const price: ResolveUnitPriceResult = resolveUnitPriceExTax(
    input.productId,
    pricingCustomerTypeId,
    input.asOfDate,
  );
  if (!price.ok) {
    return price;
  }

  return {
    ok: true,
    pricingKind,
    pricingCustomerTypeId,
    unitPriceExTax: price.unitPriceExTax,
    productName: price.productName,
  };
}
