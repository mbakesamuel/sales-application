# Organization setup (General Parameters)

Sidebar section: **General Parameters**. Labels below match the sidebar today. Use these screens for first-time site setup and whenever company structure or policy options change.

## Section map

| Sidebar item | Purpose |
|--------------|---------|
| **App settings** | Company-wide options (numbering, sales/stock behaviour, session security) plus company identity registry |
| **Report settings** | Report footer **signatory** history (name, title, effective-from) |
| **Data backup** | Create / restore full database backups; optional daily auto-backup (**ADMIN**) — see [Data backup and restore](11-data-backup-restore.md) |
| **Data sync** | Central sync server URL, device token, auto-sync, Sync Now (**ADMIN**) — see [Data synchronization](12-data-sync.md) |
| **Financial year** | Create, open, or close financial years |
| **Financial month** | Open or close calendar months for the open year |
| **Services** | Commercial service sites / modules |
| **Collection points** | Outlets / mills (e.g. Bota, Mondoni) used on sales, DOs, and stock |
| **Oil storage Locations** | Reusable location name definitions |
| **Locations Assignment** | Assign locations to collection points (including **Sales tank**) |
| **Payment Options** | Accepted payment methods |
| **Tax Regime** | Actual vs Simplified (and related) regimes |
| **Tax Rate Schedule** | Date-effective VAT / sales-tax rates |
| **Transport Rates** | Transport cost per kg by collection point and product |

Related screens outside this section: **Transportation cost** compute (Sales) and the **transportation cost** report (Reports).

---

## App settings

Screen title: **General Application Settings**. Option cards each have their own **Save…** button. After changing options that affect POS or stock screens, have clerks reopen those screens (or sign out/in).

### Stock document numbering

- **Auto-generate receipt numbers** — When off, users enter a receipt number on new drafts.
- **Auto-generate transfer numbers** — When off, users enter a transfer number on new drafts.

### Bottle Oil sales

- **Use registered customers** — Off by default. When off, Bottle Oil uses an invoice customer name only (no directory pick). When on, a directory customer is required. Special dispositions stay invoice-name only.
- **Allow Ration disposition** — Off by default. When off, Ration is hidden. **Public relation** is always available on Bottle Oil.

### Transportation cost

- **Moliwe + SCR MAYA transport cost policy** — On by default. Compute and the monthly transportation cost report include only Moliwe invoices raised to customer SCR MAYA. Uncheck to include all collection points and customers.

### Session security

- **Idle sign-out timeout** — Off by default (stay signed in until manual sign-out or session expiry). When set, the app signs out after the selected idle period. Applies on next sign-in.

### Sales invoices

Applies to loose **Sales → Invoicing** and **Bottle Oil sales**:

- **Lock unit price from schedule** — On by default. Add/Edit item resolve unit price from the pricing schedule and block manual edits.
- **Auto-generate sales invoice numbers** — Off by default (enter a booklet serial). When on, the system assigns `INV-year-######` on save.
- **Enforce booklet validation** — Off by default. When on, manual serials must belong to an **ACTIVE** booklet issued to the selected collection point (see **Sales → Document booklets**). Ignored when auto-generate is on.

### Delivery order numbering

- **Auto-generate delivery order numbers** — Off by default (booklet serial). When on, assigns `DO-year-######` on save. Carry-forward and transfer DO numbers stay system-assigned.
- **Enforce booklet validation** — Off by default. When on, manual DO serials must belong to an **ACTIVE** booklet for the collection point (**Document booklets**, kind Delivery order). Ignored when auto-generate is on.

### Loose sales

- **Allow Public relation disposition** — Off by default.
- **Use unregistered customer** — Off by default (directory customer required). When on, clerks can type an invoice name for normal disposition; Ration / Public relation always use an invoice name.
- **Require sales tank for Loose Palm Oil** — On by default. Loose Palm Oil lines only use locations marked **Sales tank**. When off, Palm Oil can use any location with stock. Other products always use any location with stock; Palm Kernel / Cake never use a location.

### Stock transfers

- **Allow loose Palm Oil transfers between collection points** — Off by default (only bottled products may transfer inter-site). When on, loose Palm Oil may also transfer between collection points; other loose products stay within collection point.
- **Group products for stock intake** — Off by default. When on, bulk receipts and carry-forward use Palm Oil / Sludge Oil / Palm Kernel groups; invoices and reports still show individual product names.
- **Use receive date for stock posting** — Off by default (stock posts when Receive is confirmed). When on, receive posts inventory on the Date entered (must be in the open financial month).

### Danger zone (ADMIN with write)

**Clear operational data…** permanently deletes stock movements/balances, receipts, transfers, adjustments, sales (including consignments), and delivery orders, while keeping master data (products, customers, users, budgets, permissions, settings). Sequence counters for stock documents, commercial invoices, delivery orders, and VCN reset to 1. Use only under IT/admin control.

### Company registry

Maintain company identity used on invoices and report headers:

| Field | Notes |
|-------|--------|
| **Company name** | Printed on documents |
| **Department** | Required |
| **VAT rate (%)** | Displayed here; maintained on **Tax Rate Schedule** |
| **Fiscal year start month** | Company calendar start |
| **Logo URL** | Optional logo for headers |
| **Theme** | UI theme toggle on the registry toolbar (when you have write access) |

---

## Report settings

Manages the **report signatory** history only: **name**, **title**, and **effective from** date. Printed report footers use the latest entry whose effective date is on or before the report’s as-at date.

**Hide zero / empty quantity rows** is **not** on this screen. Use the toggle on each report that supports it (preference is stored on the PC). See [Reports](08-reports.md).

---

## Data backup and Data sync

| Screen | Who | Purpose |
|--------|-----|---------|
| **Data backup** | **ADMIN** | Full `.db` backup/restore and optional daily auto-backup while the app is running |
| **Data sync** | **ADMIN** | Hono Central API URL, device token / id, auto-sync, outbox status, Sync Now |

Full procedures: [Data backup and restore](11-data-backup-restore.md) and [Data synchronization](12-data-sync.md).

---

## Financial year and month

| Screen | Purpose |
|--------|---------|
| **Financial year** | Open or close a financial year. |
| **Financial month** | Open or close calendar months within the open year. |

**Rules of thumb**

- Only one year/month should be open for normal posting.
- You cannot open a **future** financial year (after the current calendar year). You can still reopen the current year or an earlier year for posting or reprinting.
- Reports use an **as at** date of the earlier of **today** and the **open month’s end**. Reopening a past month (e.g. January) to print shows figures as at that month’s close, not today’s live stock.
- If save/post fails with a period error, open the correct month first.

---

## Services, collection points, and storage

| Screen | Purpose |
|--------|---------|
| **Services** | Commercial service sites / modules used in the org model. |
| **Collection points** | Outlets used on sales, delivery orders, and stock (also called sales points in some reports). |
| **Oil storage Locations** | Reusable location name definitions. |
| **Locations Assignment** | Link a location to a collection point; mark **Sales tank** locations used when selling loose Palm Oil (when that App setting is on). |

Sales invoices and stock postings need a coherent collection point + location assignment setup.

---

## Payment Options

Define the payment methods accepted on sales and delivery orders. At least one method is required before the sales screen allows normal paid invoices.

| Kind | Typical use on sales |
|------|----------------------|
| **Cash** (`SIMPLE`, code/name **CASH**) | **Bottle Oil** normal sales — Cash only (required). Hidden on loose invoices. |
| **Cheque** | Loose sales — cheque number + bank. |
| **Traite** | Loose sales — trait no #, issued on, maturity on, bank. |
| **Bank transfer** | Loose sales — bank / reference fields. |
| **Credit** | As configured for your site. |

Ensure a **Cash** method exists for Bottle Oil. For loose commercial sales, configure at least one non-cash method (cheque, traite, or bank transfer).

---

## Tax Regime and Tax Rate Schedule

| Screen | Purpose |
|--------|---------|
| **Tax Regime** | Actual vs Simplified (and related regime setup). |
| **Tax Rate Schedule** | Date-effective VAT / sales-tax rates. |

Rates are resolved as-of the invoice or DO date when calculating taxes.

---

## Transport Rates

Maintain transport cost **per kg** by **collection point** and **product**. Used by **Sales → Transportation cost** compute and the monthly transportation cost report (policy filter under **App settings → Transportation cost**).

Next: [Customers and products](03-customers-products.md).
