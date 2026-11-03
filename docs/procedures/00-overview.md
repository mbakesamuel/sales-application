# Operations procedures — overview

This booklet is a **click-path** manual for day-to-day work in **Stock**, **Delivery Order**, and **Sales**. Each procedure lists the sidebar path, who usually does it, prerequisites, numbered steps, and how to check success.

For concepts, permissions, and report theory, use the [User guide](../user-guide/00-overview.md). This booklet does not replace Role permissions training.

## How to read a procedure

| Field | Meaning |
|-------|---------|
| **Path** | Exact sidebar navigation (labels match the app today) |
| **Who** | Typical role(s); your site may grant the same screens to other roles |
| **Before you start** | Must be true, or the save will fail |
| **Check** | What you should see when the procedure worked |
| **If it fails** | Common causes; see also [Troubleshooting](../user-guide/10-troubleshooting.md) |

Procedure IDs (`P-ST-01`, `P-DO-02`, `P-SA-03`, …) are for training checklists and support tickets.

## Rules that apply everywhere

1. **Open financial month** — Almost all posting (sales, DOs, stock) requires **General Parameters → Financial year** and **Financial month** to be open. Document dates must fall in that month.
2. **Pending vs validated / draft vs posted** — Clerks often **save pending** or **draft**. Supervisors **validate** or **post**. Reports and Pick DO usually ignore pending/draft documents.
3. **Collection point** — Same idea as “sales point” on some older screens; pick the outlet where stock or the sale belongs.
4. **Booklets (optional)** — If **App settings** enforce booklet validation, issue and activate booklets (**P-SA-01**, **P-SA-02**) before clerks enter serial numbers on invoices or DOs. If auto-generate invoice/DO numbers is on, booklet serial entry is not required.

## Suggested end-to-end order (first week / go-live)

Use this order when setting up a site or training a mixed cohort:

1. Confirm open month and master data (collection points, locations, products, payment options) — [Getting started](../user-guide/01-getting-started.md).
2. **P-SA-01 / P-SA-02** — Document booklets (if serial enforcement is on).
3. **P-ST-01** — Opening Stock balances (and **P-ST-09** if clerks submit drafts).
4. **P-DO-01** — Register Commitments (opening DO balances), then validate if needed.
5. **P-DO-02 / P-DO-04** — Create and validate a delivery order.
6. **P-ST-03** — Post a stock receipt (so sellable stock exists).
7. **P-SA-03 / P-SA-06** — Create a loose invoice with Pick DO; validate the sale.
8. **P-SA-07** — Bottle Oil sale (store keeper path) as needed.
9. **P-ST-04 / P-ST-08** — Transfer and receive (multi-site stock) as needed.
10. **P-SA-08 / P-SA-09** — Consignment notes when your site uses them.

## Chapters in this booklet

| Chapter | Sidebar section | Contents |
|---------|-----------------|----------|
| [01 — Stock](01-stock.md) | **Stock** | Opening balances, hub tabs, Bottle Stock, receive, validation |
| [02 — Delivery orders](02-delivery-orders.md) | **Delivery Order** | Commitments, create/list/validate, tracking, transfer balance |
| [03 — Sales](03-sales.md) | **Sales** | Booklets, invoicing, Bottle Oil, validation, consignments, transport cost |

## Roles (quick map)

| Role | Typical procedures here |
|------|-------------------------|
| **Statistics clerk** | Opening stock/commitments (draft), stock receipts/transfers, DO create |
| **Store Keeper** | Bottle Stock, Bin card, Receive transfers, Bottle Oil sales |
| **Supervisor / Manager** | Validation queues (stock, DO, sales, booklets, consignments) |
| **ADMIN** | Settings that unlock procedures (booklets, auto-number, transfer policy) |
