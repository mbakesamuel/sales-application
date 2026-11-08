export interface CarryForwardCommitmentRow {
    detailId: number;
    /** SQLite autoincrement id, or Postgres UUID string in thin-client mode. */
    deliveryOrderId: number | string;
    deliveryOrderNo: string;
    customerId: number;
    customerName: string;
    salesPointId: number;
    salesPointName: string;
    productId: number;
    productName: string;
    orderQty: number;
    soldQty: number;
    outstandingQty: number;
    dateIssued: string;
    notes: string | null;
    /** Original paper/booklet DO number (required on new CF rows). */
    sourceDocumentNo: string | null;
}
export interface CarryForwardCommitmentPendingRow {
    detailId: number;
    /** SQLite autoincrement id, or Postgres UUID string in thin-client mode. */
    deliveryOrderId: number | string;
    deliveryOrderNo: string;
    customerId: number;
    customerName: string;
    salesPointId: number;
    salesPointName: string;
    productId: number;
    productName: string;
    orderQty: number;
    outstandingQty: number;
    dateIssued: string;
    sourceDocumentNo: string | null;
}
export interface CarryForwardFormOptions {
    customers: Array<{
        id: number;
        name: string;
    }>;
    products: Array<{
        productId: number;
        productName: string;
    }>;
    salesPoints: Array<{
        id: number;
        name: string;
    }>;
}
export interface UpsertCarryForwardInput {
    userId: string;
    customerId: number;
    salesPointId: number;
    productId: number;
    /** Desired outstanding kg (what still needs to be sold). */
    outstandingQty: number;
    /** Original paper/booklet DO # — required when outstandingQty > 0. */
    sourceDocumentNo?: string | null;
    /** When set, update this existing CF detail instead of creating a new CF DO. */
    detailId?: number | null;
    notes?: string | null;
}
export interface UpsertCarryForwardBatchLine {
    customerId: number;
    /** Desired outstanding kg; omit / NaN lines are skipped by the batch API. */
    outstandingQty: number;
    /** Original paper/booklet DO # — required when outstandingQty > 0. */
    sourceDocumentNo: string;
    detailId?: number | null;
}
export interface UpsertCarryForwardBatchInput {
    userId: string;
    salesPointId: number;
    productId: number;
    notes?: string | null;
    lines: UpsertCarryForwardBatchLine[];
}
export interface DeleteCarryForwardInput {
    userId: string;
    detailId: number;
}
export type CarryForwardMutationResult = {
    ok: true;
    deliveryOrderNo: string;
    detailId: number;
    pendingValidation?: boolean;
} | {
    ok: false;
    error: string;
};
export type CarryForwardBatchResult = {
    ok: true;
    saved: number;
    pendingValidation?: boolean;
} | {
    ok: false;
    error: string;
};
export type CarryForwardDeleteResult = {
    ok: true;
} | {
    ok: false;
    error: string;
};
