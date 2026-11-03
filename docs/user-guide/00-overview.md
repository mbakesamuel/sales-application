# User guide — overview

**Sales Management Application** is a Windows desktop app for palm-oil commercial sales and inventory. It covers master data, delivery orders, sales invoices, stock, budgets, and printable management reports.

The window title bar, Windows installer, and Start Menu / desktop shortcuts are labelled **Sales Management Application**.

## Who this guide is for

Staff who create invoices, validate delivery orders, post stock, or print weekly/monthly reports. For installers and code structure, see the [developer guide](../developer-guide/00-overview.md).

## What you can do

| Area | Typical work |
|------|----------------|
| **General Parameters** | App settings, report signatories, data backup/sync, financial year/month, services, collection points, storage, payment options, tax, transport rates |
| **Customers** | Customers and **Customer Types** |
| **Products** | Catalog, **Product Categories**, **Product Unit Prices** |
| **Sales Budget** | **12 Months Phasing** (annual qty / price / monthly %); crosstab views under Reports |
| **Stock** | Opening Stock balances, **Stock**, **Bottle Stock**, **Receive transfers**, **Stock validation** |
| **Delivery Order** | **Register Commitments**, **Delivery Order** (create / list / validation queue), **DO tracking**, **Transfer DO balance** |
| **Sales** | **Invoicing**, **Bottle Oil sales**, **Sales validation**, **Document booklets**, **Booklet validation**, **Consignment notes** / **Consignment validation**, **Transportation cost** |
| **Reports** | Daily / Weekly / Monthly / Annual printable overlays (see [Reports](08-reports.md) for sidebar names) |
| **Users & access** | **Manage Users**, **Manage roles**, **Role permissions** |
| **Overview** | Role-based home dashboard (commercial, Store Keeper, or supervisor) |

## Overview dashboard

The **Overview** sidebar item opens a dashboard that depends on your role:

| Role | Dashboard |
|------|-----------|
| **Admin / Manager / Statistics clerk** (and similar) | **Commercial** — daily revenue line, sales by category pie, DO kg vs sales kg by month |
| **Store Keeper** | **Bottle Oil** — open-month Bottle Oil revenue, sales by product, Bottle Oil units by month, invoice counts, bottled stock on hand, **Pending receive** tile (dispatched transfers → **Receive transfers**) |
| **Senior sales supervisor** / **Junior sales supervisor** (`JNR_SALES_SUP`) | **Supervisor** — queue tiles (**Pending sales** → Sales validation, **Pending stock** → Stock validation, **Pending consignment** → Consignment validation), revenue + sales by product charts, loose and bottled stock tables |

Totals use **validated** sales where charts show revenue. If no financial month is open, the dashboard asks you to open one. Use **Refresh** after posting new sales. Queue tiles navigate to the matching validation screen.

## Important concepts

- **Financial year / month** — Most posting (sales, stock, DOs) requires an **open** financial year and month. Close periods when the month is complete.
- **Validated vs pending** — Sales, delivery orders, booklets, consignments, and many stock documents often start as pending and must be **validated** before they affect reports and balances the way management expects.
- **Product categories** — Flags on categories (`isMain`, `isBottled`) control how products appear on reports (loose palm oil vs bottled vs other/PKO). See [Customers and products](03-customers-products.md).
- **Delivery order (DO)** — Customer commitment that can be drawn down on sales invoices. Carry-forward commitments are entered on **Register Commitments** and stored as special DOs. Statistics clerks see submitted CF lines in **Awaiting validation** until a supervisor validates them on **Delivery Order → Validation queue**.
- **Booklets** — When App settings enforce booklet validation, invoice and DO serials must come from an **ACTIVE** booklet issued to the collection point (**Sales → Document booklets** / **Booklet validation**).

## Suggested reading order

1. [Getting started](01-getting-started.md)
2. [Organization setup](02-organization-setup.md) (first-time sites)
3. [Sales invoices](04-sales-invoices.md) and [Delivery orders](05-delivery-orders.md)
4. [Inventory and stock](06-inventory-stock.md)
5. [Reports](08-reports.md)

If something does not appear as expected (especially on reports), see [Troubleshooting](10-troubleshooting.md).
