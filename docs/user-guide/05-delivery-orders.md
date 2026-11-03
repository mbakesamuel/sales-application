# Delivery orders

Sidebar section: **Delivery Order**.

| Sidebar item | Purpose |
|--------------|---------|
| **Register Commitments** | Opening / carried-forward customer commitments (CF DOs) |
| **Delivery Order** | **DO list** (default), create/edit modal, **Validation queue** |
| **DO tracking** | Lookup by number: ordered / lifted / remaining, lifts, transfers |
| **Transfer DO balance** | Move remaining commitment to another collection point |

## Delivery Order workspace

Screen: **Delivery Order → Delivery Order**.

Delivery orders (DOs) record customer commitments by product and collection point. After validation, remaining quantities can be drawn down on sales invoices (**Sales → Invoicing → Pick DO**).

The workspace defaults to **DO list**. Create or edit a DO from **New delivery order** or by opening a list row — both open the form in a modal. **Validation queue** remains a second tab for supervisors.

### Typical lifecycle

1. From **DO list**, click **New delivery order** (or open an existing row). In the modal, enter the **Booklet serial no.** (unless App settings auto-generate DO numbers), customer, collection point, date, lines (qty / price), payments as required.
2. Save (pending). Close the modal when finished; the list refreshes.
3. An authorized user **validates** the DO (`validate_delivery_orders` permission) — from the DO modal or the **Validation queue**.
4. Sales clerks pick remaining balances on **Sales → Invoicing**.
5. Optional: cancel a validated DO if you have `cancel_validated_delivery_order`.

Pending DOs do **not** appear in Pick DO. Only **validated** DOs with remaining kg are listed.

Products flagged **Exclude from delivery orders** (for example sludge oil and palm kernel) do not appear in the Delivery Order product list and cannot be posted on new DO lines. Toggle the flag under **Products**.

### DO tracking

Screen: **Delivery Order → DO tracking**.

Look up a delivery order by booklet / DO / CF / DT number to see:

1. **Header** — status, customer, collection point, date, and summary chips for **Ordered**, **Lifted**, and **Remaining** kg (readable in light and dark app themes).
2. **Commitment by product** — ordered, lifted, remaining, and % lifted per product.
3. **Lift history** — pending and validated sales invoices linked to that DO, with line quantities.

Use **Open in Delivery ordering** to jump to **DO list** and open the create/edit modal for that number. Use **Print tracking report** to preview and print a **Delivery Order Tracking Report** (commitment by product, lift history, transfers out) with the company report header. Pick DO still only offers **validated** DOs; tracking shows any DO status and linked sales.

### Transfer DO balance

Screen: **Delivery Order → Transfer DO balance**.

When a collection point is short of stock but another point can fulfil the remaining commitment, authorized users (action `transfer_delivery_order_balance`) can move **remaining** kg per product from a **validated** source DO to a different collection point.

**What happens**

1. Look up the source DO and enter transfer kg per product (up to remaining).
2. Choose the destination collection point.
3. On confirm, the source DO’s `orderQty` is reduced by the transferred amounts, and the app creates a new **validated** DO at the destination with number `DT-{year}-{seq}` (`sourceKind = TRANSFER`), linked back to the source.
4. Pick DO at the destination collection point then lists the new DO for that customer.

This moves **commitment only** — it does not move physical stock. Use **Stock** transfers separately if goods must move.

DO tracking shows **Transferred from** on destination DOs and a **Transfers out** section on source DOs.

### Print

On a saved delivery order, use **Print delivery order** to preview and print a **Delivery Order Report**. The printout uses the company report header (compact typography on DO and DO-tracking prints — smaller than management reports) and includes order number, order date, customer (with address/phone when on file), collection point, line items, tax totals, payments, and Authorized By / Received By signature lines. There is no separate customer delivery date on the report. A **QR code** (top right) encodes the delivery order number, date, customer, collection point, and net/gross totals (plus taxpayer ID when present) so those fields can be verified against the printed report.

### Booklet serial number

When **App settings → Delivery order numbering → Auto-generate delivery order numbers** is **off**, new delivery orders require a **Booklet serial no.** typed from the physical booklet:

- Digits only (no letters or punctuation).
- At most 20 digits.
- Must be unique among delivery orders (duplicates are rejected).
- Immutable after save.
- When **Enforce booklet validation** is on, the serial must belong to an **ACTIVE** Delivery-order booklet for the collection point (**Sales → Document booklets**).
- Older DOs that still use legacy `DO-…` numbers remain loadable for lookup and printing.

When auto-generate is **on**, the system assigns `DO-year-######` on save. **Carry-forward** and **transfer** DO numbers stay system-assigned (`CF-…` / `DT-…`).

### DO list

**DO list** is the default Delivery Order view and defaults to the **open posting month** (`dateIssued`). **Open year** covers the financial year through as-at; **All time** is for looking up a DO number outside the open period. Use **New delivery order**, or a row action — **Edit** (pencil) when **PENDING**, **Open** (eye) when **VALIDATED** — to work in the modal form.

### Validation queue

Tab: **Validation queue** (visible when your role has `validate_delivery_orders`).

Shows pending delivery orders ready for validation. You can select multiple rows and **validate** them in bulk. Use this when a supervisor clears a backlog of clerk-entered DOs.

## Register Commitments (carry-forward)

Screen: **Delivery Order → Register Commitments** (`carry-forward-commitments`). On-screen title: **Carry-forward commitments**.

Use this to enter **opening / carried-forward** customer commitments that should appear on commitment reports and be sellable via Pick DO.

**How it is stored**

- Each outstanding original DO becomes **its own** carry-forward delivery order (`sourceKind = CARRY_FORWARD`) with a system number `CF-{year}-{seq}`.
- You must enter the **original paper/booklet DO number** on every new line (digits only). The same original number cannot be registered twice on open CF commitments.
- The same customer may have **multiple** CF DOs at the **same** collection point (and product) when they had several outstanding originals — do not sum them into one bulk figure.
- Batch entry is scoped by **collection point + product**; add one line per original DO (customer + original DO # + outstanding kg).
- Adjusting outstanding qty updates that CF line while respecting quantities already sold against its `CF-…` number. Legacy CF rows without an original DO # remain visible as “—” until edited.

**Clerk submit / supervisor validate:** Users without delivery-order validation access (for example **Statistics clerk**) save CF commitments as **pending** delivery orders. They do not appear on commitment reports or Pick DO until a supervisor validates them on **Delivery Order → Validation queue**. Supervisors and managers with **Validate delivery orders** still save them as **validated** immediately when they enter data themselves. If a clerk edits an already validated CF line, the DO returns to **pending** until re-validated.

**Dating:** The CF DO gets a **`dateIssued`** when first created (today within the open month, or month end). Commitment reports only include **validated** DOs with `dateIssued` on or before the report as-at date — so CF posted in July does not appear when January is open for reprinting. Pick DO always shows **live** remaining qty on validated CF lines.

On **Sales → Invoicing → Pick DO**, these rows show with a **CF** marker, the **original DO #** when recorded, and remaining kg **per product** — so clerks can choose among multiple outstanding originals for the same customer.

Next: [Inventory and stock](06-inventory-stock.md).
