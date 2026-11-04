/** Threshold (kg) separating Retail (<) from Wholesale (≥) for DO / retail invoice rules. */
export const DO_RETAIL_WHOLESALE_THRESHOLD_KG = 3000;

export type DoPricingKind = "INDUSTRY" | "WHOLESALE" | "RETAIL";

export function isIndustryCustomerType(
  code: string | null | undefined,
  name: string | null | undefined,
): boolean {
  const text = `${code ?? ""} ${name ?? ""}`.toUpperCase();
  return text.includes("INDUSTR");
}

/**
 * Classify the pricing kind for a DO line.
 * When blockRetailQuantity is on, callers must reject RETAIL (sub-threshold non-Industry).
 */
export function classifyDoPricingKind(input: {
  isIndustryCustomer: boolean;
  orderQtyKg: number;
  blockRetailQuantity: boolean;
}): DoPricingKind {
  if (input.isIndustryCustomer) {
    return "INDUSTRY";
  }

  if (input.orderQtyKg >= DO_RETAIL_WHOLESALE_THRESHOLD_KG) {
    return "WHOLESALE";
  }

  return "RETAIL";
}

export function retailQuantityBlockedOnDoMessage(): string {
  return (
    `Delivery orders are for Industry and Wholesale only ` +
    `(Wholesale requires at least ${DO_RETAIL_WHOLESALE_THRESHOLD_KG} kg). ` +
    `Use a Retail sale invoice for quantities below ${DO_RETAIL_WHOLESALE_THRESHOLD_KG} kg.`
  );
}

export function retailSaleQtyTooHighMessage(): string {
  return (
    `Retail sales must be below ${DO_RETAIL_WHOLESALE_THRESHOLD_KG} kg per line. ` +
    `Use a delivery order (Wholesale / Industry) for ${DO_RETAIL_WHOLESALE_THRESHOLD_KG} kg or more.`
  );
}
