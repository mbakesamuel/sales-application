import { prisma } from "../../db/prisma.js";
import { loadRpcActor } from "../rpcActor.js";

export const PALM_OIL_KG_PER_LITRE = 0.85;
export const BOTTLED_PACK_ORDER = [
  "jug20",
  "carton5",
  "carton15",
  "unit1",
  "other",
] as const;

export type BottledPackColumn = {
  id: string;
  label: string;
  units: number;
  litresPerUnit: number;
};

export type SalesPointRow = { id: number; name: string };

export type StorageLocationRow = {
  id: number;
  salesPointId: number;
  name: string;
  isActive: boolean;
  isSalesTank: boolean;
  effectivelySellable: boolean;
};

export type ProductRow = {
  productId: number;
  productName: string;
  productCode: string | null;
  productCatId: number;
  isMain: number;
  isBottled: number;
  omitsStorageLocation: boolean;
};

export function parseQty(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function isStorageLocationEffectivelySellable(args: {
  isActive?: boolean | number | null;
}): boolean {
  return (
    args.isActive === true ||
    args.isActive === 1 ||
    args.isActive == null
  );
}

export function isLooseLpoProduct(product: {
  productCode?: string | null;
  productName?: string | null;
  isBottled?: number | boolean | null;
}): boolean {
  if (product.isBottled === 1 || product.isBottled === true) return false;
  const code = (product.productCode ?? "").trim().toUpperCase();
  if (code === "LPO") return true;
  const name = (product.productName ?? "").trim().toLowerCase();
  return name.includes("loose") && name.includes("palm") && name.includes("oil");
}

export async function loadSalesPointsForUser(
  userId?: string | null,
): Promise<SalesPointRow[]> {
  let scopedId: number | null = null;
  if (userId) {
    try {
      const actor = await loadRpcActor(userId);
      scopedId = actor.salesPointId;
    } catch {
      scopedId = null;
    }
  }
  const rows = await prisma.sales_points.findMany({
    where: {
      is_active: true,
      ...(scopedId != null ? { id: scopedId } : {}),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

export async function resolveReportSalesPointId(
  userId: string | null | undefined,
  requested?: number | null,
): Promise<number | null> {
  if (userId) {
    try {
      const actor = await loadRpcActor(userId);
      if (actor.salesPointId != null) return actor.salesPointId;
    } catch {
      /* ignore */
    }
  }
  if (requested != null && Number.isFinite(Number(requested))) {
    return Number(requested);
  }
  return null;
}

export async function reportScopedSalesPointId(
  userId?: string | null,
): Promise<number | null> {
  if (!userId) return null;
  try {
    return (await loadRpcActor(userId)).salesPointId;
  } catch {
    return null;
  }
}

export async function loadStorageLocationsForUser(
  userId?: string | null,
): Promise<StorageLocationRow[]> {
  const scopedId = await reportScopedSalesPointId(userId);
  const rows = await prisma.storage_locations.findMany({
    where: scopedId != null ? { sales_point_id: scopedId } : undefined,
    include: { locations: { select: { location_name: true } } },
    orderBy: [{ sales_point_id: "asc" }, { id: "asc" }],
  });
  return rows.map((row) => {
    const isActive = Boolean(row.is_active);
    return {
      id: row.id,
      salesPointId: row.sales_point_id,
      name: row.locations.location_name,
      isActive,
      isSalesTank: Boolean(row.is_sales_tank),
      effectivelySellable: isStorageLocationEffectivelySellable({ isActive }),
    };
  });
}

export async function loadProducts(): Promise<ProductRow[]> {
  const rows = await prisma.products.findMany({
    include: {
      product_cats: { select: { is_main: true, is_bottled: true } },
    },
    orderBy: { product_name: "asc" },
  });
  return rows.map((p) => ({
    productId: p.product_id,
    productName: p.product_name,
    productCode: p.product_code,
    productCatId: p.product_cat_id,
    isMain: p.product_cats.is_main ? 1 : 0,
    isBottled: p.product_cats.is_bottled ? 1 : 0,
    omitsStorageLocation: Boolean(p.omits_storage_location),
  }));
}

export function detectBottledPack(
  product: Pick<ProductRow, "productName" | "productCode">,
): BottledPackColumn {
  const text = `${product.productName} ${product.productCode ?? ""}`.toUpperCase();
  if (text.includes("20L") || text.includes("JUG")) {
    return { id: "jug20", label: "1X20L JUG", units: 0, litresPerUnit: 20 };
  }
  if (text.includes("3X5") || (text.includes("5L") && text.includes("CTN"))) {
    return { id: "carton5", label: "3X5L CTN", units: 0, litresPerUnit: 15 };
  }
  if (text.includes("15L")) {
    return { id: "carton15", label: "1X15L CTN", units: 0, litresPerUnit: 15 };
  }
  if (text.includes("1L")) {
    return { id: "unit1", label: "1L BOTTLE", units: 0, litresPerUnit: 1 };
  }
  return { id: "other", label: "OTHER", units: 0, litresPerUnit: 1 };
}

export function compareStorageLocationsForReport(
  a: StorageLocationRow,
  b: StorageLocationRow,
): number {
  const key = (loc: StorageLocationRow) => {
    const name = loc.name.toUpperCase();
    const nums = name.match(/\d+/g);
    const number = nums?.length
      ? Number.parseInt(nums[nums.length - 1]!, 10) || 0
      : 0;
    let rank = 9;
    if (name.includes("PRODUCTION") && name.includes("TANK")) rank = 0;
    else if (loc.isSalesTank || (name.includes("SALES") && name.includes("TANK")))
      rank = 1;
    else if (name.includes("BOTTLING") && name.includes("TANK")) rank = 2;
    else if (name.includes("PIT")) rank = 3;
    else if (name.includes("DRUM")) rank = 4;
    return { rank, number, name };
  };
  const ka = key(a);
  const kb = key(b);
  if (ka.rank !== kb.rank) return ka.rank - kb.rank;
  if (ka.number !== kb.number) return ka.number - kb.number;
  return ka.name.localeCompare(kb.name);
}
