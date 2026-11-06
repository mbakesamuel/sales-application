import { prisma } from "../db/prisma.js";

export type DocumentKind =
  | "SALES_INVOICE"
  | "DELIVERY_ORDER"
  | "STOCK_RECEIPT"
  | "STOCK_TRANSFER"
  | "STOCK_ADJUSTMENT";

export type AllocateSequenceInput = {
  salesPointId: number;
  documentKind: DocumentKind;
  financialYear: number;
  prefix?: string;
  pad?: number;
};

export type AllocateSequenceResult = {
  value: number;
  documentNo: string;
};

const DOCUMENT_NO_COLUMN: Record<
  DocumentKind,
  { table: string; column: string }
> = {
  SALES_INVOICE: { table: "sales", column: "invoice_no" },
  DELIVERY_ORDER: { table: "delivery_orders", column: "delivery_order_no" },
  STOCK_RECEIPT: { table: "stock_receipts", column: "receipt_no" },
  STOCK_TRANSFER: { table: "stock_transfers", column: "transfer_no" },
  STOCK_ADJUSTMENT: { table: "stock_adjustments", column: "adjustment_no" },
};

/**
 * Atomically allocate the next document number for a sales point + kind + FY.
 * Seeds from the highest existing document with the same prefix so sequences
 * stay ahead of imported/synced rows.
 */
export async function allocateDocumentSequence(
  input: AllocateSequenceInput,
): Promise<AllocateSequenceResult> {
  if (!Number.isFinite(input.financialYear)) {
    throw new Error("financialYear is required to allocate a document number.");
  }

  const pad = input.pad ?? 6;
  const prefix =
    input.prefix ??
    defaultPrefix(input.documentKind, input.financialYear, input.salesPointId);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.document_sequences.findUnique({
      where: {
        sales_point_id_document_kind_financial_year: {
          sales_point_id: input.salesPointId,
          document_kind: input.documentKind,
          financial_year: input.financialYear,
        },
      },
    });

    const maxExisting = await maxExistingSerial(
      tx,
      input.documentKind,
      prefix,
    );
    const nextValue =
      Math.max(existing?.last_value ?? 0, maxExisting) + 1;

    await tx.document_sequences.upsert({
      where: {
        sales_point_id_document_kind_financial_year: {
          sales_point_id: input.salesPointId,
          document_kind: input.documentKind,
          financial_year: input.financialYear,
        },
      },
      create: {
        sales_point_id: input.salesPointId,
        document_kind: input.documentKind,
        financial_year: input.financialYear,
        last_value: nextValue,
      },
      update: {
        last_value: nextValue,
        updated_at: new Date(),
      },
    });

    return nextValue;
  });

  return {
    value: result,
    documentNo: `${prefix}${String(result).padStart(pad, "0")}`,
  };
}

async function maxExistingSerial(
  tx: {
    $queryRawUnsafe: <T = unknown>(
      query: string,
      ...values: unknown[]
    ) => Promise<T>;
  },
  documentKind: DocumentKind,
  prefix: string,
): Promise<number> {
  const mapping = DOCUMENT_NO_COLUMN[documentKind];
  if (!mapping) return 0;

  // Escape LIKE metacharacters in the prefix.
  const likePrefix = prefix.replace(/([\\%_])/g, "\\$1") + "%";
  const rows = await tx.$queryRawUnsafe<Array<{ serial: string | null }>>(
    `SELECT ${mapping.column} AS serial
     FROM ${mapping.table}
     WHERE ${mapping.column} LIKE $1 ESCAPE '\\'`,
    likePrefix,
  );

  let max = 0;
  for (const row of rows) {
    const serial = row.serial ?? "";
    if (!serial.startsWith(prefix)) continue;
    const suffix = serial.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    const n = Number.parseInt(suffix, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

function defaultPrefix(
  kind: DocumentKind,
  financialYear: number,
  salesPointId: number,
): string {
  const yy = String(financialYear).slice(-2);
  switch (kind) {
    case "SALES_INVOICE":
      return `SI-${yy}-${salesPointId}-`;
    case "DELIVERY_ORDER":
      return `DO-${yy}-${salesPointId}-`;
    case "STOCK_RECEIPT":
      return `SR-${yy}-${salesPointId}-`;
    case "STOCK_TRANSFER":
      return `ST-${yy}-${salesPointId}-`;
    case "STOCK_ADJUSTMENT":
      return `SA-${yy}-${salesPointId}-`;
    default:
      return `DOC-${yy}-${salesPointId}-`;
  }
}
