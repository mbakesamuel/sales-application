/** Threshold (kg) separating Retail (<) from Wholesale (≥) for DO / retail invoice rules. */
export declare const DO_RETAIL_WHOLESALE_THRESHOLD_KG = 3000;
export type DoPricingKind = "INDUSTRY" | "WHOLESALE" | "RETAIL";
export declare function isIndustryCustomerType(code: string | null | undefined, name: string | null | undefined): boolean;
/**
 * Classify the pricing kind for a DO line.
 * When blockRetailQuantity is on, callers must reject RETAIL (sub-threshold non-Industry).
 */
export declare function classifyDoPricingKind(input: {
    isIndustryCustomer: boolean;
    orderQtyKg: number;
    blockRetailQuantity: boolean;
}): DoPricingKind;
export declare function retailQuantityBlockedOnDoMessage(): string;
export declare function retailSaleQtyTooHighMessage(): string;
