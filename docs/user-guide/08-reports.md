# Reports

Sidebar section: **Reports**, grouped as **Daily**, **Weekly**, **Monthly**, and **Annual**. Printable report screens open in an **in-app overlay** (dimmed backdrop over the main window) with **Print** and **Save PDF**; close the overlay to return to the app. Use **Open report** on the placeholder if you closed the overlay. Most reports use company header settings and an **as-at** date of the earlier of **today** and the **open financial month’s end** (so reopening January prints as at 31 Jan). Stock quantities on stock / stock-summary / bottle-stock sections are rebuilt from movements through that as-at date. **Commitment** outstanding (**Commitments** report and Stock Summary commitment column) uses validated DOs and linked sales with `dateIssued` on or before as-at — not today’s live Pick DO balances. Several support **Comments** (toolbar) — company-wide text shown above the footer when non-empty.

**Report settings** (General Parameters) manages the **report signatory** history (name + title + effective-from date). Printed footers use the latest entry whose effective date is on or before the report’s as-at date. **Hide zero / empty quantity rows** is a per-report toggle on screens that support it (stored on the PC), not a General Parameters switch.

Names below match the **Reports** sidebar.

## Report catalog

### Daily

| Sidebar | Purpose |
|---------|---------|
| **Sales Summary** | Validated sales for a chosen date (and optional collection point): by product with DO no., vehicle, qty, DO balance; customer-type summary; print / CSV / comments. |
| **Day to Day Sales Details** | Open-month day-by-day matrix of validated sales kg by customer category (Industry, Wholesale, Retail, Staff/Worker, Pub. relation) plus transfer-out column; optional collection point and product filters. |

### Weekly

| Sidebar | Purpose |
|---------|---------|
| **Quantity Phasing** | Budget kg crosstab (ISO week × group × month). See [Sales budgets](07-sales-budgets.md). |
| **Revenue Phasing** | Budget revenue crosstab (ISO week × group × month). |
| **Stock Summary** | Combined stock and commitment view for management. |
| **Stock** | Stock by collection point / storage layout. Non-bottled sections (Palm Oil, PKO, Palm Kernel, PKC) share a common quantity-column grid; **Bottled Palm Oil** appears last with its own pack matrix. |
| **Commitments** | Outstanding validated DO balances by customer / collection point (**as of** report as-at). One row per customer per product category (customer name only). |
| **Bottle Stock** | Bottled stock matrix and sales by pack. |
| **Bottle Sales** | Bottled issues for a chosen week in the open month (Mon–Fri detail; estimate basis options). |
| **Sales/Delivery By Product** | Weekly loose + bottled + other/PKO deliveries (week picker). |

### Monthly

| Sidebar | Purpose |
|---------|---------|
| **12-MTH Quantity Phasing** | Monthly budget kg crosstab. See [Sales budgets](07-sales-budgets.md). |
| **12-MTH Revenue Phasing** | Monthly budget revenue crosstab. |
| **Delivery By Product/Cust Category (Jan–Jun)** | Half-year delivery report H1. |
| **Delivery By Product/Cust Category (Jul–Dec)** | Half-year delivery report H2. |
| **Stock Summary** | Company-total loose palm oil opening, reception, issues, calculated stock for the month and fiscal YTD (all collection points). *Different report from Weekly → Stock Summary.* |
| **Stock Reconciliation** | Open-month LPO opening (prior balance + **Opening Stock / carry-forward** backlog) / reception / issues / calculated stock, plus BPO and palm-kernel rows by collection point. |
| **Sales/Delivery LPO** | Open-month weekly breakdown: **Payments** = bottled oil kg + value; **Deliveries** = other products kg + value (sales without taxes). |
| **Transportation cost** | Open-month transportation cost for customers by collection point and product (policy from App settings). |
| **Deliveries By Cust. Cat** | Open-month weekly non-bottled deliveries (kg) by destination buckets. |
| **Monthly Sales - LPO** | Full-year LPO by destination (incl. Makoko) and BPO in tons and '000 FRS (taxes excluded). |
| **Sales/Deliveries - Other Prod.** | Open-month non-LPO / non-bottled sales by collection point and product. |
| **Industry Product Monthly sales** | Full-year Industry sales by collection point for each non-LPO / non-bottled product. |
| **Bottled Palm Oil Stock Reconciliation** | Open-month bottled B/F, receptions, cash/PR issues, and balance by pack. |
| **BPO Issued to GM's PR** | Open-month Bottle Oil **Ration** and **Public relation** sales by invoice. |
| **Revenue & taxes** | Validated invoice **net**, **VAT**, **sales tax**, and **gross** for the open month or FY to date. |

### Annual

| Sidebar | Purpose |
|---------|---------|
| **Palm Oil Sales Activity** | Full calendar year through as-at: validated loose + bottled palm oil sales by customer category in tons and tax-excluded value ('000 FRS); **LOOSE OIL** and **LOOSE AND BTLD OIL** sections with TODATE and %TAGE; average selling price and budget price rows. Prints **A4 landscape**. |

## Sales Summary (daily)

- Includes only **validated** sales on the selected **report date**.
- Optional **collection point** filter.
- Lines grouped by product; each line can show DO number, vehicle, quantity, and remaining DO balance where linked.
- Customer-type summary block at the end.
- Supports print, CSV export, and report comments.

## Day to Day Sales Details

- **Open financial month** only (through report as-at).
- One row per calendar day; columns: Industry, Whole sale, Retail, Staff/Worker, Pub. relation, Transfer (transfer-out kg), Total.
- Optional **collection point** and **product** filters (default: all).
- Validated sales only; customer category from customer type (and ration disposition → Staff/Worker); Public relation disposition → Pub. relation column.
- Print / CSV / comments.

## Sales/Delivery By Product (weekly)

- Includes only **validated** sales in the selected week.
- **Week picker** — choose any week that overlaps the **open financial month**, capped at as-at. Local calendar dates are used (no UTC day shift).
- **1) Loose palm oil** — products in **main** categories, totals by customer-type bucket × collection point (not by customer name).
- **2) Bottled palm oil** — bottled packs (column order includes 1×15L, 3×5L, 1×20L jug).
- **3) Other products / PKO** — non-main, non-bottled products (e.g. Palm Kernel Oil) as named kg rows.

If a PKO sale is “missing”, open the correct week and scroll to section 3 — customer names are not printed on this report.

## Monthly Stock Summary (loose LPO)

- Open financial month only (through report as-at).
- Memo routing: **From** MPOS **TO** COMMERCIAL DIRECTOR (report date).
- Company totals (all collection points): opening stock, add reception, total stock, less issues to customers, calculated stock.
- **THIS MONTH** = flows in the open month; **TO DATE N MONTH** = fiscal year-to-date through as-at (N = fiscal month index).
- Physical stock, stock variance, and % variance are blank (—), same as stock reconciliation v1.
- Public relation sales are **not** included (loose LPO issues only).
- Print / PDF window / CSV / comments.

## Bottle Sales

- Same **open-month week picker** as Sales/Delivery By Product (Mon–Fri day columns for the selected week).
- Month / YTD / prior-month comparison blocks still use the report **as-at** date.
- **Week ESTM** basis (working days vs ISO week) affects the budget estimate share only.

## Sales/Delivery LPO

- Open financial month only (through report as-at).
- One row per calendar week (Mon–Sun clipped to the month).
- **Payments** = validated bottled-oil sales (kg + line net FCFA).
- **Deliveries** = validated sales of all other (non-bottled) products (kg + line net FCFA).
- Banner: sales without taxes; TOTAL row; print / CSV / comments.

## Deliveries By Cust. Cat

- Open financial month only (through report as-at).
- One row per calendar week (Mon–Sun clipped to the month).
- Validated **non-bottled** sales only (kg).
- Columns: Industries, Wholesales, Retail, CDC Workers, Makoko Farms, Total — matched from customer name and customer type (and ration disposition → CDC Workers).
- Footer: column totals and **TOTAL %** of the grand total; print / CSV / comments.

## Monthly Sales - LPO

- Full **calendar financial year** through report as-at.
- **LPO** (main non-bottled) sales by destination — customer name and type; Makoko Farms supported.
- **BPO** bottled aggregate in tons and tax-excluded value ('000 FRS).
- Two half-year tables: **Jan–Jul** and **Aug–Dec + TOTAL**.

## Revenue & taxes

- Validated invoices by **date issued** through as-at.
- Filter: **open month** or **FY to date**; optional **collection point**.
- Summary row: invoice count, net, VAT, sales tax, gross (all tax-excluded net where noted).
- Breakdown tables: by day or month, and by collection point.
- Print / CSV / comments.

## Industry Product Monthly sales

- Full calendar FY through as-at; **Industry** customers only.
- One section per non-LPO / non-bottled product with collection-point rows + TOTAL.
- Tons and tax-excluded value ('000 FRS); **Jan–Jul** and **Aug–Dec + TODATE**.

## Bottled Palm Oil Stock Reconciliation

- **Open month** only (through as-at).
- Opening B/F (prior balance + in-month carry-forward), receptions by supplier, **Cash Sales** and **GM's Public Relations** issues, closing balance.
- Pack columns (20L, 3×5L, 1×15L) in units, kg (0 dp), and value without taxes.

## BPO Issued to GM's PR

- Open-month **validated** Bottle Oil **Ration** and **Public relation** sales only.
- One row per invoice: date, customer, address, pack qty (1x20L / 3x5L / 1x15L), received by, amount (gross), VEH. C. NO (consignment note when present).
- Usual report header and signatory footer; print / CSV / comments.

## Sales/Deliveries - Other Prod.

- **Open month** only; non-LPO / non-bottled products.
- Rows grouped by collection point × product; **DELIVERIES** kg + F.CFA (tax excluded); **PAYMENTS** columns blank.
- **SUBTOTAL** per collection point and **GRAND TOTAL**.

## Transportation cost (monthly)

- Open-month transportation cost by collection point / product / customer (uses **Transport Rates**).
- Subject to **App settings → Transportation cost → Moliwe + SCR MAYA transport cost policy** when that option is on.
- Related compute screen: **Sales → Transportation cost**.

## Stock (weekly)

Section order: **Palm Oil** (main loose) → **Palm Kernel Oil** → **Palm Kernel** (cracked / uncracked) → **Palm Kernel Cake** → **Bottled Palm Oil** (last).

Non-bottled sections share Palm Oil’s four-column grid (Collection point | Storage or cracked | Qty or uncracked | Remarks). Palm Kernel uses cracked and uncracked in the storage and qty columns; PKC quantity aligns with the Palm Oil qty column. Bottled keeps its own pack matrix and is not aligned to that grid.

Quantities come from stock movements through report as-at. Cancelling a validated sale posts a `SALE_REVERSAL` dated on the **original sale date**, so stock returns in that open month’s report (not only after the cancel day).

**Print / PDF:** Uses a **compact page layout** (2mm top and bottom margins, 8mm left/right) so more rows fit on each A4 page. The report header is tightened in print mode; on-screen preview keeps normal spacing.

## Commitments (weekly)

Outstanding validated DO balances by customer and collection point (**as of** report as-at).

- **One row per customer** within each product-category section (main palm oil and other products alike). Row labels show the **customer name only** (no product name in brackets). Quantities at each collection point are that customer’s outstanding kg summed for products in that category.
- The header row (`CUSTOMER` | collection points | `TOTAL`), category sections, and grand total share **one table** so quantity columns line up under the headers.
- Rejected / cancelled sales do not reduce DO remaining balance (they are excluded from lifted qty).
- **Print / PDF** uses the same **compact page layout** as the Stock report (2mm top/bottom margins).

## Palm Oil Sales Activity (annual)

- Full **calendar financial year** through report as-at.
- Two matrix sections: **LOOSE OIL** (Industry, Wholesale, Retail, Others + total) and **LOOSE AND BTLD OIL** (BPO + same categories + total).
- Per month (through current month): **TONS** and **FCFA** ('000 FRS, taxes excluded); **TODATE** and **%TAGE** columns.
- Footer rows: **AV. S. PRICE** (average selling price) and **BUDG.** (budget unit price from sales budget, with % of budget achieved).
- Current month column is labelled **AS AT {day} {Mon}. {year}** (partial month).
- Print / Save PDF use **A4 landscape**; CSV / comments supported.

## Report comments

Each report route can store its own comments (shared for the company). Empty comments hide the section. Stock & commitment legacy comments were migrated into the shared map.

## Print

Use **Print** on each screen. Print CSS hides toolbars (`no-print`) and applies shared report styling:

- Body class **`scr-print-mode`** during print (no per-report portrait/landscape body hacks on the newer monthly reports).
- Document chrome: **`scr-page`** / **`scr-document`** / **`scr-table`**; total rows use **`scr-row-total`**.
- Landscape is still used where needed (e.g. some monthly delivery layouts, **Palm Oil Sales Activity**, and the **weekly** Quantity / Revenue Phasing crosstabs).
- **Stock** and **Commitments** use a named print page with **2mm top and bottom** margins (8mm left/right) plus a tighter print header so more table rows fit per page. Other reports keep the default **8mm** margin on all sides.

Management report headers use the standard `ReportHeader` sizes. **Sales invoice**, **cash receipt**, **delivery order**, and **DO tracking** prints use a **compact header** (smaller company name and title) so more room remains for line items.

The **bin card report** is opened from **Stock → Bottle Stock → Bin card → Open report** (not from the Reports sidebar). It opens in **A4 portrait**; use Print or Save from that window like other report routes. Roles with Bottle Stock or bin card access (including **Store Keeper**) can open it.

Next: [Users and permissions](09-users-permissions.md). Technical notes: [Reports engine](../developer-guide/06-reports-engine.md).
