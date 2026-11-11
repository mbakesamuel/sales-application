/**
 * Carry-forward / opening-balance stock RPCs against Postgres.
 * Ports src/electron/stock/carryForwardStock.ts.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { getOpenPostingPeriodForActor } from "./financialYearsService.js";
import {
  assertRouteWrite,
  canPerformAction,
  loadRpcActor,
} from "./rpcActor.js";
import { allocateDocumentSequence } from "./sequences.js";
import {
  applyMovement,
  financialYearFromIsoDate,
  getBalanceQty,
  parseIsoDateTime,
} from "./stockMovements.js";
import { listSalesPoints } from "./mastersQueries.js";

const ROUTE_ID = "carry-forward-stock";
const QTY_EPS = 0.000001;

export type UpsertCarryForwardStockBatchInput = {
  userId: string;
  salesPointId: number;
  occurredAt: string;
  notes?: string | null;
  lines: Array<{
    storageLocationId?: number | null;
    productId: number;
    onHandQty: number;
  }>;
};

export type CarryForwardStockBatchResult =
  | {
      ok: true;
      saved: number;
      adjustmentNo: string | null;
      pendingValidation?: boolean;
    }
  | { ok: false; error: string };

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function parseQty(value: string | number | null | undefined): number {
  const n = Number.parseFloat(String(value ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function isStockPoolProduct(product: {
  excludeFromSales: boolean;
  stockPoolProductId: number | null;
  stockIntakeGroup: string | null;
}): boolean {
  return (
    Boolean(product.excludeFromSales) &&
    product.stockPoolProductId == null &&
    product.stockIntakeGroup != null
  );
}

function requiresValidation(actor: Awaited<ReturnType<typeof loadRpcActor>>): boolean {
  return !(
    canPerformAction(actor, "validate_stock_documents") ||
    canPerformAction(actor, "validate_delivery_orders")
  );
}

export async function getFormOptions() {
  const [productRows, salesPoints, storageRows, company] = await Promise.all([
    prisma.products.findMany({
      include: {
        product_cats: { select: { is_bottled: true, product_code: true } },
      },
      orderBy: { product_name: "asc" },
    }),
    listSalesPoints(),
    prisma.storage_locations.findMany({
      where: { sales_points: { is_active: true } },
      include: { locations: { select: { location_name: true } } },
      orderBy: [
        { sales_point_id: "asc" },
        { is_default: "desc" },
        { id: "asc" },
      ],
    }),
    prisma.company_settings.findFirst({
      where: { id: "default" },
      select: { stock_intake_oil_grouping: true },
    }),
  ]);

  const products = productRows.map((p) => {
    const stockIntakeGroup =
      p.stock_intake_group === "PALM_OIL" ||
      p.stock_intake_group === "SLUDGE_OIL" ||
      p.stock_intake_group === "PALM_KERNEL"
        ? p.stock_intake_group
        : null;
    const excludeFromSales = Boolean(p.exclude_from_sales);
    const stockPoolProductId = p.stock_pool_product_id ?? null;
    return {
      productId: p.product_id,
      productName: p.product_name,
      uom: p.uom || "Kg",
      isBottled: Boolean(p.product_cats?.is_bottled),
      productCatCode: p.product_cats?.product_code ?? "",
      omitsStorageLocation: Boolean(p.omits_storage_location),
      stockIntakeGroup,
      stockPoolProductId,
      excludeFromSales,
      isStockPool: isStockPoolProduct({
        excludeFromSales,
        stockPoolProductId,
        stockIntakeGroup,
      }),
    };
  });

  const storageLocations = storageRows
    .slice()
    .sort((a, b) => {
      if (a.sales_point_id !== b.sales_point_id) {
        return a.sales_point_id - b.sales_point_id;
      }
      if (a.is_default !== b.is_default) {
        return Number(b.is_default) - Number(a.is_default);
      }
      const nameA = a.locations?.location_name ?? "";
      const nameB = b.locations?.location_name ?? "";
      return nameA.localeCompare(nameB);
    })
    .map((s) => ({
      id: s.id,
      salesPointId: s.sales_point_id,
      name: s.locations?.location_name ?? `Storage #${s.id}`,
      isDefault: Boolean(s.is_default),
    }));

  return {
    products,
    salesPoints: salesPoints.map((sp) => ({ id: sp.id, name: sp.name })),
    storageLocations,
    stockIntakeOilGrouping: Boolean(company?.stock_intake_oil_grouping),
  };
}

export async function list(): Promise<
  Array<{
    salesPointId: number;
    salesPointName: string;
    storageLocationId: number | null;
    storageLocationName: string;
    productId: number;
    productName: string;
    uom: string;
    currentQty: number;
    lastAdjustmentNo: string | null;
    lastOccurredAt: string | null;
  }>
> {
  const adjustments = await prisma.stock_adjustments.findMany({
    where: { source_kind: "CARRY_FORWARD", status: "POSTED" },
    include: {
      sales_points: { select: { name: true } },
      stock_adjustment_lines: true,
    },
    orderBy: [{ occurred_at: "desc" }, { adjustment_no: "desc" }],
  });

  type Key = string;
  const latestByKey = new Map<
    Key,
    {
      salesPointId: number;
      salesPointName: string;
      storageLocationId: number | null;
      productId: number;
      lastAdjustmentNo: string;
      lastOccurredAt: string;
    }
  >();

  const productIds = new Set<number>();
  const locationIds = new Set<number>();

  for (const adj of adjustments) {
    for (const line of adj.stock_adjustment_lines) {
      productIds.add(line.product_id);
      if (line.storage_location_id != null) {
        locationIds.add(line.storage_location_id);
      }
      const key = `${adj.sales_point_id}:${line.storage_location_id ?? "null"}:${line.product_id}`;
      if (latestByKey.has(key)) continue;
      latestByKey.set(key, {
        salesPointId: adj.sales_point_id,
        salesPointName: adj.sales_points.name,
        storageLocationId: line.storage_location_id,
        productId: line.product_id,
        lastAdjustmentNo: adj.adjustment_no,
        lastOccurredAt: adj.occurred_at.toISOString().slice(0, 10),
      });
    }
  }

  const [products, locations] = await Promise.all([
    productIds.size > 0
      ? prisma.products.findMany({
          where: { product_id: { in: [...productIds] } },
          select: { product_id: true, product_name: true, uom: true },
        })
      : Promise.resolve([]),
    locationIds.size > 0
      ? prisma.storage_locations.findMany({
          where: { id: { in: [...locationIds] } },
          include: { locations: { select: { location_name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const productById = new Map(
    products.map((p) => [
      p.product_id,
      { name: p.product_name, uom: p.uom || "Kg" },
    ]),
  );
  const locationById = new Map(
    locations.map((l) => [
      l.id,
      l.locations?.location_name ?? `Storage #${l.id}`,
    ]),
  );

  const rows = await Promise.all(
    [...latestByKey.values()].map(async (row) => {
      const product = productById.get(row.productId);
      const currentQty = await getBalanceQty(
        prisma,
        row.salesPointId,
        row.productId,
        row.storageLocationId,
        "SELLABLE",
      );
      return {
        salesPointId: row.salesPointId,
        salesPointName: row.salesPointName,
        storageLocationId: row.storageLocationId,
        storageLocationName:
          row.storageLocationId == null
            ? "—"
            : (locationById.get(row.storageLocationId) ?? "—"),
        productId: row.productId,
        productName: product?.name ?? `Product ${row.productId}`,
        uom: product?.uom ?? "Kg",
        currentQty,
        lastAdjustmentNo: row.lastAdjustmentNo,
        lastOccurredAt: row.lastOccurredAt,
      };
    }),
  );

  rows.sort((a, b) => {
    const bySp = a.salesPointName.localeCompare(b.salesPointName);
    if (bySp !== 0) return bySp;
    const byProduct = a.productName.localeCompare(b.productName);
    if (byProduct !== 0) return byProduct;
    return a.storageLocationName.localeCompare(b.storageLocationName);
  });

  return rows;
}

export async function listPending(userId: string) {
  await loadRpcActor(userId);

  const adjustments = await prisma.stock_adjustments.findMany({
    where: {
      status: "DRAFT",
      source_kind: "CARRY_FORWARD",
      created_by_user_id: userId,
    },
    include: {
      sales_points: { select: { name: true } },
      stock_adjustment_lines: true,
    },
    orderBy: [{ occurred_at: "desc" }, { adjustment_no: "desc" }],
  });

  const productIds = [
    ...new Set(
      adjustments.flatMap((a) =>
        a.stock_adjustment_lines.map((l) => l.product_id),
      ),
    ),
  ];
  const locationIds = [
    ...new Set(
      adjustments.flatMap((a) =>
        a.stock_adjustment_lines
          .map((l) => l.storage_location_id)
          .filter((id): id is number => id != null),
      ),
    ),
  ];

  const [products, locations] = await Promise.all([
    productIds.length > 0
      ? prisma.products.findMany({
          where: { product_id: { in: productIds } },
          select: { product_id: true, product_name: true, uom: true },
        })
      : Promise.resolve([]),
    locationIds.length > 0
      ? prisma.storage_locations.findMany({
          where: { id: { in: locationIds } },
          include: { locations: { select: { location_name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const productById = new Map(
    products.map((p) => [
      p.product_id,
      { name: p.product_name, uom: p.uom || "Kg" },
    ]),
  );
  const locationById = new Map(
    locations.map((l) => [
      l.id,
      l.locations?.location_name ?? `Storage #${l.id}`,
    ]),
  );

  const rows = [];
  for (const adj of adjustments) {
    for (const line of adj.stock_adjustment_lines) {
      const product = productById.get(line.product_id);
      const currentQty = await getBalanceQty(
        prisma,
        adj.sales_point_id,
        line.product_id,
        line.storage_location_id,
        "SELLABLE",
      );
      const deltaQty = parseQty(line.delta_qty);
      rows.push({
        adjustmentId: adj.id,
        adjustmentNo: adj.adjustment_no,
        occurredAt: adj.occurred_at.toISOString().slice(0, 10),
        submittedAt: adj.created_at.toISOString(),
        salesPointId: adj.sales_point_id,
        salesPointName: adj.sales_points.name,
        productId: line.product_id,
        productName: product?.name ?? `Product ${line.product_id}`,
        uom: product?.uom ?? "Kg",
        storageLocationId: line.storage_location_id,
        storageLocationName:
          line.storage_location_id == null
            ? "—"
            : (locationById.get(line.storage_location_id) ?? "—"),
        currentQty,
        proposedQty: currentQty + deltaQty,
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = b.occurredAt.localeCompare(a.occurredAt);
    if (byDate !== 0) return byDate;
    const byNo = b.adjustmentNo.localeCompare(a.adjustmentNo);
    if (byNo !== 0) return byNo;
    const byProduct = a.productName.localeCompare(b.productName);
    if (byProduct !== 0) return byProduct;
    return a.storageLocationName.localeCompare(b.storageLocationName);
  });

  return rows;
}

export async function listOnHand(salesPointId: number, productId: number) {
  if (!Number.isFinite(salesPointId) || !Number.isFinite(productId)) {
    return [];
  }

  const locationRows = await prisma.storage_locations.findMany({
    where: { sales_point_id: salesPointId },
    select: { id: true },
  });

  const results: Array<{ storageLocationId: number | null; qty: number }> = [];
  const nullQty = await getBalanceQty(
    prisma,
    salesPointId,
    productId,
    null,
    "SELLABLE",
  );
  if (Math.abs(nullQty) > QTY_EPS) {
    results.push({ storageLocationId: null, qty: nullQty });
  }

  for (const loc of locationRows) {
    const qty = await getBalanceQty(
      prisma,
      salesPointId,
      productId,
      loc.id,
      "SELLABLE",
    );
    if (Math.abs(qty) > QTY_EPS) {
      results.push({ storageLocationId: loc.id, qty });
    }
  }

  return results;
}

export async function upsertBatch(
  input: UpsertCarryForwardStockBatchInput,
): Promise<CarryForwardStockBatchResult> {
  try {
    const actor = await loadRpcActor(input.userId);
    assertRouteWrite(actor, ROUTE_ID);

    const period = await getOpenPostingPeriodForActor(input.userId);
    if (!period) {
      return {
        ok: false,
        error: "Open a financial month before posting carry-forward stock.",
      };
    }

    const occurredDate = String(input.occurredAt ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredDate)) {
      return { ok: false, error: "Invalid occurrence date." };
    }
    if (occurredDate < period.startDate || occurredDate > period.endDate) {
      return {
        ok: false,
        error: `Occurrence date must fall in the open month (${period.startDate}–${period.endDate}).`,
      };
    }

    const salesPointId = Number(input.salesPointId);
    if (!Number.isFinite(salesPointId)) {
      return { ok: false, error: "Collection point is required." };
    }

    const salesPoint = await prisma.sales_points.findFirst({
      where: { id: salesPointId, is_active: true },
      select: { id: true },
    });
    if (!salesPoint) {
      return { ok: false, error: "Collection point not found or inactive." };
    }

    const productIds = [
      ...new Set(
        (input.lines ?? [])
          .map((line) => Number(line.productId))
          .filter((id) => Number.isFinite(id)),
      ),
    ];
    const products =
      productIds.length > 0
        ? await prisma.products.findMany({
            where: { product_id: { in: productIds } },
            select: {
              product_id: true,
              omits_storage_location: true,
            },
          })
        : [];
    const productById = new Map(products.map((p) => [p.product_id, p]));

    const seen = new Set<string>();
    const deltas: Array<{
      productId: number;
      storageLocationId: number | null;
      deltaQty: number;
    }> = [];

    for (const line of input.lines ?? []) {
      const productId = Number(line.productId);
      const onHandQty = Number(line.onHandQty);
      if (!Number.isFinite(productId) || !Number.isFinite(onHandQty) || onHandQty < 0) {
        continue;
      }

      const product = productById.get(productId);
      if (!product) {
        return { ok: false, error: "Product not found." };
      }

      let storageLocationId: number | null;
      if (product.omits_storage_location) {
        const rawLoc = line.storageLocationId;
        if (rawLoc != null && Number.isFinite(Number(rawLoc))) {
          return {
            ok: false,
            error: "Palm Kernel / Cake products do not use storage locations.",
          };
        }
        storageLocationId = null;
      } else {
        storageLocationId = Number(line.storageLocationId);
        if (!Number.isFinite(storageLocationId)) {
          continue;
        }
        const location = await prisma.storage_locations.findFirst({
          where: { id: storageLocationId, sales_point_id: salesPointId },
          select: { id: true },
        });
        if (!location) {
          return {
            ok: false,
            error: "Storage location does not belong to the collection point.",
          };
        }
      }

      const pairKey =
        storageLocationId == null
          ? `null:${productId}`
          : `${storageLocationId}:${productId}`;
      if (seen.has(pairKey)) {
        return {
          ok: false,
          error:
            storageLocationId == null
              ? "Duplicate product in the same batch."
              : "Duplicate location and product in the same batch.",
        };
      }
      seen.add(pairKey);

      const current = await getBalanceQty(
        prisma,
        salesPointId,
        productId,
        storageLocationId,
        "SELLABLE",
      );
      const delta = onHandQty - current;
      if (Math.abs(delta) <= QTY_EPS) {
        continue;
      }
      deltas.push({ productId, storageLocationId, deltaQty: delta });
    }

    if (deltas.length === 0) {
      return { ok: true, saved: 0, adjustmentNo: null };
    }

    const pendingValidation = requiresValidation(actor);
    const occurredAt = parseIsoDateTime(occurredDate);
    const reason = (input.notes ?? "").trim() || "Carry-forward stock";
    const financialYear = financialYearFromIsoDate(occurredDate);
    const id = randomUUID();

    const allocated = await allocateDocumentSequence({
      salesPointId,
      documentKind: "STOCK_ADJUSTMENT",
      financialYear,
    });
    const adjustmentNo = allocated.documentNo;

    await prisma.$transaction(async (tx) => {
      await tx.stock_adjustments.create({
        data: {
          id,
          adjustment_no: adjustmentNo,
          sales_point_id: salesPointId,
          occurred_at: occurredAt,
          reason,
          status: "DRAFT",
          source_kind: "CARRY_FORWARD",
          created_by_user_id: input.userId,
        },
      });

      for (const line of deltas) {
        await tx.stock_adjustment_lines.create({
          data: {
            id: randomUUID(),
            adjustment_id: id,
            product_id: line.productId,
            delta_qty: formatQty(line.deltaQty),
            storage_location_id: line.storageLocationId,
            from_condition: null,
            to_condition: null,
          },
        });
      }

      if (!pendingValidation) {
        for (const line of deltas) {
          await applyMovement(tx, {
            salesPointId,
            productId: line.productId,
            storageLocationId: line.storageLocationId,
            qty: formatQty(line.deltaQty),
            kind: "ADJUSTMENT",
            occurredAt,
            userId: input.userId,
            sourceKind: "ADJUSTMENT",
            sourceId: id,
            condition: "SELLABLE",
            notes: "Carry-forward stock",
          });
        }

        await tx.stock_adjustments.update({
          where: { id },
          data: {
            status: "POSTED",
            posted_by_user_id: input.userId,
            posted_at: new Date(),
            updated_at: new Date(),
          },
        });
      }
    });

    return {
      ok: true,
      saved: deltas.length,
      adjustmentNo,
      pendingValidation,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to post carry-forward stock.",
    };
  }
}
