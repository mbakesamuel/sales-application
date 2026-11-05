import { prisma } from "../db/prisma.js";
import { applyMovement } from "./stockMovements.js";

export async function listSalesValidationQueue(input: {
  userId?: string;
  salesPointId?: number | null;
}) {
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
      soldAtIso: row.sold_at.toISOString(),
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
  productMode?: string;
  salesPointId?: number | null;
}) {
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

  const rows = await prisma.sales.findMany({
    where,
    orderBy: { sold_at: "desc" },
    take: 300,
    include: {
      sale_lines: true,
      sales_points: { select: { name: true } },
    },
  });

  const mapped = rows.map((row) => ({
    id: row.id,
    invoiceNo: row.invoice_no,
    soldAtIso: row.sold_at.toISOString(),
    salesPointName: row.sales_points?.name ?? "",
    deliveryOrderNo: row.delivery_order_no,
    customerName: row.customer_name_snapshot,
    productSummary: `${row.sale_lines.length} line(s)`,
    status: row.status,
    totalQtyLabel: "",
    totalAmountXaf: String(row.gross_amount),
  }));

  return {
    rows: mapped,
    totals: {
      count: mapped.length,
      totalQtyLabel: "",
      totalAmountXaf: String(
        mapped.reduce((sum, r) => sum + Number(r.totalAmountXaf || 0), 0),
      ),
    },
    periodLabel: "All",
  };
}

export async function loadSaleByInvoiceNo(invoiceNo: string) {
  const sale = await prisma.sales.findUnique({
    where: { invoice_no: invoiceNo.trim() },
    include: {
      sale_lines: true,
      payments: true,
      sales_points: { select: { name: true } },
    },
  });
  if (!sale) return null;

  return {
    id: sale.id,
    invoiceNo: sale.invoice_no,
    status: sale.status,
    soldAtIso: sale.sold_at.toISOString(),
    dateIssuedIso: sale.date_issued,
    customerId: sale.customer_id,
    customerName: sale.customer_name_snapshot,
    salesPointId: sale.sales_point_id,
    salesPointName: sale.sales_points?.name ?? null,
    vehicleNumber: sale.vehicle_number,
    deliveryOrderNo: sale.delivery_order_no,
    referenceNumber: sale.reference_number,
    saleProductMode: sale.sale_product_mode,
    saleDisposition: sale.sale_disposition,
    netAmount: String(sale.net_amount),
    vatAmount: String(sale.vat_amount),
    grossAmount: String(sale.gross_amount),
    lines: sale.sale_lines.map((line) => ({
      productId: line.product_id,
      qtyKg: String(line.qty_kg),
      qtyUnits: line.qty_units != null ? String(line.qty_units) : null,
      unitPricePerKg: String(line.unit_price_per_kg),
      unitPricePerUnit:
        line.unit_price_per_unit != null ? String(line.unit_price_per_unit) : null,
      lineNet: String(line.line_net),
      lineVat: String(line.line_vat),
      lineGross: String(line.line_gross),
      storageLocationId: line.storage_location_id,
    })),
    payments: sale.payments.map((p) => ({
      paymentMethodId: p.payment_method_id,
      amount: String(p.amount),
      chequeNo: p.cheque_no,
      bank: p.bank,
      traiteNo: p.traite_no,
      traiteIssuedOn: p.traite_issued_on,
      traiteMaturityOn: p.traite_maturity_on,
    })),
  };
}

export async function validateSaleCommand(input: {
  saleId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
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

      const isBottle = sale.sale_product_mode === "BOTTLE";
      const occurredAt = sale.sold_at;
      if (sale.sales_point_id != null) {
        for (const line of sale.sale_lines) {
          const qty = isBottle
            ? String(line.qty_units ?? line.qty_kg)
            : String(line.qty_kg);
          await applyMovement(tx, {
            salesPointId: sale.sales_point_id,
            productId: line.product_id,
            storageLocationId: line.storage_location_id,
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
    await prisma.$transaction(async (tx) => {
      const sale = await tx.sales.findUnique({ where: { id: input.saleId } });
      if (!sale) throw new Error("Sale not found.");
      if (sale.status !== "VALIDATED") {
        throw new Error("Only validated sales can be cancelled.");
      }

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
