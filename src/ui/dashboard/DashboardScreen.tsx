import { useEffect, useRef, useState } from "preact/hooks";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
  PieController,
  ArcElement,
  BarController,
  BarElement,
} from "chart.js";
import { getAuthenticatedDashboard } from "../auth/dashboard.ts";
import { formatDisplayDate } from "../../shared/formatDisplayDate.ts";
import type {
  BottleOilDashboardSummary,
  CommercialDashboardSummary,
  DashboardStockOnHandRow,
  DashboardSummary,
  SupervisorDashboardSummary,
} from "../../shared/dashboard.types.ts";
import "./DashboardScreen.css";

interface DashboardScreenProps {
  onNavigate?: (routeId: string) => void;
}

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  Tooltip,
  Legend,
  PieController,
  ArcElement,
  BarController,
  BarElement,
);

const CHART_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#ca8a04",
  "#4b5563",
];

function formatMoney(value: number): string {
  return Math.round(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function formatQty(value: number): string {
  return Number(value.toFixed(3)).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function readCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function destroyCharts(charts: {
  line?: Chart;
  pie?: Chart;
  bar?: Chart;
}) {
  charts.line?.destroy();
  charts.pie?.destroy();
  charts.bar?.destroy();
}

export function DashboardScreen({ onNavigate }: DashboardScreenProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const lineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pieCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const barCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartsRef = useRef<{
    line?: Chart;
    pie?: Chart;
    bar?: Chart;
  }>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setError("Dashboard is taking too long to load.");
        setLoading(false);
      }
    }, 15000);

    getAuthenticatedDashboard()
      .getSummary()
      .then((data) => {
        if (!cancelled) {
          setSummary(data);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard.");
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [reloadKey]);

  useEffect(() => {
    const textColor = readCssVar("--text-h", "#111827");
    const mutedColor = readCssVar("--text-muted", "#6b7280");
    const gridColor = readCssVar("--border", "#e5e7eb");
    const accent = readCssVar("--accent", "#2563eb");

    destroyCharts(chartsRef.current);
    chartsRef.current = {};

    if (!summary?.hasOpenPeriod) {
      return () => destroyCharts(chartsRef.current);
    }

    let cancelled = false;
    let rafId = 0;
    let attempts = 0;

    const paintCharts = () => {
      if (cancelled) {
        return;
      }

      destroyCharts(chartsRef.current);
      chartsRef.current = {};

      // Wait until canvases exist and their host boxes have real layout height.
      const lineHost = lineCanvasRef.current?.parentElement;
      const pieHost = pieCanvasRef.current?.parentElement;
      const hostsReady =
        Boolean(lineCanvasRef.current) &&
        Boolean(pieCanvasRef.current) &&
        (lineHost?.clientHeight ?? 0) > 40 &&
        (pieHost?.clientHeight ?? 0) > 40;

      if (!hostsReady) {
        attempts += 1;
        if (attempts < 20) {
          rafId = window.requestAnimationFrame(paintCharts);
        }
        return;
      }

      if (lineCanvasRef.current) {
        const labels =
          summary.revenueByDay.length > 0
            ? summary.revenueByDay.map((row) => formatDisplayDate(row.dateIso))
            : ["No sales"];
        const values =
          summary.revenueByDay.length > 0
            ? summary.revenueByDay.map((row) => row.amount)
            : [0];
        const isSupervisor = summary.variant === "supervisor";

        chartsRef.current.line = new Chart(lineCanvasRef.current, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "Revenue (XAF)",
                data: values,
                borderColor: accent,
                backgroundColor: "rgba(37, 99, 235, 0.12)",
                fill: true,
                tension: 0.25,
                pointRadius: 3,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: isSupervisor
              ? { padding: { top: 6, right: 8, bottom: 2, left: 2 } }
              : undefined,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => ` ${formatMoney(Number(ctx.raw ?? 0))} XAF`,
                },
              },
            },
            scales: {
              x: {
                ticks: {
                  color: mutedColor,
                  maxRotation: 0,
                  autoSkip: true,
                  maxTicksLimit: isSupervisor ? 8 : undefined,
                },
                grid: { color: gridColor },
              },
              y: {
                beginAtZero: true,
                ticks: {
                  color: mutedColor,
                  callback: (value) => formatMoney(Number(value)),
                },
                grid: { color: gridColor },
              },
            },
          },
        });
      }

      if (pieCanvasRef.current) {
        const pieRows =
          summary.variant === "bottleOil" || summary.variant === "supervisor"
            ? summary.revenueByProduct
            : summary.revenueByCategory;
        const isSupervisor = summary.variant === "supervisor";
        const isBottle = summary.variant === "bottleOil";

        chartsRef.current.pie = new Chart(pieCanvasRef.current, {
          type: "pie",
          data: {
            labels: pieRows.length > 0 ? pieRows.map((c) => c.label) : ["No sales"],
            datasets: [
              {
                data: pieRows.length > 0 ? pieRows.map((c) => c.amount) : [1],
                backgroundColor:
                  pieRows.length > 0
                    ? pieRows.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]!)
                    : ["#d1d5db"],
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: isSupervisor
              ? { padding: { top: 4, right: 4, bottom: 4, left: 4 } }
              : undefined,
            plugins: {
              legend: {
                // Side-by-side panels are narrow; bottom legend uses the height.
                position:
                  isSupervisor || isBottle || window.innerWidth < 900
                    ? "bottom"
                    : "right",
                labels: {
                  color: textColor,
                  boxWidth: 10,
                  font: { size: 11 },
                  padding: 8,
                },
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    if (pieRows.length === 0) {
                      return " No data";
                    }
                    return ` ${formatMoney(Number(ctx.raw ?? 0))} XAF`;
                  },
                },
              },
            },
          },
        });
      }

      if (barCanvasRef.current && summary.variant !== "supervisor") {
        if (summary.variant === "bottleOil") {
          const months = summary.salesQtyByMonth;
          chartsRef.current.bar = new Chart(barCanvasRef.current, {
            type: "bar",
            data: {
              labels: months.map((m) => m.label),
              datasets: [
                {
                  label: "Bottle Oil sales (units)",
                  data: months.map((m) => m.qtyUnits),
                  backgroundColor: accent,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: "top",
                  labels: { color: textColor, boxWidth: 12 },
                },
                tooltip: {
                  callbacks: {
                    label: (ctx) =>
                      ` ${formatQty(Number(ctx.raw ?? 0))} units`,
                  },
                },
              },
              scales: {
                x: {
                  ticks: { color: mutedColor },
                  grid: { display: false },
                },
                y: {
                  ticks: {
                    color: mutedColor,
                    callback: (value) => Number(value).toLocaleString(),
                  },
                  grid: { color: gridColor },
                },
              },
            },
          });
        } else {
          const months = summary.doVsSalesByMonth;
          chartsRef.current.bar = new Chart(barCanvasRef.current, {
            type: "bar",
            data: {
              labels: months.map((m) => m.label),
              datasets: [
                {
                  label: "Delivery orders (kg)",
                  data: months.map((m) => m.doQtyKg),
                  backgroundColor: "#059669",
                },
                {
                  label: "Sales (kg)",
                  data: months.map((m) => m.salesQtyKg),
                  backgroundColor: accent,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: "top",
                  labels: { color: textColor, boxWidth: 12 },
                },
                tooltip: {
                  callbacks: {
                    label: (ctx) =>
                      ` ${ctx.dataset.label}: ${Math.round(Number(ctx.raw ?? 0)).toLocaleString()} kg`,
                  },
                },
              },
              scales: {
                x: {
                  ticks: { color: mutedColor },
                  grid: { display: false },
                },
                y: {
                  ticks: {
                    color: mutedColor,
                    callback: (value) => Number(value).toLocaleString(),
                  },
                  grid: { color: gridColor },
                },
              },
            },
          });
        }
      }

      chartsRef.current.line?.resize();
      chartsRef.current.pie?.resize();
      chartsRef.current.bar?.resize();

      // Second frame: layout may still be settling after Chart.js inserts wrappers.
      rafId = window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        chartsRef.current.line?.resize();
        chartsRef.current.pie?.resize();
        chartsRef.current.bar?.resize();
      });
    };

    paintCharts();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      destroyCharts(chartsRef.current);
    };
  }, [summary]);

  useEffect(() => {
    const root = document.querySelector(".dash-root");
    if (!root || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      chartsRef.current.line?.resize();
      chartsRef.current.pie?.resize();
      chartsRef.current.bar?.resize();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [summary?.hasOpenPeriod, summary?.variant]);

  if (loading && !summary) {
    return <p class="dash-status">Loading dashboard…</p>;
  }

  if (error && !summary) {
    return <p class="dash-status dash-status-error">{error}</p>;
  }

  if (!summary) {
    return <p class="dash-status">No dashboard data.</p>;
  }

  if (!summary.hasOpenPeriod || !summary.openMonth) {
    if (summary.variant === "supervisor") {
      return (
        <SupervisorDashboardView
          summary={summary}
          loading={loading}
          error={error}
          onRefresh={() => setReloadKey((value) => value + 1)}
          onNavigate={onNavigate}
          lineCanvasRef={lineCanvasRef}
          pieCanvasRef={pieCanvasRef}
        />
      );
    }

    if (summary.variant === "bottleOil") {
      return (
        <div class="dash-root dash-root--bottle">
          <div class="dash-toolbar">
            <div>
              <h2 class="dash-title">Bottle Oil overview</h2>
              <p class="dash-subtitle">
                as at {formatDisplayDate(summary.asAtIso)}
              </p>
            </div>
            <button
              type="button"
              class="dash-refresh"
              onClick={() => setReloadKey((value) => value + 1)}
            >
              Refresh
            </button>
          </div>
          <BottleOilTiles summary={summary} onNavigate={onNavigate} />
          <BottleOilStockTable summary={summary} />
          <p class="dash-status">
            Open a financial year and month to see Bottle Oil sales charts.
          </p>
        </div>
      );
    }

    return (
      <div class="dash-empty">
        <h2>Overview</h2>
        <p>Open a financial year and month to see sales and delivery charts.</p>
        <button
          type="button"
          class="dash-refresh"
          onClick={() => setReloadKey((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
    );
  }

  if (summary.variant === "bottleOil") {
    return (
      <BottleOilDashboardView
        summary={summary}
        loading={loading}
        error={error}
        onRefresh={() => setReloadKey((value) => value + 1)}
        onNavigate={onNavigate}
        lineCanvasRef={lineCanvasRef}
        pieCanvasRef={pieCanvasRef}
        barCanvasRef={barCanvasRef}
      />
    );
  }

  if (summary.variant === "supervisor") {
    return (
      <SupervisorDashboardView
        summary={summary}
        loading={loading}
        error={error}
        onRefresh={() => setReloadKey((value) => value + 1)}
        onNavigate={onNavigate}
        lineCanvasRef={lineCanvasRef}
        pieCanvasRef={pieCanvasRef}
      />
    );
  }

  return (
    <CommercialDashboardView
      summary={summary}
      loading={loading}
      error={error}
      onRefresh={() => setReloadKey((value) => value + 1)}
      lineCanvasRef={lineCanvasRef}
      pieCanvasRef={pieCanvasRef}
      barCanvasRef={barCanvasRef}
    />
  );
}

function dashTileStatusClass(count: number): string {
  return count > 0 ? "dash-tile--pending" : "dash-tile--clear";
}

function BottleOilTiles({
  summary,
}: {
  summary: BottleOilDashboardSummary;
  onNavigate?: (routeId: string) => void;
}) {
  return (
    <div class="dash-tiles">
      <div class={`dash-tile ${dashTileStatusClass(summary.invoiceCounts.pending)}`}>
        <div class="dash-tile-label">Pending invoices</div>
        <div class="dash-tile-value">{summary.invoiceCounts.pending}</div>
        <div class="dash-tile-meta">Bottle Oil drafts awaiting validation</div>
      </div>
      <div class="dash-tile">
        <div class="dash-tile-label">Validated (open month)</div>
        <div class="dash-tile-value">
          {summary.invoiceCounts.validatedOpenMonth}
        </div>
        <div class="dash-tile-meta">
          Rejected: {summary.invoiceCounts.rejectedOpenMonth}
        </div>
      </div>
      <div class="dash-tile">
        <div class="dash-tile-label">Sellable stock on hand</div>
        <div class="dash-tile-value">
          {formatQty(summary.sellableUnitsTotal)}
        </div>
        <div class="dash-tile-meta">Bottled products · sellable units</div>
      </div>
    </div>
  );
}

function BottleOilStockTable({
  summary,
}: {
  summary: BottleOilDashboardSummary;
}) {
  return (
    <section class="dash-section dash-section-stock">
      <h3 class="dash-section-title">Bottled stock on hand</h3>
      <p class="dash-section-meta">
        As at {formatDisplayDate(summary.asAtIso)}
      </p>
      {summary.stockOnHand.length === 0 ? (
        <p class="dash-status">No bottled stock on hand.</p>
      ) : (
        <div class="dash-stock-scroll">
          <table class="dash-stock-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Location</th>
                <th>Point</th>
                <th>Condition</th>
                <th class="dash-num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {summary.stockOnHand.map((row, index) => (
                <tr key={`${row.productName}-${row.storageLocationName}-${index}`}>
                  <td>{row.productName}</td>
                  <td>{row.storageLocationName}</td>
                  <td>{row.salesPointName}</td>
                  <td>{row.condition === "SELLABLE" ? "Sellable" : "Unsellable"}</td>
                  <td class="dash-num">
                    {formatQty(row.qty)} {row.uom}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StockOnHandTable({
  title,
  meta,
  rows,
  emptyMessage,
}: {
  title: string;
  meta: string;
  rows: DashboardStockOnHandRow[];
  emptyMessage: string;
}) {
  return (
    <section class="dash-section dash-section-stock">
      <h3 class="dash-section-title">{title}</h3>
      <p class="dash-section-meta">{meta}</p>
      {rows.length === 0 ? (
        <p class="dash-status">{emptyMessage}</p>
      ) : (
        <div class="dash-stock-scroll">
          <table class="dash-stock-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Location</th>
                <th>Point</th>
                <th>Condition</th>
                <th class="dash-num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.productName}-${row.storageLocationName}-${index}`}>
                  <td>{row.productName}</td>
                  <td>{row.storageLocationName}</td>
                  <td>{row.salesPointName}</td>
                  <td>{row.condition === "SELLABLE" ? "Sellable" : "Unsellable"}</td>
                  <td class="dash-num">
                    {formatQty(row.qty)} {row.uom}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SupervisorQueueTiles({
  summary,
  onNavigate,
}: {
  summary: SupervisorDashboardSummary;
  onNavigate?: (routeId: string) => void;
}) {
  return (
    <div class="dash-tiles">
      {summary.queueTiles.map((tile) => {
        const content = (
          <>
            <div class="dash-tile-label">{tile.label}</div>
            <div class="dash-tile-value">{tile.count}</div>
            <div class="dash-tile-meta">Awaiting validation</div>
          </>
        );
        if (onNavigate) {
          return (
            <button
              key={tile.id}
              type="button"
              class={`dash-tile dash-tile-btn ${dashTileStatusClass(tile.count)}`}
              onClick={() => onNavigate(tile.routeId)}
            >
              {content}
            </button>
          );
        }
        return (
          <div
            key={tile.id}
            class={`dash-tile ${dashTileStatusClass(tile.count)}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function SupervisorDashboardView({
  summary,
  loading,
  error,
  onRefresh,
  onNavigate,
  lineCanvasRef,
  pieCanvasRef,
}: {
  summary: SupervisorDashboardSummary;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onNavigate?: (routeId: string) => void;
  lineCanvasRef: { current: HTMLCanvasElement | null };
  pieCanvasRef: { current: HTMLCanvasElement | null };
}) {
  return (
    <div class="dash-root dash-root--supervisor">
      <div class="dash-toolbar">
        <div>
          <h2 class="dash-title">Supervisor overview</h2>
          <p class="dash-subtitle">
            {summary.openMonth?.label ?? "No open month"}
            {summary.openYear != null ? ` · FY ${summary.openYear}` : ""}
            {" · "}
            as at {formatDisplayDate(summary.asAtIso)}
          </p>
        </div>
        <button
          type="button"
          class="dash-refresh"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <p class="dash-status dash-status-error">{error}</p> : null}

      <SupervisorQueueTiles summary={summary} onNavigate={onNavigate} />

      {summary.hasOpenPeriod ? (
        <div class="dash-sections dash-sections--supervisor">
          <section class="dash-section">
            <h3 class="dash-section-title">Sales revenue — open month</h3>
            <p class="dash-section-meta">Daily validated invoice totals (gross XAF)</p>
            <div class="dash-chart dash-chart-line">
              <canvas ref={lineCanvasRef} />
            </div>
          </section>

          <section class="dash-section">
            <h3 class="dash-section-title">Sales by product — open month</h3>
            <p class="dash-section-meta">Validated line net by product (all modes)</p>
            <div class="dash-chart dash-chart-pie">
              <canvas ref={pieCanvasRef} />
            </div>
          </section>
        </div>
      ) : (
        <p class="dash-status">
          Open a financial year and month to see revenue charts.
        </p>
      )}

      <div class="dash-stock-split">
        <StockOnHandTable
          title="Loose stock on hand (kg)"
          meta={`Sellable total: ${formatQty(summary.looseSellableTotalKg)} kg`}
          rows={summary.looseStockOnHand}
          emptyMessage="No loose stock on hand."
        />
        <StockOnHandTable
          title="Bottle stock on hand (units)"
          meta={`Sellable total: ${formatQty(summary.bottleSellableTotalUnits)} units`}
          rows={summary.bottleStockOnHand}
          emptyMessage="No bottled stock on hand."
        />
      </div>
    </div>
  );
}

function BottleOilDashboardView({
  summary,
  loading,
  error,
  onRefresh,
  onNavigate,
  lineCanvasRef,
  pieCanvasRef,
  barCanvasRef,
}: {
  summary: BottleOilDashboardSummary;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onNavigate?: (routeId: string) => void;
  lineCanvasRef: { current: HTMLCanvasElement | null };
  pieCanvasRef: { current: HTMLCanvasElement | null };
  barCanvasRef: { current: HTMLCanvasElement | null };
}) {
  return (
    <div class="dash-root dash-root--bottle">
      <div class="dash-toolbar">
        <div>
          <h2 class="dash-title">Bottle Oil overview</h2>
          <p class="dash-subtitle">
            {summary.openMonth?.label}
            {summary.openYear != null ? ` · FY ${summary.openYear}` : ""}
            {" · "}
            as at {formatDisplayDate(summary.asAtIso)}
          </p>
        </div>
        <button
          type="button"
          class="dash-refresh"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <p class="dash-status dash-status-error">{error}</p> : null}

      <BottleOilTiles summary={summary} onNavigate={onNavigate} />

      <div class="dash-sections dash-sections--bottle">
        <section class="dash-section dash-section--bottle-revenue">
          <h3 class="dash-section-title">Bottle Oil revenue — open month</h3>
          <p class="dash-section-meta">
            Daily validated Bottle Oil invoice totals (gross XAF)
          </p>
          <div class="dash-chart dash-chart-line">
            <canvas ref={lineCanvasRef} />
          </div>
        </section>

        <div class="dash-bottle-chart-row">
          <section class="dash-section">
            <h3 class="dash-section-title">Sales by product — open month</h3>
            <p class="dash-section-meta">Validated Bottle Oil line net by product</p>
            <div class="dash-chart dash-chart-pie">
              <canvas ref={pieCanvasRef} />
            </div>
          </section>

          <section class="dash-section">
            <h3 class="dash-section-title">
              Bottle Oil sales units — FY {summary.openYear}
            </h3>
            <p class="dash-section-meta">
              Validated Bottle Oil quantity (units) by calendar month
            </p>
            <div class="dash-chart dash-chart-bar">
              <canvas ref={barCanvasRef} />
            </div>
          </section>
        </div>
      </div>

      <BottleOilStockTable summary={summary} />
    </div>
  );
}

function CommercialDashboardView({
  summary,
  loading,
  error,
  onRefresh,
  lineCanvasRef,
  pieCanvasRef,
  barCanvasRef,
}: {
  summary: CommercialDashboardSummary;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  lineCanvasRef: { current: HTMLCanvasElement | null };
  pieCanvasRef: { current: HTMLCanvasElement | null };
  barCanvasRef: { current: HTMLCanvasElement | null };
}) {
  return (
    <div class="dash-root">
      <div class="dash-toolbar">
        <div>
          <h2 class="dash-title">Overview</h2>
          <p class="dash-subtitle">
            {summary.openMonth?.label}
            {summary.openYear != null ? ` · FY ${summary.openYear}` : ""}
            {" · "}
            as at {formatDisplayDate(summary.asAtIso)}
          </p>
        </div>
        <button
          type="button"
          class="dash-refresh"
          disabled={loading}
          onClick={onRefresh}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? <p class="dash-status dash-status-error">{error}</p> : null}

      <div class="dash-sections">
        <section class="dash-section">
          <h3 class="dash-section-title">Sales revenue — open month</h3>
          <p class="dash-section-meta">Daily validated invoice totals (gross XAF)</p>
          <div class="dash-chart dash-chart-line">
            <canvas ref={lineCanvasRef} />
          </div>
        </section>

        <section class="dash-section">
          <h3 class="dash-section-title">Sales by product category — open month</h3>
          <p class="dash-section-meta">Validated line net share by category</p>
          <div class="dash-chart dash-chart-pie">
            <canvas ref={pieCanvasRef} />
          </div>
        </section>

        <section class="dash-section">
          <h3 class="dash-section-title">
            Delivery orders vs sales — FY {summary.openYear}
          </h3>
          <p class="dash-section-meta">
            Validated DO ordered kg vs validated sales kg by calendar month
          </p>
          <div class="dash-chart dash-chart-bar">
            <canvas ref={barCanvasRef} />
          </div>
        </section>
      </div>
    </div>
  );
}
