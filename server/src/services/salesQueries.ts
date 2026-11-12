import { prisma } from "../db/prisma.js";
import { applyMovement } from "./stockMovements.js";
import { resolveStockProductId } from "./stockIntakeGrouping.js";
import { resolveSaleLineStorageLocationId } from "./saleStorageLocation.js";
import { assertSaleLinesStockAsOf } from "./saleStockAssert.js";
import {
  assertAction,
  assertRouteWrite,
  canPerformAction,
  loadRpcActor,
} from "./rpcActor.js";
import { getOpenPostingPeriodForActor } from "./financialYearsService.js";

const SALES_ROUTE_ID = "sales";
const BOTTLE_OIL_SALES_ROUTE_ID = "bottle-oil-sales";

async function resolveListDateRange(
  period: string,
  userId?: string | null,
): Promise<{
  fromIso: string | null;
  toIso: string | null;
  periodLabel: string;
}> {
  if (period === "all") {
    return { fromIso: null, toIso: null, periodLabel: "All time" };
  }

  const actorId = userId?.trim();
  if (!actorId) {
    throw new Error("Open a financial month before listing documents.");
  }

  // Match createSale: list the actor's open month (HO personal / CP month),
  // not a separate central window that can hide newly posted invoices.
  const open = await getOpenPostingPeriodForActor(actorId);
  if (!open) {
    throw new Error("Open a financial month before listing documents.");
  }

  if (period === "year") {
    const yearStart = `${open.financialYear}-01-01`;
    const yearEnd = `${open.financialYear}-12-31`;
    return {
      fromIso: yearStart,
      toIso: yearEnd,
      periodLabel: `FY ${open.financialYear}`,
    };
  }

  return {
    fromIso: open.startDate,
    toIso: open.endDate,
    periodLabel: `${open.monthName} ${open.financialYear}`,
  };
}

function formatProductSummary(
  lines: Array<{ productName: string }>,
): string {
  if (lines.length === 0) return "";
  if (lines.length === 1) return lines[0].productName;
  return `${lines[0].productName} +${lines.length - 1} more`;
}

function formatMoneyLabel(value: string | number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value);
  return `${Math.round(amount).toLocaleString("en-US")} XAF`;
}

function trimQtyLabel(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

function saleRouteIdForMode(saleProductMode: string | null | undefined): string {
  return String(saleProductMode ?? "LOOSE").toUpperCase() === "BOTTLE"
    ? BOTTLE_OIL_SALES_ROUTE_ID
    : SALES_ROUTE_ID;
}

export async function listSalesValidationQueue(input: {
  userId?: string;
  salesPointId?: number | null;
}) {
  if (input.userId?.trim()) {
    const actor = await loadRpcActor(input.userId);
    if (!canPerformAction(actor, "validate_sales")) {
      throw new Error("You do not have permission to validate sales.");
    }
  }

  const where: {
    status: string;
    sales_point_id?: number;
  } = { status: "PENDING" };
  if (input.salesPointId != null && Number.isFinite(input.salesPointId)) {
    where.sales_point_id = input.salesPointId;
  }

  const rows = await prisma.sales.findMany({
    where,
    orderBy: { created_at: "asc" },
    take: 200,
    include: {
      sale_lines: { select: { id: true } },
      sales_points: { select: { name: true } },
    },
  });

  const creatorIds = [...new Set(rows.map((r) => r.created_by_user_id))];
  const creators =
    creatorIds.length > 0
      ? await prisma.users.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, name: true },
        })
      : [];
  const creatorName = new Map(creators.map((u) => [u.id, u.name]));

  return {
    totalPending: rows.length,
    rows: rows.map((row) => ({
      id: row.id,
      invoiceNo: row.invoice_no,
      soldAtIso: String(row.date_issued).slice(0, 10),
      dateIssuedIso: row.date_issued,
      customerName: row.customer_name_snapshot,
      salesPointName: row.sales_points?.name ?? null,
      createdByName: creatorName.get(row.created_by_user_id) ?? "",
      saleProductMode: row.sale_product_mode,
      totalLabel: `${row.gross_amount} XAF`,
      lineCount: row.sale_lines.length,
    })),
  };
}

export async function listSales(filters: {
  userId?: string;
  q?: string;
  period?: string;
  productMode?: string;
  salesPointId?: number | null;
}) {
  const periodRaw = String(filters.period ?? "month");
  const period =
    periodRaw === "year" || periodRaw === "all" ? periodRaw : "month";
  const { fromIso, toIso, periodLabel } = await resolveListDateRange(
    period,
    filters.userId,
  );

  const where: Record<string, unknown> = {};
  if (filters.salesPointId != null && Number.isFinite(filters.salesPointId)) {
    where.sales_point_id = filters.salesPointId;
  }
  if (filters.productMode) {
    where.sale_product_mode = filters.productMode;
  }
  if (filters.q?.trim()) {
    const q = filters.q.trim();
    where.OR = [
      { invoice_no: { contains: q, mode: "insensitive" } },
      { customer_name_snapshot: { contains: q, mode: "insensitive" } },
    ];
  }
  if (fromIso && toIso) {
    where.date_issued = { gte: fromIso, lte: toIso };
  }

  const rows = await prisma.sales.findMany({
    where,
    orderBy: [{ date_issued: "desc" }, { invoice_no: "desc" }],
    take: 300,
    include: {
      sale_lines: true,
      sales_points: { select: { name: true } },
    },
  });

  const productIds = [
    ...new Set(rows.flatMap((row) => row.sale_lines.map((line) => line.product_id))),
  ];
  const products = productIds.length
    ? await prisma.products.findMany({
        where: { product_id: { in: productIds } },
        select: { product_id: true, product_name: true },
      })
    : [];
  const productName = new Map(
    products.map((product) => [product.product_id, product.product_name]),
  );

  const isBottledList = String(filters.productMode ?? "").toUpperCase() === "BOTTLE";
  let totalAmount = 0;
  let totalQty = 0;

  const mapped = rows.map((row) => {
    const gross = Number(row.gross_amount);
    let rowQty = 0;
    const lineSummaries = row.sale_lines.map((line) => {
      if (isBottledList) {
        rowQty += Number(line.qty_units ?? line.qty_kg) || 0;
      } else {
        rowQty += Number(line.qty_kg) || 0;
      }
      return {
        productName:
          productName.get(line.product_id) ?? `Product ${line.product_id}`,
      };
    });
    totalAmount += Number.isFinite(gross) ? gross : 0;
    totalQty += rowQty;

    return {
      id: row.id,
      invoiceNo: row.invoice_no,
      // UI Date column reads soldAtIso; show the posting/sale date, not created-at.
      soldAtIso: String(row.date_issued).slice(0, 10),
      salesPointName: row.sales_points?.name ?? "",
      deliveryOrderNo: row.delivery_order_no,
      customerName: row.customer_name_snapshot,
      productSummary: formatProductSummary(lineSummaries),
      status: row.status,
      totalQtyLabel: isBottledList
        ? `${trimQtyLabel(rowQty)} units`
        : `${trimQtyLabel(rowQty)} kg`,
      totalAmountXaf: formatMoneyLabel(row.gross_amount),
    };
  });

  return {
    rows: mapped,
    totals: {
      count: mapped.length,
      totalQtyLabel: isBottledList
        ? `${trimQtyLabel(totalQty)} units`
        : `${trimQtyLabel(totalQty)} kg`,
      totalAmountXaf: formatMoneyLabel(totalAmount),
    },
    periodLabel,
  };
}

export async function loadSaleByInvoiceNo(invoiceNo: string) {
  const trimmed = invoiceNo.trim();
  if (!trimmed) return null;

  const sale = await prisma.sales.findUnique({
    where: { invoice_no: trimmed },
    include: {
      sale_lines: { orderBy: { id: "asc" } },
      payments: { orderBy: { created_at: "asc" } },
      sales_points: { select: { name: true } },
    },
  });
  if (!sale) return null;

  const productIds = [...new Set(sale.sale_lines.map((line) => line.product_id))];
  const paymentMethodIds = [
    ...new Set(sale.payments.map((payment) => payment.payment_method_id)),
  ];
  const userIds = [
    sale.created_by_user_id,
    sale.validated_by_user_id,
    sale.cancelled_by_user_id,
  ].filter((id): id is string => Boolean(id));

  const [products, paymentMethods, users] = await Promise.all([
    productIds.length
      ? prisma.products.findMany({
          where: { product_id: { in: productIds } },
          include: {
            product_cats: { select: { product_cat: true } },
          },
        })
      : [],
    paymentMethodIds.length
      ? prisma.payment_method_definitions.findMany({
          where: { id: { in: paymentMethodIds } },
        })
      : [],
    userIds.length
      ? prisma.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const productById = new Map(
    products.map((product) => [
      product.product_id,
      {
        productName: product.product_name,
        productCat: product.product_cats?.product_cat ?? "",
      },
    ]),
  );
  const methodById = new Map(
    paymentMethods.map((method) => [
      method.id,
      {
        methodCode: method.code,
        methodName: method.name,
        kind: method.kind,
      },
    ]),
  );
  const userName = new Map(users.map((user) => [user.id, user.name]));

  return {
    id: sale.id,
    invoiceNo: sale.invoice_no,
    soldAtIso: sale.sold_at.toISOString(),
    referenceNumber: sale.reference_number,
    salesPointId: sale.sales_point_id,
    salesPointName: sale.sales_points?.name ?? null,
    customerId: sale.customer_id,
    customerName: sale.customer_name_snapshot,
    createdByUserId: sale.created_by_user_id,
    createdByName: userName.get(sale.created_by_user_id) ?? "",
    status: sale.status,
    validatedAtIso: sale.validated_at ? sale.validated_at.toISOString() : null,
    validatedByName: sale.validated_by_user_id
      ? (userName.get(sale.validated_by_user_id) ?? null)
      : null,
    cancelledAtIso: sale.cancelled_at ? sale.cancelled_at.toISOString() : null,
    cancelledByName: sale.cancelled_by_user_id
      ? (userName.get(sale.cancelled_by_user_id) ?? null)
      : null,
    cancelReason: sale.cancel_reason,
    vehicleNumber: sale.vehicle_number,
    dateIssuedIso: sale.date_issued,
    deliveryOrderNo: sale.delivery_order_no,
    saleProductMode: sale.sale_product_mode,
    saleDisposition: sale.sale_disposition,
    netAmount: String(sale.net_amount),
    vatAmount: String(sale.vat_amount),
    grossAmount: String(sale.gross_amount),
    lines: sale.sale_lines.map((line) => {
      const product = productById.get(line.product_id);
      return {
        productId: line.product_id,
        productName: product?.productName ?? `Product ${line.product_id}`,
        productCat: product?.productCat ?? "",
        storageLocationId: line.storage_location_id,
        qtyKg: String(line.qty_kg),
        qtyUnits: line.qty_units != null ? String(line.qty_units) : null,
        unitPricePerKg: String(line.unit_price_per_kg),
        unitPricePerUnit:
          line.unit_price_per_unit != null
            ? String(line.unit_price_per_unit)
            : null,
        lineNet: String(line.line_net),
        lineVat: String(line.line_vat),
        lineGross: String(line.line_gross),
      };
    }),
    payments: sale.payments.map((payment) => {
      const method = methodById.get(payment.payment_method_id);
      return {
        paymentMethodId: payment.payment_method_id,
        methodCode: method?.methodCode ?? "",
        methodName: method?.methodName ?? "",
        kind: method?.kind ?? "OTHER",
        amount: String(payment.amount),
        chequeNo: payment.cheque_no,
        bank: payment.bank,
        traiteNo: payment.traite_no,
        traiteIssuedOn: payment.traite_issued_on,
        traiteMaturityOn: payment.traite_maturity_on,
        paidAtIso: payment.paid_at.toISOString(),
      };
    }),
  };
}

export async function validateSaleCommand(input: {
  saleId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const actor = await loadRpcActor(input.userId);
    assertAction(
      actor,
      "validate_sales",
      "You do not have permission to validate sales.",
    );

    await prisma.$transaction(async (tx) => {
      const sale = await tx.sales.findUnique({
        where: { id: input.saleId },
        include: { sale_lines: true },
      });
      if (!sale) throw new Error("Sale not found.");
      if (sale.status === "VALIDATED") return;
      if (sale.status !== "PENDING") {
        throw new Error(`Cannot validate a sale in status ${sale.status}.`);
      }
      assertRouteWrite(actor, saleRouteIdForMode(sale.sale_product_mode));

      const isBottle = sale.sale_product_mode === "BOTTLE";
      const dateIssued =
        String(sale.date_issued ?? "").slice(0, 10) ||
        sale.sold_at.toISOString().slice(0, 10);
      const occurredAt = new Date(`${dateIssued}T12:00:00.000Z`);
      if (sale.sales_point_id != null) {
        await assertSaleLinesStockAsOf(tx, {
          salesPointId: sale.sales_point_id,
          dateIssued,
          isBottleMode: isBottle,
          excludeSaleId: sale.id,
          lines: sale.sale_lines.map((line) => ({
            productId: line.product_id,
            qtyKg: String(line.qty_kg),
            qtyUnits: line.qty_units,
            storageLocationId: line.storage_location_id,
          })),
        });

        for (const line of sale.sale_lines) {
          const qty = isBottle
            ? String(line.qty_units ?? line.qty_kg)
            : String(line.qty_kg);
          const catalog = await tx.products.findUnique({
            where: { product_id: line.product_id },
            select: { non_stockable: true },
          });
          if (catalog?.non_stockable) continue;
          const productId = await resolveStockProductId(tx, line.product_id);
          const stockProduct = await tx.products.findUnique({
            where: { product_id: productId },
            select: { non_stockable: true },
          });
          if (stockProduct?.non_stockable) continue;
          let storageLocationId = line.storage_location_id;
          if (isBottle && storageLocationId == null) {
            storageLocationId = await resolveSaleLineStorageLocationId(tx, {
              salesPointId: sale.sales_point_id,
              preferredLocationId: null,
              isBottleMode: true,
            });
            await tx.sale_lines.update({
              where: { id: line.id },
              data: { storage_location_id: storageLocationId },
            });
          }
          await applyMovement(tx, {
            salesPointId: sale.sales_point_id,
            productId,
            storageLocationId,
            qty,
            kind: "SALE",
            occurredAt,
            userId: input.userId,
            sourceKind: "SALE",
            sourceId: sale.id,
          });
        }
      }

      await tx.sales.update({
        where: { id: sale.id },
        data: {
          status: "VALIDATED",
          validated_at: new Date(),
          validated_by_user_id: input.userId,
          updated_at: new Date(),
        },
      });
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not validate sale.",
    };
  }
}

export async function cancelSaleCommand(input: {
  saleId: string;
  userId: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Cancellation reason is required." };

  try {
    const actor = await loadRpcActor(input.userId);
    assertAction(
      actor,
      "cancel_validated_sales",
      "You do not have permission to cancel validated sales.",
    );

    await prisma.$transaction(async (tx) => {
      const sale = await tx.sales.findUnique({ where: { id: input.saleId } });
      if (!sale) throw new Error("Sale not found.");
      if (sale.status !== "VALIDATED") {
        throw new Error("Only validated sales can be cancelled.");
      }
      assertRouteWrite(actor, saleRouteIdForMode(sale.sale_product_mode));

      // Reverse SALE movements for this source.
      const movements = await tx.stock_movements.findMany({
        where: { source_kind: "SALE", source_id: sale.id },
      });
      for (const mov of movements) {
        await applyMovement(tx, {
          salesPointId: mov.sales_point_id,
          productId: mov.product_id,
          storageLocationId: mov.storage_location_id,
          qty: mov.qty,
          kind: "SALE_REVERSAL",
          occurredAt: new Date(),
          userId: input.userId,
          sourceKind: "SALE_CANCEL",
          sourceId: sale.id,
          condition: (mov.condition as "SELLABLE" | "UNSELLABLE") || "SELLABLE",
          notes: reason,
        });
      }

      await tx.sales.update({
        where: { id: sale.id },
        data: {
          status: "REJECTED",
          cancelled_at: new Date(),
          cancelled_by_user_id: input.userId,
          cancel_reason: reason,
          updated_at: new Date(),
        },
      });
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not cancel sale.",
    };
  }
}

export async function deleteSaleCommand(input: {
  saleId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sale = await prisma.sales.findUnique({ where: { id: input.saleId } });
    if (!sale) return { ok: false, error: "Sale not found." };
    if (sale.status === "VALIDATED") {
      return { ok: false, error: "Validated sales cannot be deleted." };
    }
    await prisma.sales.delete({ where: { id: input.saleId } });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not delete sale.",
    };
  }
}

export async function validateManySalesCommand(input: {
  saleIds: string[];
  userId: string;
}) {
  const errors: Array<{ id: string; invoiceNo?: string; error: string }> = [];
  let validated = 0;
  for (const saleId of input.saleIds) {
    const result = await validateSaleCommand({ saleId, userId: input.userId });
    if (result.ok) {
      validated += 1;
    } else {
      errors.push({ id: saleId, error: result.error });
    }
  }
  return { ok: true as const, validated, errors };
}
