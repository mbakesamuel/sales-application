import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Bottle oil sells from Bottled Oil Store (not a sales tank). When the UI omits
 * storageLocationId, resolve it the same way Electron legacy createSale does.
 */
export async function resolveSaleLineStorageLocationId(
  db: Db,
  args: {
    salesPointId: number;
    preferredLocationId?: number | null;
    isBottleMode: boolean;
  },
): Promise<number | null> {
  const preferred =
    args.preferredLocationId != null && Number.isFinite(args.preferredLocationId)
      ? Number(args.preferredLocationId)
      : null;

  if (args.isBottleMode) {
    if (preferred != null) {
      const match = await db.storage_locations.findFirst({
        where: {
          id: preferred,
          sales_point_id: args.salesPointId,
          is_active: true,
        },
        select: { id: true },
      });
      if (match) return match.id;
    }

    const bottleLocations = await db.storage_locations.findMany({
      where: {
        sales_point_id: args.salesPointId,
        is_active: true,
      },
      include: { locations: { select: { location_name: true } } },
      orderBy: [{ is_sales_tank: "asc" }, { is_default: "desc" }, { id: "asc" }],
      take: 50,
    });
    const bottle = bottleLocations.find((row) =>
      String(row.locations?.location_name ?? "")
        .toLowerCase()
        .includes("bottle"),
    );
    if (bottle) return bottle.id;

    throw new Error(
      "No Bottle Oil Store is configured for this collection point.",
    );
  }

  if (preferred != null) {
    const match = await db.storage_locations.findFirst({
      where: {
        id: preferred,
        sales_point_id: args.salesPointId,
        is_active: true,
      },
      select: { id: true },
    });
    if (match) return match.id;
  }

  const fallback = await db.storage_locations.findFirst({
    where: {
      sales_point_id: args.salesPointId,
      is_active: true,
    },
    orderBy: [{ is_default: "desc" }, { id: "asc" }],
    select: { id: true },
  });
  return fallback?.id ?? null;
}

export async function findBottleOilStoreLocationId(
  db: Db,
  botaSalesPointId: number | null,
): Promise<number | null> {
  if (botaSalesPointId == null) return null;
  try {
    return await resolveSaleLineStorageLocationId(db, {
      salesPointId: botaSalesPointId,
      preferredLocationId: null,
      isBottleMode: true,
    });
  } catch {
    return null;
  }
}
