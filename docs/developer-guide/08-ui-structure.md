# UI structure

## Entry and routing

- App shell / login → home
- [`src/ui/pages/HomeScreen.tsx`](../../src/ui/pages/HomeScreen.tsx) switches on `route.id` to custom screens or generic table UIs
- Sidebar sections: [`src/ui/navigation/schemaRoutes.ts`](../../src/ui/navigation/schemaRoutes.ts)
- Canonical route ids: [`src/shared/routeCatalog.ts`](../../src/shared/routeCatalog.ts)

## Screen styles

| Kind | Examples |
|------|----------|
| Custom domain | Sales (`SalesClient` / `SalesScreen`), delivery orders (create, list, validation queue, **tracking**, **transfer**), **vehicle consignment notes** (+ validation queue), carry-forward, stock hub (**bin card**), reports, budgets, dashboard, **`ChangePasswordScreen`** (first-login gate) |
| Schema/table CRUD | Many org master-data routes via shared table components + `api.db.*` |

## Overview dashboard

Route **Overview** (`overview`) renders `src/ui/dashboard/DashboardScreen.tsx`. Data via `window.api.dashboard.getSummary`. UI branches on `summary.variant`:

- `commercial` — revenue / category / DO vs sales charts  
- `bottleOil` — Store Keeper compact layout (`.dash-root--bottle`)  
- `supervisor` — queue tiles + stock tables (`.dash-root--supervisor`)

## Reports UI

Under `src/ui/reports/`:

- Sidebar groups: **Daily / Weekly / Monthly / Annual** in `schemaRoutes.ts`
- `*Screen.tsx` — toolbar (print, CSV, comments, week/year/date pickers) + document
- `reportBody.tsx` — shared route switch for overlay and report-window bootstrap
- `ReportOverlayShell` — in-app modal overlay (primary path from sidebar via `HomeScreen.openReportOverlay`)
- `*Document` export — used by Weekly Print Pack where applicable
- Shared: `ReportHeader`, `ReportFooter`, `ReportComments*`
- Secondary windows: [`ReportWindowApp.tsx`](../../src/ui/pages/ReportWindowApp.tsx) bootstraps printable routes from `REPORT_WINDOW_ROUTE_IDS` (including parameterized bin card via `query`). Sidebar reports use the overlay instead.

CSS: `StockCommitmentReport.css` (shared report chrome), plus report-specific **thin overlays** (column widths, section spacing — e.g. `MonthlyPalmOilSalesReport.css`, `SalesBudgetCrosstab.css`, `BinCardReport.css`, `PalmOilSalesActivityReport.css`). Overlay panel width: `ReportOverlayShell.css` (`min(1200px, 100%)`). **Stock report** (`.sr-stock-report`) and **Commitment report** (`.cr-commitment-report`) use named print page `scrCompactTopTight` (2mm top/bottom margins) in `StockCommitmentReport.css`.

**Compact print headers** — `SalePrintView.css` and `DeliveryOrderPrintView.css` scope smaller `.report-header` typography for invoices, receipts, DO, and DO-tracking prints. VCN print (`VcnPrintView.tsx`) uses the overlay shell and dual **Original** / **Duplicate** A4 copies.

## Forms and dialogs

[`FormDialog.tsx`](../../src/ui/components/FormDialog.tsx) + [`FormDialog.css`](../../src/ui/components/FormDialog.css) — standard modal shell (`form-dialog-panel`, label/control rows, primary/secondary actions). Used by master-data modals (users, customer types, payment methods, tax, etc.) and by **[`CustomerFormModal`](../../src/ui/customers/CustomerFormModal.tsx)** (two-step add/edit customer wizard; Basic includes tax regime / TPN and commercial service; regime select drives `hasTaxpayerId`). Keep textareas constrained (`box-sizing`, max-height) so they do not overflow the panel.

## Permissions in UI

Home/nav filters routes by snapshot; screens receive `readOnly` when access is `read`. Action buttons (validate) should check action flags from the permissions snapshot.
