import type { AuthUser } from "../auth/session.ts";
import type { SalesApi } from "../sales/types.ts";
import type { DeliveryOrdersApi } from "../delivery-orders/types.ts";
import type { StockApi } from "../stock/types.ts";
import type {
  ConsignmentMutationResult,
  ConsignmentPrintPayload,
  LoadedConsignmentFormView,
  LoadSaleForConsignmentResult,
  SaveConsignmentNoteInput,
  SaveConsignmentNoteResult,
} from "../../shared/vehicleConsignmentNotes.types.ts";
import type {
  FinancialMonthRow,
  FinancialPeriodStatus,
  FinancialYearRow,
  OpenPostingPeriod,
  OpenYearResult,
} from "../../shared/financialYears.types.ts";
import type { DashboardSummary } from "../../shared/dashboard.types.ts";
import type {
  BottleOilStockSalesReport,
  BottledWeeklyIssuesReport,
  CommitmentReport,
  StockCommitmentReport,
  StockReport,
  MonthlyDeliveryReport,
  MonthlyStockReconciliationReport,
  LooseLpoStockSummaryReport,
  MonthlyPaymentDeliveryReport,
  MonthlyDeliveriesByDestinationReport,
  MonthlyPalmOilSalesReport,
  PalmOilSalesActivityReport,
  IndustryProductMonthlySalesReport,
  BottledPalmOilSalesReturnReport,
  OtherProductSalesDeliveriesReport,
  MonthlyBottledOilReport,
  RevenueTaxesPeriod,
  RevenueTaxesReport,
  SalesBudgetMonthlyCrosstabReport,
  SalesBudgetMonthlyRevenueCrosstabReport,
  SalesBudgetWeeklyCrosstabReport,
  SalesBudgetWeeklyRevenueCrosstabReport,
  WeeklyDeliveriesReport,
  DailySalesReport,
  DailySalesMatrixReport,
  ReportSignatoryRow,
} from "../../shared/reports.types.ts";
import type {
  PermissionsApi,
  RolePermissionsSnapshot,
} from "../../shared/permissions.types.ts";
import type {
  CreateDocumentBookletInput,
  DocumentBookletFilters,
  DocumentBookletRow,
  RejectDocumentBookletResult,
  ValidateDocumentBookletResult,
  ValidateManyBookletsResult,
  ValidateSerialForSalesPointInput,
  ValidateSerialForSalesPointResult,
} from "../../shared/documentBooklets.types.ts";
import type { SyncApi } from "../../shared/sync.types.ts";

interface LoginInput {
  username: string;
  password: string;
}

interface ChangePasswordInput {
  authToken: string;
  currentPassword: string;
  newPassword: string;
}

interface ChangePasswordResult {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  error?: never;
}

interface ChangePasswordErrorResult {
  error: string;
  user?: never;
  permissions?: never;
}

type ChangePasswordResponse = ChangePasswordResult | ChangePasswordErrorResult;

interface LoginResult {
  token: string;
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  sessionIdleTimeoutMinutes: number;
  error?: never;
}

interface LoginErrorResult {
  error: string;
  token?: never;
  user?: never;
  permissions?: never;
}

type LoginResponse = LoginResult | LoginErrorResult;

interface AuthSessionResponse {
  user: AuthUser;
  permissions: RolePermissionsSnapshot;
  sessionIdleTimeoutMinutes: number;
}

export interface SchemaSummary {
  tableCount: number;
  tables: string[];
}

export interface TableQueryInput {
  table: string;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface TableQueryResult {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

export interface ColumnMeta {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isRequired: boolean;
  isAutoIncrement: boolean;
  isEditableOnCreate: boolean;
  isEditableOnUpdate: boolean;
  isHidden: boolean;
  isBoolean: boolean;
  defaultValue: string | null;
  allowsNull: boolean;
}

export interface TableSchema {
  table: string;
  primaryKeyColumns: string[];
  columns: ColumnMeta[];
}

export interface TableInsertInput {
  table: string;
  values: Record<string, unknown>;
  authToken?: string;
}

export interface TableUpdateInput {
  table: string;
  primaryKey: Record<string, unknown>;
  values: Record<string, unknown>;
  authToken?: string;
}

export interface TableDeleteInput {
  table: string;
  primaryKey: Record<string, unknown>;
  authToken?: string;
}

export interface ClearOperationalDataInput {
  authToken?: string;
  /** Must be exactly `"CLEAR"`. */
  confirm: string;
  /** When true, also clear ops tables on the central sync Postgres via API. */
  alsoClearSyncDb?: boolean;
}

export type ClearOperationalDataResponse =
  | {
      ok: true;
      deleted: Record<string, number>;
      sequences: Record<string, number>;
      syncCleared?: boolean;
      syncTables?: string[];
      syncError?: string;
    }
  | { ok: false; error: string };

type SetCompanyUiThemeResult =
  | { ok: true; uiThemePreset: "agro" | "dark" }
  | { ok: false; error: string };

interface DatabaseApi {
  getSchemaSummary(): Promise<SchemaSummary>;
  queryTable(input: TableQueryInput): Promise<TableQueryResult>;
  getTableSchema(table: string): Promise<TableSchema>;
  insertRow(input: TableInsertInput): Promise<Record<string, unknown>>;
  updateRow(input: TableUpdateInput): Promise<Record<string, unknown>>;
  setCompanyUiTheme(input: {
    authToken: string;
    uiThemePreset: "agro" | "dark";
  }): Promise<SetCompanyUiThemeResult>;
  deleteRow(input: TableDeleteInput): Promise<void>;
  clearOperationalData(
    input: ClearOperationalDataInput,
  ): Promise<ClearOperationalDataResponse>;
}

interface AuthApi {
  login(data: LoginInput): Promise<LoginResponse>;
  getSession(token: string): Promise<AuthSessionResponse | null>;
  logout(token: string): Promise<void>;
  changePassword(data: ChangePasswordInput): Promise<ChangePasswordResponse>;
}

interface ReportsApi {
  getStockCommitment(
    authToken: string,
    hideZero?: boolean,
    asAtIso?: string,
  ): Promise<StockCommitmentReport>;
  getStockReport(
    authToken: string,
    hideZero?: boolean,
    asAtIso?: string,
  ): Promise<StockReport>;
  getCommitmentReport(
    authToken: string,
    hideZero?: boolean,
  ): Promise<CommitmentReport>;
  getBottleOilStockSales(
    authToken: string,
    hideZero?: boolean,
    asAtIso?: string,
  ): Promise<BottleOilStockSalesReport>;
  getBottledWeeklyIssues(
    authToken: string,
    estimateBasis?: import("../../shared/reports.types").BottledWeeklyEstimateBasis,
    weekMondayIso?: string,
  ): Promise<BottledWeeklyIssuesReport>;
  getWeekChoices(authToken: string): Promise<{
    asAtIso: string;
    weekChoices: import("../../shared/reports.types").WeeklyDeliveriesWeekChoice[];
    defaultWeekMondayIso: string | null;
  }>;
  getWeeklyDeliveries(
    authToken: string,
    weekMondayIso?: string,
    hideZero?: boolean,
  ): Promise<WeeklyDeliveriesReport>;
  getMonthlyDelivery(half: 1 | 2, authToken: string): Promise<MonthlyDeliveryReport>;
  getMonthlyStockReconciliation(
    authToken: string,
    hideZero?: boolean,
  ): Promise<MonthlyStockReconciliationReport>;
  getLooseLpoStockSummary(authToken: string): Promise<LooseLpoStockSummaryReport>;
  getMonthlyPaymentDelivery(authToken: string): Promise<MonthlyPaymentDeliveryReport>;
  getTransportCost(authToken: string): Promise<import("../../shared/reports.types").TransportCostReport>;
  getMonthlyDeliveriesByDestination(
    authToken: string,
  ): Promise<MonthlyDeliveriesByDestinationReport>;
  getMonthlyPalmOilSales(authToken: string): Promise<MonthlyPalmOilSalesReport>;
  getPalmOilSalesActivity(authToken: string): Promise<PalmOilSalesActivityReport>;
  getIndustryProductMonthlySales(
    authToken: string,
  ): Promise<IndustryProductMonthlySalesReport>;
  getBottledPalmOilSalesReturn(
    authToken: string,
  ): Promise<BottledPalmOilSalesReturnReport>;
  getOtherProductSalesDeliveries(
    authToken: string,
  ): Promise<OtherProductSalesDeliveriesReport>;
  getMonthlyBottledOil(authToken: string): Promise<MonthlyBottledOilReport>;
  getRevenueTaxes(
    authToken: string,
    period?: RevenueTaxesPeriod,
    salesPointId?: number | null,
  ): Promise<RevenueTaxesReport>;
  getSalesBudgetMonthlyCrosstab(
    authToken: string,
    reportYear?: number,
  ): Promise<SalesBudgetMonthlyCrosstabReport>;
  getSalesBudgetWeeklyCrosstab(
    authToken: string,
    reportYear?: number,
  ): Promise<SalesBudgetWeeklyCrosstabReport>;
  getSalesBudgetMonthlyRevenueCrosstab(
    authToken: string,
    reportYear?: number,
  ): Promise<SalesBudgetMonthlyRevenueCrosstabReport>;
  getSalesBudgetWeeklyRevenueCrosstab(
    authToken: string,
    reportYear?: number,
  ): Promise<SalesBudgetWeeklyRevenueCrosstabReport>;
  getDailySales(
    authToken: string,
    reportDateIso: string,
    salesPointId?: number | null,
  ): Promise<DailySalesReport>;
  getDailySalesMatrix(
    authToken: string,
    salesPointId?: number | null,
    productId?: number | null,
  ): Promise<DailySalesMatrixReport>;
  saveReportComments(
    authToken: string,
    input: { reportId: string; text: string | null },
  ): Promise<{ ok: true; comments: string | null } | { ok: false; error: string }>;
  listSignatories(authToken: string): Promise<ReportSignatoryRow[]>;
  getSignatory(
    authToken: string,
    asAtIso?: string | null,
  ): Promise<{ name: string; title: string }>;
  upsertSignatory(
    authToken: string,
    input: {
      id?: string | null;
      name: string;
      title: string;
      effectiveFrom: string;
    },
  ): Promise<{ ok: true; row: ReportSignatoryRow } | { ok: false; error: string }>;
  deleteSignatory(
    authToken: string,
    id: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
}

interface DashboardApi {
  getSummary(authToken: string): Promise<DashboardSummary>;
}

interface FinancialYearsApi {
  listYears(authToken: string): Promise<FinancialYearRow[]>;
  openYear(authToken: string, financialYear: number): Promise<OpenYearResult>;
  closeYear(authToken: string, periodId: string): Promise<FinancialYearRow>;
  listMonthsForOpenYear(
    authToken: string,
  ): Promise<{ year: FinancialYearRow | null; months: FinancialMonthRow[] }>;
  listMonthsForPeriod(
    authToken: string,
    periodId: string,
  ): Promise<FinancialMonthRow[]>;
  setMonthStatus(
    authToken: string,
    monthId: string,
    status: FinancialPeriodStatus,
  ): Promise<FinancialMonthRow>;
  getOpenPostingPeriod(authToken: string): Promise<OpenPostingPeriod | null>;
}

interface VehicleConsignmentNotesApi {
  loadSaleByInvoice(invoiceNo: string): Promise<LoadSaleForConsignmentResult>;
  loadByVcnNo(vcnNo: string): Promise<LoadedConsignmentFormView | null>;
  save(input: SaveConsignmentNoteInput): Promise<SaveConsignmentNoteResult>;
  delete(payload: { id: string; userId: string }): Promise<ConsignmentMutationResult>;
  validate(payload: {
    id: string;
    userId: string;
  }): Promise<ConsignmentMutationResult>;
  loadPrintById(noteId: string): Promise<ConsignmentPrintPayload | null>;
  listValidationQueue(
    userId: string,
  ): Promise<
    import("../../shared/vehicleConsignmentNotes.types.ts").ConsignmentValidationQueuePage
  >;
  validateMany(payload: {
    userId: string;
    noteIds: string[];
  }): Promise<
    import("../../shared/vehicleConsignmentNotes.types.ts").ConsignmentValidateManyResult
  >;
}

export interface ElectronAppApi {
  db: DatabaseApi;
  auth: AuthApi;
  permissions: PermissionsApi;
  sales: SalesApi;
  vehicleConsignmentNotes: VehicleConsignmentNotesApi;
  deliveryOrders: DeliveryOrdersApi;
  carryForward: {
    getFormOptions(): Promise<import("../../shared/carryForward.types.ts").CarryForwardFormOptions>;
    list(): Promise<import("../../shared/carryForward.types.ts").CarryForwardCommitmentRow[]>;
    listPending(input: {
      userId: string;
    }): Promise<import("../../shared/carryForward.types.ts").CarryForwardCommitmentPendingRow[]>;
    upsert(
      input: import("../../shared/carryForward.types.ts").UpsertCarryForwardInput,
    ): Promise<import("../../shared/carryForward.types.ts").CarryForwardMutationResult>;
    upsertBatch(
      input: import("../../shared/carryForward.types.ts").UpsertCarryForwardBatchInput,
    ): Promise<import("../../shared/carryForward.types.ts").CarryForwardBatchResult>;
    delete(
      input: import("../../shared/carryForward.types.ts").DeleteCarryForwardInput,
    ): Promise<import("../../shared/carryForward.types.ts").CarryForwardDeleteResult>;
  };
  carryForwardStock: {
    getFormOptions(): Promise<
      import("../../shared/carryForwardStock.types.ts").CarryForwardStockFormOptions
    >;
    list(): Promise<import("../../shared/carryForwardStock.types.ts").CarryForwardStockRow[]>;
    listPending(input: {
      userId: string;
    }): Promise<import("../../shared/carryForwardStock.types.ts").CarryForwardStockPendingRow[]>;
    listOnHand(input: {
      salesPointId: number;
      productId: number;
    }): Promise<import("../../shared/carryForwardStock.types.ts").CarryForwardStockOnHandRow[]>;
    upsertBatch(
      input: import("../../shared/carryForwardStock.types.ts").UpsertCarryForwardStockBatchInput,
    ): Promise<import("../../shared/carryForwardStock.types.ts").CarryForwardStockBatchResult>;
  };
  transportCost: {
    getFormOptions(): Promise<
      import("../../shared/transportCost.types.ts").TransportCostFormOptions
    >;
    compute(
      authToken: string,
      input: import("../../shared/transportCost.types.ts").TransportCostComputeInput,
    ): Promise<import("../../shared/transportCost.types.ts").TransportCostComputeResult>;
  };
  stock: StockApi;
  reports: ReportsApi;
  dashboard: DashboardApi;
  financialYears: FinancialYearsApi;
  dialog: {
    confirm(message: string): boolean;
    alert(message: string): void;
  };
  print: {
    htmlToPdf(
      html: string,
      options?: { landscape?: boolean; attributionFooter?: boolean },
    ): Promise<Uint8Array>;
    printHtml(
      html: string,
      options?: { landscape?: boolean; attributionFooter?: boolean },
    ): Promise<{ ok: boolean }>;
    printPdf(data: Uint8Array): Promise<{ ok: boolean }>;
    savePdf(input: {
      defaultName: string;
      data: Uint8Array;
    }): Promise<{ cancelled: true } | { ok: true; path: string }>;
  };
  backup: {
    getInfo(authToken: string): Promise<import("../../shared/backup.types.ts").BackupInfo>;
    create(
      authToken: string,
    ): Promise<import("../../shared/backup.types.ts").BackupCreateResult>;
    restore(
      authToken: string,
    ): Promise<import("../../shared/backup.types.ts").BackupRestoreResult>;
    getSchedule(
      authToken: string,
    ): Promise<import("../../shared/backup.types.ts").BackupScheduleStatus>;
    updateSchedule(
      authToken: string,
      patch: Partial<import("../../shared/backup.types.ts").BackupScheduleConfig>,
    ): Promise<import("../../shared/backup.types.ts").BackupScheduleUpdateResult>;
    chooseDestinationFolder(
      authToken: string,
    ): Promise<import("../../shared/backup.types.ts").BackupChooseFolderResult>;
    runScheduledNow(
      authToken: string,
    ): Promise<import("../../shared/backup.types.ts").BackupRunScheduledResult>;
  };
  windows: {
    openReport(
      authToken: string,
      reportId: string,
      query?: unknown,
    ): Promise<{ ok: true } | { ok: false; error: string }>;
    onReportClosed(
      callback: (payload: { reportId: string }) => void,
    ): () => void;
  };
  reportWindow: {
    getBootstrap(
      reportId: string,
    ): Promise<{ reportId: string; authToken: string; query?: unknown } | null>;
    onBootstrap(
      callback: (payload: {
        reportId: string;
        authToken: string;
        query?: unknown;
      }) => void,
    ): () => void;
  };
  booklets: DocumentBookletsApi;
  sync: SyncApi;
}

export interface DocumentBookletsApi {
  listBooklets(
    authToken: string,
    filters?: DocumentBookletFilters,
  ): Promise<DocumentBookletRow[]>;
  createBooklet(
    authToken: string,
    input: CreateDocumentBookletInput,
  ): Promise<{ ok: true; booklet: DocumentBookletRow } | { ok: false; error: string }>;
  validateBooklet(
    authToken: string,
    bookletId: string,
  ): Promise<ValidateDocumentBookletResult>;
  rejectBooklet(
    authToken: string,
    bookletId: string,
    reason?: string,
  ): Promise<RejectDocumentBookletResult>;
  validateManyBooklets(
    authToken: string,
    bookletIds: string[],
  ): Promise<ValidateManyBookletsResult>;
  cancelBooklet(
    authToken: string,
    bookletId: string,
    reason?: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>;
  validateSerial(
    input: ValidateSerialForSalesPointInput,
  ): Promise<ValidateSerialForSalesPointResult>;
}

declare global {
  interface Window {
    api: ElectronAppApi;
  }
}

export {};
