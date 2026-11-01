import attributionCss from "../reports/ReportAttributionFooter.css?raw";
import bottledIssuesCss from "../reports/BottledWeeklyIssuesReport.css?raw";
import bottledReturnCss from "../reports/BottledPalmOilSalesReturnReport.css?raw";
import commentsCss from "../reports/ReportComments.css?raw";
import crosstabCss from "../reports/SalesBudgetCrosstab.css?raw";
import customersCss from "../customers/CustomersScreen.css?raw";
import dailyMatrixCss from "../reports/DailySalesMatrixReport.css?raw";
import destinationCss from "../reports/MonthlyDeliveriesByDestinationReport.css?raw";
import doPrintCss from "../delivery-orders/DeliveryOrderPrintView.css?raw";
import footerCss from "../reports/ReportFooter.css?raw";
import headerCss from "../reports/ReportHeader.css?raw";
import industryCss from "../reports/IndustryProductMonthlySalesReport.css?raw";
import lightCss from "../reports/ReportLightSurface.css?raw";
import looseLpoCss from "../reports/LooseLpoStockSummaryReport.css?raw";
import mboCss from "../reports/MonthlyBottledOilReport.css?raw";
import mdrCss from "../reports/MonthlyDeliveryReport.css?raw";
import mposCss from "../reports/MonthlyPalmOilSalesReport.css?raw";
import otherProductCss from "../reports/OtherProductSalesDeliveriesReport.css?raw";
import paymentCss from "../reports/MonthlyPaymentDeliveryReport.css?raw";
import posaCss from "../reports/PalmOilSalesActivityReport.css?raw";
import qrCss from "../components/QrCode.css?raw";
import receiptCss from "../stock/ReceiptPrintView.css?raw";
import reconciliationCss from "../reports/MonthlyStockReconciliationReport.css?raw";
import revenueCss from "../reports/RevenueTaxesReport.css?raw";
import salePrintCss from "../sales/SalePrintView.css?raw";
import stampCss from "./DocumentStatusStamp.css?raw";
import stockCss from "../reports/StockCommitmentReport.css?raw";
import binCardCss from "../stock/BinCardReport.css?raw";
import transferCss from "../stock/TransferPrintView.css?raw";
import transportCss from "../transport/TransportCostComputeScreen.css?raw";
import transportCostReportCss from "../reports/TransportCostReport.css?raw";
import vcnBordereauCss from "../vehconsignment-note/VcnPrintBordereau.css?raw";
import vcnProductsCss from "../vehconsignment-note/VcnPrintProductsTable.css?raw";
import vcnCss from "../vehconsignment-note/VcnPrintView.css?raw";
import watermarkCss from "../reports/ReportWatermark.css?raw";

const PARTS = [
  headerCss,
  footerCss,
  attributionCss,
  watermarkCss,
  commentsCss,
  lightCss,
  stockCss,
  crosstabCss,
  mdrCss,
  mboCss,
  mposCss,
  reconciliationCss,
  destinationCss,
  paymentCss,
  dailyMatrixCss,
  looseLpoCss,
  bottledIssuesCss,
  bottledReturnCss,
  industryCss,
  otherProductCss,
  posaCss,
  revenueCss,
  transportCostReportCss,
  binCardCss,
  salePrintCss,
  doPrintCss,
  receiptCss,
  transferCss,
  vcnCss,
  vcnBordereauCss,
  vcnProductsCss,
  stampCss,
  qrCss,
  customersCss,
  transportCss,
];

/** Print stylesheets inlined into the standalone HTML document. */
export const PRINT_DOCUMENT_CSS = PARTS.map((css) =>
  css.replace(/@import\s+[^;]+;/g, ""),
).join("\n");
