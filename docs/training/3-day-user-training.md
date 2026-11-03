# Three-Day Training Schedule — Sales Management Application

**Audience:** Mixed cohort (sales clerks, supervisors, store keepers, statistics clerks, admin/manager).

**Format:** ~6 contact hours per day (09:00–12:00, 13:00–16:00), alternating **demo → guided lab → Q&A**.

**Materials:** Exported user guide and [operations procedures](../procedures/00-overview.md) (`npm run docs:export`) or [user guide chapters](../user-guide/00-overview.md); training database with open financial month and sample customers/products.

**Not covered in depth (reference only):** Sales budget phasing/crosstabs, DO balance transfer, PKCP/PKP edge cases, IT backup scripting, developer guide.

---

## Day 1 — Foundation, Setup & Master Data

**Goal:** Everyone can log in, understand the open month rule, navigate the app, and maintain customers/products.

| Time | Module | Content | Hands-on | Doc reference |
|------|--------|---------|----------|---------------|
| 09:00–09:45 | **Intro & concepts** | App purpose; sidebar areas; **Overview dashboard** by role; **validated vs pending**; **financial year/month** (posting gate) | Login; confirm open month; tour sidebar | [Overview](../user-guide/00-overview.md), [Getting started](../user-guide/01-getting-started.md) |
| 09:45–10:30 | **Organization setup** (admin/manager lead; others observe) | App settings (company header, Bottle Oil options, lock unit price); **Financial years/months** open/close; collection points (**Sales points**), **Storage locations**, payment methods (Cash for Bottle Oil; cheque/traite/bank for loose); tax regimes/rates (overview) | Admin: open FY + current month; verify one sales point + sellable storage + Cash method | [Organization setup](../user-guide/02-organization-setup.md) |
| 10:45–12:00 | **Customers & types** | Customer wizard (4 steps); customer types → report buckets (Industry, Wholesale, Retail, CDC/Ration) | Each pair: create 2 customers with different types | [Customers and products](../user-guide/03-customers-products.md) |
| 13:00–14:15 | **Products & pricing** | Products & categories; **isMain / isBottled** flags (report sections); **Product unit prices** (effective dates) | Verify LPO/bottled products; add one unit price schedule row | [Customers and products](../user-guide/03-customers-products.md) |
| 14:15–15:30 | **Permissions overview** (admin) + **roles lab** (all) | Default roles (clerk, supervisor, store keeper, statistics clerk); route vs action flags (`validate_sales`, `validate_delivery_orders`) | Clerks: sign in as clerk — note which screens are visible; supervisors: validation queues | [Users and permissions](../user-guide/09-users-permissions.md) |
| 15:30–16:00 | **Day 1 recap** | First-run checklist review; common save failures (closed month, missing payment method) | Quick troubleshooting drill | [Getting started](../user-guide/01-getting-started.md), [Troubleshooting](../user-guide/10-troubleshooting.md) |

**Day 1 outcomes:** Open month confirmed; master data ready; users know their role’s sidebar and validation responsibilities.

---

## Day 2 — Core Operations (DO → Sales → Stock)

**Goal:** End-to-end commercial flow: commitment → lift → stock movement → validation.

**Flow:** Delivery Order → Validate DO → Pick DO on invoice → Sales invoice → Validate sale → Stock movement. Stock receipts also feed stock movements.

| Time | Module | Content | Hands-on | Doc reference |
|------|--------|---------|----------|---------------|
| 09:00–10:15 | **Delivery orders** | Create DO (booklet serial, lines, payments); **Validation queue**; **DO tracking** + print; CF opening commitments (brief) | Clerk: save pending DO; supervisor: validate; track by DO number | [Delivery orders](../user-guide/05-delivery-orders.md) |
| 10:15–11:30 | **Loose sales invoices** | Sales Invoice tabs; booklet serial; registered vs walk-in; **Pick DO** (split by product); payments (cheque/traite/bank — no Cash); stock-as-of invoice date; vehicle number | Create loose invoice against validated DO; save pending | [Sales invoices](../user-guide/04-sales-invoices.md) |
| 11:30–12:00 | **Sales validation** | Pending vs validated; `validate_sales` / `direct_validate_sales`; invoice list filters (open month) | Supervisor: validate clerk’s invoice; clerk: re-open list | [Sales invoices](../user-guide/04-sales-invoices.md), [Users and permissions](../user-guide/09-users-permissions.md) |
| 13:00–14:00 | **Bottle Oil sales** | Separate screen; units; Cash-only normal sales; Ration/PR dispositions (if enabled); print cash receipt vs loose invoice | Store keeper: one Bottle Oil cash sale | [Sales invoices](../user-guide/04-sales-invoices.md), [Organization setup](../user-guide/02-organization-setup.md) |
| 14:00–15:00 | **Consignment notes** (if site uses them) | Prepare note from validated sale; **Consignment validation** queue; supervisor Overview tile | Prepare + validate one consignment note (loose or Ration) | [Sales invoices](../user-guide/04-sales-invoices.md) |
| 15:00–16:00 | **Stock essentials** | Stock hub tabs: **On hand**, **Receipts**, **Movements**; posting dates in open month; location rules (bulk vs bottled); **Opening stock balances** (CF) + validation queue (brief) | Post one receipt; check On hand; statistics clerk demo: draft CF → supervisor validates | [Inventory and stock](../user-guide/06-inventory-stock.md) |

**Day 2 outcomes:** One full cycle completed: DO → validated sale → stock deducted; Bottle Oil path understood; stock receipt posted.

**Role callouts:**

- **Store keeper:** Bottle Oil + receive transfers (mention only; detail if time).
- **Statistics clerk:** CF stock/commitments submit; no validate actions by default.
- **Supervisors:** All validation queues (DO, sales, consignment, stock).

---

## Day 3 — Reports, Month-End & Admin Wrap-Up

**Goal:** Run essential management reports, understand as-at dating, close the month confidently.

| Time | Module | Content | Hands-on | Doc reference |
|------|--------|---------|----------|---------------|
| 09:00–09:30 | **Report concepts** | In-app overlay; Print / PDF / CSV; **as-at date** (min of today & month end); validated-only data; **Report settings** (hide zeros, signatory) | Open Report settings; set signatory | [Reports](../user-guide/08-reports.md), [Organization setup](../user-guide/02-organization-setup.md) |
| 09:30–10:30 | **Daily & weekly reports** | **Daily sales report** (date + optional point); **Daily sales matrix**; **Stock report** + **Commitment report**; **Sales/delivery report** (week picker, 3 sections: LPO / bottled / other-PKO) | Print daily sales for today; pick correct week on sales/delivery | [Reports](../user-guide/08-reports.md) |
| 10:45–12:00 | **Monthly reports (core set)** | **Monthly stock reconciliation**; **Loose LPO stock summary**; **Monthly Payment/Delivery**; **Revenue & taxes** (overview); **Deliveries by Destination** (optional skim) | Run reconciliation + payment/delivery for open month | [Reports](../user-guide/08-reports.md) |
| 13:00–13:45 | **Bin card & bottle reports** (store keeper focus) | **Bin card** ledger + print; **Bottle oil stock & sales**; bottled weekly issues (mention) | Store keeper: bin card for one bottled SKU | [Inventory and stock](../user-guide/06-inventory-stock.md), [Reports](../user-guide/08-reports.md) |
| 13:45–14:30 | **Month-end rhythm** | Daily checklist: confirm open month → DOs/sales → stock → week-end reports; when to close month; reopening past month for reprint (as-at behaviour) | Walkthrough month-close checklist on whiteboard | [Getting started](../user-guide/01-getting-started.md), [Organization setup](../user-guide/02-organization-setup.md) |
| 14:30–15:15 | **Troubleshooting clinic** | Closed month; pending vs validated on reports; Pick DO empty; wrong report section (category flags); insufficient stock as-of date; zero rows hidden | Fix 3 scripted scenarios from troubleshooting guide | [Troubleshooting](../user-guide/10-troubleshooting.md) |
| 15:15–16:00 | **Admin wrap-up** | **Users** (temp password, first-login change); **Role permissions** matrix; **Data backup** (manual + optional daily schedule) | Admin: create backup; review permission group for one custom role | [Users and permissions](../user-guide/09-users-permissions.md), [Data backup](../user-guide/11-data-backup-restore.md) |

**Day 3 outcomes:** Participants can print the reports their role needs; understand why figures differ from live On-hand; admins can backup and adjust permissions.

---

## Optional / Stretch (if time permits)

| Topic | When | Doc |
|-------|------|-----|
| Sales budget phasing + monthly crosstab | End of Day 3 or post-training | [Sales budgets](../user-guide/07-sales-budgets.md) |
| Transfer DO balance | Day 2 extension for supervisors | [Delivery orders](../user-guide/05-delivery-orders.md) |
| Stock transfers & receive transfers | Day 2 extension for store keeper | [Inventory and stock](../user-guide/06-inventory-stock.md), [Users and permissions](../user-guide/09-users-permissions.md) |
| Palm Oil Sales Activity (annual) | Month-end / finance session | [Reports](../user-guide/08-reports.md) |

---

## Pre-training checklist (trainer)

1. Training PC with app installed; **ADMIN** + sample roles seeded.
2. Open financial year + **current month**.
3. Sample data: 2 sales points, sellable storage, Cash + cheque methods, LPO + bottled products, unit prices, 3+ customers (mixed types), 1 validated DO with balance.
4. Printed quick-reference: open-month rule, validation queues, report as-at rule.
5. Export user guide and this schedule for handouts: `npm run docs:export`.

## Assessment (light)

- **Day 1 quiz:** What blocks posting? What do customer types affect?
- **Day 2 lab sign-off:** Clerk creates pending sale; supervisor validates; stock visible on On hand.
- **Day 3 lab sign-off:** Print daily sales + commitment report; explain one troubleshooting scenario.

---

## Doc map (training vs out-of-scope)

| In scope (basic usage) | Out of scope (this schedule) |
|------------------------|------------------------------|
| User guide §00–06, 08–11 (selected) | Developer guide entirely |
| Core reports (daily, weekly stock/commitment/sales-delivery, key monthly) | Full monthly report catalog |
| Users, roles, backup | Database migrations, IPC, build/packaging |
