/**
 * Stock intake oil grouping (Palm Oil / Sludge Oil / Palm Kernel).
 * Ports src/electron/stock/{stockIntakeBalance,stockIntakeMigration}.ts against Postgres.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import {
  applyMovement,
  signedDeltaForKind,
  type StockCondition,
  type StockMovementKind,
} from "./stockMovements.js";

const QTY_EPS = 0.000001;

const SLUDGE_OIL_POOL_PRODUCT_NAME = "Sludge Oil";
const PALM_KERNEL_POOL_PRODUCT_NAME = "Palm Kernel";
const LOOSE_PALM_OIL_PRODUCT_NAME = "Loose Palm Oil";

const SLUDGE_MEMBER_PRODUCT_NAMES = [
  "Bottom Tank Oil Grade A",
  "Palm Sludge Oil Grade B",
  "Palm Sludge Oil Grade C",
] as const;

const PALM_KERNEL_MEMBER_PRODUCT_NAMES = [
  "Cracked Palm Kernel",
  "Uncracked Palm Kernel",
] as const;

type Tx = Prisma.TransactionClient | PrismaClient;

type IntakeGroup = "PALM_OIL" | "SLUDGE_OIL" | "PALM_KERNEL";

type BalanceRow = {
  salesPointId: number;
  productId: number;
  storageLocationId: number | null;
  condition: StockCondition;
  qty: number;
};

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function poolBalanceKey(row: BalanceRow): string {
  return `${row.salesPointId}:${row.storageLocationId ?? "null"}:${row.condition}`;
}

async function loadProductNameIndex(
  tx: Tx,
): Promise<Map<string, number>> {
  const rows = await tx.products.findMany({
    select: { product_id: true, product_name: true },
  });
  const index = new Map<string, number>();
  for (const row of rows) {
    index.set(normalizeName(row.product_name), row.product_id);
  }
  return index;
}

function findProductByName(
  index: Map<string, number>,
  name: string,
): number | null {
  return index.get(normalizeName(name)) ?? null;
}

function findMemberIds(
  index: Map<string, number>,
  names: readonly string[],
): number[] {
  const ids: number[] = [];
  for (const name of names) {
    const id = findProductByName(index, name);
    if (id != null) ids.push(id);
  }
  return ids;
}

async function defaultCommercialServiceId(tx: Tx): Promise<string | null> {
  const row = await tx.commercial_services.findFirst({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function defaultProductCatId(
  tx: Tx,
  memberIds: number[],
): Promise<number | null> {
  if (memberIds.length > 0) {
    const row = await tx.products.findUnique({
      where: { product_id: memberIds[0] },
      select: { product_cat_id: true },
    });
    return row?.product_cat_id ?? null;
  }
  const cat = await tx.product_cats.findFirst({
    where: { is_bottled: false },
    orderBy: { product_cat_id: "asc" },
    select: { product_cat_id: true },
  });
  return cat?.product_cat_id ?? null;
}

async function ensurePoolProduct(
  tx: Tx,
  index: Map<string, number>,
  poolName: string,
  productCode: string,
  stockIntakeGroup: Exclude<IntakeGroup, "PALM_OIL">,
  memberIds: number[],
): Promise<number | null> {
  let poolId = findProductByName(index, poolName);
  const poolOmitsStorageLocation = stockIntakeGroup === "PALM_KERNEL";

  if (poolId == null) {
    const productCatId = await defaultProductCatId(tx, memberIds);
    if (productCatId == null) return null;
    const commercialServiceId = await defaultCommercialServiceId(tx);
    const created = await tx.products.create({
      data: {
        product_name: poolName,
        product_code: productCode,
        product_cat_id: productCatId,
        commercial_service_id: commercialServiceId,
        uom: "Kg",
        stock_intake_group: stockIntakeGroup,
        exclude_from_sales: true,
        stock_pool_product_id: null,
        omits_storage_location: poolOmitsStorageLocation,
        updated_at: new Date(),
      },
      select: { product_id: true },
    });
    poolId = created.product_id;
    index.set(normalizeName(poolName), poolId);
  } else {
    await tx.products.update({
      where: { product_id: poolId },
      data: {
        stock_intake_group: stockIntakeGroup,
        exclude_from_sales: true,
        stock_pool_product_id: null,
        ...(poolOmitsStorageLocation ? { omits_storage_location: true } : {}),
        updated_at: new Date(),
      },
    });
  }

  if (memberIds.length > 0) {
    await tx.products.updateMany({
      where: { product_id: { in: memberIds } },
      data: {
        stock_intake_group: stockIntakeGroup,
        stock_pool_product_id: poolId,
        updated_at: new Date(),
      },
    });
  }

  return poolId;
}

/** Idempotent backfill of intake pool products and member mappings. */
export async function applyStockIntakeProductBackfill(tx: Tx = prisma): Promise<void> {
  const index = await loadProductNameIndex(tx);

  await ensurePoolProduct(
    tx,
    index,
    SLUDGE_OIL_POOL_PRODUCT_NAME,
    "SLU",
    "SLUDGE_OIL",
    findMemberIds(index, SLUDGE_MEMBER_PRODUCT_NAMES),
  );

  await ensurePoolProduct(
    tx,
    index,
    PALM_KERNEL_POOL_PRODUCT_NAME,
    "PK",
    "PALM_KERNEL",
    findMemberIds(index, PALM_KERNEL_MEMBER_PRODUCT_NAMES),
  );

  const loosePalmOilId = findProductByName(index, LOOSE_PALM_OIL_PRODUCT_NAME);
  if (loosePalmOilId != null) {
    await tx.products.update({
      where: { product_id: loosePalmOilId },
      data: {
        stock_intake_group: "PALM_OIL",
        updated_at: new Date(),
      },
    });
  }
}

async function getAllIntakePoolProductIds(tx: Tx): Promise<number[]> {
  const index = await loadProductNameIndex(tx);
  const ids: number[] = [];
  for (const name of [SLUDGE_OIL_POOL_PRODUCT_NAME, PALM_KERNEL_POOL_PRODUCT_NAME]) {
    const id = findProductByName(index, name);
    if (id != null) ids.push(id);
  }
  return ids;
}

async function loadPositiveBalances(
  tx: Tx,
  productIds: number[],
): Promise<BalanceRow[]> {
  if (productIds.length === 0) return [];

  const rows = await tx.stock_movements.findMany({
    where: { product_id: { in: productIds } },
    select: {
      sales_point_id: true,
      product_id: true,
      storage_location_id: true,
      condition: true,
      kind: true,
      qty: true,
    },
  });

  const totals = new Map<string, BalanceRow>();
  for (const row of rows) {
    const condition: StockCondition =
      row.condition === "UNSELLABLE" ? "UNSELLABLE" : "SELLABLE";
    const key = `${row.sales_point_id}:${row.product_id}:${row.storage_location_id ?? "null"}:${condition}`;
    const signed = signedDeltaForKind(row.kind as StockMovementKind, row.qty);
    const existing = totals.get(key);
    if (existing) {
      existing.qty += signed;
    } else {
      totals.set(key, {
        salesPointId: row.sales_point_id,
        productId: row.product_id,
        storageLocationId: row.storage_location_id,
        condition,
        qty: signed,
      });
    }
  }

  return [...totals.values()].filter((row) => row.qty > QTY_EPS);
}

async function consolidatePoolBalances(
  tx: Tx,
  userId: string,
  poolId: number,
  memberIds: number[],
  notes: string,
): Promise<void> {
  if (memberIds.length === 0) return;

  const sourceId = randomUUID();
  const occurredAt = new Date();
  const memberBalances = await loadPositiveBalances(tx, memberIds);
  const poolTotals = new Map<string, number>();

  for (const row of memberBalances) {
    if (row.qty <= QTY_EPS) continue;

    await applyMovement(tx, {
      salesPointId: row.salesPointId,
      productId: row.productId,
      storageLocationId: row.storageLocationId,
      condition: row.condition,
      qty: formatQty(-row.qty),
      kind: "ADJUSTMENT",
      occurredAt,
      userId,
      sourceKind: "STOCK_INTAKE_GROUPING",
      sourceId,
      notes,
    });

    const key = poolBalanceKey(row);
    poolTotals.set(key, (poolTotals.get(key) ?? 0) + row.qty);
  }

  for (const [key, qty] of poolTotals) {
    const [salesPointId, locationToken, condition] = key.split(":");
    await applyMovement(tx, {
      salesPointId: Number.parseInt(salesPointId, 10),
      productId: poolId,
      storageLocationId:
        locationToken === "null" ? null : Number.parseInt(locationToken, 10),
      condition: condition as StockCondition,
      qty: formatQty(qty),
      kind: "ADJUSTMENT",
      occurredAt,
      userId,
      sourceKind: "STOCK_INTAKE_GROUPING",
      sourceId,
      notes,
    });
  }
}

async function splitPoolToLandingProduct(
  tx: Tx,
  userId: string,
  poolId: number,
  landingId: number,
  notes: string,
): Promise<void> {
  const sourceId = randomUUID();
  const occurredAt = new Date();
  const poolBalances = await loadPositiveBalances(tx, [poolId]);

  for (const row of poolBalances) {
    if (row.qty <= QTY_EPS) continue;

    await applyMovement(tx, {
      salesPointId: row.salesPointId,
      productId: poolId,
      storageLocationId: row.storageLocationId,
      condition: row.condition,
      qty: formatQty(-row.qty),
      kind: "ADJUSTMENT",
      occurredAt,
      userId,
      sourceKind: "STOCK_INTAKE_GROUPING",
      sourceId,
      notes: `${notes} (from pool)`,
    });

    await applyMovement(tx, {
      salesPointId: row.salesPointId,
      productId: landingId,
      storageLocationId: row.storageLocationId,
      condition: row.condition,
      qty: formatQty(row.qty),
      kind: "ADJUSTMENT",
      occurredAt,
      userId,
      sourceKind: "STOCK_INTAKE_GROUPING",
      sourceId,
      notes,
    });
  }
}

async function consolidateIntakePoolBalances(tx: Tx, userId: string): Promise<void> {
  const index = await loadProductNameIndex(tx);

  const sludgePoolId = findProductByName(index, SLUDGE_OIL_POOL_PRODUCT_NAME);
  if (sludgePoolId != null) {
    await consolidatePoolBalances(
      tx,
      userId,
      sludgePoolId,
      findMemberIds(index, SLUDGE_MEMBER_PRODUCT_NAMES),
      "Consolidate sludge grades into Sludge Oil pool",
    );
  }

  const palmKernelPoolId = findProductByName(index, PALM_KERNEL_POOL_PRODUCT_NAME);
  if (palmKernelPoolId != null) {
    await consolidatePoolBalances(
      tx,
      userId,
      palmKernelPoolId,
      findMemberIds(index, PALM_KERNEL_MEMBER_PRODUCT_NAMES),
      "Consolidate cracked/uncracked into Palm Kernel pool",
    );
  }
}

async function splitIntakePoolBalancesToLandingProducts(
  tx: Tx,
  userId: string,
): Promise<void> {
  const index = await loadProductNameIndex(tx);

  const sludgePoolId = findProductByName(index, SLUDGE_OIL_POOL_PRODUCT_NAME);
  const sludgeLandingId = findProductByName(index, SLUDGE_MEMBER_PRODUCT_NAMES[0]);
  if (sludgePoolId != null && sludgeLandingId != null) {
    await splitPoolToLandingProduct(
      tx,
      userId,
      sludgePoolId,
      sludgeLandingId,
      "Return Sludge Oil pool stock to Bottom Tank Oil Grade A",
    );
  }

  const palmKernelPoolId = findProductByName(index, PALM_KERNEL_POOL_PRODUCT_NAME);
  const palmKernelLandingId = findProductByName(
    index,
    PALM_KERNEL_MEMBER_PRODUCT_NAMES[0],
  );
  if (palmKernelPoolId != null && palmKernelLandingId != null) {
    await splitPoolToLandingProduct(
      tx,
      userId,
      palmKernelPoolId,
      palmKernelLandingId,
      "Return Palm Kernel pool stock to Cracked Palm Kernel",
    );
  }
}

export async function getIntakeOilGroupingStatus(): Promise<{
  enabled: boolean;
  poolTotalQty: number;
}> {
  const [company, poolIds] = await Promise.all([
    prisma.company_settings.findFirst({
      where: { id: "default" },
      select: { stock_intake_oil_grouping: true },
    }),
    getAllIntakePoolProductIds(prisma),
  ]);

  let poolTotalQty = 0;
  if (poolIds.length > 0) {
    const balances = await loadPositiveBalances(prisma, poolIds);
    poolTotalQty = balances.reduce((sum, row) => sum + row.qty, 0);
  }

  return {
    enabled: Boolean(company?.stock_intake_oil_grouping),
    poolTotalQty,
  };
}

export async function applyIntakeOilGrouping(
  userId: string,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await prisma.$transaction(
      async (tx) => {
        const company = await tx.company_settings.findFirst({
          where: { id: "default" },
          select: { stock_intake_oil_grouping: true },
        });
        const current = Boolean(company?.stock_intake_oil_grouping);

        if (current === enabled) {
          await tx.company_settings.update({
            where: { id: "default" },
            data: {
              stock_intake_oil_grouping: enabled,
              updated_at: new Date(),
            },
          });
          return;
        }

        if (enabled) {
          await applyStockIntakeProductBackfill(tx);
          await consolidateIntakePoolBalances(tx, userId);
        } else {
          await splitIntakePoolBalancesToLandingProducts(tx, userId);
        }

        await tx.company_settings.update({
          where: { id: "default" },
          data: {
            stock_intake_oil_grouping: enabled,
            updated_at: new Date(),
          },
        });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not update stock intake setting.",
    };
  }
}

/** When grouping is on, invoice/sale lines on member grades deduct from the pool. */
export async function resolveStockProductId(
  tx: Tx,
  productId: number,
  groupingEnabled?: boolean,
): Promise<number> {
  const enabled =
    groupingEnabled ??
    Boolean(
      (
        await tx.company_settings.findFirst({
          where: { id: "default" },
          select: { stock_intake_oil_grouping: true },
        })
      )?.stock_intake_oil_grouping,
    );
  if (!enabled) return productId;

  const row = await tx.products.findUnique({
    where: { product_id: productId },
    select: { stock_pool_product_id: true },
  });
  return row?.stock_pool_product_id ?? productId;
}
