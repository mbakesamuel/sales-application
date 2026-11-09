/**
 * Commitment report (customer × sales-point matrix by product category).
 * Ports src/electron/reports/commitmentReport.ts + commitmentAsOf.ts.
 */
import { prisma } from "../../db/prisma.js";
import {
  loadReportComments,
  loadReportCompanySettings,
  nowIso,
  resolveReportAsAt,
} from "../reportCompany.js";
import {
  loadProducts,
  loadSalesPointsForUser,
  parseQty,
  reportScopedSalesPointId,
  sum,
  type ProductRow,
  type SalesPointRow,
} from "./reportShared.js";

type CategoryRow = {
  productCatId: number;
  productCat: string;
  isMain: number;
  isBottled: number;
};

type OutstandingCommitment = {
  customerId: number;
  customerName: string;
  salesPointId: number;
  productId: number;
  productName: string;
  productCatId: number;
  isMain: number;
  isBottled: number;
  categoryName: string;
  qty: number;
};

type CommitmentReportRow = {
  label: string;
  quantities: number[];
  rowTotal: number;
  kind: "data" | "total";
};

type CommitmentReportSection = {
  sectionLetter: string;
  title: string;
  salesPointNames: string[];
  rows: CommitmentReportRow[];
  columnTotals: number[];
  grandTotal: number;
};

export type CommitmentReport = {
  settings: Awaited<ReturnType<typeof loadReportCompanySettings>>;
  asAtIso: string;
  generatedAtIso: string;
  sections: CommitmentReportSection[];
  salesPointNames: string[];
  columnTotals: number[];
  grandTotal: number;
  comments: string | null;
};

const SECTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

async function loadCategories(): Promise<CategoryRow[]> {
  const rows = await prisma.product_cats.findMany({
    orderBy: [
      { is_bottled: "asc" },
      { is_main: "desc" },
      { product_cat: "asc" },
    ],
  });
  return rows.map((r) => ({
    productCatId: r.product_cat_id,
    productCat: r.product_cat,
    isMain: r.is_main ? 1 : 0,
    isBottled: r.is_bottled ? 1 : 0,
  }));
}

/**
 * Outstanding DO commitments as of asAtIso (inclusive).
 * VALIDATED DOs with date_issued <= asAt, minus sales on those DOs
 * with date_issued <= asAt (PENDING + VALIDATED).
 */
export async function loadOutstandingCommitmentsAsOf(
  asAtDateIso: string,
  options?: { hideZero?: boolean; salesPointId?: number | null },
): Promise<OutstandingCommitment[]> {
  const asAt = asAtDateIso.slice(0, 10);
  const hideZero = options?.hideZero ?? false;
  const salesPointId =
    options?.salesPointId != null && Number.isFinite(Number(options.salesPointId))
      ? Number(options.salesPointId)
      : null;

  const orderRows = await prisma.delivery_orders.findMany({
    where: {
      status: "VALIDATED",
      customer_id: { not: null },
      ...(salesPointId != null ? { sales_point_id: salesPointId } : {}),
    },
    select: {
      delivery_order_no: true,
      customer_id: true,
      sales_point_id: true,
      date_issued: true,
      delivery_order_details: {
        select: { product_id: true, order_qty: true },
      },
    },
  });
  // Match Electron: substr(dateIssued, 1, 10) <= asAt (ISO date strings).
  const orders = orderRows.filter(
    (o) => String(o.date_issued).slice(0, 10) <= asAt,
  );

  const customerIds = [
    ...new Set(
      orders
        .map((o) => o.customer_id)
        .filter((id): id is number => id != null),
    ),
  ];
  const productIds = [
    ...new Set(
      orders.flatMap((o) =>
        o.delivery_order_details.map((d) => d.product_id),
      ),
    ),
  ];

  const [customers, products, sales] = await Promise.all([
    customerIds.length > 0
      ? prisma.customers.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    productIds.length > 0
      ? prisma.products.findMany({
          where: { product_id: { in: productIds } },
          select: {
            product_id: true,
            product_name: true,
            product_cat_id: true,
            product_cats: {
              select: {
                product_cat: true,
                is_main: true,
                is_bottled: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    prisma.sales.findMany({
      where: {
        delivery_order_no: { not: null },
        status: { in: ["PENDING", "VALIDATED"] },
      },
      select: {
        delivery_order_no: true,
        date_issued: true,
        sale_lines: { select: { product_id: true, qty_kg: true } },
      },
    }),
  ]);

  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const productById = new Map(
    products.map((p) => [
      p.product_id,
      {
        productName: p.product_name,
        productCatId: p.product_cat_id,
        isMain: p.product_cats.is_main ? 1 : 0,
        isBottled: p.product_cats.is_bottled ? 1 : 0,
        categoryName: p.product_cats.product_cat,
      },
    ]),
  );

  const soldByDoProduct = new Map<string, number>();
  for (const sale of sales) {
    if (String(sale.date_issued).slice(0, 10) > asAt) continue;
    const doNo = sale.delivery_order_no;
    if (!doNo) continue;
    for (const line of sale.sale_lines) {
      const key = `${doNo}:${line.product_id}`;
      soldByDoProduct.set(
        key,
        (soldByDoProduct.get(key) ?? 0) + parseQty(line.qty_kg),
      );
    }
  }

  const totals = new Map<string, OutstandingCommitment>();

  for (const order of orders) {
    const customerId = order.customer_id;
    if (customerId == null) continue;
    const name =
      customerName.get(customerId)?.trim() || `Customer #${customerId}`;

    for (const detail of order.delivery_order_details) {
      const product = productById.get(detail.product_id);
      if (!product) continue;
      const sold =
        soldByDoProduct.get(
          `${order.delivery_order_no}:${detail.product_id}`,
        ) ?? 0;
      const outstanding = Math.max(parseQty(detail.order_qty) - sold, 0);
      if (hideZero && outstanding <= 0) continue;

      const key = `${customerId}:${order.sales_point_id}:${detail.product_id}`;
      const existing = totals.get(key);
      if (existing) {
        existing.qty += outstanding;
        continue;
      }

      totals.set(key, {
        customerId,
        customerName: name,
        salesPointId: order.sales_point_id,
        productId: detail.product_id,
        productName: product.productName,
        productCatId: product.productCatId,
        isMain: product.isMain,
        isBottled: product.isBottled,
        categoryName: product.categoryName,
        qty: outstanding,
      });
    }
  }

  return [...totals.values()];
}

/** Aggregate as-of outstanding by sales point + product (stock-commitment metrics). */
export async function loadCommitmentMetricsAsOf(
  asAtDateIso: string,
  options?: { salesPointId?: number | null },
): Promise<Array<{ salesPointId: number; productId: number; qty: number }>> {
  const totals = new Map<string, number>();
  for (const row of await loadOutstandingCommitmentsAsOf(asAtDateIso, {
    hideZero: true,
    salesPointId: options?.salesPointId,
  })) {
    const key = `${row.salesPointId}:${row.productId}`;
    totals.set(key, (totals.get(key) ?? 0) + row.qty);
  }
  return [...totals.entries()].map(([key, qty]) => {
    const [salesPointId, productId] = key
      .split(":")
      .map((value) => Number.parseInt(value, 10));
    return { salesPointId, productId, qty };
  });
}

function qtyForSalesPoint(
  commitments: OutstandingCommitment[],
  salesPointId: number,
  predicate: (row: OutstandingCommitment) => boolean,
): number {
  return sum(
    commitments
      .filter((row) => predicate(row) && row.salesPointId === salesPointId)
      .map((row) => row.qty),
  );
}

function buildSection(
  sectionLetter: string,
  category: CategoryRow,
  salesPoints: SalesPointRow[],
  commitments: OutstandingCommitment[],
  products: ProductRow[],
  hideZero: boolean,
): CommitmentReportSection | null {
  const categoryProducts = products.filter(
    (product) => product.productCatId === category.productCatId,
  );
  if (categoryProducts.length === 0) {
    return null;
  }

  const categoryCommitments = commitments.filter(
    (row) => row.productCatId === category.productCatId,
  );
  const salesPointNames = salesPoints.map((sp) => sp.name.toUpperCase());

  const rowKeys = new Map<string, { customerName: string }>();
  for (const commitment of categoryCommitments) {
    const key = String(commitment.customerId);
    if (!rowKeys.has(key)) {
      rowKeys.set(key, { customerName: commitment.customerName });
    }
  }

  const dataRows: CommitmentReportRow[] = [...rowKeys.entries()]
    .map(([key, meta]) => {
      const predicate = (row: OutstandingCommitment) =>
        String(row.customerId) === key;
      const quantities = salesPoints.map((salesPoint) =>
        qtyForSalesPoint(categoryCommitments, salesPoint.id, predicate),
      );
      const rowTotal = sum(quantities);
      return {
        label: meta.customerName.trim().toUpperCase(),
        quantities,
        rowTotal,
        kind: "data" as const,
      };
    })
    .filter((row) => !hideZero || row.rowTotal > 0)
    .sort((left, right) => left.label.localeCompare(right.label));

  if (hideZero && dataRows.length === 0) {
    return null;
  }

  const columnTotals = salesPoints.map((salesPoint) =>
    sum(
      categoryCommitments
        .filter((row) => row.salesPointId === salesPoint.id)
        .map((row) => row.qty),
    ),
  );
  const grandTotal = sum(columnTotals);

  return {
    sectionLetter,
    title: category.productCat.toUpperCase(),
    salesPointNames,
    rows: [
      ...dataRows,
      {
        label: "TOTAL",
        quantities: columnTotals,
        rowTotal: grandTotal,
        kind: "total",
      },
    ],
    columnTotals,
    grandTotal,
  };
}

export async function getCommitmentReport(
  userId?: string | null,
  hideZeroArg?: boolean | null,
): Promise<CommitmentReport> {
  const asAtIso = await resolveReportAsAt(null, userId);
  const settings = await loadReportCompanySettings(userId, asAtIso);
  const hideZero = hideZeroArg ?? true;
  const [salesPoints, categories, products, scopedSalesPointId, comments] =
    await Promise.all([
      loadSalesPointsForUser(userId),
      loadCategories(),
      loadProducts(),
      reportScopedSalesPointId(userId),
      loadReportComments("commitment-report"),
    ]);

  const commitments = await loadOutstandingCommitmentsAsOf(asAtIso, {
    hideZero,
    salesPointId: scopedSalesPointId,
  });

  const sections: CommitmentReportSection[] = [];
  let sectionIndex = 0;

  for (const category of categories) {
    const sectionLetter =
      SECTION_LETTERS[sectionIndex] ?? String(sectionIndex + 1);
    const section = buildSection(
      sectionLetter,
      category,
      salesPoints,
      commitments,
      products,
      hideZero,
    );
    if (section) {
      sections.push(section);
      sectionIndex += 1;
    }
  }

  const salesPointNames = salesPoints.map((sp) => sp.name.toUpperCase());
  const columnTotals = salesPoints.map((_, columnIndex) =>
    sum(sections.map((section) => section.columnTotals[columnIndex] ?? 0)),
  );
  const grandTotal = sum(columnTotals);

  return {
    settings,
    asAtIso,
    generatedAtIso: nowIso(),
    sections,
    salesPointNames,
    columnTotals,
    grandTotal,
    comments,
  };
}
