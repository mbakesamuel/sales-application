import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";

type Tx = Prisma.TransactionClient | typeof prisma;

/**
 * Atomically allocate the next VCN number for the current calendar year.
 * Format: VCN-YYYY-NNNNNN (matches Electron). Sequence rows are keyed by year.
 */
export async function allocateConsignmentNoteNo(tx: Tx = prisma): Promise<string> {
  const year = new Date().getFullYear();
  const seqId = String(year);
  const rows = await tx.$queryRaw<Array<{ assigned: number }>>`
    INSERT INTO vehicle_consignment_note_sequences (id, next_number, updated_at)
    VALUES (${seqId}, 2, NOW())
    ON CONFLICT (id) DO UPDATE
      SET next_number = vehicle_consignment_note_sequences.next_number + 1,
          updated_at = NOW()
    RETURNING next_number - 1 AS assigned
  `;
  const assigned = Number(rows[0]?.assigned ?? 1);
  const next = Number.isFinite(assigned) && assigned > 0 ? assigned : 1;
  return `VCN-${year}-${String(next).padStart(6, "0")}`;
}
