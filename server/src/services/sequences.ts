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

/**
 * Atomically allocate the next document number for a sales point + kind + FY.
 */
export async function allocateDocumentSequence(
  input: AllocateSequenceInput,
): Promise<AllocateSequenceResult> {
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

    const nextValue = (existing?.last_value ?? 0) + 1;

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
