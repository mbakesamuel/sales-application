# Getting started

## Install

1. Install the Windows build (**Sales Management Application** Setup) from your IT package, or run from source with `npm run dev` (developers).
2. Launch **Sales Management Application** from the Start menu or desktop shortcut.
3. Sign in with the username and temporary password provided by your administrator. On first login the app asks you to choose a new password before you can continue.

The application stores data locally in a SQLite database on the PC (Electron user data folder by default). IT can point the database at another folder by editing `app.settings.config` next to the installed `.exe` — see [Data backup and restore](11-data-backup-restore.md#optional-custom-database-directory).

## First-run checklist

Before day-to-day sales, an administrator (or manager with access) should confirm:

1. **Financial year** — Open the correct year (**General Parameters → Financial year**).
2. **Financial month** — Open the current calendar month (**General Parameters → Financial month**). Posting into a closed month is blocked.
3. **App settings** — Company registry (name / department for headers) and policy options (numbering, Bottle Oil, loose sales, transfers, etc.).
4. **Collection points and storage** — At least one **Collection point** with **Locations Assignment** (including **Sales tank** locations for loose Palm Oil POS).
5. **Payment Options** — Cash for Bottle Oil; at least one non-cash method (cheque / traite / bank transfer) for loose sales.
6. **Tax Rate Schedule** — Date-effective VAT rates (and **Tax Regime** as needed).
7. **Products and prices** — Products in the right categories, with unit price schedules where needed.
8. **Customers** — Customer accounts with customer types (types drive loose-oil report rows such as Industries / Wholesale / Retail).
9. **Users and permissions** — **Manage Users** / **Manage roles** / **Role permissions** so clerks can sell but only authorized roles can validate.
10. **Document booklets** (if booklet validation is enforced in App settings) — Issue and validate invoice / DO booklets under **Sales → Document booklets** and **Booklet validation**.
11. **Data backup** / **Data sync** (ADMIN) — Confirm backup path and sync settings if used on this PC.

## Login and roles

Access to each sidebar screen depends on your **role**. Action rights (for example validating a sale) are separate from merely opening the Sales screen. See [Users and permissions](09-users-permissions.md).

## Daily rhythm (typical)

1. Confirm the open financial month (**General Parameters → Financial month**).
2. Enter or validate delivery orders (**Delivery Order**); supervisors use the **Validation queue** tab.
3. Create invoices (**Sales → Invoicing** / **Bottle Oil sales**); supervisors clear **Sales → Sales validation**.
4. Post stock under **Stock** (receipts / transfers / adjustments); Store Keepers clear **Receive transfers**; supervisors use **Stock validation**.
5. Print or export weekly reports at week end.

Next: [Organization setup](02-organization-setup.md).
