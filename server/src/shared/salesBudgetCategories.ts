/** Sales budget helpers keyed by ProductCat (one budget row per category). */

export interface SalesBudgetCategoryRef {
  productCatId: number;
  productCat: string;
  isMain: number;
  isBottled: number;
}

export interface SalesBudgetProductRef {
  productId: number;
  productName: string;
  productCode: string | null;
  productCatId: number;
}

export interface SalesBudgetCategoryDef {
  productCatId: number;
  label: string;
  /** Short label used in monthly delivery budget table headers. */
  tonsLabel: string;
  valueLabel: string;
}

/** Categories ordered for budget UI / monthly delivery: main first, then bottled last within name sort. */
export function sortSalesBudgetCategories(
  categories: SalesBudgetCategoryRef[],
): SalesBudgetCategoryRef[] {
  return [...categories].sort((a, b) => {
    if (a.isMain !== b.isMain) {
      return b.isMain - a.isMain;
    }
    if (a.isBottled !== b.isBottled) {
      return a.isBottled - b.isBottled;
    }
    return a.productCat.localeCompare(b.productCat);
  });
}

/** Categories that have at least one product (default budget row set). */
export function salesBudgetCategoriesWithProducts(
  categories: SalesBudgetCategoryRef[],
  products: SalesBudgetProductRef[],
): SalesBudgetCategoryRef[] {
  const catIdsWithProducts = new Set(products.map((p) => p.productCatId));
  return sortSalesBudgetCategories(categories).filter((c) =>
    catIdsWithProducts.has(c.productCatId),
  );
}

function categoryText(category: SalesBudgetCategoryRef): string {
  return category.productCat.toUpperCase();
}

/**
 * Palm-kernel (uncracked/cracked) categories shown in the MDR kernel budget table
 * (no G.TOTAL). Excludes PKO / PKC / palm oil.
 */
export function isKernelPkBudgetCategory(category: SalesBudgetCategoryRef): boolean {
  const text = categoryText(category);
  if (text.includes("KERNEL OIL") || /\bPKO\b/.test(text)) {
    return false;
  }
  if (text.includes("KERNEL CAKE") || /\bPKC\b/.test(text)) {
    return false;
  }
  if (category.isMain === 1 || category.isBottled === 1) {
    return false;
  }
  if (text.includes("UNCRACKED") || (text.includes("CRACKED") && !text.includes("UNCRACKED"))) {
    return true;
  }
  // Generic "Palm Kernel" / "Palm Kernel Product" style categories.
  return text.includes("KERNEL") && !text.includes("OIL") && !text.includes("CAKE");
}

export function budgetCategoryLabels(category: SalesBudgetCategoryRef): {
  label: string;
  tonsLabel: string;
  valueLabel: string;
} {
  const label = category.productCat.trim() || `Category ${category.productCatId}`;
  const text = categoryText(category);

  if (category.isBottled === 1 || (text.includes("BOTTLED") && text.includes("PALM"))) {
    return { label, tonsLabel: "B.P.O (TONS)", valueLabel: "B.P.O (FCFA)" };
  }
  if (category.isMain === 1 || (text.includes("PALM OIL") && !text.includes("KERNEL"))) {
    return { label, tonsLabel: "PALM OIL (TONS)", valueLabel: "PALM OIL (FCFA)" };
  }
  if (text.includes("KERNEL OIL") || /\bPKO\b/.test(text)) {
    return {
      label,
      tonsLabel: "P. KERNEL OIL (TONS)",
      valueLabel: "P. KERNEL OIL (FCFA)",
    };
  }
  if (text.includes("KERNEL CAKE") || /\bPKC\b/.test(text)) {
    return {
      label,
      tonsLabel: "P. Kernel Cake(Tons)",
      valueLabel: "PKC (FCFA)",
    };
  }
  if (text.includes("UNCRACKED")) {
    return {
      label,
      tonsLabel: "UNCRACKED P.K(TONS)",
      valueLabel: "UNCRACKED P.K(FCFA)",
    };
  }
  if (text.includes("CRACKED")) {
    return {
      label,
      tonsLabel: "CRACKED P.K(TONS)",
      valueLabel: "CRACKED P.K(FCFA)",
    };
  }

  const upper = label.toUpperCase();
  return {
    label,
    tonsLabel: `${upper} (TONS)`,
    valueLabel: `${upper} (FCFA)`,
  };
}

export function toSalesBudgetCategoryDef(
  category: SalesBudgetCategoryRef,
): SalesBudgetCategoryDef {
  const labels = budgetCategoryLabels(category);
  return {
    productCatId: category.productCatId,
    ...labels,
  };
}

/** Product ids that roll into a category’s actuals. */
export function productIdsForCategory(
  productCatId: number,
  products: SalesBudgetProductRef[],
): number[] {
  return products
    .filter((p) => p.productCatId === productCatId)
    .map((p) => p.productId)
    .sort((a, b) => a - b);
}
