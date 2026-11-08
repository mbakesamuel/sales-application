# Inventory and stock

Sidebar section: **Stock**.

| Sidebar item | Purpose |
|--------------|---------|
| **Opening Stock balances** | Opening / carried-forward on-hand quantities |
| **Stock** | Main inventory workspace (loose products) |
| **Bottle Stock** | Bottled-only workspace at Bota (Store Keepers see this remapped as **Stock** when they lack main Stock) |
| **Stock validation** | Validate draft receipts, transfers, adjustments (including carry-forward) |

## Stock hub (**Stock**)

**Stock → Stock** opens the inventory workspace with tabs:

| Tab | Purpose |
|-----|---------|
| **On hand** | Live balances by product and storage location. |
| **Movements** | Ledger of quantity changes. |
| **Receipts** | Goods in. |
| **Transfers** | Move between storage locations / collection points. |
| **Adjustments** | Manual corrections (including carry-forward stock postings tagged as such). |

Users with write on both **Stock** and **Bottle Stock** (for example Statistics clerk) see a **unified** Stock screen that lists loose and bottled products together. Transfer, receipt, and adjustment documents still contain either loose or bottled lines only — not both on one document.

Core ideas:

| Concept | Meaning |
|---------|---------|
| **Stock balance** | On-hand quantity by product and storage location (and collection point). |
| **Stock movement** | Ledger of quantity changes from receipts, transfers, adjustments, sales, etc. |
| **Receipt** | Goods in. |
| **Transfer** | Move between storage locations (and optionally collection points when allowed). |
| **Adjustment** | Manual correction (including carry-forward stock postings tagged as such). |

**Storage location rules:** Bottled products may share a location with other bottled products. Non-bottled (bulk) products may occupy a location with only **one** product at a time. Bottled and bulk stock must **not** share a location. Receipts, transfers in, adjustments, and opening stock that would break these rules are blocked until the conflicting stock is cleared.

All posting dates must fall in the **open financial month**.

## Bottle Stock

**Stock → Bottle Stock** is the bottled-products workspace at **Bota**. Mills deliver bottle products to Bota outside the app; Bota posts stock in via **Reception** (consignment note). Bottle products share one storage location — **transfers are not used** for bottle stock.

| Tab | Purpose |
|-----|---------|
| **Bin card** | Bottled ledger filters (default tab) |
| **Reception** | Consignment goods-in at Bota: mill **Consignment Note #**, consigned-by / received-by signatures, then post to augment on-hand by bottle product type |
| **Adjustments** | Bottled corrections / write-offs |

Reception keeps a system **Receipt #** and a separate mill **Consignment Note #**. Required on save: Consignment Note #, Consigned by, Received by (designations and consignment/receive dates are optional).

**On hand**, **Movements**, and **Transfers** are not shown on Bottle Stock. Store Keepers typically use Bottle Stock only (sidebar label **Stock** when main Stock is hidden).

## Opening Stock balances (carry-forward stock)

Screen: **Stock → Opening Stock balances**.

Enter opening / carried-forward on-hand quantities by choosing a **collection point** and **date**, then adding table rows of **product** and **desired on-hand**. Most products also require a **storage location**.

**Palm Kernel / Cake (category codes PKCP and PKP):** these products do not use storage locations. On the batch form, pick the product only (location shows as **—**). Opening balance is stored at **collection-point level**. Validated sales of those products deduct from that total (no tank on the invoice).

These post as stock adjustments with a carry-forward source kind so movements and reports can distinguish them from ordinary adjustments. Receipts, transfers, and manual adjustments remain unavailable for PKCP/PKP products.

**Clerk submit / supervisor validate:** Users without stock validation access (for example **Statistics clerk**) save opening balances as **draft** carry-forward adjustments. They do not change on-hand balances or reports until a supervisor validates them on **Stock → Stock validation**. Supervisors and managers with **Validate stock documents** still post immediately when they enter data themselves.

Submitted lines appear in **Awaiting validation** on the Opening Stock balances screen until a supervisor posts them; the posted balances table updates only after validation.

**Dating:** Choose a date in the batch form (must fall in the **open financial month**). That date becomes the adjustment / movement `occurredAt`. On the **Stock** report it counts from that date once posted. On **Stock Reconciliation**, posted carry-forward LPO qty in the open month is included in **Opening stock** (one-time backlog), not under Reception.

## Stock validation

Screen: **Stock → Stock validation** (separate sidebar item — not a tab inside Stock).

Supervisors review and validate **draft** stock receipts, transfers, adjustments, and carry-forward opening balances. Requires route access plus action **Validate stock documents**. The supervisor Overview **Pending stock** tile navigates here.

## Bin card

Bin card is for **bottled products only**. How you open it:

| Role / access | How to open |
|---------------|-------------|
| **Store Keeper** / Bottle Stock | **Stock → Bottle Stock** (or remapped **Stock**) → **Bin card** tab (default). |
| Unified Stock users | Use **Bottle Stock** for the Bin card tab (main **Stock** does not show Bin card). |

Pick a **bottled product** (required) plus optional collection point, storage location, condition, and date range. Bulk (non-bottled) products are not available on this screen. The main screen shows a stock-style table:

- Opening balance (movements before the From date)
- Each movement as **In** / **Out** with a running **Balance**
- Closing balance

Use **Open report** to open a printable bin card in the in-app report overlay (**Print** / **Save PDF**). The report opens in **A4 portrait** layout. Store Keepers with Bottle Stock access can open this report; after a permission change, **log out and sign in again**.

Quantities use pack units for bottled products. Movements are limited to the **open financial month** on the main screen date pickers.

## Practical tips

- **Sales tank** (or other) locations must exist under **General Parameters → Locations Assignment** for the collection point used on invoices.
- Do not mix bulk products in one location (e.g. LPO and PKO in one pit tank), and do not mix bottled oil with bulk in the same location; clear the conflicting stock first. Multiple bottled products in one location are allowed.
- After large opening-stock entry, refresh Reports **Stock** / **Stock Summary** to verify (stock report qty is reconstructed as of the report as-at date from movements).
- **Hide zero / empty quantity rows** on a report can hide empty locations; turn that toggle off on the report itself if you need to see zeros.
- Inter-site loose Palm Oil transfers require **App settings → Allow loose Palm Oil transfers between collection points**.

Next: [Sales budgets](07-sales-budgets.md).
