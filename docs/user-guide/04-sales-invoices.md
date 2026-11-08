# Sales invoices

Screens under sidebar **Sales**:

| Sidebar item | Purpose |
|--------------|---------|
| **Invoicing** | Loose / bulk invoices — list first; **New invoice** opens the form in a modal |
| **Bottle Oil sales** | Bottled invoices — list first; **New Bottle Oil invoice** opens the form in a modal |
| **Sales validation** | Queue of pending invoices for supervisors to validate (including bulk) |
| **Document booklets** | Issue sales-invoice / delivery-order booklet ranges to collection points |
| **Booklet validation** | Validate pending booklet issuances (`validate_document_booklets`) |
| **Consignment notes** / **Consignment validation** | Vehicle consignment notes for validated sales |
| **Transportation cost** | Compute transport cost for quantities lifted in the open month |

## Modes and dispositions

- **Loose (Invoicing)** — Lines in kg; deduct from a **sales tank** (when App settings require it for LPO). Delivery-order picking is available for normal dispositions with a registered customer.
- **Bottle Oil sales** — Separate screen for bottled products (units). Deducts from **Bottle Oil Store** (not a sales tank). No delivery-order picking. The per-invoice **Registered customer** checkbox is **never shown**; customer mode follows **App settings → Bottle Oil sales → Use registered customers** (off = invoice name only; on = directory customer required). **Ration** is available only when **Allow Ration disposition** is on in App settings (off by default). See [Organization setup](02-organization-setup.md).
- **Sale disposition** — Normal commercial sales vs special cases such as **Ration** or **Public relation**. Special dispositions use an **invoice name only** (no directory customer) and no delivery-order linking. **Line amounts work like normal sales**; payment method is **fixed by disposition** (not Cash or cheque). On loose Invoicing, **Ration** is limited to the **LPO** product category; **Public relation** uses Loose Palm Oil products (when allowed in App settings). On Bottle Oil, Ration may be hidden by company setting; Public relation remains available.

## Creating a normal sale

Open **Sales → Invoicing** or **Bottle Oil sales**, then **New invoice** / **New Bottle Oil invoice** to open the form modal.

1. **Invoice number** — By default enter the **Booklet serial no.** from the paper booklet. If **App settings → Sales invoices → Auto-generate sales invoice numbers** is on, the system assigns `INV-year-######` on save (no booklet serial field). If **Enforce booklet validation** is on (and auto-generate is off), the serial must belong to an **ACTIVE** booklet for the collection point.
2. Select **customer** and **collection point**:
   - **Loose** — Use the **Registered customer** checkbox when selling to a directory account; uncheck for an invoice name only (when App settings allow unregistered customers).
   - **Bottle Oil** — Invoice name only by default, or a directory customer when the company setting is on (no checkbox).
3. Set the transaction date (must fall in the open posting period).
4. Optionally link a **delivery order** (loose / normal / registered customer only — see below).
5. Add product lines (qty, price, storage location where required).
6. Enter payments so paid total matches the invoice total — see **Payments** below.
7. Save. The sale is typically **pending** until validated (unless your role has direct validate — see below). Supervisors can also clear pending invoices on **Sales → Sales validation**.

**Unit price on lines** — By default (**App settings → Lock unit price from schedule**), **Add item** / **Edit item** resolve unit price from the product pricing schedule and the price field is read-only. Turn the setting off to allow manual overrides when the field is editable. See [Organization setup](02-organization-setup.md).

Vehicle number is required for loose/normal sales that need it.

## Payments

The paid total must equal the invoice total for all dispositions (including **Ration** and **Public relation**). Payment amount is **locked** to the invoice gross (auto-filled). For **normal** sales you choose the method; for **Ration** and **Public relation** the method is **read-only** and set automatically.

| Mode / disposition | Payment method | Notes |
|--------------------|----------------|-------|
| **Bottle Oil — normal** | **Cash** (read-only) | One payment line covering the full amount. |
| **Bottle Oil — Ration** | **Ration (deferred)** (read-only) | Full invoice amount; deferred CDC worker credit — not cash. |
| **Bottle Oil — Public relation** | **Public relation (complimentary)** (read-only) | Full invoice amount; complimentary GM issue — not cash. |
| **Loose — normal** | Cheque, Traite, Bank Transfer, etc. | **Cash is hidden**. Choose method from the dropdown. |
| **Loose — Ration** | **Ration (deferred)** (read-only) | Same deferred method as bottle Ration. |
| **Loose — Public relation** | **Public relation (complimentary)** (read-only) | Same complimentary method as bottle Public relation. |

### Traite (loose)

When the payment method kind is **Traite**, enter:

- **Trait no #**
- **Issued on** (date)
- **Maturity on** (date)
- **Bank** (when required for that method)

Cheque methods still use **Cheque #** and **Bank**. Bank transfer uses its reference / bank fields as configured.

## Booklet serial number

When auto-generate is **off**, new invoices require a **Booklet serial no.** typed from the physical booklet:

- Digits only (no letters or punctuation).
- At most 20 digits.
- Must be unique among invoices (duplicates are rejected).
- Immutable after save — you cannot change the serial on an existing invoice.
- When **Enforce booklet validation** is on, the serial must fall in an **ACTIVE** booklet issued to the selected collection point (**Sales → Document booklets**).
- Older invoices that still use legacy `INV-…` numbers remain loadable for lookup and printing.

When auto-generate is **on**, the system assigns `INV-year-######` and booklet enforcement does not apply.

## Document booklets

**Sales → Document booklets** registers paper booklet ranges for **Sales invoice** or **Delivery order** kinds, issued to a collection point (from–to serials).

Typical flow:

1. Issue a booklet (status **PENDING** unless your role can activate immediately).
2. A supervisor validates it on **Sales → Booklet validation** (or on the booklets screen when allowed) → status **ACTIVE**.
3. Clerks may then use serials from that range when App settings enforce booklet validation.

Cancel an active booklet only when your process requires it (write access). See [Users and permissions](09-users-permissions.md) for `validate_document_booklets`.

## Stock as of invoice date

On create and validate, the app checks **sellable stock as of the invoice date** (`dateIssued`) at the collection point and storage location — not only today’s live balance. Receipts, carry-forward stock, transfers, and prior sales through that date count; stock that arrived *after* the invoice date does not. Backdating an invoice before stock was on hand is blocked (even if you validate later, after a receipt).

**Pending invoices also reserve that stock.** Available qty for new lines and new invoices is reduced by other **pending** sales (loose and bottle) dated on or before the invoice date at the same location. Saving a pending sale of 5 when 5 are on hand blocks further sales of that stock until the pending invoice is validated, cancelled, or deleted. Physical stock movements are still posted only on validate (or direct validate).

Validated sales post stock movements stamped with the invoice date so later as-of checks stay consistent.

## Delivery order on the invoice

### When DO UI appears

Delivery order fields show for **loose**, **normal** disposition, with a **registered customer**.

### Pick DO (recommended)

1. Choose the customer and collection point first.
2. Click **Pick DO**. The list shows only **validated** DOs for **that customer and collection point** that still have remaining balance.
3. The list is **split by product**: each row is one product with remaining kg (not a single bulk total for the whole DO). Carry-forward DOs are marked **CF** and show the **original DO #** when registered.
4. Click a row — the app **links that delivery order**, switches to the DO’s customer if needed, and **opens Add line** with that product, remaining qty, and DO unit price. Confirm storage location (auto-picked from stock when possible) and save the line.
5. Use **Add line** again for more products; if a DO product was linked but the modal was closed, Add line still prefills that product until you save a line or clear the DO.

### Manual Lookup

1. Type a DO number (or use Pick DO).
2. Click **Lookup** to confirm the DO and link it (sets the DO number and adopts the DO customer). If the DO has exactly one product with remaining balance, Add line will prefill that product.
3. Add products with **Add line**.

### After save

The invoice stores the delivery order number so later sales against the same DO reduce remaining balance (used by Pick DO and commitment reports).

## Validate, cancel, and delete

- **Validate** — Requires the `validate_sales` action permission. Re-checks stock **as of the invoice date** (see above), then deducts live inventory. Use the invoice screen or **Sales → Sales validation**. Validated sales appear on delivery/stock-style reports that filter on validated status.
- **Direct validate (create + validate in one step)** — Users with the `direct_validate_sales` action (default: **ADMIN** and **MANAGER**) see **Validate invoice** and **Save as pending** when creating a new invoice. **Validate invoice** creates the sale and validates it in one step (stock is deducted immediately). **Save as pending** keeps the two-step workflow. Supervisors with `validate_sales` but not `direct_validate_sales` still validate pending invoices opened from the list, after a clerk saves, or from **Sales validation**.
- **Cancel validated invoice** — Users with `cancel_validated_sales` (default: **ADMIN** and **MANAGER**) **and** route **write** on Invoicing or Bottle Oil Sales see **Cancel invoice** on a **validated** invoice. Enter a non-empty reason. The invoice status becomes **REJECTED**, stock is restored via `SALE_REVERSAL` movements dated on the original sale date (so open-month stock reports net correctly), linked delivery-order commitments are released (rejected sales no longer count as lifted), and any linked vehicle consignment note is rejected. A red banner shows who cancelled, when, and why. Cancellation also syncs to the central database when sync is configured.
- **Delete** — **Pending** invoices can be deleted by users with write access on the sales screen. **Validated** or **cancelled** invoices can be permanently deleted only with `delete_validated_sales` (default: **ADMIN**). Deleting a still-validated invoice reverses stock first; deleting an already cancelled invoice does not reverse again.

Cancelled (REJECTED) invoices stay in the booklet serial sequence (no number gap) and are excluded from revenue / validated-sales reports.

## Invoice list

**Sales → Invoicing** and **Sales → Bottle Oil sales** open on the invoice list. Default filter is the **open posting month** (`dateIssued`), not the calendar month on the PC. **Open year** shows the financial year through the report as-at date. Use **All time** when searching an invoice number from another period.

Use **New invoice** (or **New Bottle Oil invoice**) to create a sale in a modal. **Edit** opens a pending invoice; **Open** opens a validated or cancelled invoice (view-only after save). **Print** runs from the list or from the open invoice form.

## Print

Use **Print** on the invoice list, or the print control in the invoice modal after save. Company header comes from app settings (compact header typography on invoice/receipt prints — smaller than management reports). The printout includes a **QR code** encoding the invoice/receipt number, date, customer, net/gross totals, and taxpayer ID when present — scan it to verify those fields against the printed document.

- **Loose sales** — Prints a **sales invoice** (line items, taxes, payments, totals).
- **Bottle Oil sales** — Prints a **cash receipt**: same company header and QR, with receipt wording (“Received from … the sum of … in settlement of … For and on behalf of …”) instead of the invoice line table.

## Vehicle consignment notes

Under **Sales**:

| Screen | Purpose |
|--------|---------|
| **Consignment notes** | Prepare vehicle consignment notes linked to validated sales (lookup by invoice / VCN number, save, print). Allowed for **loose** sales and Bottle Oil **Ration** / **Public relation**; not for **normal** Bottle Oil cash sales. Print opens in the same report-style overlay as analytics reports; each A4 page shows **Original** and **Duplicate** stamped copies of the note. |
| **Consignment validation** | Queue of **pending** consignment notes for supervisors to review and validate (including bulk validate). |

Validation requires the `validate_vehicle_consignment_notes` action (default: ADMIN, MANAGER, SENIOR_SALES_SUPERVISOR; also grantable to custom roles such as junior supervisors). Pending notes appear on the **supervisor Overview** as a queue tile when that role uses the supervisor dashboard.

## Transportation cost

**Sales → Transportation cost** computes transport cost for quantities lifted in the open month (uses **Transport Rates** and the App settings **Moliwe + SCR MAYA** policy). When that policy is on (default), the screen auto-computes for Moliwe / SCR MAYA / Loose Palm Oil and hides **Process cost**; when off, use **Process cost** to choose customer, collection point, and product. Rates and costs include VAT from the current VAT schedule. The printable company-wide view is **Reports → Monthly → Transportation cost**.

Next: [Delivery orders](05-delivery-orders.md). Developer detail for Pick DO: [Domain modules](../developer-guide/05-domain-modules.md).
