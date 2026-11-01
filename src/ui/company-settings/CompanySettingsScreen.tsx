import { useEffect, useMemo, useState } from "preact/hooks";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  ImageOff,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedDb } from "../auth/db.ts";
import type { AuthUser } from "../auth/session.ts";
import { formatDisplayDate as formatDate } from "../../shared/formatDisplayDate.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import { normalizeVatRateDecimal } from "../../shared/taxRules.ts";
import type { TableSchema } from "../types/electron.d.ts";
import {
  CompanySettingsFormModal,
  MONTHS,
  THEME_COLORS,
  THEME_LABELS,
  THEME_PRESETS,
} from "./CompanySettingsFormModal.tsx";
import {
  AppThemeToggle,
  COMPANY_THEME_CHANGED_EVENT,
} from "../theme/AppThemeToggle.tsx";
import "./CompanySettingsScreen.css";

export type ThemePreset = "agro" | "dark";

interface CompanyRecord {
  id: string;
  companyName: string;
  department: string;
  vatRate: number;
  fiscalYearStartMonth: number;
  logoUrl: string;
  uiThemePreset: ThemePreset;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

type SortField =
  | "companyName"
  | "department"
  | "vatRate"
  | "fiscalYearStartMonth"
  | "uiThemePreset"
  | "updatedAt";

type SortDirection = "asc" | "desc";

type ModalState =
  | { type: "create" }
  | { type: "edit"; record: CompanyRecord }
  | { type: "delete"; record: CompanyRecord }
  | null;

interface CompanySettingsScreenProps {
  readOnly?: boolean;
  user?: AuthUser | null;
}

const COLUMNS: Array<{ key: SortField; label: string }> = [
  { key: "companyName", label: "Company" },
  { key: "department", label: "Department" },
  { key: "vatRate", label: "VAT %" },
  { key: "fiscalYearStartMonth", label: "FY start" },
  { key: "uiThemePreset", label: "Theme" },
  { key: "updatedAt", label: "Updated" },
];

const SESSION_IDLE_TIMEOUT_OPTIONS = [
  { value: 0, label: "Off (no idle sign-out)" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "60 minutes" },
  { value: 120, label: "120 minutes" },
] as const;

function normalizeTheme(value: unknown): ThemePreset {
  return THEME_PRESETS.includes(value as ThemePreset)
    ? (value as ThemePreset)
    : "agro";
}

function LogoCell({ url, name }: { url: string; name: string }) {
  const [hasError, setHasError] = useState(false);

  if (!url || hasError) {
    return (
      <div class="company-settings-logo-placeholder" aria-label="No logo">
        <ImageOff size={15} />
      </div>
    );
  }

  return (
    <img
      class="company-settings-logo"
      src={url}
      alt={`${name} logo`}
      onError={() => setHasError(true)}
    />
  );
}

function ThemeBadge({ preset }: { preset: ThemePreset }) {
  return (
    <span class="company-settings-theme-badge">
      <span
        class="company-settings-theme-dot"
        style={{ background: THEME_COLORS[preset] }}
      />
      {THEME_LABELS[preset]}
    </span>
  );
}

export function CompanySettingsScreen({
  readOnly = false,
  user = null,
}: CompanySettingsScreenProps = {}) {
  const canWrite = !readOnly;
  const isAdmin = user?.role === "ADMIN";
  const [records, setRecords] = useState<CompanyRecord[]>([]);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{
    field: SortField;
    direction: SortDirection;
  }>({ field: "updatedAt", direction: "desc" });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [autoGenerateStockReceiptNo, setAutoGenerateStockReceiptNo] = useState(true);
  const [autoGenerateStockTransferNo, setAutoGenerateStockTransferNo] = useState(true);
  const [stockNumberSaving, setStockNumberSaving] = useState(false);
  const [stockNumberSavedHint, setStockNumberSavedHint] = useState<string | null>(null);
  const [bottleOilUseRegisteredCustomers, setBottleOilUseRegisteredCustomers] =
    useState(false);
  const [bottleOilAllowRation, setBottleOilAllowRation] = useState(false);
  const [bottleOilSettingSaving, setBottleOilSettingSaving] = useState(false);
  const [bottleOilSettingSavedHint, setBottleOilSettingSavedHint] = useState<
    string | null
  >(null);
  const [transportCostMoliweOnlyPolicy, setTransportCostMoliweOnlyPolicy] =
    useState(false);
  const [transportCostSettingSaving, setTransportCostSettingSaving] =
    useState(false);
  const [transportCostSettingSavedHint, setTransportCostSettingSavedHint] =
    useState<string | null>(null);
  const [sessionIdleTimeoutMinutes, setSessionIdleTimeoutMinutes] = useState(0);
  const [sessionSecuritySettingSaving, setSessionSecuritySettingSaving] =
    useState(false);
  const [sessionSecuritySettingSavedHint, setSessionSecuritySettingSavedHint] =
    useState<string | null>(null);
  const [salesInvoiceLockUnitPrice, setSalesInvoiceLockUnitPrice] =
    useState(true);
  const [autoGenerateSalesInvoiceNo, setAutoGenerateSalesInvoiceNo] =
    useState(false);
  const [
    enforceSalesInvoiceBookletValidation,
    setEnforceSalesInvoiceBookletValidation,
  ] = useState(false);
  const [salesInvoiceSettingSaving, setSalesInvoiceSettingSaving] =
    useState(false);
  const [salesInvoiceSettingSavedHint, setSalesInvoiceSettingSavedHint] =
    useState<string | null>(null);
  const [autoGenerateDeliveryOrderNo, setAutoGenerateDeliveryOrderNo] =
    useState(false);
  const [
    enforceDeliveryOrderBookletValidation,
    setEnforceDeliveryOrderBookletValidation,
  ] = useState(false);
  const [doNumberSaving, setDoNumberSaving] = useState(false);
  const [doNumberSavedHint, setDoNumberSavedHint] = useState<string | null>(
    null,
  );
  const [
    stockTransferReceiveUsesDocumentDate,
    setStockTransferReceiveUsesDocumentDate,
  ] = useState(false);
  const [
    loosePalmOilAllowInterSalesPointTransfer,
    setLoosePalmOilAllowInterSalesPointTransfer,
  ] = useState(false);
  const [stockIntakeOilGrouping, setStockIntakeOilGrouping] = useState(false);
  const [loadedStockIntakeOilGrouping, setLoadedStockIntakeOilGrouping] =
    useState(false);
  const [stockTransferSettingSaving, setStockTransferSettingSaving] =
    useState(false);
  const [stockTransferSettingSavedHint, setStockTransferSettingSavedHint] =
    useState<string | null>(null);
  const [looseSalesAllowPublicRelation, setLooseSalesAllowPublicRelation] =
    useState(false);
  const [
    looseSalesAllowUnregisteredCustomer,
    setLooseSalesAllowUnregisteredCustomer,
  ] = useState(false);
  const [loosePalmOilRequireSalesTank, setLoosePalmOilRequireSalesTank] =
    useState(true);
  const [looseSalesSettingSaving, setLooseSalesSettingSaving] = useState(false);
  const [looseSalesSettingSavedHint, setLooseSalesSettingSavedHint] = useState<
    string | null
  >(null);
  const [clearOpsOpen, setClearOpsOpen] = useState(false);
  const [clearOpsConfirmText, setClearOpsConfirmText] = useState("");
  const [clearOpsAlsoSync, setClearOpsAlsoSync] = useState(false);
  const [clearOpsBusy, setClearOpsBusy] = useState(false);
  const [clearOpsError, setClearOpsError] = useState<string | null>(null);
  const [clearOpsSuccessHint, setClearOpsSuccessHint] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadStockNumberSettings() {
      try {
        const result = await getAuthenticatedDb().queryTable({
          table: "CompanySettings",
          limit: 50,
        });
        if (cancelled) {
          return;
        }
        const row = (result.rows as Array<Record<string, unknown>>).find(
          (r) => String(r.id) === "default",
        );
        if (!row) {
          setAutoGenerateStockReceiptNo(true);
          setAutoGenerateStockTransferNo(true);
          setBottleOilUseRegisteredCustomers(false);
          setBottleOilAllowRation(false);
          setTransportCostMoliweOnlyPolicy(false);
          setSessionIdleTimeoutMinutes(0);
          setStockTransferReceiveUsesDocumentDate(false);
          setLoosePalmOilAllowInterSalesPointTransfer(false);
          setStockIntakeOilGrouping(false);
          setLoadedStockIntakeOilGrouping(false);
          setLooseSalesAllowPublicRelation(false);
          setLooseSalesAllowUnregisteredCustomer(false);
          setLoosePalmOilRequireSalesTank(true);
          setSalesInvoiceLockUnitPrice(true);
          setAutoGenerateSalesInvoiceNo(false);
          setAutoGenerateDeliveryOrderNo(false);
          return;
        }
        setAutoGenerateStockReceiptNo(
          row.autoGenerateStockReceiptNo == null
            ? true
            : Number(row.autoGenerateStockReceiptNo) !== 0,
        );
        setAutoGenerateStockTransferNo(
          row.autoGenerateStockTransferNo == null
            ? true
            : Number(row.autoGenerateStockTransferNo) !== 0,
        );
        setBottleOilUseRegisteredCustomers(
          Number(row.bottleOilUseRegisteredCustomers ?? 0) !== 0,
        );
        setBottleOilAllowRation(Number(row.bottleOilAllowRation ?? 0) !== 0);
        setTransportCostMoliweOnlyPolicy(
          Number(row.transportCostMoliweOnlyPolicy ?? 0) !== 0,
        );
        setSessionIdleTimeoutMinutes(
          Number(row.sessionIdleTimeoutMinutes ?? 0),
        );
        setStockTransferReceiveUsesDocumentDate(
          Number(row.stockTransferReceiveUsesDocumentDate ?? 0) !== 0,
        );
        setLoosePalmOilAllowInterSalesPointTransfer(
          Number(row.loosePalmOilAllowInterSalesPointTransfer ?? 0) !== 0,
        );
        const intakeGrouping =
          Number(row.stockIntakeOilGrouping ?? 0) !== 0;
        setStockIntakeOilGrouping(intakeGrouping);
        setLoadedStockIntakeOilGrouping(intakeGrouping);
        setLooseSalesAllowPublicRelation(
          Number(row.looseSalesAllowPublicRelation ?? 0) !== 0,
        );
        setLooseSalesAllowUnregisteredCustomer(
          Number(row.looseSalesAllowUnregisteredCustomer ?? 0) !== 0,
        );
        setLoosePalmOilRequireSalesTank(
          row.loosePalmOilRequireSalesTank == null
            ? true
            : Number(row.loosePalmOilRequireSalesTank) !== 0,
        );
        setSalesInvoiceLockUnitPrice(
          Number(row.salesInvoiceLockUnitPrice ?? 1) !== 0,
        );
        setAutoGenerateSalesInvoiceNo(
          Number(row.autoGenerateSalesInvoiceNo ?? 0) !== 0,
        );
        setEnforceSalesInvoiceBookletValidation(
          Number(row.enforceSalesInvoiceBookletValidation ?? 0) !== 0,
        );
        setAutoGenerateDeliveryOrderNo(
          Number(row.autoGenerateDeliveryOrderNo ?? 0) !== 0,
        );
        setEnforceDeliveryOrderBookletValidation(
          Number(row.enforceDeliveryOrderBookletValidation ?? 0) !== 0,
        );
      } catch {
        if (!cancelled) {
          setAutoGenerateStockReceiptNo(true);
          setAutoGenerateStockTransferNo(true);
          setBottleOilUseRegisteredCustomers(false);
          setBottleOilAllowRation(false);
          setTransportCostMoliweOnlyPolicy(false);
          setSessionIdleTimeoutMinutes(0);
          setStockTransferReceiveUsesDocumentDate(false);
          setLoosePalmOilAllowInterSalesPointTransfer(false);
          setStockIntakeOilGrouping(false);
          setLoadedStockIntakeOilGrouping(false);
          setLooseSalesAllowPublicRelation(false);
          setLooseSalesAllowUnregisteredCustomer(false);
          setLoosePalmOilRequireSalesTank(true);
          setSalesInvoiceLockUnitPrice(true);
          setAutoGenerateSalesInvoiceNo(false);
          setEnforceSalesInvoiceBookletValidation(false);
          setAutoGenerateDeliveryOrderNo(false);
          setEnforceDeliveryOrderBookletValidation(false);
        }
      }
    }

    void loadStockNumberSettings();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  async function onSaveStockNumberSettings() {
    if (!canWrite || stockNumberSaving) {
      return;
    }
    setStockNumberSaving(true);
    setActionError(null);
    setStockNumberSavedHint(null);
    try {
      await getAuthenticatedDb().updateRow({
        table: "CompanySettings",
        primaryKey: { id: "default" },
        values: {
          autoGenerateStockReceiptNo: autoGenerateStockReceiptNo ? 1 : 0,
          autoGenerateStockTransferNo: autoGenerateStockTransferNo ? 1 : 0,
        },
      });
      setStockNumberSavedHint("Stock document numbering saved.");
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save stock document numbering.",
      );
    } finally {
      setStockNumberSaving(false);
    }
  }

  async function onSaveBottleOilSettings() {
    if (!canWrite || bottleOilSettingSaving) {
      return;
    }
    setBottleOilSettingSaving(true);
    setActionError(null);
    setBottleOilSettingSavedHint(null);
    try {
      await getAuthenticatedDb().updateRow({
        table: "CompanySettings",
        primaryKey: { id: "default" },
        values: {
          bottleOilUseRegisteredCustomers: bottleOilUseRegisteredCustomers ? 1 : 0,
          bottleOilAllowRation: bottleOilAllowRation ? 1 : 0,
        },
      });
      setBottleOilSettingSavedHint("Bottle Oil sales options saved.");
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save Bottle Oil sales options.",
      );
    } finally {
      setBottleOilSettingSaving(false);
    }
  }

  async function onSaveTransportCostSettings() {
    if (!canWrite || transportCostSettingSaving) {
      return;
    }
    setTransportCostSettingSaving(true);
    setActionError(null);
    setTransportCostSettingSavedHint(null);
    try {
      await getAuthenticatedDb().updateRow({
        table: "CompanySettings",
        primaryKey: { id: "default" },
        values: {
          transportCostMoliweOnlyPolicy: transportCostMoliweOnlyPolicy ? 1 : 0,
        },
      });
      setTransportCostSettingSavedHint("Transportation cost options saved.");
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save transportation cost options.",
      );
    } finally {
      setTransportCostSettingSaving(false);
    }
  }

  async function onSaveSessionSecuritySettings() {
    if (!canWrite || sessionSecuritySettingSaving) {
      return;
    }

    if (!SESSION_IDLE_TIMEOUT_OPTIONS.some((option) => option.value === sessionIdleTimeoutMinutes)) {
      setActionError("Select a valid idle timeout preset.");
      return;
    }

    setSessionSecuritySettingSaving(true);
    setActionError(null);
    setSessionSecuritySettingSavedHint(null);
    try {
      await getAuthenticatedDb().updateRow({
        table: "CompanySettings",
        primaryKey: { id: "default" },
        values: {
          sessionIdleTimeoutMinutes,
        },
      });
      setSessionSecuritySettingSavedHint("Session security options saved.");
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save session security options.",
      );
    } finally {
      setSessionSecuritySettingSaving(false);
    }
  }

  async function onSaveSalesInvoiceSettings() {
    if (!canWrite || salesInvoiceSettingSaving) {
      return;
    }
    setSalesInvoiceSettingSaving(true);
    setActionError(null);
    setSalesInvoiceSettingSavedHint(null);
    try {
      await getAuthenticatedDb().updateRow({
        table: "CompanySettings",
        primaryKey: { id: "default" },
        values: {
          salesInvoiceLockUnitPrice: salesInvoiceLockUnitPrice ? 1 : 0,
          autoGenerateSalesInvoiceNo: autoGenerateSalesInvoiceNo ? 1 : 0,
          enforceSalesInvoiceBookletValidation:
            enforceSalesInvoiceBookletValidation ? 1 : 0,
        },
      });
      setSalesInvoiceSettingSavedHint("Sales invoice options saved.");
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save sales invoice options.",
      );
    } finally {
      setSalesInvoiceSettingSaving(false);
    }
  }

  async function onSaveDeliveryOrderNumberSettings() {
    if (!canWrite || doNumberSaving) {
      return;
    }
    setDoNumberSaving(true);
    setActionError(null);
    setDoNumberSavedHint(null);
    try {
      await getAuthenticatedDb().updateRow({
        table: "CompanySettings",
        primaryKey: { id: "default" },
        values: {
          autoGenerateDeliveryOrderNo: autoGenerateDeliveryOrderNo ? 1 : 0,
          enforceDeliveryOrderBookletValidation:
            enforceDeliveryOrderBookletValidation ? 1 : 0,
        },
      });
      setDoNumberSavedHint("Delivery order numbering saved.");
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save delivery order numbering.",
      );
    } finally {
      setDoNumberSaving(false);
    }
  }

  async function onSaveStockTransferSettings() {
    if (!canWrite || stockTransferSettingSaving) {
      return;
    }
    setStockTransferSettingSaving(true);
    setActionError(null);
    setStockTransferSettingSavedHint(null);
    try {
      if (
        user?.id &&
        stockIntakeOilGrouping !== loadedStockIntakeOilGrouping
      ) {
        if (!stockIntakeOilGrouping) {
          const status =
            await getElectronApi().stock.getIntakeOilGroupingStatus();
          if (status.poolTotalQty > 0.000001) {
            const confirmed = window.confirm(
              `Pooled intake stock (Sludge Oil and Palm Kernel) totals ${status.poolTotalQty.toLocaleString("en-US")} kg. ` +
                "Turning this off will move Sludge Oil balance to Bottom Tank Oil Grade A and Palm Kernel balance to Cracked Palm Kernel. Continue?",
            );
            if (!confirmed) {
              return;
            }
          }
        }

        const groupingResult =
          await getElectronApi().stock.applyIntakeOilGrouping({
            userId: user.id,
            enabled: stockIntakeOilGrouping,
          });
        if (groupingResult.ok === false) {
          setActionError(groupingResult.error);
          return;
        }
        setLoadedStockIntakeOilGrouping(stockIntakeOilGrouping);
      }

      await getAuthenticatedDb().updateRow({
        table: "CompanySettings",
        primaryKey: { id: "default" },
        values: {
          stockTransferReceiveUsesDocumentDate: stockTransferReceiveUsesDocumentDate
            ? 1
            : 0,
          loosePalmOilAllowInterSalesPointTransfer:
            loosePalmOilAllowInterSalesPointTransfer ? 1 : 0,
        },
      });
      setStockTransferSettingSavedHint("Stock transfer options saved.");
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save stock transfer options.",
      );
    } finally {
      setStockTransferSettingSaving(false);
    }
  }

  async function onSaveLooseSalesSettings() {
    if (!canWrite || looseSalesSettingSaving) {
      return;
    }
    setLooseSalesSettingSaving(true);
    setActionError(null);
    setLooseSalesSettingSavedHint(null);
    try {
      await getAuthenticatedDb().updateRow({
        table: "CompanySettings",
        primaryKey: { id: "default" },
        values: {
          looseSalesAllowPublicRelation: looseSalesAllowPublicRelation ? 1 : 0,
          looseSalesAllowUnregisteredCustomer: looseSalesAllowUnregisteredCustomer
            ? 1
            : 0,
          loosePalmOilRequireSalesTank: loosePalmOilRequireSalesTank ? 1 : 0,
        },
      });
      setLooseSalesSettingSavedHint("Loose sales options saved.");
    } catch (saveError) {
      setActionError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save loose sales options.",
      );
    } finally {
      setLooseSalesSettingSaving(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const api = getElectronApi();
        const [result, tableSchema] = await Promise.all([
          api.db.queryTable({ table: "CompanySettings", limit: 200 }),
          api.db.getTableSchema("CompanySettings"),
        ]);

        if (cancelled) {
          return;
        }

        setRecords(
          result.rows.map((row) => ({
            id: String(row.id ?? ""),
            companyName: String(row.companyName ?? ""),
            department: String(row.department ?? ""),
            vatRate: normalizeVatRateDecimal(row.vatRate as string | number | null) * 100,
            fiscalYearStartMonth: Number(row.fiscalYearStartMonth ?? 1),
            logoUrl: String(row.logoUrl ?? ""),
            uiThemePreset: normalizeTheme(row.uiThemePreset),
            createdAt: String(row.createdAt ?? ""),
            updatedAt: String(row.updatedAt ?? ""),
            raw: row,
          })),
        );
        setSchema(tableSchema);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load company settings.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    function onThemeChanged(event: Event) {
      const preset = normalizeTheme((event as CustomEvent<ThemePreset>).detail);
      setRecords((current) =>
        current.map((record) =>
          record.id === "default"
            ? {
                ...record,
                uiThemePreset: preset,
                raw: { ...record.raw, uiThemePreset: preset },
              }
            : record,
        ),
      );
    }
    window.addEventListener(COMPANY_THEME_CHANGED_EVENT, onThemeChanged);
    return () => {
      window.removeEventListener(COMPANY_THEME_CHANGED_EVENT, onThemeChanged);
    };
  }, []);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return records
      .filter((record) => {
        if (!normalizedQuery) {
          return true;
        }

        return (
          record.companyName.toLowerCase().includes(normalizedQuery) ||
          record.department.toLowerCase().includes(normalizedQuery) ||
          record.uiThemePreset.toLowerCase().includes(normalizedQuery)
        );
      })
      .sort((left, right) => {
        const leftValue = left[sort.field];
        const rightValue = right[sort.field];
        const result = String(leftValue).localeCompare(String(rightValue), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return sort.direction === "asc" ? result : -result;
      });
  }, [records, query, sort]);

  function refresh() {
    setRefreshKey((current) => current + 1);
  }

  async function deleteRecord(record: CompanyRecord) {
    setActionError(null);

    try {
      await getAuthenticatedDb().deleteRow({
        table: "CompanySettings",
        primaryKey: { id: record.id },
      });
      setModal(null);
      refresh();
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete company settings.",
      );
      setModal(null);
    }
  }

  function openClearOpsModal() {
    setClearOpsConfirmText("");
    setClearOpsAlsoSync(false);
    setClearOpsError(null);
    setClearOpsOpen(true);
  }

  function closeClearOpsModal() {
    if (clearOpsBusy) {
      return;
    }
    setClearOpsOpen(false);
    setClearOpsConfirmText("");
    setClearOpsAlsoSync(false);
    setClearOpsError(null);
  }

  function formatClearOpsSummary(
    deleted: Record<string, number>,
    sequences: Record<string, number>,
    syncCleared?: boolean,
    syncError?: string,
  ): string {
    const deletedParts = Object.entries(deleted)
      .filter(([, count]) => count > 0)
      .map(([table, count]) => `${table} (${count})`);
    const sequenceParts = Object.entries(sequences)
      .filter(([, count]) => count > 0)
      .map(([table]) => table);
    const deletedLabel =
      deletedParts.length > 0 ? deletedParts.join(", ") : "no rows";
    const sequencesLabel =
      sequenceParts.length > 0
        ? ` Sequences reset: ${sequenceParts.join(", ")}.`
        : "";
    let syncLabel = "";
    if (syncCleared === true) {
      syncLabel = " Central sync database operational data also cleared.";
    } else if (syncError) {
      syncLabel = ` Local clear succeeded; sync clear failed: ${syncError}`;
    }
    return `Cleared operational data: ${deletedLabel}.${sequencesLabel}${syncLabel} Refresh open stock, sales, and delivery order screens.`;
  }

  async function onConfirmClearOps() {
    if (clearOpsBusy || clearOpsConfirmText !== "CLEAR") {
      return;
    }

    setClearOpsBusy(true);
    setClearOpsError(null);
    setClearOpsSuccessHint(null);
    setActionError(null);

    try {
      const result = await getAuthenticatedDb().clearOperationalData({
        confirm: "CLEAR",
        alsoClearSyncDb: clearOpsAlsoSync,
      });
      if (result.ok === false) {
        setClearOpsError(result.error);
        return;
      }

      setClearOpsOpen(false);
      setClearOpsConfirmText("");
      setClearOpsAlsoSync(false);
      setClearOpsSuccessHint(
        formatClearOpsSummary(
          result.deleted,
          result.sequences,
          result.syncCleared,
          result.syncError,
        ),
      );
    } catch (clearError) {
      setClearOpsError(
        clearError instanceof Error
          ? clearError.message
          : "Failed to clear operational data.",
      );
    } finally {
      setClearOpsBusy(false);
    }
  }

  return (
    <div class="company-settings-screen">
      <header class="company-settings-header">
        <div class="company-settings-heading">
          <Building2 size={19} />
          <div>
            <h2>General Application Settings</h2>
            <p>Company identity, fiscal settings, and UI theme registry</p>
          </div>
        </div>
      </header>

      <div class="company-settings-cards-grid">
      <section class="company-settings-stock-numbering">
        <div class="company-settings-stock-numbering-header">
          <div>
            <h3>Stock document numbering</h3>
            <p>
              Choose whether receipt and transfer numbers are assigned automatically
              or entered when drafting new documents.
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              class="company-settings-primary-btn"
              disabled={isLoading || stockNumberSaving}
              onClick={() => void onSaveStockNumberSettings()}
            >
              {stockNumberSaving ? "Saving…" : "Save numbering options"}
            </button>
          ) : null}
        </div>
        {stockNumberSavedHint && !actionError ? (
          <p class="company-settings-stock-numbering-hint">{stockNumberSavedHint}</p>
        ) : null}
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={autoGenerateStockReceiptNo}
            disabled={isLoading || !canWrite || stockNumberSaving}
            onChange={(event) => {
              setAutoGenerateStockReceiptNo(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setStockNumberSavedHint(null);
            }}
          />
          <span>
            <strong>Auto-generate receipt numbers</strong>
            <span>
              When unchecked, users must enter a receipt number when creating a new
              stock receipt draft.
            </span>
          </span>
        </label>
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={autoGenerateStockTransferNo}
            disabled={isLoading || !canWrite || stockNumberSaving}
            onChange={(event) => {
              setAutoGenerateStockTransferNo(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setStockNumberSavedHint(null);
            }}
          />
          <span>
            <strong>Auto-generate transfer numbers</strong>
            <span>
              When unchecked, users must enter a transfer number when creating a new
              stock transfer draft.
            </span>
          </span>
        </label>
      </section>

      <section class="company-settings-stock-numbering">
        <div class="company-settings-stock-numbering-header">
          <div>
            <h3>Bottle Oil sales</h3>
            <p>
              Options for Bottle Oil invoices: registered customers and whether
              Ration disposition is allowed.
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              class="company-settings-primary-btn"
              disabled={isLoading || bottleOilSettingSaving}
              onClick={() => void onSaveBottleOilSettings()}
            >
              {bottleOilSettingSaving ? "Saving…" : "Save Bottle Oil options"}
            </button>
          ) : null}
        </div>
        {bottleOilSettingSavedHint && !actionError ? (
          <p class="company-settings-stock-numbering-hint">
            {bottleOilSettingSavedHint}
          </p>
        ) : null}
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={bottleOilUseRegisteredCustomers}
            disabled={isLoading || !canWrite || bottleOilSettingSaving}
            onChange={(event) => {
              setBottleOilUseRegisteredCustomers(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setBottleOilSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Use registered customers</strong>
            <span>
              When unchecked (default), Bottle Oil sales never shows the
              registered-customer checkbox and requires a customer name on the
              invoice. When checked, Bottle Oil sales requires a customer from the
              directory (still no per-invoice checkbox — this setting is the
              switch).
            </span>
          </span>
        </label>
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={bottleOilAllowRation}
            disabled={isLoading || !canWrite || bottleOilSettingSaving}
            onChange={(event) => {
              setBottleOilAllowRation(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setBottleOilSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Allow Ration disposition</strong>
            <span>
              When unchecked (default), Bottle Oil sales hides the Ration option.
              When checked, clerks can mark Bottle Oil invoices as Ration.
              Public relation is always available.
            </span>
          </span>
        </label>
      </section>

      <section class="company-settings-stock-numbering">
        <div class="company-settings-stock-numbering-header">
          <div>
            <h3>Transportation cost</h3>
            <p>
              Options for transport cost compute and the monthly transportation
              cost report.
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              class="company-settings-primary-btn"
              disabled={isLoading || transportCostSettingSaving}
              onClick={() => void onSaveTransportCostSettings()}
            >
              {transportCostSettingSaving ? "Saving…" : "Save transportation cost options"}
            </button>
          ) : null}
        </div>
        {transportCostSettingSavedHint && !actionError ? (
          <p class="company-settings-stock-numbering-hint">
            {transportCostSettingSavedHint}
          </p>
        ) : null}
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={transportCostMoliweOnlyPolicy}
            disabled={isLoading || !canWrite || transportCostSettingSaving}
            onChange={(event) => {
              setTransportCostMoliweOnlyPolicy(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setTransportCostSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Moliwe + SCR MAYA transport cost policy</strong>
            <span>
              When checked (default), compute and the monthly transportation cost
              report include only Moliwe invoices raised to customer SCR MAYA.
              Uncheck only to include all collection points and customers.
            </span>
          </span>
        </label>
      </section>

      <section class="company-settings-stock-numbering">
        <div class="company-settings-stock-numbering-header">
          <div>
            <h3>Session security</h3>
            <p>
              Automatically sign users out after a period of inactivity. Applies
              on next sign-in.
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              class="company-settings-primary-btn"
              disabled={isLoading || sessionSecuritySettingSaving}
              onClick={() => void onSaveSessionSecuritySettings()}
            >
              {sessionSecuritySettingSaving ? "Saving…" : "Save session security options"}
            </button>
          ) : null}
        </div>
        {sessionSecuritySettingSavedHint && !actionError ? (
          <p class="company-settings-stock-numbering-hint">
            {sessionSecuritySettingSavedHint}
          </p>
        ) : null}
        <label class="company-settings-stock-numbering-option company-settings-stock-numbering-select">
          <span>
            <strong>Idle sign-out timeout</strong>
            <span>
              When Off (default), users stay signed in until they sign out manually
              or the session expires. When set, the app silently signs out after
              the selected period with no keyboard or mouse activity.
            </span>
          </span>
          <select
            value={String(sessionIdleTimeoutMinutes)}
            disabled={isLoading || !canWrite || sessionSecuritySettingSaving}
            onChange={(event) => {
              setSessionIdleTimeoutMinutes(
                Number.parseInt(
                  (event.currentTarget as HTMLSelectElement).value,
                  10,
                ),
              );
              setSessionSecuritySettingSavedHint(null);
            }}
          >
            {SESSION_IDLE_TIMEOUT_OPTIONS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section class="company-settings-stock-numbering">
        <div class="company-settings-stock-numbering-header">
          <div>
            <h3>Sales invoices</h3>
            <p>
              Options for Add item and Edit item on loose Sales Invoicing and
              Bottle Oil sales.
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              class="company-settings-primary-btn"
              disabled={isLoading || salesInvoiceSettingSaving}
              onClick={() => void onSaveSalesInvoiceSettings()}
            >
              {salesInvoiceSettingSaving ? "Saving…" : "Save sales invoice options"}
            </button>
          ) : null}
        </div>
        {salesInvoiceSettingSavedHint && !actionError ? (
          <p class="company-settings-stock-numbering-hint">
            {salesInvoiceSettingSavedHint}
          </p>
        ) : null}
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={salesInvoiceLockUnitPrice}
            disabled={isLoading || !canWrite || salesInvoiceSettingSaving}
            onChange={(event) => {
              setSalesInvoiceLockUnitPrice(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setSalesInvoiceSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Lock unit price from schedule</strong>
            <span>
              When checked (default), Add item and Edit item modals resolve unit
              price from the product pricing schedule and block manual edits.
              When unchecked, clerks can override the price when the field is
              editable (walk-in loose sales without auto-fill).
            </span>
          </span>
        </label>
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={autoGenerateSalesInvoiceNo}
            disabled={isLoading || !canWrite || salesInvoiceSettingSaving}
            onChange={(event) => {
              setAutoGenerateSalesInvoiceNo(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setSalesInvoiceSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Auto-generate sales invoice numbers</strong>
            <span>
              When unchecked (default), users enter a booklet serial when creating
              a new invoice. When checked, the system assigns INV-year-###### on
              save.
            </span>
          </span>
        </label>
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={enforceSalesInvoiceBookletValidation}
            disabled={isLoading || !canWrite || salesInvoiceSettingSaving}
            onChange={(event) => {
              setEnforceSalesInvoiceBookletValidation(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setSalesInvoiceSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Enforce booklet validation</strong>
            <span>
              When checked, manual sales invoice serials must belong to an active
              booklet issued to the selected collection point. When unchecked (default),
              any unused numeric serial is accepted. Ignored when auto-generate is on.
            </span>
          </span>
        </label>
      </section>

      <section class="company-settings-stock-numbering">
        <div class="company-settings-stock-numbering-header">
          <div>
            <h3>Delivery order numbering</h3>
            <p>
              Choose whether delivery order numbers are assigned automatically or
              entered from a booklet when creating a new order.
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              class="company-settings-primary-btn"
              disabled={isLoading || doNumberSaving}
              onClick={() => void onSaveDeliveryOrderNumberSettings()}
            >
              {doNumberSaving ? "Saving…" : "Save numbering options"}
            </button>
          ) : null}
        </div>
        {doNumberSavedHint && !actionError ? (
          <p class="company-settings-stock-numbering-hint">{doNumberSavedHint}</p>
        ) : null}
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={autoGenerateDeliveryOrderNo}
            disabled={isLoading || !canWrite || doNumberSaving}
            onChange={(event) => {
              setAutoGenerateDeliveryOrderNo(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setDoNumberSavedHint(null);
            }}
          />
          <span>
            <strong>Auto-generate delivery order numbers</strong>
            <span>
              When unchecked (default), users enter a booklet serial when creating
              a new delivery order. When checked, the system assigns DO-year-######
              on save. Carry-forward and transfer numbers stay system-assigned.
            </span>
          </span>
        </label>
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={enforceDeliveryOrderBookletValidation}
            disabled={isLoading || !canWrite || doNumberSaving}
            onChange={(event) => {
              setEnforceDeliveryOrderBookletValidation(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setDoNumberSavedHint(null);
            }}
          />
          <span>
            <strong>Enforce booklet validation</strong>
            <span>
              When checked, manual delivery order serials must belong to an active
              booklet issued to the selected collection point. When unchecked (default),
              any unused numeric serial is accepted. Ignored when auto-generate is on.
            </span>
          </span>
        </label>
      </section>

      <section class="company-settings-stock-numbering">
        <div class="company-settings-stock-numbering-header">
          <div>
            <h3>Loose sales</h3>
            <p>
              Options for Sales Invoicing (loose product) invoices.
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              class="company-settings-primary-btn"
              disabled={isLoading || looseSalesSettingSaving}
              onClick={() => void onSaveLooseSalesSettings()}
            >
              {looseSalesSettingSaving ? "Saving…" : "Save loose sales options"}
            </button>
          ) : null}
        </div>
        {looseSalesSettingSavedHint && !actionError ? (
          <p class="company-settings-stock-numbering-hint">
            {looseSalesSettingSavedHint}
          </p>
        ) : null}
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={looseSalesAllowPublicRelation}
            disabled={isLoading || !canWrite || looseSalesSettingSaving}
            onChange={(event) => {
              setLooseSalesAllowPublicRelation(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setLooseSalesSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Allow Public relation disposition</strong>
            <span>
              When unchecked (default), Sales Invoicing hides Public relation.
              When checked, clerks can mark loose invoices as Public relation.
            </span>
          </span>
        </label>
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={looseSalesAllowUnregisteredCustomer}
            disabled={isLoading || !canWrite || looseSalesSettingSaving}
            onChange={(event) => {
              setLooseSalesAllowUnregisteredCustomer(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setLooseSalesSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Use unregistered customer</strong>
            <span>
              When unchecked (default), Sales Invoicing requires a customer from
              the directory. When checked, clerks enter the customer name on the
              invoice instead (normal disposition only; Ration / Public relation
              always use an invoice name).
            </span>
          </span>
        </label>
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={loosePalmOilRequireSalesTank}
            disabled={isLoading || !canWrite || looseSalesSettingSaving}
            onChange={(event) => {
              setLoosePalmOilRequireSalesTank(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setLooseSalesSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Require sales tank for Loose Palm Oil</strong>
            <span>
              When on (default), Loose Palm Oil invoices only use locations marked
              Sales tank. When off, Palm Oil can use any location with stock.
              Other products always use any location with stock; Palm Kernel /
              Cake never use a location.
            </span>
          </span>
        </label>
      </section>

      <section class="company-settings-stock-numbering">
        <div class="company-settings-stock-numbering-header">
          <div>
            <h3>Stock transfers</h3>
            <p>
              Options for how transfer receive dates affect inventory posting.
            </p>
          </div>
          {canWrite ? (
            <button
              type="button"
              class="company-settings-primary-btn"
              disabled={isLoading || stockTransferSettingSaving}
              onClick={() => void onSaveStockTransferSettings()}
            >
              {stockTransferSettingSaving ? "Saving…" : "Save transfer options"}
            </button>
          ) : null}
        </div>
        {stockTransferSettingSavedHint && !actionError ? (
          <p class="company-settings-stock-numbering-hint">
            {stockTransferSettingSavedHint}
          </p>
        ) : null}
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={loosePalmOilAllowInterSalesPointTransfer}
            disabled={isLoading || !canWrite || stockTransferSettingSaving}
            onChange={(event) => {
              setLoosePalmOilAllowInterSalesPointTransfer(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setStockTransferSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Allow loose Palm Oil transfers between collection points</strong>
            <span>
              When unchecked (default), only bottled products may transfer between
              collection points. Loose Palm Oil and other loose products must use
              Within collection point. When checked, loose Palm Oil may also
              transfer between collection points; other loose products remain
              intra-only.
            </span>
          </span>
        </label>
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={stockIntakeOilGrouping}
            disabled={isLoading || !canWrite || stockTransferSettingSaving}
            onChange={(event) => {
              setStockIntakeOilGrouping(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setStockTransferSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Group products for stock intake</strong>
            <span>
              When off (default), each product is received and tracked separately.
              When on, bulk receipts and carry-forward use Palm Oil, Sludge Oil, and
              Palm Kernel groups; sludge grades and cracked/uncracked palm kernel
              invoices deduct from shared pools. Invoices and reports always show
              the individual product names.
            </span>
          </span>
        </label>
        <label class="company-settings-stock-numbering-option">
          <input
            type="checkbox"
            checked={stockTransferReceiveUsesDocumentDate}
            disabled={isLoading || !canWrite || stockTransferSettingSaving}
            onChange={(event) => {
              setStockTransferReceiveUsesDocumentDate(
                (event.currentTarget as HTMLInputElement).checked,
              );
              setStockTransferSettingSavedHint(null);
            }}
          />
          <span>
            <strong>Use receive date for stock posting</strong>
            <span>
              When on, transfer receive posts inventory on the Date entered
              (must be in the open financial month). When off (default), stock
              posts at the moment Receive is confirmed; the Date field is
              paperwork only.
            </span>
          </span>
        </label>
      </section>

      {isAdmin && canWrite ? (
        <section class="company-settings-stock-numbering company-settings-danger-zone">
          <div class="company-settings-stock-numbering-header">
            <div>
              <h3>Danger zone</h3>
              <p>
                Permanently delete operational transactions while keeping master
                data (products, customers, users, budgets, permissions, and
                settings).
              </p>
            </div>
            <button
              type="button"
              class="company-settings-delete-btn company-settings-danger-btn"
              disabled={isLoading || clearOpsBusy}
              onClick={openClearOpsModal}
            >
              Clear operational data…
            </button>
          </div>
          <div class="company-settings-danger-copy">
            <p>
              <strong>Deletes:</strong> stock movements and balances; stock
              receipts, transfers, and adjustments; sales (lines, payments, and
              vehicle consignment notes); delivery orders and transfer links.
            </p>
            <p>
              <strong>Resets:</strong> stock document, commercial invoice,
              delivery order, and VCN sequence counters to 1.
            </p>
          </div>
          {clearOpsSuccessHint && !actionError ? (
            <p class="company-settings-stock-numbering-hint">
              {clearOpsSuccessHint}
            </p>
          ) : null}
        </section>
      ) : null}
      </div>

      {error ? <p class="company-settings-error">{error}</p> : null}
      {actionError ? <p class="company-settings-error">{actionError}</p> : null}

      <section class="company-settings-registry">
        <div class="company-settings-registry-header">
          <div>
            <h3>Company registry</h3>
            <p class="company-settings-registry-subtitle">
              {filtered.length} / {records.length} records
            </p>
          </div>
          <div class="company-settings-registry-controls">
            {canWrite ? <AppThemeToggle /> : null}
            <label class="company-settings-search">
              <Search size={14} />
              <input
                type="search"
                value={query}
                placeholder="Search company, department, theme…"
                onInput={(event) =>
                  setQuery((event.currentTarget as HTMLInputElement).value)
                }
              />
            </label>
            <div class="company-settings-registry-sort">
              <label class="company-settings-registry-sort-label">
                Sort by
                <select
                  class="company-settings-registry-sort-select"
                  value={sort.field}
                  onChange={(event) => {
                    const field = (event.currentTarget as HTMLSelectElement)
                      .value as SortField;
                    setSort((current) => ({
                      field,
                      direction:
                        current.field === field ? current.direction : "desc",
                    }));
                  }}
                >
                  {COLUMNS.map((column) => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                class="company-settings-registry-sort-direction"
                title={
                  sort.direction === "asc"
                    ? "Sort ascending"
                    : "Sort descending"
                }
                onClick={() =>
                  setSort((current) => ({
                    ...current,
                    direction: current.direction === "asc" ? "desc" : "asc",
                  }))
                }
              >
                {sort.direction === "asc" ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </button>
            </div>
            {canWrite ? (
              <button
                type="button"
                class="company-settings-primary-btn"
                disabled={!schema || isLoading}
                onClick={() => setModal({ type: "create" })}
              >
                <Plus size={14} />
                New record
              </button>
            ) : null}
          </div>
        </div>

        <div class="company-settings-registry-list">
          {isLoading ? (
            <p class="company-settings-registry-empty">
              Loading company settings…
            </p>
          ) : filtered.length === 0 ? (
            <p class="company-settings-registry-empty">
              No records match your search.
            </p>
          ) : (
            filtered.map((record) => (
              <article key={record.id} class="company-settings-record-card">
                <div class="company-settings-record-logo">
                  <LogoCell url={record.logoUrl} name={record.companyName} />
                </div>
                <div class="company-settings-record-body">
                  <div class="company-settings-record-title">
                    <strong>{record.companyName}</strong>
                    <small>{record.id}</small>
                  </div>
                  <dl class="company-settings-record-meta">
                    <div>
                      <dt>Department</dt>
                      <dd>{record.department || "—"}</dd>
                    </div>
                    <div>
                      <dt>VAT %</dt>
                      <dd class="company-settings-mono">
                        {record.vatRate.toFixed(2)}%
                      </dd>
                    </div>
                    <div>
                      <dt>FY start</dt>
                      <dd>
                        {MONTHS[record.fiscalYearStartMonth - 1] ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Theme</dt>
                      <dd>
                        <ThemeBadge preset={record.uiThemePreset} />
                      </dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd class="company-settings-date">
                        {formatDate(record.updatedAt)}
                      </dd>
                    </div>
                  </dl>
                </div>
                {canWrite ? (
                  <div class="company-settings-record-actions">
                    <div class="company-settings-actions">
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => setModal({ type: "edit", record })}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        title={
                          record.id === "default"
                            ? "The default company record cannot be deleted"
                            : "Delete"
                        }
                        class="is-danger"
                        disabled={record.id === "default"}
                        onClick={() => setModal({ type: "delete", record })}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>

      {modal?.type === "create" || modal?.type === "edit" ? (
        <CompanySettingsFormModal
          key={
            modal.type === "edit"
              ? `edit-${modal.record.id}`
              : "create-company-settings"
          }
          mode={modal.type}
          row={modal.type === "edit" ? modal.record.raw : undefined}
          onClose={() => setModal(null)}
          onSaved={refresh}
        />
      ) : null}

      {modal?.type === "delete" ? (
        <FormDialog
          ariaLabel="Delete company settings"
          title="Delete record"
          onClose={() => setModal(null)}
        >
          <div class="company-settings-delete">
            <p>
              Permanently delete <strong>{modal.record.companyName}</strong>?
              This cannot be undone.
            </p>
            <div class="form-dialog-actions">
              <button
                type="button"
                class="form-dialog-btn-secondary"
                onClick={() => setModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                class="company-settings-delete-btn"
                onClick={() => void deleteRecord(modal.record)}
              >
                Delete
              </button>
            </div>
          </div>
        </FormDialog>
      ) : null}

      {clearOpsOpen ? (
        <FormDialog
          ariaLabel="Clear operational data"
          title="Clear operational data"
          onClose={closeClearOpsModal}
        >
          <div class="company-settings-delete company-settings-clear-ops">
            <p>
              This permanently deletes stock, sales, vehicle consignment notes,
              and delivery order data from this database. Master data is kept.
            </p>
            <ul class="company-settings-clear-ops-list">
              <li>StockMovement, StockBalance</li>
              <li>StockReceipt, StockTransfer, StockAdjustment (+ lines)</li>
              <li>Sale (+ lines, taxes, payments, VCN)</li>
              <li>DeliveryOrderTransfer, DeliveryOrder (+ details)</li>
              <li>Document sequences reset to 1</li>
            </ul>
            <label class="company-settings-clear-ops-confirm company-settings-clear-ops-sync">
              <input
                type="checkbox"
                checked={clearOpsAlsoSync}
                disabled={clearOpsBusy}
                onChange={(event) =>
                  setClearOpsAlsoSync(
                    (event.currentTarget as HTMLInputElement).checked,
                  )
                }
              />
              <span>
                Also clear central sync database (requires sync server online and
                Device API token). Affects the database the sync server is
                connected to.
              </span>
            </label>
            <label class="company-settings-clear-ops-confirm">
              <span>Type CLEAR to confirm</span>
              <input
                type="text"
                class="company-settings-input"
                value={clearOpsConfirmText}
                disabled={clearOpsBusy}
                autoComplete="off"
                spellcheck={false}
                onInput={(event) =>
                  setClearOpsConfirmText(
                    (event.currentTarget as HTMLInputElement).value,
                  )
                }
              />
            </label>
            {clearOpsError ? (
              <p class="company-settings-error">{clearOpsError}</p>
            ) : null}
            <div class="form-dialog-actions">
              <button
                type="button"
                class="form-dialog-btn-secondary"
                disabled={clearOpsBusy}
                onClick={closeClearOpsModal}
              >
                Cancel
              </button>
              <button
                type="button"
                class="company-settings-delete-btn"
                disabled={clearOpsBusy || clearOpsConfirmText !== "CLEAR"}
                onClick={() => void onConfirmClearOps()}
              >
                {clearOpsBusy ? "Clearing…" : "Clear operational data"}
              </button>
            </div>
          </div>
        </FormDialog>
      ) : null}
    </div>
  );
}
