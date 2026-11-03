# Domain modules

Key main-process domains and entry files.

## Booklet serial numbers (sales and DOs)

New sales invoices and delivery orders require a **manual booklet serial** entered by the operator (paper booklet). Shared validation lives in `src/shared/bookletSerial.ts` (`validateBookletSerial`): digits only, max 20 characters, non-empty. Services enforce uniqueness and immutability after create (`src/electron/sales/service.ts`, `src/electron/deliveryOrders/service.ts`).

| Kind | Numbering |
|------|-----------|
| New sale / new DO | Operator booklet serial (required) |
| Carry-forward DO | Auto `CF-{year}-{seq}` via `allocateCarryForwardDeliveryOrderNo` in `doNo.ts` |
| Legacy rows | Existing `INV-…` / `DO-…` values remain loadable |

Legacy auto-allocators `allocateDeliveryOrderNo` / `allocateInvoiceNo` in `doNo.ts` / `invoice.ts` are **unused** by create paths; do not wire new UI to them.

## Sales

| Piece | Path |
|-------|------|
| Service | `src/electron/sales/service.ts` |
| Invoice helpers (legacy allocate) | `src/electron/sales/invoice.ts` |
| Print payload | `src/electron/sales/print.ts` |
| DO list/lookup for POS | `src/electron/sales/deliveryOrders.ts` |
| IPC | `src/electron/ipc/sales.ts` |
| UI | `src/ui/sales/SalesClient.tsx`, `SalesScreen.tsx` (`variant`: `loose` \| `bottled`) |
| Routes | `sales`, `bottle-oil-sales` |

### Bottle Oil company settings

| Column | Migration | Default | Effect |
|--------|-----------|---------|--------|
| `bottleOilUseRegisteredCustomers` | `078` | off | Directory customers vs invoice name on Bottle Oil |
| `bottleOilAllowRation` | `079` | off | Whether Ration disposition is offered / accepted on Bottle Oil |

Form options expose both flags; `createSale` enforces them. The Sales UI never shows the per-invoice registered-customer checkbox on the bottled variant. Ration is hidden on Bottle Oil when `bottleOilAllowRation` is off. Admins toggle both under App settings.

### Pick DO behaviour (current)

- `listAvailableDeliveryOrders({ salesPointId, customerId })` — validated DOs for that pair; **one row per product** with remaining kg; CF flagged via `sourceKind`.
- Sold qty = sum of sale lines on sales with the same `deliveryOrderNo` + product.
- UI pick / lookup **links** the DO number and adopts the DO customer without replacing the invoice line list. Pick opens **Add line** prefilled with that product’s remaining qty and DO unit price; Lookup prefills when exactly one remaining product exists.

Operator description: [Sales invoices](../user-guide/04-sales-invoices.md).

### Cancel / delete validated sales

- `cancelValidatedSale` / `deleteSale` in `service.ts`; stock via `reverseStockForValidatedSale` in `src/electron/stock/sales.ts` (`SALE_REVERSAL` movements use the original `SALE.occurredAt`, not cancel time — migration `120` backdates older rows).
- Sets `Sale.status` to `REJECTED`, fills `cancelledAt` / `cancelledByUserId` / `cancelReason` (migration `119`). Rejected sales are excluded from revenue and from DO lifted qty.
- IPC: `sales:cancelValidatedSale`; UI modal + rejected banner in `SalesClient.tsx`.
- Permissions: actions `cancel_validated_sales` / `delete_validated_sales` plus route write on the sales screen.

### Payment UI rules (POS)

Enforced in `SalesClient.tsx` (not separate IPC):

| Variant | Methods shown | Amount |
|---------|---------------|--------|
| `bottled` | Cash only (`code`/`name` = `CASH`) | Locked to invoice gross; single line |
| `loose` | Non-cash methods only | Locked to invoice gross |

Traite payments (`kind === "TRAITE"`) require `traiteNo`, `traiteIssuedOn`, `traiteMaturityOn` (plus bank when enabled). Persist on `Payment` via existing sale create payload fields in `src/electron/sales/service.ts`.

## Delivery orders

| Piece | Path |
|-------|------|
| Service | `src/electron/deliveryOrders/service.ts` |
| DO numbers (CF allocate + unused legacy) | `src/electron/deliveryOrders/doNo.ts` |
| IPC | `src/electron/ipc/deliveryOrders.ts` |
| UI | `src/ui/delivery-orders/` (create, list, validation queue) |

Statuses: `PENDING` | `VALIDATED` | `REJECTED` (as used in types).

### Validation queue

- `listValidationQueue()` — pending DOs awaiting validation.
- `validateMany({ ids })` — bulk validate.
- UI: `src/ui/delivery-orders/validation-queue/ValidationQueueClient.tsx` (tab gated on `validate_delivery_orders`).

### DO tracking

| Piece | Path |
|-------|------|
| Builder | `src/electron/deliveryOrders/track.ts` → `trackDeliveryOrderByNo` |
| IPC | `deliveryOrders:trackByNo` |
| UI | `src/ui/delivery-orders/DeliveryOrderTrackingScreen.tsx`, `DeliveryOrderTrackingPrintView.tsx` |
| Route | `delivery-order-tracking` (migration `044`) |

Shows header, commitment by product, lift history, and transfers out. Printable tracking report uses company report header. Any DO status — not limited to validated.

### Transfer DO balance

| Piece | Path |
|-------|------|
| Service | `src/electron/deliveryOrders/transfer.ts` → `transferDeliveryOrderBalance` |
| IPC | `deliveryOrders:transferBalance` (requires `userId`; action `transfer_delivery_order_balance`) |
| UI | `src/ui/delivery-orders/DeliveryOrderTransferScreen.tsx` |
| Route | `delivery-order-transfer` (migration `045`) |

Reduces source DO `orderQty`, creates validated destination DO `DT-{year}-{seq}` with `sourceKind = TRANSFER`. Commitment only — no stock movement.

### Print

| Piece | Path |
|-------|------|
| Print payload | `src/electron/deliveryOrders/print.ts` |
| IPC | `deliveryOrders:getPrintById` |
| UI | `src/ui/delivery-orders/DeliveryOrderPrintView.tsx` |

## Vehicle consignment notes

| Piece | Path |
|-------|------|
| Service | `src/electron/vehicleConsignmentNotes/service.ts` |
| IPC | `src/electron/ipc/vehicleConsignmentNotes.ts` |
| Types | `src/shared/vehicleConsignmentNotes.types.ts` |
| UI | `src/ui/vehconsignment-note/` (`ConsignmentNotesClient`, `ConsignmentValidationScreen`, print views) |
| Routes | `vehicle-consignment-notes`, `vehicle-consignment-validation` |
| Action | `validate_vehicle_consignment_notes` |

Validation queue: `listValidationQueue` / `validateMany`. Route seed for supervisor roles: migration `086_supervisor_overview.sql`. Action seed: `084_validate_vehicle_consignment_notes.sql`. Details columns: `085_consignment_details.sql`.

## Carry-forward commitments

| Piece | Path |
|-------|------|
| Service | `src/electron/commitments/carryForward.ts` |
| IPC | `src/electron/ipc/carryForward.ts` |

`list()` returns validated CF commitment lines; `listPending(userId)` returns the submitting clerk’s pending CF delivery-order lines for the **Awaiting validation** section on the commitments screen.

One `CARRY_FORWARD` DO **per outstanding original DO** (`sourceDocumentNo` required on create; unique among open CF). Auto CF numbering (not booklet serials). Batch upsert creates/updates by `detailId` — no merge by customer+point. Users without `validate_stock_documents` or `validate_delivery_orders` save as **draft** stock adjustments / **pending** DOs for supervisor validation (`carryForwardRequiresValidation` in `permissions/service.ts`).

## Stock

| Piece | Path |
|-------|------|
| Core service / post | `src/electron/stock/service.ts`, `post.ts`, `sales.ts` |
| Carry-forward stock | `src/electron/stock/carryForwardStock.ts` |
| IPC | `src/electron/ipc/stock.ts`, `carryForwardStock.ts` |
| UI | stock screens under `src/ui/` (stock hub, CF stock) |

`applyMovement` in `post.ts` enforces storage location occupancy: bottled products may co-mingle; non-bottled products are one SKU per location; bottled and bulk stock cannot share a location (non-zero on-hand).

### Bin card

| Piece | Path |
|-------|------|
| Builder | `src/electron/stock/binCard.ts` → `getBinCard(userId, query)` |
| Types | `src/shared/stock.types.ts` (`BinCardQuery`, `BinCardReport`) |
| IPC | `stock:getBinCard` in `src/electron/ipc/stock.ts` |
| UI (filters + table) | `src/ui/stock/BinCardScreen.tsx` |
| UI (print window) | `src/ui/stock/BinCardReportScreen.tsx` |
| Report route | `stock-bin-card-report` in `REPORT_WINDOW_ROUTE_IDS` |

The main screen posts filters to `windows:openReport` with a **`query`** payload (bottled product, date range, optional sales point / location / condition). Bin card is **bottled products only** (enforced in `getBinCard` and the product picker). The report window bootstraps via `report-window:bootstrap` and renders with shared report chrome (`StockCommitmentReport.css` + `BinCardReport.css`). Report window size is **A4 portrait** (~820×1120). Permissions: migration `051_stock_bin_card_permissions.sql` (copied from stock-movements / stock-balance routes).

## Pricing and tax

| Piece | Path |
|-------|------|
| Unit price resolve | `src/electron/pricing/resolveUnitPrice.ts` |
| Lock unit price on invoices | `CompanySettings.salesInvoiceLockUnitPrice` (migration `106`); enforced in `SalesLineModal` via sales bootstrap |
| Tax rates | `src/electron/tax/resolveRates.ts` |

Customer types may set `exemptFromSalesTax` (migration `036`). Sales for those types follow exemption rules; `npm run recalc:sales-tax-exempt` recalculates affected historical sales when needed.

## Financial periods

| Piece | Path |
|-------|------|
| Service | `src/electron/financialYears/service.ts` |
| IPC | `src/electron/ipc/financialYears.ts` |

`getOpenPostingPeriod()` and `resolveReportAsAt()` are shared by posting validation and reports. On startup, `backfillFinancialMonths()` fills missing month rows for open years. `openYear(year)` rejects years after the local calendar year so a future period cannot become the posting year by mistake; past and current years can still be opened.

## Database backup

| Piece | Path |
|-------|------|
| Service | `src/electron/db/backup.ts` — `getBackupInfo`, async `createBackup` (await SQLite `.backup()`), `restoreBackup` |
| Schedule | `src/electron/db/backupSchedule.ts` — daily auto-backup while app runs (`runScheduledBackup` awaits `createBackup`); config `{userData}/backup-schedule.json` |
| IPC | `src/electron/ipc/backup.ts` (handlers await create / scheduled run) |
| UI | `src/ui/organization/DataBackupScreen.tsx` |
| Route | `data-backup` (ADMIN write by default; migration `108`) |
| IT script | `scripts/backup-windows.ps1` — Task Scheduler copy when app is closed |

Restore closes the DB, renames live `sales.db` to `.old-{timestamp}`, copies the backup, and triggers `app.relaunch()`. Metadata for last in-app backup: `{userData}/backup-meta.json`. Automatic backups write `sales-auto-backup-*.db` to a configured folder and prune by retention count.

## Dashboard

| Piece | Path |
|-------|------|
| Summary builder | `src/electron/dashboard/summary.ts` |
| Types | `src/shared/dashboard.types.ts` (`commercial` \| `bottleOil` \| `supervisor`) |
| IPC | `src/electron/ipc/dashboard.ts` |
| UI | `src/ui/dashboard/` (Overview route; compact CSS for bottle/supervisor) |
| Role helpers | `isStoreKeeperRole` / `isSupervisorOverviewRole` in `src/shared/roles.ts` |

`getSummary` picks a variant from the authenticated user’s role:

| Variant | Roles | Payload highlights |
|---------|-------|--------------------|
| `commercial` | Default | Revenue by day, by category, DO vs sales by month |
| `bottleOil` | `STORE_KEEPER` | Bottle Oil revenue/product/qty charts, invoice counts, bottled stock |
| `supervisor` | `SENIOR_SALES_SUPERVISOR`, `JNR_SALES_SUP` | Queue tiles (sales / stock / consignment), revenue by product, loose + bottle stock |

Authenticated helper: `getAuthenticatedDashboard()` in the UI auth layer.

## Generic table CRUD

Schema-driven admin tables use `db:*` IPC (`tableQuery`, `tableMutations`, `tableMeta`) for list/edit UIs that are not custom domain screens.
