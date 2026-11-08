import { useEffect, useMemo, useState } from "preact/hooks";
import type { SalesBudgetPhaseMonth, SalesBudgetPhaseResult } from "../../shared/salesBudgetPhase.ts";
import {
  balancePercentStringsTo100,
  buildSalesBudgetPhase,
  formatPhasedAmountDisplay,
  formatPhasedQtyKgDisplay,
  monthName,
  normalizeFiscalMonthPercents,
} from "../../shared/salesBudgetPhase.ts";
import {
  salesBudgetCategoriesWithProducts,
  toSalesBudgetCategoryDef,
  type SalesBudgetCategoryDef,
  type SalesBudgetCategoryRef,
  type SalesBudgetProductRef,
} from "../../shared/salesBudgetCategories.ts";
import { getAuthenticatedDb } from "../auth/db.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedReports } from "../auth/reports.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import { openConfirm } from "../components/confirmModal.tsx";
import { ReportFooter } from "../reports/ReportFooter.tsx";
import "./SalesBudgetScreen.css";
import "../components/FormDialog.css";

interface SalesBudgetScreenProps {
  readOnly?: boolean;
}

type FinancialYearPeriodRow = {
  financialYear: number;
  startDate: string;
  endDate: string;
  status: string;
};

type BudgetRow = {
  id: string;
  financialYear: number;
  productCatId: number;
  annualQtyKg: string;
  budgetUnitPricePerKg: string;
};

type PhaseProfileRow = {
  id: string;
  financialYear: number;
  productCatId: number;
  pctM01: string;
  pctM02: string;
  pctM03: string;
  pctM04: string;
  pctM05: string;
  pctM06: string;
  pctM07: string;
  pctM08: string;
  pctM09: string;
  pctM10: string;
  pctM11: string;
  pctM12: string;
};

type FiscalMonthLabel = { financialMonth: number; label: string };

/* function formatPeriodLabel(p: FinancialYearPeriodRow): string {
  const sy = p.startDate?.slice(0, 10) ?? "";
  const ey = p.endDate?.slice(0, 10) ?? "";
  const sY = sy ? sy.slice(0, 4) : String(p.financialYear);
  const eY = ey ? ey.slice(0, 4) : String(p.financialYear);
  return `FY ${p.financialYear} (${sY}–${eY}) · ${p.status}`;
} */

function pad12(values: string[]): string[] {
  return Array.from({ length: 12 }, (_, i) => values[i] ?? "0");
}

function parsePercentNumber(v: string): number {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function sumEnteredPercents(values: string[]): number {
  return values.reduce((acc, v) => acc + parsePercentNumber(v), 0);
}

const PCT_SUM_OK_EPS = 0.02;

function fiscalMonthCalendarLabel(
  financialYear: number,
  financialMonth: number,
  fiscalYearStartMonth: number,
): string {
  const zeroBased = financialMonth - 1;
  const startZero = fiscalYearStartMonth - 1;
  const calendarMonth = (startZero + zeroBased) % 12;
  const yearOffset = Math.floor((startZero + zeroBased) / 12);
  const calendarYear = financialYear + yearOffset;
  return `${monthName(calendarMonth + 1)} ${calendarYear}`;
}

function stripThousands(value: string): string {
  return value.trim().replace(/,/g, "");
}

function formatAnnualFigure(value: number | string): string {
  const n =
    typeof value === "number"
      ? value
      : Number.parseFloat(stripThousands(String(value ?? "")));
  if (!Number.isFinite(n)) {
    return "";
  }
  return Math.round(n).toLocaleString("en-US");
}

function formatUnitPriceFigure(value: number | string): string {
  const n =
    typeof value === "number"
      ? value
      : Number.parseFloat(stripThousands(String(value ?? "")));
  if (!Number.isFinite(n)) {
    return "";
  }
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function parseQtyKg(value: string): number {
  const s = stripThousands(value);
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Annual quantity must be a non-negative number.");
  }
  return Math.round(n);
}

function parsePrice(value: string): number {
  const s = stripThousands(value);
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Unit price must be a non-negative number.");
  }
  return n;
}

function tryComputeRevenueDisplay(qtyRaw: string, priceRaw: string): string {
  const qtyStr = stripThousands(qtyRaw).trim();
  const priceStr = stripThousands(priceRaw).trim();
  if (!qtyStr || !priceStr) {
    return "—";
  }
  const qty = Number.parseFloat(qtyStr);
  const price = Number.parseFloat(priceStr);
  if (!Number.isFinite(qty) || !Number.isFinite(price) || qty < 0 || price < 0) {
    return "—";
  }
  return formatAnnualFigure(Math.round(qty) * price);
}

function BudgetRowForm({
  cat,
  budget,
  canEdit,
  onSave,
  onClear,
}: {
  cat: SalesBudgetCategoryDef;
  budget: BudgetRow | undefined;
  canEdit: boolean;
  onSave: (annualQtyKg: number, budgetUnitPricePerKg: number) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const initialQty = budget?.annualQtyKg ? formatAnnualFigure(budget.annualQtyKg) : "";
  const initialPrice = budget?.budgetUnitPricePerKg
    ? formatUnitPriceFigure(budget.budgetUnitPricePerKg)
    : "";

  const [revenueDisplay, setRevenueDisplay] = useState(() =>
    tryComputeRevenueDisplay(initialQty, initialPrice),
  );

  useEffect(() => {
    setRevenueDisplay(tryComputeRevenueDisplay(initialQty, initialPrice));
  }, [initialQty, initialPrice, cat.productCatId]);

  return (
    <form
      class="sbb-budget-form"
      onInput={(e) => {
        const form = e.currentTarget;
        const fd = new FormData(form);
        const qty = String(fd.get("annualQtyKg") ?? "");
        const price = String(fd.get("budgetUnitPricePerKg") ?? "");
        setRevenueDisplay(tryComputeRevenueDisplay(qty, price));
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!canEdit) {
          return;
        }
        const form = e.currentTarget;
        const fd = new FormData(form);
        const annualQtyKgRaw = String(fd.get("annualQtyKg") ?? "").trim();
        const budgetUnitPricePerKgRaw = String(
          fd.get("budgetUnitPricePerKg") ?? "",
        ).trim();
        const annualQtyKg = parseQtyKg(annualQtyKgRaw);
        const budgetUnitPricePerKg = parsePrice(budgetUnitPricePerKgRaw);
        await onSave(annualQtyKg, budgetUnitPricePerKg);
      }}
    >
      <input
        name="annualQtyKg"
        type="text"
        inputMode="decimal"
        required
        defaultValue={initialQty}
        placeholder="Qty kg"
        aria-label={`Annual qty kg for ${cat.label}`}
        class="sbb-input"
        disabled={!canEdit}
        key={`qty-${cat.productCatId}-${budget?.annualQtyKg ?? ""}`}
      />
      <input
        name="budgetUnitPricePerKg"
        type="text"
        inputMode="decimal"
        required
        defaultValue={initialPrice}
        placeholder="XAF/kg"
        aria-label={`Budget unit price for ${cat.label}`}
        class="sbb-input"
        disabled={!canEdit}
        key={`price-${cat.productCatId}-${budget?.budgetUnitPricePerKg ?? ""}`}
      />
      <input
        type="text"
        readOnly
        tabIndex={-1}
        value={revenueDisplay}
        class="sbb-input sbb-input-readonly"
        aria-label={`Revenue XAF for ${cat.label}`}
      />
      <div class="sbb-budget-actions">
        <button type="submit" disabled={!canEdit} class="sbb-btn sbb-btn-primary">
          Save
        </button>
        {budget ? (
          <button
            type="button"
            class="sbb-btn sbb-btn-ghost"
            disabled={!canEdit}
            onClick={() => void onClear()}
          >
            Clear budget
          </button>
        ) : null}
      </div>
    </form>
  );
}

function CategoryPhasePctEditor(props: {
  disabled: boolean;
  financialYear: number;
  productCatId: number;
  fiscalMonthLabels: FiscalMonthLabel[];
  initialPcts: string[];
  serverPctKey: string;
  onSave: (pcts: string[]) => Promise<void>;
  onAfterSave: () => void;
  onError: (err: unknown) => void;
}) {
  const {
    disabled,
    financialYear,
    productCatId,
    fiscalMonthLabels,
    initialPcts,
    serverPctKey,
    onSave,
    onAfterSave,
    onError,
  } = props;

  const [values, setValues] = useState<string[]>(() =>
    balancePercentStringsTo100(pad12(initialPcts)),
  );

  useEffect(() => {
    setValues(balancePercentStringsTo100(pad12(initialPcts)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPctKey]);

  const total = sumEnteredPercents(values);
  const sumOk = Math.abs(total - 100) <= PCT_SUM_OK_EPS;

  return (
    <form
      class="sbb-phase-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (disabled) return;

        if (!sumOk) {
          onError(new Error(`Percentages must total 100% (currently ${total.toFixed(2)}%).`));
          return;
        }

        try {
          await onSave(balancePercentStringsTo100(values));
          onAfterSave();
        } catch (err) {
          onError(err);
        }
      }}
    >
      <input type="hidden" name="financialYear" value={financialYear} />
      <input type="hidden" name="productCatId" value={productCatId} />

      <div class="sbb-phase-grid">
        {fiscalMonthLabels.map((row, idx) => {
          const name = `pctM${String(row.financialMonth).padStart(2, "0")}`;
          const fieldId = `pct-${productCatId}-${name}`;
          return (
            <div key={row.financialMonth} class="sbb-phase-field">
              <label for={fieldId}>
                FY mo {row.financialMonth} · {row.label}
              </label>
              <div class="sbb-phase-input-wrap">
                <input
                  id={fieldId}
                  name={name}
                  type="text"
                  inputMode="decimal"
                  required
                  value={values[idx] ?? ""}
                  onChange={(ev) => {
                    const target = ev.currentTarget;
                    const next = [...values];
                    next[idx] = target.value;
                    setValues(next);
                  }}
                  class="sbb-input"
                  disabled={disabled}
                />
                <span class="sbb-phase-suffix">%</span>
              </div>
            </div>
          );
        })}
      </div>

      <div
        class={`sbb-pct-total ${sumOk ? "sbb-pct-total-ok" : "sbb-pct-total-warn"}`}
      >
        Total: {total.toFixed(2)}%{" "}
        <span class="sbb-pct-total-note">
          {sumOk ? "(100% — OK to save)" : "(must total 100% to save)"}
        </span>
      </div>

      <button
        type="submit"
        disabled={disabled || !sumOk}
        class="sbb-btn sbb-btn-primary"
      >
        Save phasing
      </button>
    </form>
  );
}

function defaultEqualSplitPercentages(): string[] {
  return balancePercentStringsTo100(
    Array.from({ length: 12 }, () => String(100 / 12)),
  );
}

function profileRowToPercentStrings(row: PhaseProfileRow): string[] {
  const values = [
    row.pctM01,
    row.pctM02,
    row.pctM03,
    row.pctM04,
    row.pctM05,
    row.pctM06,
    row.pctM07,
    row.pctM08,
    row.pctM09,
    row.pctM10,
    row.pctM11,
    row.pctM12,
  ];

  const asNumbers = values.map((v) => parsePercentNumber(v));
  const sum = asNumbers.reduce((acc, n) => acc + n, 0);
  const asPercents = sum <= 1.5 ? asNumbers.map((n) => n * 100) : asNumbers;

  return balancePercentStringsTo100(asPercents.map((n) => String(n)));
}

export function SalesBudgetScreen({ readOnly = false }: SalesBudgetScreenProps) {
  const [periods, setPeriods] = useState<FinancialYearPeriodRow[]>([]);
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState<number>(1);
  const [categories, setCategories] = useState<SalesBudgetCategoryRef[]>([]);
  const [products, setProducts] = useState<SalesBudgetProductRef[]>([]);
  const [selectedFinancialYear, setSelectedFinancialYear] = useState<number | null>(null);
  const [budgetByCatId, setBudgetByCatId] = useState<Map<number, BudgetRow>>(new Map());
  const [pctsByCatId, setPctsByCatId] = useState<Map<number, string[]>>(new Map());
  const [profileIdByCatId, setProfileIdByCatId] = useState<Map<number, string>>(new Map());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [previewCatId, setPreviewCatId] = useState<number | "">("");
  const [previewQtyKg, setPreviewQtyKg] = useState<string>("");
  const [previewPricePerKg, setPreviewPricePerKg] = useState<string>("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<SalesBudgetPhaseResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [signatoryName, setSignatoryName] = useState<string | null>(null);
  const [signatoryTitle, setSignatoryTitle] = useState("Manager, Palm Oil Sales");
  const [phaseModalCatId, setPhaseModalCatId] = useState<number | null>(null);

  const api = useMemo(() => getElectronApi(), []);
  const db = useMemo(() => getAuthenticatedDb(), []);

  const budgetCategories: SalesBudgetCategoryDef[] = useMemo(
    () =>
      salesBudgetCategoriesWithProducts(categories, products).map(toSalesBudgetCategoryDef),
    [categories, products],
  );

  async function refreshForFinancialYear(fy: number): Promise<void> {
    const [budgetRows, profileRows] = await Promise.all([
      api.db.queryTable({ table: "ProductSalesBudget", limit: 5000 }),
      api.db.queryTable({
        table: "ProductSalesBudgetMonthPhaseProfile",
        limit: 5000,
      }),
    ]);

    const budgetsForFy = (budgetRows.rows as Array<Record<string, unknown>>).filter(
      (r) => Number(r.financialYear) === fy,
    );
    const profilesForFy = (profileRows.rows as Array<Record<string, unknown>>).filter(
      (r) => Number(r.financialYear) === fy,
    );

    const nextBudgetMap = new Map<number, BudgetRow>();
    for (const r of budgetsForFy) {
      const productCatId = Number(r.productCatId);
      nextBudgetMap.set(productCatId, {
        id: String(r.id ?? ""),
        financialYear: fy,
        productCatId,
        annualQtyKg: String(r.annualQtyKg ?? ""),
        budgetUnitPricePerKg: String(r.budgetUnitPricePerKg ?? ""),
      });
    }

    const nextPctsMap = new Map<number, string[]>();
    const nextProfileIdMap = new Map<number, string>();
    for (const r of profilesForFy) {
      const productCatId = Number(r.productCatId);
      nextPctsMap.set(
        productCatId,
        profileRowToPercentStrings(r as unknown as PhaseProfileRow),
      );
      if (r.id != null) {
        nextProfileIdMap.set(productCatId, String(r.id));
      }
    }

    setBudgetByCatId(nextBudgetMap);
    setPctsByCatId(nextPctsMap);
    setProfileIdByCatId(nextProfileIdMap);
  }

  useEffect(() => {
    let cancelled = false;
    void getAuthenticatedReports()
      .getSignatory()
      .then((s) => {
        if (cancelled) return;
        setSignatoryName(s.name);
        setSignatoryTitle(s.title);
      })
      .catch(() => {
        /* keep defaults */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAll(): Promise<void> {
      setLoading(true);
      setError(null);
      setMessage(null);
      try {
        const [
          fyRows,
          companySettingsRows,
          categoryRows,
          productRows,
          budgetRows,
          profileRows,
        ] = await Promise.all([
          db.queryTable({ table: "FinancialYearPeriod", limit: 500 }),
          db.queryTable({ table: "CompanySettings", limit: 20 }),
          db.queryTable({ table: "ProductCat", limit: 500 }),
          db.queryTable({ table: "Product", limit: 1000 }),
          db.queryTable({ table: "ProductSalesBudget", limit: 5000 }),
          db.queryTable({
            table: "ProductSalesBudgetMonthPhaseProfile",
            limit: 5000,
          }),
        ]);

        if (cancelled) return;

        const fyList = (fyRows.rows as Array<Record<string, unknown>>).map((r) => ({
          financialYear: Number(r.financialYear),
          startDate: String(r.startDate ?? ""),
          endDate: String(r.endDate ?? ""),
          status: String(r.status ?? ""),
        }));

        fyList.sort((a, b) => b.financialYear - a.financialYear);

        const settingsDefault =
          (companySettingsRows.rows as Array<Record<string, unknown>>).find(
            (r) => String(r.id ?? "") === "default",
          ) ?? (companySettingsRows.rows[0] as Record<string, unknown> | undefined);

        const fiscalStart = Number(settingsDefault?.fiscalYearStartMonth ?? 1) || 1;

        const categoryList: SalesBudgetCategoryRef[] = (
          categoryRows.rows as Array<Record<string, unknown>>
        ).map((r) => ({
          productCatId: Number(r.productCatId),
          productCat: String(r.productCat ?? ""),
          isMain: Number(r.isMain ?? 0) ? 1 : 0,
          isBottled: Number(r.isBottled ?? 0) ? 1 : 0,
        }));

        const productList: SalesBudgetProductRef[] = (
          productRows.rows as Array<Record<string, unknown>>
        )
          .map((r) => ({
            productId: Number(r.productId),
            productName: String(r.productName ?? ""),
            productCode: r.productCode == null ? null : String(r.productCode),
            productCatId: Number(r.productCatId),
          }))
          .sort((a, b) => a.productName.localeCompare(b.productName));

        setPeriods(fyList);
        setFiscalYearStartMonth(fiscalStart);
        setCategories(categoryList);
        setProducts(productList);

        const defaultFy = fyList[0]?.financialYear ?? null;
        setSelectedFinancialYear(defaultFy);

        if (defaultFy != null) {
          const budgetsForFy = (budgetRows.rows as Array<Record<string, unknown>>).filter(
            (r) => Number(r.financialYear) === defaultFy,
          );
          const profilesForFy = (profileRows.rows as Array<Record<string, unknown>>).filter(
            (r) => Number(r.financialYear) === defaultFy,
          );

          const nextBudgetMap = new Map<number, BudgetRow>();
          for (const r of budgetsForFy) {
            const productCatId = Number(r.productCatId);
            nextBudgetMap.set(productCatId, {
              id: String(r.id ?? ""),
              financialYear: defaultFy,
              productCatId,
              annualQtyKg: String(r.annualQtyKg ?? ""),
              budgetUnitPricePerKg: String(r.budgetUnitPricePerKg ?? ""),
            });
          }
          const nextPctsMap = new Map<number, string[]>();
          const nextProfileIdMap = new Map<number, string>();
          for (const r of profilesForFy) {
            const productCatId = Number(r.productCatId);
            nextPctsMap.set(
              productCatId,
              profileRowToPercentStrings(r as unknown as PhaseProfileRow),
            );
            if (r.id != null) {
              nextProfileIdMap.set(productCatId, String(r.id));
            }
          }
          setBudgetByCatId(nextBudgetMap);
          setPctsByCatId(nextPctsMap);
          setProfileIdByCatId(nextProfileIdMap);

          const firstCat = salesBudgetCategoriesWithProducts(categoryList, productList)[0];
          if (firstCat) {
            setPreviewCatId(firstCat.productCatId);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, [api, db]);

  useEffect(() => {
    if (!selectedFinancialYear) return;
    if (previewCatId === "") return;

    const budget = budgetByCatId.get(previewCatId);
    if (budget) {
      setPreviewQtyKg(formatAnnualFigure(budget.annualQtyKg));
      setPreviewPricePerKg(formatUnitPriceFigure(budget.budgetUnitPricePerKg));
    } else {
      setPreviewQtyKg("");
      setPreviewPricePerKg("");
    }
  }, [budgetByCatId, previewCatId, selectedFinancialYear]);

  const fiscalMonthLabels: FiscalMonthLabel[] = useMemo(() => {
    const fy = selectedFinancialYear ?? 0;
    return Array.from({ length: 12 }, (_, i) => {
      const fm = i + 1;
      return {
        financialMonth: fm,
        label: fiscalMonthCalendarLabel(fy, fm, fiscalYearStartMonth),
      };
    });
  }, [fiscalYearStartMonth, selectedFinancialYear]);

  const phaseModalCat =
    phaseModalCatId != null
      ? (budgetCategories.find((c) => c.productCatId === phaseModalCatId) ?? null)
      : null;

  async function savePhaseProfile(
    cat: SalesBudgetCategoryDef,
    nextPcts: string[],
  ): Promise<void> {
    if (readOnly || selectedFinancialYear == null) {
      return;
    }
    const fy = selectedFinancialYear;
    const balancedPcts = balancePercentStringsTo100(nextPcts);
    const total = sumEnteredPercents(balancedPcts);
    if (Math.abs(total - 100) > PCT_SUM_OK_EPS) {
      throw new Error(`Percentages must total 100% (currently ${total.toFixed(2)}%).`);
    }

    const hasExisting = pctsByCatId.has(cat.productCatId);
    const existingProfileId = profileIdByCatId.get(cat.productCatId);
    const valuesToSave: Record<string, string | number> = {
      financialYear: fy,
      productCatId: cat.productCatId,
    };

    for (let i = 0; i < 12; i += 1) {
      const key = `pctM${String(i + 1).padStart(2, "0")}`;
      valuesToSave[key] = balancedPcts[i] ?? "0";
    }

    if (hasExisting) {
      if (!existingProfileId) {
        throw new Error("Phase profile id is missing; refresh and try again.");
      }
      const updateValues = { ...valuesToSave } as Record<string, unknown>;
      delete updateValues.financialYear;
      delete updateValues.productCatId;
      await db.updateRow({
        table: "ProductSalesBudgetMonthPhaseProfile",
        primaryKey: { id: existingProfileId },
        values: updateValues as Record<string, unknown>,
      });
    } else {
      await db.insertRow({
        table: "ProductSalesBudgetMonthPhaseProfile",
        values: valuesToSave as Record<string, unknown>,
      });
    }
    await refreshForFinancialYear(fy);
  }

  if (loading) {
    return (
      <div class="sbb-page">
        <p class="sbb-empty">Loading sales budget…</p>
      </div>
    );
  }

  if (!periods.length) {
    return (
      <div class="sbb-page">
        <p class="sbb-empty">
          No financial years exist yet. Add one under Financial years before entering
          budgets.
        </p>
        <ReportFooter name={signatoryName} label={signatoryTitle} />
      </div>
    );
  }

  if (error && products.length === 0 && budgetByCatId.size === 0) {
    return (
      <div class="sbb-page">
        <div class="sbb-alert sbb-alert-error">{error}</div>
        <ReportFooter name={signatoryName} label={signatoryTitle} />
      </div>
    );
  }

  const fy = selectedFinancialYear;
  const fyPeriod = fy == null ? null : periods.find((p) => p.financialYear === fy) ?? null;

  function renderPreviewMonth(m: SalesBudgetPhaseMonth) {
    const monthTotalKg = m.weeks.reduce((acc, w) => acc + w.qtyKg, 0);
    const monthTotalFcfa = m.weeks.reduce((acc, w) => acc + w.amountFcfa, 0);
    return (
      <details
        key={`${m.calendarYear}-${m.calendarMonth}`}
        class="sbb-details sbb-preview-month"
      >
        <summary>
          {m.calendarYear}-{String(m.calendarMonth).padStart(2, "0")} ·{" "}
          {formatPhasedQtyKgDisplay(monthTotalKg)} kg ·{" "}
          {formatPhasedAmountDisplay(monthTotalFcfa)} XAF
        </summary>
        <div class="sbb-details-body">
          <ul class="sbb-week-list">
            {m.weeks.map((w) => (
              <li key={w.label}>
                {w.label}: {formatPhasedQtyKgDisplay(w.qtyKg)} kg ·{" "}
                {formatPhasedAmountDisplay(w.amountFcfa)} XAF
              </li>
            ))}
          </ul>
        </div>
      </details>
    );
  }

  return (
    <div class="sbb-page">
      <header class="sbb-header">
        <h1 class="sbb-title">Sales budget phasing</h1>
        <p class="sbb-lead">
          Set annual quantity (kg) and unit price per kg for each product category.
          Each category has its own monthly phasing percentages for the financial year;
          quantities are phased into fiscal months, then spread across ISO weeks.
        </p>
        {readOnly ? <span class="sbb-readonly-badge">Read only</span> : null}
      </header>

      {message ? <div class="sbb-alert sbb-alert-success">{message}</div> : null}
      {error ? <div class="sbb-alert sbb-alert-error">{error}</div> : null}

      {fy != null && budgetCategories.length === 0 ? (
        <p class="sbb-empty">
          No product categories with products. Add products before entering budgets.
        </p>
      ) : null}

      {fy != null && budgetCategories.length > 0 ? (
        <section class="sbb-card">
          <div class="sbb-section-header">
            <div>
              <h2 class="sbb-section-title">Annual budgets by product category</h2>
              <p class="sbb-section-hint">
                Enter annual quantity and unit price for FY {fy}. One budget row per category;
                actuals in reports sum all products in that category. Use{" "}
                <strong>Edit phasing</strong> to set fiscal-month percentages in a dialog (must
                total 100%).
              </p>
            </div>
            {fyPeriod ? (
              <button
                type="button"
                class="sbb-btn sbb-btn-primary"
                onClick={() => setPreviewOpen(true)}
              >
                Phasing preview
              </button>
            ) : null}
          </div>
          <div class="sbb-table-wrap">
            <table class="sbb-table">
              <thead>
                <tr>
                  <th>Budget group</th>
                  <th>Annual qty · unit price · revenue (XAF)</th>
                  <th>Phasing ({fy})</th>
                </tr>
              </thead>
              <tbody>
                {budgetCategories.map((cat) => {
                  const budget = budgetByCatId.get(cat.productCatId);
                  const canEdit = !readOnly;
                  const hasSavedPhasing = pctsByCatId.has(cat.productCatId);
                  return (
                    <tr key={cat.productCatId}>
                      <td>
                        <div class="sbb-product-name">{cat.label}</div>
                      </td>
                      <td>
                        <BudgetRowForm
                          cat={cat}
                          budget={budget}
                          canEdit={canEdit}
                          onSave={async (annualQtyKg, budgetUnitPricePerKg) => {
                            setError(null);
                            setMessage(null);
                            try {
                              if (budgetByCatId.has(cat.productCatId)) {
                                const existing = budgetByCatId.get(cat.productCatId);
                                if (!existing?.id) {
                                  throw new Error(
                                    "Budget row id is missing; refresh and try again.",
                                  );
                                }
                                await db.updateRow({
                                  table: "ProductSalesBudget",
                                  primaryKey: { id: existing.id },
                                  values: {
                                    annualQtyKg: String(Math.round(annualQtyKg)),
                                    budgetUnitPricePerKg:
                                      budgetUnitPricePerKg.toString(),
                                  },
                                });
                              } else {
                                await db.insertRow({
                                  table: "ProductSalesBudget",
                                  values: {
                                    financialYear: fy!,
                                    productCatId: cat.productCatId,
                                    annualQtyKg: String(Math.round(annualQtyKg)),
                                    budgetUnitPricePerKg:
                                      budgetUnitPricePerKg.toString(),
                                  },
                                });
                              }
                              await refreshForFinancialYear(fy!);
                              setMessage(`Budget saved for ${cat.label}.`);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            }
                          }}
                          onClear={async () => {
                            if (readOnly || !budget) {
                              return;
                            }
                            const confirmed = await openConfirm({
                              ariaLabel: "Confirm clear budget",
                              title: "Clear budget?",
                              description: `Clear budget for “${cat.label}”? This cannot be undone.`,
                              confirmLabel: "Clear",
                              confirmVariant: "danger",
                            });
                            if (!confirmed) {
                              return;
                            }
                            setError(null);
                            setMessage(null);
                            try {
                              if (!budget.id) {
                                throw new Error(
                                  "Budget row id is missing; refresh and try again.",
                                );
                              }
                              await db.deleteRow({
                                table: "ProductSalesBudget",
                                primaryKey: { id: budget.id },
                              });
                              await refreshForFinancialYear(fy!);
                              setMessage(`Cleared budget for ${cat.label}.`);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            }
                          }}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          class="sbb-btn"
                          disabled={!canEdit}
                          onClick={() => setPhaseModalCatId(cat.productCatId)}
                        >
                          Edit phasing
                          {hasSavedPhasing ? " · saved" : ""}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {phaseModalCat && fy != null ? (
        <FormDialog
          wide
          ariaLabel={`Monthly phasing for ${phaseModalCat.label}`}
          title={`Monthly phasing — ${phaseModalCat.label}`}
          subtitle={`Twelve percentages must sum to 100%. Weights drive fiscal-month phasing for this category in ${fy}.`}
          onClose={() => setPhaseModalCatId(null)}
        >
          <CategoryPhasePctEditor
            disabled={readOnly}
            financialYear={fy}
            productCatId={phaseModalCat.productCatId}
            fiscalMonthLabels={fiscalMonthLabels}
            serverPctKey={`${phaseModalCat.productCatId}|${(pctsByCatId.get(phaseModalCat.productCatId) ?? defaultEqualSplitPercentages()).join("|")}`}
            initialPcts={
              pctsByCatId.get(phaseModalCat.productCatId) ??
              defaultEqualSplitPercentages()
            }
            onSave={async (nextPcts) => {
              await savePhaseProfile(phaseModalCat, nextPcts);
            }}
            onAfterSave={() => {
              setMessage(`Phasing saved for ${phaseModalCat.label} (${fy}).`);
              setPhaseModalCatId(null);
            }}
            onError={(err) => {
              setError(err instanceof Error ? err.message : String(err));
            }}
          />
        </FormDialog>
      ) : null}

      {previewOpen && fyPeriod && budgetCategories.length > 0 ? (
        <FormDialog
          wide
          panelClassName="sbb-preview-dialog"
          ariaLabel="Phasing preview"
          title="Phasing preview"
          subtitle="Uses the saved monthly profile for the selected category. Preview does not save budget rows."
          onClose={() => {
            setPreviewOpen(false);
            setPreview(null);
          }}
        >
          <div class="sbb-preview-form">
            <div class="sbb-field">
              <label class="sbb-label" for="previewCat">
                Budget group
              </label>
              <select
                id="previewCat"
                class="sbb-select"
                value={previewCatId}
                onChange={(e) => {
                  const v = Number.parseInt(e.currentTarget.value, 10);
                  setPreviewCatId(Number.isFinite(v) ? v : "");
                }}
                disabled={readOnly}
              >
                {budgetCategories.map((c) => (
                  <option key={c.productCatId} value={c.productCatId}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div class="sbb-field">
              <label class="sbb-label" for="previewQty">
                Annual qty (kg)
              </label>
              <input
                id="previewQty"
                type="text"
                inputMode="decimal"
                value={previewQtyKg}
                onChange={(e) => setPreviewQtyKg(e.currentTarget.value)}
                class="sbb-input"
                disabled={readOnly}
              />
            </div>
            <div class="sbb-field">
              <label class="sbb-label" for="previewPrice">
                Unit price (XAF/kg)
              </label>
              <input
                id="previewPrice"
                type="text"
                inputMode="decimal"
                value={previewPricePerKg}
                onChange={(e) => setPreviewPricePerKg(e.currentTarget.value)}
                class="sbb-input"
                disabled={readOnly}
              />
            </div>
            <button
              type="button"
              disabled={previewBusy || readOnly || previewCatId === ""}
              class="sbb-btn sbb-btn-primary"
              onClick={async () => {
                if (!fyPeriod) return;
                if (previewCatId === "") return;
                setPreviewBusy(true);
                setPreview(null);
                setError(null);
                setMessage(null);
                try {
                  const annualQtyKg = previewQtyKg ? parseQtyKg(previewQtyKg) : 0;
                  const price = previewPricePerKg ? parsePrice(previewPricePerKg) : 0;
                  const pcts =
                    pctsByCatId.get(previewCatId) ?? defaultEqualSplitPercentages();
                  const fiscalMonthPercents = normalizeFiscalMonthPercents(
                    pcts.map((v) => parsePercentNumber(v)),
                  ).map((f) => f * 100);

                  const result = buildSalesBudgetPhase({
                    financialYear: fyPeriod.financialYear,
                    fiscalYearStartMonth,
                    fyStartIso: fyPeriod.startDate.slice(0, 10),
                    fyEndIso: fyPeriod.endDate.slice(0, 10),
                    annualQtyKg,
                    budgetUnitPricePerKg: price,
                    fiscalMonthPercents,
                  });
                  setPreview(result);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setPreviewBusy(false);
                }
              }}
            >
              {previewBusy ? "Running…" : "Run preview"}
            </button>
          </div>

          {preview ? (
            <div class="sbb-preview-columns">
              <div class="sbb-preview-list">
                {preview.months.slice(0, 6).map((m) => renderPreviewMonth(m))}
              </div>
              <div class="sbb-preview-list">
                {preview.months.slice(6, 12).map((m) => renderPreviewMonth(m))}
              </div>
            </div>
          ) : null}
        </FormDialog>
      ) : null}

   </div>
  );
}
