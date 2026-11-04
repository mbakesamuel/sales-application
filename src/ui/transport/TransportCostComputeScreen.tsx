import { useEffect, useState } from "preact/hooks";
import type { RolePermissionsSnapshot } from "../../shared/permissions.types.ts";
import { canWriteRouteFromSnapshot } from "../../shared/permissionUtils.ts";
import type {
  TransportCostComputeInput,
  TransportCostComputeResult,
  TransportCostFormOptions,
} from "../../shared/transportCost.types.ts";
import { isLooseLpoProduct } from "../../shared/looseLpoProduct.ts";
import { getAuthToken } from "../auth/db.ts";
import { getElectronApi } from "../auth/client.ts";
import { getAuthenticatedReports } from "../auth/reports.ts";
import type { TransportCostReport } from "../../shared/reports.types.ts";
import { FormDialog } from "../components/FormDialog.tsx";
import { ReportOverlayShell } from "../reports/ReportOverlayShell.tsx";
import { TransportCostReportDocument } from "../reports/TransportCostReportScreen.tsx";
import "../components/FormDialog.css";
import "../customers/CustomersScreen.css";
import "./TransportCostComputeScreen.css";

interface TransportCostComputeScreenProps {
  permissions: RolePermissionsSnapshot;
  readOnly?: boolean;
}

function formatKg(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatMoney(value: number | null): string {
  if (value == null) return "—";
  return Math.round(value).toLocaleString("en-US");
}

function IconTruck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

function IconPrinter() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </svg>
  );
}

function IconCalculator() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <line x1="8" y1="6" x2="16" y2="6" />
      <line x1="16" y1="14" x2="16" y2="18" />
      <path d="M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01" />
    </svg>
  );
}

function IconPackage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function IconCoins() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </svg>
  );
}

function IconFileText() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function TransportCostComputeScreen({
  permissions,
  readOnly = false,
}: TransportCostComputeScreenProps) {
  const canCompute =
    canWriteRouteFromSnapshot(permissions, "transport-cost-compute") && !readOnly;

  const [options, setOptions] = useState<TransportCostFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [result, setResult] = useState<TransportCostComputeResult | null>(null);
  const [printOpen, setPrintOpen] = useState(false);
  const [printReport, setPrintReport] = useState<TransportCostReport | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  const [computeOpen, setComputeOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [salesPointId, setSalesPointId] = useState("");
  const [productId, setProductId] = useState("");

  function openComputeModal() {
    setActionError(null);
    setComputeOpen(true);
  }

  function closeComputeModal() {
    if (computing) {
      return;
    }
    setComputeOpen(false);
    setActionError(null);
  }

  useEffect(() => {
    if (!printOpen) {
      return;
    }

    let cancelled = false;
    setPrintLoading(true);
    setPrintError(null);
    setPrintReport(null);

    void getAuthenticatedReports()
      .getTransportCost()
      .then((data) => {
        if (!cancelled) {
          setPrintReport(data);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setPrintError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load transportation cost report.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPrintLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [printOpen]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const formOptions = await getElectronApi().transportCost.getFormOptions();
        if (!cancelled) {
          setOptions(formOptions);
        }
      } catch (loadError) {
        if (!cancelled) {
          setOptions(null);
          setError(
            loadError instanceof Error ? loadError.message : "Failed to load form options.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runCompute(
    input: TransportCostComputeInput,
    options?: { closeModal?: boolean },
  ): Promise<boolean> {
    setActionError(null);

    const token = getAuthToken();
    if (!token) {
      setActionError("Login required.");
      return false;
    }

    setComputing(true);
    try {
      const computeResult = await getElectronApi().transportCost.compute(token, input);
      setResult(computeResult);
      if (options?.closeModal) {
        setComputeOpen(false);
      }
      return true;
    } catch (computeError) {
      setResult(null);
      setActionError(
        computeError instanceof Error ? computeError.message : "Failed to compute transport cost.",
      );
      return false;
    } finally {
      setComputing(false);
    }
  }

  async function handleCompute() {
    const parsedCustomerId = Number.parseInt(customerId, 10);
    const parsedSalesPointId = Number.parseInt(salesPointId, 10);
    const parsedProductId = Number.parseInt(productId, 10);

    if (!customerId || Number.isNaN(parsedCustomerId)) {
      setActionError("Select a customer.");
      return;
    }
    if (!salesPointId || Number.isNaN(parsedSalesPointId)) {
      setActionError("Select a collection point.");
      return;
    }
    if (!productId || Number.isNaN(parsedProductId)) {
      setActionError("Select a product.");
      return;
    }

    await runCompute(
      {
        customerId: parsedCustomerId,
        salesPointId: parsedSalesPointId,
        productId: parsedProductId,
      },
      { closeModal: true },
    );
  }

  useEffect(() => {
    if (!options?.openPeriod || !options.transportCostMoliweOnlyPolicy) {
      return;
    }

    let cancelled = false;

    async function autoCompute() {
      const customer = options!.customers[0];
      const salesPoint = options!.salesPoints[0];
      const product = options!.products.find((entry) => isLooseLpoProduct(entry));

      if (!customer || !salesPoint || !product) {
        if (!cancelled) {
          setResult(null);
          const missing: string[] = [];
          if (!customer) missing.push("customer SCR MAYA");
          if (!salesPoint) missing.push("collection point Moliwe");
          if (!product) missing.push("product Loose Palm Oil (LPO)");
          setActionError(
            `Cannot auto-compute transportation cost: missing ${missing.join(", ")}.`,
          );
        }
        return;
      }

      if (!cancelled) {
        setCustomerId(String(customer.id));
        setSalesPointId(String(salesPoint.id));
        setProductId(String(product.productId));
      }

      const token = getAuthToken();
      if (!token) {
        if (!cancelled) {
          setActionError("Login required.");
        }
        return;
      }

      if (!cancelled) {
        setComputing(true);
        setActionError(null);
      }

      try {
        const computeResult = await getElectronApi().transportCost.compute(token, {
          customerId: customer.id,
          salesPointId: salesPoint.id,
          productId: product.productId,
        });
        if (!cancelled) {
          setResult(computeResult);
        }
      } catch (computeError) {
        if (!cancelled) {
          setResult(null);
          setActionError(
            computeError instanceof Error
              ? computeError.message
              : "Failed to compute transport cost.",
          );
        }
      } finally {
        if (!cancelled) {
          setComputing(false);
        }
      }
    }

    void autoCompute();
    return () => {
      cancelled = true;
    };
  }, [options]);

  if (loading) {
    return <p class="customers-status">Loading…</p>;
  }

  if (error) {
    return <p class="customers-status customers-status-error">{error}</p>;
  }

  if (!options?.openPeriod) {
    return (
      <p class="customers-status customers-status-error">
        Open a financial month before computing transportation cost.
      </p>
    );
  }

  return (
    <>
      <div class="customers-screen tcc-screen">
        <header class="customers-screen-header">
          <div class="customers-screen-brand">
            <div class="customers-screen-brand-icon">
              <IconTruck />
            </div>
            <div>
              <h2 class="customers-screen-brand-title">Transportation Cost</h2>
            </div>
          </div>

          <div class="customers-screen-header-actions">
            {!options.transportCostMoliweOnlyPolicy ? (
              <button
                type="button"
                class="customers-btn customers-btn-primary"
                disabled={!canCompute || options.salesPoints.length === 0 || computing}
                onClick={openComputeModal}
              >
                <IconCalculator /> Process cost
              </button>
            ) : null}
          </div>
        </header>

        {actionError && !computeOpen ? (
          <p class="customers-banner customers-banner-error">{actionError}</p>
        ) : null}

        {result?.warnings.length ? (
          <div class="customers-banner customers-banner-warning">
            {result.warnings.map((warning) => (
              <p key={warning} style="margin: 2px 0;">{warning}</p>
            ))}
          </div>
        ) : null}

        <div class="customers-stats">
          <div class="customers-stat-card">
            <div class="customers-stat-icon customers-stat-icon-blue">
              <IconPackage />
            </div>
            <div>
              <p class="customers-stat-value">
                {formatKg(result?.totalQtyKg ?? 0)} kg
              </p>
              <p class="customers-stat-label">Total Lifted Volume</p>
            </div>
          </div>

          <div class="customers-stat-card">
            <div class="customers-stat-icon customers-stat-icon-emerald">
              <IconCoins />
            </div>
            <div>
              <p class="customers-stat-value">
                {formatMoney(result?.totalCost ?? 0)} XAF
              </p>
              <p class="customers-stat-label">Total Transport Cost</p>
            </div>
          </div>

          <div class="customers-stat-card">
            <div class="customers-stat-icon customers-stat-icon-violet">
              <IconFileText />
            </div>
            <div>
              <p class="customers-stat-value">{result?.lines.length ?? 0}</p>
              <p class="customers-stat-label">Validated Lift Invoices</p>
            </div>
          </div>

          <div class="customers-stat-card">
            <div class="customers-stat-icon customers-stat-icon-amber">
              <IconCheck />
            </div>
            <div>
              <p class="customers-stat-value">
                {!result
                  ? "—"
                  : result.warnings.length === 0
                    ? "Complete"
                    : "Missing Rates"}
              </p>
              <p class="customers-stat-label">Rate Schedule</p>
            </div>
          </div>
        </div>

        <div class="customers-card tcc-results-card">
          <div class="customers-card-toolbar">
            <div class="customers-card-toolbar-row">
              <div>
                <h3 class="customers-card-title">
                  {result
                    ? `${result.customerName} · ${result.salesPointName} · ${result.productName}`
                    : "Lift transactions"}
                </h3>
                <p class="customers-card-subtitle">
                  {result
                    ? `${result.lines.length} lift transaction${result.lines.length === 1 ? "" : "s"} found`
                    : computing
                      ? "Computing transportation cost…"
                      : options.transportCostMoliweOnlyPolicy
                        ? "Waiting for Moliwe · SCR MAYA · Loose Palm Oil computation."
                        : "Use Process cost to load validated lifts for the open month."}
                </p>
              </div>
              {result ? (
                <div class="customers-card-controls">
                  <button
                    type="button"
                    class="customers-btn customers-btn-secondary"
                    onClick={() => setPrintOpen(true)}
                  >
                    <IconPrinter /> Print Report
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div class="customers-table-scroll">
            <table class="customers-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice No</th>
                  <th>DO No</th>
                  <th class="tcc-num">Qty (kg)</th>
                  <th class="tcc-num">Rate / kg (XAF)</th>
                  <th class="tcc-num">Cost (XAF)</th>
                </tr>
              </thead>
              <tbody>
                {!result ? (
                  <tr>
                    <td colSpan={6} class="customers-table-empty">
                      {computing
                        ? "Computing…"
                        : options.transportCostMoliweOnlyPolicy
                          ? "No computation yet."
                          : "No computation yet. Use Process cost to calculate allowance."}
                    </td>
                  </tr>
                ) : result.lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} class="customers-table-empty">
                      No validated lifts found for this selection in the open month.
                    </td>
                  </tr>
                ) : (
                  result.lines.map((line, index) => (
                    <tr key={`${line.dateIssued}-${line.invoiceNo ?? index}`}>
                      <td>{line.dateIssued}</td>
                      <td>
                        {line.invoiceNo ? (
                          <span class="customers-mono-chip">{line.invoiceNo}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {line.deliveryOrderNo ? (
                          <span class="customers-mono-chip">{line.deliveryOrderNo}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td class="tcc-num">
                        <strong>{formatKg(line.qtyKg)}</strong>
                      </td>
                      <td class="tcc-num">
                        {line.rateMissing ? "—" : formatMoney(line.ratePerKg)}
                      </td>
                      <td class="tcc-num">
                        {line.rateMissing ? (
                          <span class="customers-badge customers-badge-amber">
                            Missing Rate
                          </span>
                        ) : (
                          <strong>{formatMoney(line.lineCost)}</strong>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {computeOpen && !options.transportCostMoliweOnlyPolicy ? (
        <FormDialog
          ariaLabel="Compute Transportation Cost"
          title="Compute Transportation Cost"
          subtitle="Select customer, collection point, and product to calculate transportation allowance"
          onClose={closeComputeModal}
        >
          <div class="tcc-modal-fields">
            <label class="tcc-field">
              <span class="tcc-field-label">Customer *</span>
              <select
                class="tcc-select"
                value={customerId}
                disabled={computing}
                onInput={(event) =>
                  setCustomerId((event.currentTarget as HTMLSelectElement).value)
                }
              >
                <option value="">Select customer…</option>
                {options.customers.map((customer) => (
                  <option key={customer.id} value={String(customer.id)}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>

            <label class="tcc-field">
              <span class="tcc-field-label">Collection Point *</span>
              <select
                class="tcc-select"
                value={salesPointId}
                disabled={computing}
                onInput={(event) =>
                  setSalesPointId((event.currentTarget as HTMLSelectElement).value)
                }
              >
                <option value="">Select collection point…</option>
                {options.salesPoints.map((point) => (
                  <option key={point.id} value={String(point.id)}>
                    {point.name}
                  </option>
                ))}
              </select>
            </label>

            <label class="tcc-field">
              <span class="tcc-field-label">Product *</span>
              <select
                class="tcc-select"
                value={productId}
                disabled={computing}
                onInput={(event) =>
                  setProductId((event.currentTarget as HTMLSelectElement).value)
                }
              >
                <option value="">Select product…</option>
                {options.products.map((product) => (
                  <option key={product.productId} value={String(product.productId)}>
                    {product.productName}
                    {product.productCode ? ` (${product.productCode})` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {actionError ? <p class="form-dialog-error">{actionError}</p> : null}

          <div class="form-dialog-actions">
            <button
              type="button"
              class="form-dialog-btn-secondary"
              disabled={computing}
              onClick={closeComputeModal}
            >
              Cancel
            </button>
            <button
              type="button"
              class="form-dialog-btn-primary"
              disabled={!canCompute || computing || options.salesPoints.length === 0}
              onClick={() => void handleCompute()}
            >
              {computing ? "Computing…" : "Compute Cost"}
            </button>
          </div>
        </FormDialog>
      ) : null}

      {printOpen ? (
        <ReportOverlayShell
          preview
          title="Transportation cost"
          onClose={() => setPrintOpen(false)}
        >
          {printLoading ? (
            <p class="scr-status">Loading report…</p>
          ) : printError ? (
            <p class="scr-status scr-status-error">{printError}</p>
          ) : printReport ? (
            <TransportCostReportDocument report={printReport} />
          ) : (
            <p class="scr-status">No report data available.</p>
          )}
        </ReportOverlayShell>
      ) : null}
    </>
  );
}
