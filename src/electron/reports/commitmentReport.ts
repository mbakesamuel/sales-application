import type {
  CommitmentReport,
  CommitmentReportRow,
  CommitmentReportSection,
} from "../../shared/reports.types.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import { getDatabase } from "../db/index.js";
import {
  loadOutstandingCommitmentsAsOf,
  type OutstandingCommitmentAsOf,
} from "./commitmentAsOf.js";
import { loadReportCompanySettings, loadReportComments } from "./companySettings.js";
import {
  loadProducts,
  loadSalesPointsForUser,
  nowIso,
  reportScopedSalesPointId,
  sum,
  type ProductRow,
  type SalesPointRow,
} from "./shared.js";

interface CategoryRow {
  productCatId: number;
  productCat: string;
  isMain: number;
  isBottled: number;
}

type OutstandingCommitment = OutstandingCommitmentAsOf;

const SECTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function loadCategories(): CategoryRow[] {
  return getDatabase()
    .prepare(
      `SELECT productCatId, productCat, isMain, isBottled
       FROM ProductCat
       ORDER BY isBottled ASC, isMain DESC, productCat ASC`,
    )
    .all() as CategoryRow[];
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

function buildRowLabel(customerName: string): string {
  return customerName.trim().toUpperCase();
}

function buildSection(
  sectionLetter: string,
  category: CategoryRow,
  salesPoints: SalesPointRow[],
  commitments: OutstandingCommitment[],
  products: ProductRow[],
  hideZero: boolean,
): CommitmentReportSection | null {
  const categoryProducts = products.filter((product) => product.productCatId === category.productCatId);
  if (categoryProducts.length === 0) {
    return null;
  }

  const categoryCommitments = commitments.filter((row) => row.productCatId === category.productCatId);
  const salesPointNames = salesPoints.map((salesPoint) => salesPoint.name.toUpperCase());

  // One row per customer within the category (main and other products alike).
  const rowKeys = new Map<string, { customerName: string }>();
  for (const commitment of categoryCommitments) {
    const key = String(commitment.customerId);
    if (!rowKeys.has(key)) {
      rowKeys.set(key, { customerName: commitment.customerName });
    }
  }

  const dataRows: CommitmentReportRow[] = [...rowKeys.entries()]
    .map(([key, meta]) => {
      const predicate = (row: OutstandingCommitment) => String(row.customerId) === key;

      const quantities = salesPoints.map((salesPoint) =>
        qtyForSalesPoint(categoryCommitments, salesPoint.id, predicate),
      );
      const rowTotal = sum(quantities);

      return {
        label: buildRowLabel(meta.customerName),
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

  const rows: CommitmentReportRow[] = [
    ...dataRows,
    {
      label: "TOTAL",
      quantities: columnTotals,
      rowTotal: grandTotal,
      kind: "total",
    },
  ];

  return {
    sectionLetter,
    title: category.productCat.toUpperCase(),
    salesPointNames,
    rows,
    columnTotals,
    grandTotal,
  };
}

export function getCommitmentReport(
  userId?: string | null,
  hideZeroArg?: boolean | null,
): CommitmentReport {
  const { asAtIso } = resolveReportAsAt();
  const settings = loadReportCompanySettings(userId, asAtIso);
  const hideZero = hideZeroArg ?? true;
  const salesPoints = loadSalesPointsForUser(userId);
  const categories = loadCategories();
  const products = loadProducts();
  const commitments = loadOutstandingCommitmentsAsOf(getDatabase(), asAtIso, {
    hideZero,
    salesPointId: reportScopedSalesPointId(userId),
  });

  const sections: CommitmentReportSection[] = [];
  let sectionIndex = 0;

  for (const category of categories) {
    const sectionLetter = SECTION_LETTERS[sectionIndex] ?? String(sectionIndex + 1);
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

  const salesPointNames = salesPoints.map((salesPoint) => salesPoint.name.toUpperCase());
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
    comments: loadReportComments("commitment-report"),
  };
}
