import { randomBytes } from "node:crypto";
import { prisma } from "../db/prisma.js";
import {
  assertRouteWrite,
  canPerformAction,
  loadRpcActor,
} from "./rpcActor.js";
import { allocateConsignmentNoteNo } from "./vehicleConsignmentNoteNumber.js";

type SaleProductMode = "BOTTLE" | "LOOSE";
type SaleDisposition = "NORMAL" | "RATION" | "PUBLIC_RELATION";
type ConsignmentNoteStatus = "PENDING" | "VALIDATED" | "REJECTED";

export type ConsignmentDoContext = {
  paidQtyKg: string;
  liftedQtyKg: string;
  balanceQtyKg: string;
  deliveryOrderDate: string | null;
};

export type ConsignmentSaleLine = {
  productName: string;
  qtyKg: string;
  qtyUnits: string | null;
};

export type ConsignmentSaleSnapshot = {
  id: string;
  invoiceNo: string;
  status: ConsignmentNoteStatus;
  saleProductMode: SaleProductMode | null;
  saleDisposition: SaleDisposition | null;
  salesPointName: string | null;
  customerName: string;
  customerAddress: string | null;
  vehicleNumber: string;
  soldAtIso: string;
  deliveryOrderNo: string | null;
  thisSaleLiftedQtyKg: string;
  saleLines: ConsignmentSaleLine[];
};

export type ConsignmentNoteSnapshot = {
  id: string;
  consignmentNoteNo: string;
  destination: string;
  dateOfLifting: string;
  vehicleNumber: string;
  consignerName: string;
  consignerDesignation: string;
  dateOfConsignment: string;
  receiverName: string;
  receiverNicNo: string;
  receiverNicPlaceOfIssue: string;
  receivedDate: string | null;
  status: ConsignmentNoteStatus;
  validatedAtIso: string | null;
  validatedByName: string | null;
};

export type LoadedConsignmentFormView = {
  sale: ConsignmentSaleSnapshot;
  note: ConsignmentNoteSnapshot | null;
  doContext: ConsignmentDoContext;
};

export type SaveConsignmentNoteInput = {
  noteId?: string | null;
  saleId: string;
  userId?: string;
  destination: string;
  dateOfLifting: string;
  vehicleNumber: string;
  consignerName: string;
  consignerDesignation: string;
  dateOfConsignment: string;
  receiverName: string;
  receiverNicNo: string;
  receiverNicPlaceOfIssue: string;
  receivedDate?: string | null;
};

export type SaveConsignmentNoteResult =
  | { ok: true; id: string; consignmentNoteNo: string }
  | { ok: false; error: string };

export type LoadSaleForConsignmentResult =
  | { ok: true; data: LoadedConsignmentFormView }
  | { ok: false; error: string };

export type ConsignmentMutationResult =
  | { ok: true }
  | { ok: false; error: string };

export type ConsignmentValidationQueueRow = {
  id: string;
  consignmentNoteNo: string;
  invoiceNo: string;
  customerName: string;
  salesPointName: string | null;
  destination: string;
  saleDisposition: SaleDisposition | null;
  dateOfConsignment: string;
  createdByName: string;
};

export type ConsignmentValidationQueuePage = {
  totalPending: number;
  rows: ConsignmentValidationQueueRow[];
};

export type ConsignmentValidateManyResult =
  | {
      ok: true;
      validated: number;
      errors: Array<{ id: string; consignmentNoteNo?: string; error: string }>;
    }
  | { ok: false; error: string };

export type ConsignmentPrintPayload = {
  note: ConsignmentNoteSnapshot;
  sale: ConsignmentSaleSnapshot;
  doContext: ConsignmentDoContext;
  companyName: string | null;
  department: string | null;
  liftedQtyInWords: string | null;
};

const NORMAL_BOTTLE_VCN_ERROR =
  "Consignment notes are not allowed for normal Bottle Oil sales.";
const VALIDATION_QUEUE_LIMIT = 200;
const ROUTE_ID = "vehicle-consignment-notes";
const VALIDATE_ACTION = "validate_vehicle_consignment_notes";

function createTextPrimaryKey(): string {
  const time = Date.now().toString(36);
  const random = randomBytes(8).toString("hex");
  return `c${time}${random}`;
}

function trimQty(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

function parseQty(value: unknown): number {
  const n = Number.parseFloat(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function toDateOnly(value: string): Date {
  const iso = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return new Date(`${iso}T00:00:00.000Z`);
}

function dateToIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function isNormalBottleSale(
  mode: SaleProductMode | null,
  disposition: SaleDisposition | null,
): boolean {
  return mode === "BOTTLE" && (disposition == null || disposition === "NORMAL");
}

function parseSaleProductMode(value: unknown): SaleProductMode | null {
  return value === "BOTTLE" || value === "LOOSE" ? value : null;
}

function parseSaleDisposition(value: unknown): SaleDisposition | null {
  return value === "NORMAL" ||
    value === "RATION" ||
    value === "PUBLIC_RELATION"
    ? value
    : null;
}

function requireNonEmpty(value: string, label: string): string | null {
  if (!value.trim()) return `${label} is required.`;
  return null;
}

// ---- kg in words (port of shared/formatKgInWords) ----

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
] as const;
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
] as const;

function titleCase(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function belowThousand(n: number): string {
  if (n < 20) return ONES[n] ?? String(n);
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ones ? `${TENS[tens]}-${ONES[ones]}` : (TENS[tens] ?? String(n));
  }
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const head = `${ONES[hundred]} hundred`;
  return rest ? `${head} ${belowThousand(rest)}` : head;
}

function integerToWords(n: number): string {
  if (n === 0) return "zero";
  const scales = [
    { value: 1_000_000_000, label: "billion" },
    { value: 1_000_000, label: "million" },
    { value: 1_000, label: "thousand" },
  ];
  const parts: string[] = [];
  let remaining = n;
  for (const scale of scales) {
    if (remaining >= scale.value) {
      const chunk = Math.floor(remaining / scale.value);
      remaining %= scale.value;
      parts.push(belowThousand(chunk), scale.label);
    }
  }
  if (remaining > 0) parts.push(belowThousand(remaining));
  return parts.join(" ");
}

function titleCaseWords(text: string): string {
  return text
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(titleCase)
    .join(text.includes("-") ? "-" : " ");
}

function formatKgInTonsAndKilosWords(qtyKg: string | number): string {
  const parsed =
    typeof qtyKg === "number" ? qtyKg : Number.parseFloat(String(qtyKg));
  if (!Number.isFinite(parsed) || parsed < 0) return "Zero kilos";
  const totalKg = Math.round(parsed);
  const tons = Math.floor(totalKg / 1000);
  const kilos = totalKg % 1000;
  const parts: string[] = [];
  if (tons > 0) {
    parts.push(
      `${titleCaseWords(integerToWords(tons))} ton${tons === 1 ? "" : "s"}`,
    );
  }
  if (kilos > 0) {
    parts.push(
      `${titleCaseWords(integerToWords(kilos))} kilo${kilos === 1 ? "" : "s"}`,
    );
  }
  return parts.length === 0 ? "Zero kilos" : parts.join(", ");
}

function emptyDoContext(): ConsignmentDoContext {
  return {
    paidQtyKg: "—",
    liftedQtyKg: "—",
    balanceQtyKg: "—",
    deliveryOrderDate: null,
  };
}

async function buildDoContext(
  deliveryOrderNo: string | null,
): Promise<ConsignmentDoContext> {
  if (!deliveryOrderNo?.trim()) return emptyDoContext();

  const order = await prisma.delivery_orders.findUnique({
    where: { delivery_order_no: deliveryOrderNo.trim() },
    include: { delivery_order_details: true },
  });
  if (!order) return emptyDoContext();

  let paidTotal = 0;
  let liftedTotal = 0;
  for (const detail of order.delivery_order_details) {
    const orderQty = Number(detail.order_qty) || 0;
    paidTotal += orderQty;
    const liftedRows = await prisma.$queryRaw<Array<{ lifted: unknown }>>`
      SELECT COALESCE(SUM(REPLACE(sl.qty_kg, ',', '.')::numeric), 0) AS lifted
      FROM sales s
      INNER JOIN sale_lines sl ON sl.sale_id = s.id
      WHERE s.delivery_order_no = ${order.delivery_order_no}
        AND sl.product_id = ${detail.product_id}
        AND s.status IN ('PENDING', 'VALIDATED')
    `;
    liftedTotal += parseQty(liftedRows[0]?.lifted);
  }

  return {
    paidQtyKg: trimQty(paidTotal),
    liftedQtyKg: trimQty(liftedTotal),
    balanceQtyKg: trimQty(Math.max(paidTotal - liftedTotal, 0)),
    deliveryOrderDate: dateToIso(order.date_issued),
  };
}

async function loadSaleLines(saleId: string): Promise<ConsignmentSaleLine[]> {
  const lines = await prisma.sale_lines.findMany({
    where: { sale_id: saleId },
    orderBy: { id: "asc" },
  });
  if (lines.length === 0) return [];
  const productIds = [...new Set(lines.map((l) => l.product_id))];
  const products = await prisma.products.findMany({
    where: { product_id: { in: productIds } },
    select: { product_id: true, product_name: true },
  });
  const names = new Map(products.map((p) => [p.product_id, p.product_name]));
  return lines.map((row) => ({
    productName: names.get(row.product_id) ?? "—",
    qtyKg: trimQty(parseQty(row.qty_kg)),
    qtyUnits: row.qty_units != null ? String(row.qty_units) : null,
  }));
}

async function sumSaleLiftedQtyKg(saleId: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ qty: unknown }>>`
    SELECT COALESCE(SUM(REPLACE(qty_kg, ',', '.')::numeric), 0) AS qty
    FROM sale_lines WHERE sale_id = ${saleId}
  `;
  return trimQty(parseQty(rows[0]?.qty));
}

function mapNoteRow(row: {
  id: string;
  consignment_note_no: string;
  destination: string;
  date_of_lifting: Date;
  vehicle_number: string;
  status: string;
  validated_at: Date | null;
  consigner_name: string;
  consigner_designation: string;
  date_of_consignment: Date;
  receiver_name: string;
  receiver_nic_no: string | null;
  receiver_nic_place_of_issue: string | null;
  received_date: Date | null;
  validated_by_name: string | null;
}): ConsignmentNoteSnapshot {
  return {
    id: row.id,
    consignmentNoteNo: row.consignment_note_no,
    destination: row.destination,
    dateOfLifting: dateToIso(row.date_of_lifting) ?? "",
    vehicleNumber: row.vehicle_number,
    consignerName: row.consigner_name,
    consignerDesignation: row.consigner_designation,
    dateOfConsignment: dateToIso(row.date_of_consignment) ?? "",
    receiverName: row.receiver_name,
    receiverNicNo: row.receiver_nic_no ?? "",
    receiverNicPlaceOfIssue: row.receiver_nic_place_of_issue ?? "",
    receivedDate: dateToIso(row.received_date),
    status: String(row.status) as ConsignmentNoteStatus,
    validatedAtIso: row.validated_at ? row.validated_at.toISOString() : null,
    validatedByName: row.validated_by_name,
  };
}

async function loadNoteBySaleId(
  saleId: string,
): Promise<ConsignmentNoteSnapshot | null> {
  const note = await prisma.vehicle_consignment_notes.findUnique({
    where: { sale_id: saleId },
    include: {
      consignment_details: true,
      users_vehicle_consignment_notes_validated_by_user_idTousers: {
        select: { name: true },
      },
    },
  });
  if (!note) return null;
  return mapNoteRow({
    id: note.id,
    consignment_note_no: note.consignment_note_no,
    destination: note.destination,
    date_of_lifting: note.date_of_lifting,
    vehicle_number: note.vehicle_number,
    status: note.status,
    validated_at: note.validated_at,
    consigner_name: note.consignment_details.consigner_name,
    consigner_designation: note.consignment_details.consigner_designation,
    date_of_consignment: note.consignment_details.date_of_consignment,
    receiver_name: note.consignment_details.receiver_name,
    receiver_nic_no: note.consignment_details.receiver_nic_no,
    receiver_nic_place_of_issue:
      note.consignment_details.receiver_nic_place_of_issue,
    received_date: note.consignment_details.received_date,
    validated_by_name:
      note.users_vehicle_consignment_notes_validated_by_user_idTousers?.name ??
      null,
  });
}

async function loadNoteById(
  noteId: string,
): Promise<ConsignmentNoteSnapshot | null> {
  const note = await prisma.vehicle_consignment_notes.findUnique({
    where: { id: noteId },
    include: {
      consignment_details: true,
      users_vehicle_consignment_notes_validated_by_user_idTousers: {
        select: { name: true },
      },
    },
  });
  if (!note) return null;
  return mapNoteRow({
    id: note.id,
    consignment_note_no: note.consignment_note_no,
    destination: note.destination,
    date_of_lifting: note.date_of_lifting,
    vehicle_number: note.vehicle_number,
    status: note.status,
    validated_at: note.validated_at,
    consigner_name: note.consignment_details.consigner_name,
    consigner_designation: note.consignment_details.consigner_designation,
    date_of_consignment: note.consignment_details.date_of_consignment,
    receiver_name: note.consignment_details.receiver_name,
    receiver_nic_no: note.consignment_details.receiver_nic_no,
    receiver_nic_place_of_issue:
      note.consignment_details.receiver_nic_place_of_issue,
    received_date: note.consignment_details.received_date,
    validated_by_name:
      note.users_vehicle_consignment_notes_validated_by_user_idTousers?.name ??
      null,
  });
}

async function loadSaleSnapshot(
  saleId: string,
): Promise<ConsignmentSaleSnapshot | null> {
  const sale = await prisma.sales.findUnique({
    where: { id: saleId },
    include: { sales_points: { select: { name: true } } },
  });
  if (!sale) return null;

  let customerAddress: string | null = null;
  if (sale.customer_id != null) {
    const customer = await prisma.customers.findUnique({
      where: { id: sale.customer_id },
      select: { address: true },
    });
    customerAddress = customer?.address?.trim() || null;
  }

  const [saleLines, thisSaleLiftedQtyKg] = await Promise.all([
    loadSaleLines(sale.id),
    sumSaleLiftedQtyKg(sale.id),
  ]);

  return {
    id: sale.id,
    invoiceNo: sale.invoice_no,
    status: String(sale.status) as ConsignmentNoteStatus,
    saleProductMode: parseSaleProductMode(sale.sale_product_mode),
    saleDisposition: parseSaleDisposition(sale.sale_disposition),
    salesPointName: sale.sales_points?.name ?? null,
    customerName: sale.customer_name_snapshot,
    customerAddress,
    vehicleNumber: String(sale.vehicle_number ?? ""),
    soldAtIso: sale.sold_at.toISOString(),
    deliveryOrderNo: sale.delivery_order_no,
    thisSaleLiftedQtyKg,
    saleLines,
  };
}

async function buildFormView(
  saleId: string,
): Promise<LoadedConsignmentFormView | null> {
  const sale = await loadSaleSnapshot(saleId);
  if (!sale) return null;
  const [note, doContext] = await Promise.all([
    loadNoteBySaleId(saleId),
    buildDoContext(sale.deliveryOrderNo),
  ]);
  return { sale, note, doContext };
}

export async function loadSaleForConsignmentByInvoice(
  invoiceNo: string,
): Promise<LoadSaleForConsignmentResult> {
  const trimmed = invoiceNo.trim();
  if (!trimmed) {
    return { ok: false, error: "No sale matches that invoice number." };
  }
  const sale = await prisma.sales.findUnique({
    where: { invoice_no: trimmed },
    select: { id: true },
  });
  if (!sale) {
    return { ok: false, error: "No sale matches that invoice number." };
  }
  const view = await buildFormView(sale.id);
  if (!view) {
    return { ok: false, error: "No sale matches that invoice number." };
  }
  if (
    isNormalBottleSale(view.sale.saleProductMode, view.sale.saleDisposition)
  ) {
    return { ok: false, error: NORMAL_BOTTLE_VCN_ERROR };
  }
  return { ok: true, data: view };
}

export async function loadConsignmentByVcnNo(
  vcnNo: string,
): Promise<LoadedConsignmentFormView | null> {
  const trimmed = vcnNo.trim();
  if (!trimmed) return null;
  const note = await prisma.vehicle_consignment_notes.findUnique({
    where: { consignment_note_no: trimmed },
    select: { sale_id: true },
  });
  if (!note) return null;
  return buildFormView(note.sale_id);
}

export async function saveConsignmentNote(
  userId: string,
  input: SaveConsignmentNoteInput,
): Promise<SaveConsignmentNoteResult> {
  try {
    const actor = await loadRpcActor(userId);
    assertRouteWrite(actor, ROUTE_ID);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const sale = await loadSaleSnapshot(input.saleId);
  if (!sale) return { ok: false, error: "Sale not found." };
  if (sale.status !== "VALIDATED") {
    return {
      ok: false,
      error: "Validate the sale before saving a consignment note.",
    };
  }
  if (isNormalBottleSale(sale.saleProductMode, sale.saleDisposition)) {
    return { ok: false, error: NORMAL_BOTTLE_VCN_ERROR };
  }

  for (const err of [
    requireNonEmpty(input.destination, "Destination"),
    requireNonEmpty(input.dateOfLifting, "Date of lifting"),
    requireNonEmpty(input.vehicleNumber, "Vehicle number"),
    requireNonEmpty(input.consignerName, "Consigner name"),
    requireNonEmpty(input.consignerDesignation, "Consigner designation"),
    requireNonEmpty(input.dateOfConsignment, "Date of consignment"),
    requireNonEmpty(input.receiverName, "Receiver name"),
    requireNonEmpty(input.receiverNicNo, "Receiver NIC number"),
    requireNonEmpty(input.receiverNicPlaceOfIssue, "Place of issue (NIC)"),
  ]) {
    if (err) return { ok: false, error: err };
  }

  const existing = await prisma.vehicle_consignment_notes.findUnique({
    where: { sale_id: sale.id },
  });

  const receivedRaw = input.receivedDate?.trim() || null;
  let dateOfLifting: Date;
  let dateOfConsignment: Date;
  let receivedDate: Date | null = null;
  try {
    dateOfLifting = toDateOnly(input.dateOfLifting);
    dateOfConsignment = toDateOnly(input.dateOfConsignment);
    if (receivedRaw) receivedDate = toDateOnly(receivedRaw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid date.",
    };
  }

  const detailsData = {
    consigner_name: input.consignerName.trim(),
    consigner_designation: input.consignerDesignation.trim(),
    date_of_consignment: dateOfConsignment,
    receiver_name: input.receiverName.trim(),
    receiver_nic_no: input.receiverNicNo.trim(),
    receiver_nic_place_of_issue: input.receiverNicPlaceOfIssue.trim(),
    received_date: receivedDate,
    updated_at: new Date(),
  };

  try {
    if (existing) {
      if (input.noteId && input.noteId !== existing.id) {
        return {
          ok: false,
          error: "Consignment note does not match this sale.",
        };
      }
      if (existing.status !== "PENDING") {
        return {
          ok: false,
          error: "Only pending consignment notes can be edited.",
        };
      }

      await prisma.$transaction(async (tx) => {
        await tx.consignment_details.update({
          where: { id: existing.consignment_details_id },
          data: detailsData,
        });
        await tx.vehicle_consignment_notes.update({
          where: { id: existing.id },
          data: {
            destination: input.destination.trim(),
            date_of_lifting: dateOfLifting,
            vehicle_number: input.vehicleNumber.trim(),
            updated_at: new Date(),
          },
        });
      });

      return {
        ok: true,
        id: existing.id,
        consignmentNoteNo: existing.consignment_note_no,
      };
    }

    if (input.noteId) {
      return { ok: false, error: "Consignment note not found for this sale." };
    }

    const id = createTextPrimaryKey();
    const detailsId = createTextPrimaryKey();

    const consignmentNoteNo = await prisma.$transaction(async (tx) => {
      const noteNo = await allocateConsignmentNoteNo(tx);
      await tx.consignment_details.create({
        data: {
          id: detailsId,
          sale_id: sale.id,
          ...detailsData,
          created_at: new Date(),
        },
      });
      await tx.vehicle_consignment_notes.create({
        data: {
          id,
          consignment_note_no: noteNo,
          sale_id: sale.id,
          destination: input.destination.trim(),
          date_of_lifting: dateOfLifting,
          vehicle_number: input.vehicleNumber.trim(),
          consignment_details_id: detailsId,
          status: "PENDING",
          created_by_user_id: userId,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      return noteNo;
    });

    return { ok: true, id, consignmentNoteNo };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to save consignment note.",
    };
  }
}

export async function deleteConsignmentNote(
  userId: string,
  noteId: string,
): Promise<ConsignmentMutationResult> {
  try {
    const actor = await loadRpcActor(userId);
    assertRouteWrite(actor, ROUTE_ID);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const note = await prisma.vehicle_consignment_notes.findUnique({
    where: { id: noteId },
  });
  if (!note) return { ok: false, error: "Consignment note not found." };
  if (note.status !== "PENDING") {
    return {
      ok: false,
      error: "Only pending consignment notes can be deleted.",
    };
  }

  // Cascade from consignment_details deletes the VCN row.
  await prisma.consignment_details.delete({
    where: { id: note.consignment_details_id },
  });
  return { ok: true };
}

export async function validateConsignmentNote(
  userId: string,
  noteId: string,
): Promise<ConsignmentMutationResult> {
  try {
    const actor = await loadRpcActor(userId);
    if (!canPerformAction(actor, VALIDATE_ACTION)) {
      return {
        ok: false,
        error: "You do not have permission to validate consignment notes.",
      };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Permission denied.",
    };
  }

  const note = await prisma.vehicle_consignment_notes.findUnique({
    where: { id: noteId },
  });
  if (!note) return { ok: false, error: "Consignment note not found." };
  if (note.status === "VALIDATED") return { ok: true };
  if (note.status !== "PENDING") {
    return {
      ok: false,
      error: "Only pending consignment notes can be validated.",
    };
  }

  const now = new Date();
  await prisma.vehicle_consignment_notes.update({
    where: { id: noteId },
    data: {
      status: "VALIDATED",
      validated_at: now,
      validated_by_user_id: userId,
      updated_at: now,
    },
  });
  return { ok: true };
}

export async function listConsignmentValidationQueue(
  userId: string,
): Promise<ConsignmentValidationQueuePage> {
  const actor = await loadRpcActor(userId);
  if (!canPerformAction(actor, VALIDATE_ACTION)) {
    throw new Error(
      "You do not have permission to validate consignment notes.",
    );
  }

  const scoped = actor.salesPointId;
  const where = {
    status: "PENDING",
    ...(scoped != null
      ? { sales: { sales_point_id: scoped } }
      : {}),
  };

  const [totalPending, notes] = await Promise.all([
    prisma.vehicle_consignment_notes.count({ where }),
    prisma.vehicle_consignment_notes.findMany({
      where,
      include: {
        consignment_details: true,
        sales: {
          include: { sales_points: { select: { name: true } } },
        },
        users_vehicle_consignment_notes_created_by_user_idTousers: {
          select: { name: true },
        },
      },
      orderBy: [
        { consignment_details: { date_of_consignment: "asc" } },
        { consignment_note_no: "asc" },
      ],
      take: VALIDATION_QUEUE_LIMIT,
    }),
  ]);

  return {
    totalPending,
    rows: notes.map((n) => ({
      id: n.id,
      consignmentNoteNo: n.consignment_note_no,
      invoiceNo: n.sales.invoice_no,
      customerName: n.sales.customer_name_snapshot,
      salesPointName: n.sales.sales_points?.name ?? null,
      destination: n.destination,
      saleDisposition: parseSaleDisposition(n.sales.sale_disposition),
      dateOfConsignment:
        dateToIso(n.consignment_details.date_of_consignment) ?? "",
      createdByName:
        n.users_vehicle_consignment_notes_created_by_user_idTousers?.name ??
        "—",
    })),
  };
}

export async function validateManyConsignmentNotes(
  userId: string,
  noteIds: string[],
): Promise<ConsignmentValidateManyResult> {
  const uniqueIds = [
    ...new Set(noteIds.filter((id) => typeof id === "string" && id.trim())),
  ];
  if (uniqueIds.length === 0) {
    return { ok: false, error: "Select at least one consignment note." };
  }

  let validated = 0;
  const errors: Array<{
    id: string;
    consignmentNoteNo?: string;
    error: string;
  }> = [];

  for (const id of uniqueIds) {
    const result = await validateConsignmentNote(userId, id);
    if (result.ok) {
      validated += 1;
    } else {
      const note = await prisma.vehicle_consignment_notes.findUnique({
        where: { id },
        select: { consignment_note_no: true },
      });
      errors.push({
        id,
        consignmentNoteNo: note?.consignment_note_no,
        error: result.error,
      });
    }
  }

  return { ok: true, validated, errors };
}

export async function getConsignmentPrintPayload(
  noteId: string,
): Promise<ConsignmentPrintPayload | null> {
  const note = await loadNoteById(noteId);
  if (!note) return null;

  const vcn = await prisma.vehicle_consignment_notes.findUnique({
    where: { id: noteId },
    select: { sale_id: true },
  });
  if (!vcn) return null;

  const sale = await loadSaleSnapshot(vcn.sale_id);
  if (!sale) return null;

  const [doContext, company] = await Promise.all([
    buildDoContext(sale.deliveryOrderNo),
    prisma.company_settings.findUnique({
      where: { id: "default" },
      select: { company_name: true, department: true },
    }),
  ]);

  return {
    note,
    sale,
    doContext,
    companyName: company?.company_name?.trim() || null,
    department: company?.department?.trim() || null,
    liftedQtyInWords: formatKgInTonsAndKilosWords(sale.thisSaleLiftedQtyKg),
  };
}
