import type {
  MonthlyBottledOilPackColumn,
  MonthlyBottledOilReport,
  MonthlyBottledOilReportRow,
  MonthlyBottledOilReportTotals,
} from "../../shared/reports.types.js";
import { resolveReportAsAt } from "../financialYears/service.js";
import { getDatabase } from "../db/index.js";
import {
  loadReportComments,
  loadReportCompanySettings,
} from "./companySettings.js";
import {
  detectBottledPack,
  nowIso,
  parseQty,
  reportScopedSalesPointId,
  salesPointFilterSql,
} from "./shared.js";

const ROUTE_ID = "monthly-bottled-oil-report";

const PACK_COLUMNS: MonthlyBottledOilPackColumn[] = [
  { id: "jug20", label: "1x20L" },
  { id: "carton5", label: "3x5L" },
  { id: "carton15", label: "1x15L" },
];

interface SaleHeaderRecord {
  saleId: string;
  dateIssued: string;
  invoiceNo: string;
  customerName: string;
  address: string;
  amount: number;
  receivedBy: string;
  vehConsignmentNo: string;
}

interface SaleLinePackRecord {
  saleId: string;
  productName: string;
  productCode: string | null;
  qtyUnits: number;
}

function emptyTotals(): MonthlyBottledOilReportTotals {
  return {
    qty20L: 0,
    qty3x5L: 0,
    qty15L: 0,
    amount: 0,
  };
}

function loadSaleHeaders(
  fromIso: string,
  toIso: string,
  salesPointId?: number | null,
): SaleHeaderRecord[] {
  const sp = salesPointFilterSql("s.salesPointId", salesPointId);
  return getDatabase()
    .prepare(
      `SELECT s.id AS saleId,
              s.dateIssued,
              s.invoiceNo,
              s.customerNameSnapshot AS customerName,
              COALESCE(c.address, '') AS address,
              s.grossAmount,
              COALESCE(d.receiverName, '') AS receivedBy,
              COALESCE(vcn.consignmentNoteNo, '') AS vehConsignmentNo
       FROM Sale s
       LEFT JOIN Customer c ON c.id = s.customerId
       LEFT JOIN VehicleConsignmentNote vcn ON vcn.saleId = s.id
       LEFT JOIN ConsignmentDetails d ON d.id = vcn.consignmentDetailsId
       WHERE s.status = 'VALIDATED'
         AND COALESCE(s.saleProductMode, 'LOOSE') = 'BOTTLE'
         AND s.saleDisposition IN ('RATION', 'PUBLIC_RELATION')
         AND s.dateIssued >= ?
         AND s.dateIssued <= ?${sp.clause}
       ORDER BY s.dateIssued ASC, s.invoiceNo ASC`,
    )
    .all(fromIso, toIso, ...sp.params)
    .map((row) => {
      const r = row as {
        saleId: string;
        dateIssued: string;
        invoiceNo: string;
        customerName: string;
        address: string;
        grossAmount: string;
        receivedBy: string;
        vehConsignmentNo: string;
      };
      return {
        saleId: String(r.saleId),
        dateIssued: String(r.dateIssued).slice(0, 10),
        invoiceNo: String(r.invoiceNo),
        customerName: String(r.customerName),
        address: String(r.address ?? ""),
        amount: parseQty(r.grossAmount),
        receivedBy: String(r.receivedBy ?? ""),
        vehConsignmentNo: String(r.vehConsignmentNo ?? ""),
      };
    });
}

function loadSaleLines(saleIds: string[]): SaleLinePackRecord[] {
  if (saleIds.length === 0) {
    return [];
  }
  const placeholders = saleIds.map(() => "?").join(", ");
  return getDatabase()
    .prepare(
      `SELECT sl.saleId,
              p.productName,
              p.productCode,
              sl.qtyUnits
       FROM SaleLine sl
       INNER JOIN Product p ON p.productId = sl.productId
       WHERE sl.saleId IN (${placeholders})`,
    )
    .all(...saleIds)
    .map((row) => {
      const r = row as {
        saleId: string;
        productName: string;
        productCode: string | null;
        qtyUnits: string | null;
      };
      return {
        saleId: String(r.saleId),
        productName: String(r.productName),
        productCode: r.productCode != null ? String(r.productCode) : null,
        qtyUnits: parseQty(r.qtyUnits),
      };
    });
}

export function getMonthlyBottledOilReport(
  userId?: string,
): MonthlyBottledOilReport {
  const { asAtIso, period } = resolveReportAsAt(userId);
  const settings = loadReportCompanySettings(userId, asAtIso);
  const comments = loadReportComments(ROUTE_ID);
  const monthStartIso = period.startDate;
  const monthName = period.monthName;
  const reportTitle = "BOTTLED OIL MONTHLY REPORT";
  const scopedSalesPointId = reportScopedSalesPointId(userId);

  const headers = loadSaleHeaders(monthStartIso, asAtIso, scopedSalesPointId);
  const linesBySale = new Map<string, SaleLinePackRecord[]>();
  for (const line of loadSaleLines(headers.map((h) => h.saleId))) {
    const list = linesBySale.get(line.saleId) ?? [];
    list.push(line);
    linesBySale.set(line.saleId, list);
  }

  const rows: MonthlyBottledOilReportRow[] = [];
  const totals = emptyTotals();

  for (const header of headers) {
    let qty20L = 0;
    let qty3x5L = 0;
    let qty15L = 0;
    for (const line of linesBySale.get(header.saleId) ?? []) {
      const packId = detectBottledPack({
        productName: line.productName,
        productCode: line.productCode,
      }).id;
      if (packId === "jug20") {
        qty20L += line.qtyUnits;
      } else if (packId === "carton5") {
        qty3x5L += line.qtyUnits;
      } else if (packId === "carton15") {
        qty15L += line.qtyUnits;
      }
    }

    rows.push({
      saleId: header.saleId,
      dateIssued: header.dateIssued,
      customerName: header.customerName,
      address: header.address,
      qty20L: Math.round(qty20L),
      qty3x5L: Math.round(qty3x5L),
      qty15L: Math.round(qty15L),
      receivedBy: header.receivedBy,
      amount: Math.round(header.amount),
      vehConsignmentNo: header.vehConsignmentNo,
    });

    totals.qty20L += Math.round(qty20L);
    totals.qty3x5L += Math.round(qty3x5L);
    totals.qty15L += Math.round(qty15L);
    totals.amount += Math.round(header.amount);
  }

  return {
    settings,
    asAtIso,
    monthStartIso,
    monthName,
    financialYear: period.financialYear,
    reportTitle,
    generatedAtIso: nowIso(),
    packColumns: PACK_COLUMNS,
    rows,
    totals,
    comments,
  };
}
