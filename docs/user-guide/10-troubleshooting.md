# Troubleshooting

## Cannot save sale / DO / stock document

- Confirm **Financial year** and **Financial month** are **open** (**General Parameters**).
- Check the document **date** falls inside the open month.
- For sales: payment total must match invoice total (normal dispositions); vehicle number may be required.
- **Bottle Oil** needs an active **Cash** payment method (code or name `CASH`). Loose sales hide Cash — use cheque, traite, or bank transfer.
- For **traite** payments on loose sales: enter trait no #, issued date, and maturity date (and bank when shown).
- For new sales and DOs when auto-generate is **off**: enter a **Booklet serial no.** (digits only, at most 20). Blank, letters, or punctuation are rejected.
- If **Enforce booklet validation** is on: serial must belong to an **ACTIVE** booklet for that collection point (**Sales → Document booklets** / **Booklet validation**). Pending booklets cannot be used.
- If auto-generate is **on**, booklet serial entry is not required (`INV-…` / `DO-…` assigned on save).
- If save says the serial is already used, check the booklet — another invoice or DO already has that number.
- Ensure products, **Payment Options**, and **Locations Assignment** exist.
- **Insufficient stock as of …** — Sellable qty on that **invoice date** (from receipts/CF/movements through the date) is short at the chosen location. Change the date, reduce qty, or post stock dated on or before the invoice date. Today’s balance alone is not enough if stock arrived later.

## Sale or DO does not appear on reports

- Report filters usually require **validated** status — pending documents are excluded. Check **Sales → Sales validation** or **Delivery Order → Validation queue**.
- Confirm the report **as-at / week / half** covers the document date.
- On **Sales/Delivery By Product**, use the **week picker** for the week that contains the sale date.
- PKO / kernel products appear under **3) Other products / PKO**, not under loose palm oil, and **without customer names**.

## Stock report shows unexpected qty (or missing CF)

- Reports → Weekly → **Stock** qty is **as of the open month’s as-at** (earlier of today and month end), from movements — not the live On-hand tab under **Stock → Stock**.
- Carry-forward / receipts only count from their **posting date**. CF posted in July does not appear when January is open.
- Inventory **On hand** always shows current live balance; that is expected.
- **Section order** on the Stock report is Palm Oil → PKO → Palm Kernel → PKC → Bottled (last). Non-bottled qty columns align to Palm Oil’s grid; bottled uses its own pack matrix.
- After cancelling a validated sale, stock should return in the **sale’s open month**. Reversals are dated on the original sale date (not the cancel day), so they appear when that month is still open.

## Transfer dispatched but stock not at destination

- Inter-site transfers must be **received** on **Stock → Receive transfers** (Store Keeper **Pending receive** tile). Dispatch alone does not put stock on hand at the destination.
- Check App settings **Use receive date for stock posting** if the receive date vs confirm time matters for reports.

## Commitment report shows unexpected outstanding

- Outstanding is **as of report as-at**: DOs and draw-down sales with `dateIssued` on or before that date. **Rejected / cancelled** sales do not count as lifted.
- One **customer name** per row (no `[PRODUCT]` suffix). Collection-point columns share one table with the header so quantities align.
- CF commitments only appear from their DO **`dateIssued`**. Pick DO always shows live remaining (not frozen by month).
- Later edits to CF line `orderQty` are not historical — reports use the current ordered qty minus sales through as-at.

## Pick DO is empty or missing a DO

- Customer and collection point must be selected (list is filtered to both).
- DO must be **validated**.
- Remaining balance must be greater than zero (fully sold DOs are omitted).
- Carry-forward commitments appear as **CF** rows — one CF DO per original outstanding DO (with original DO #), not a bulk total per customer (**Register Commitments**).

## Pick DO did not add lines

- Pick DO / Lookup **link** the delivery order; Pick opens **Add line** with the selected product prefilled. Confirm and save the line (or use **Add line** manually).

## Wrong report section for a product

- Check the product’s **Product Categories** flags: **Main** vs **Bottled** vs neither ([Customers and products](03-customers-products.md)).

## Zero rows missing on a report

- The report’s **Hide zero / empty quantity rows** toggle may be on. Disable it on that report to show empty rows.

## Permission denied / menu item missing

- Your role’s **route access** may be `none` or `read`. Sidebar names (**Invoicing**, **Bottle Stock**, …) may differ from Role permissions labels — ask admin to grant the matching route id.
- Validation and cancel buttons need **action** permissions **and** (for cancel/delete) route **write** on Invoicing / Bottle Oil Sales. Read-only sales plus `cancel_validated_sales` still shows “You do not have permission to modify this module.” Ask an admin to adjust **Role permissions**.
- **Consignment validation** needs route `vehicle-consignment-validation` plus action `validate_vehicle_consignment_notes`.
- **Booklet validation** needs route `booklet-validation` plus `validate_document_booklets`.
- **Stock validation** / **Receive transfers** / **Sales validation** are separate Stock / Sales sidebar routes — grant those explicitly for Overview queue tiles to navigate usefully.

## Overview looks wrong for my role

- Store Keepers see the Bottle Oil dashboard (including **Pending receive**); senior/junior sales supervisors see the supervisor queues dashboard; other commercial roles see revenue / category / DO charts. Log out and back in after a role change.

## Print layout issues

- Use the in-app **Print** control so `scr-print-mode` styles apply.
- Toolbars are hidden via `no-print`; if content is clipped, try landscape where the screen offers it.
- Weekly **Stock** and **Commitments** use tight print margins (2mm top/bottom) by design. If the logo or footer looks clipped, report it — margins are controlled in `StockCommitmentReport.css` (`@page scrCompactTopTight`). Other weekly reports still use 8mm margins.

## Lost data or need to restore a backup

- **ADMIN** — use **General Parameters → Data backup** to create or restore a full `.db` backup, or configure **automatic daily backup** (while the app is running). See [Data backup and restore](11-data-backup-restore.md).
- **IT / overnight** — `scripts/backup-windows.ps1` + Windows Task Scheduler when the app is closed (same guide).
- Manual restore: close the app, replace `sales.db` in the user data folder (or custom `databaseDir`), remove `-wal`/`-shm`, relaunch.
- If **Scheduled backup failed: Backup file not found**, ensure you are on a build that **awaits** SQLite’s async `.backup()` before validating the file (manual **Create backup** and **Run automatic backup now** exercise the same path).
- Report CSV/PDF exports are **not** full backups.

## Data sync shows Offline or Error

- **Sync badge shows "Offline"**:
  - The central Hono server is unreachable. Verify the server is running on port 3001 (`npm run server:dev` or Docker container `sales-sync-api`).
  - Check the **Hono Central API URL** under **General Parameters → Data sync** (e.g. `http://localhost:3001` or your server IP).
  - Click **Test server** to check network response.
- **Sync badge shows "Sync error"** (including a stuck **“1 error”** / failed count):
  - Click the badge to read the error message.
  - If error is "Unauthorized: Invalid device token", verify that the **Device API Token** matches `API_SECRET_KEY` in `server/.env`.
  - **Failed outbox items are retried on Sync Now** (and on the automatic sync cycle). Fix the underlying cause, then click **Sync Now** — do not expect FAILED rows to clear without a successful push.
  - Cancelled sales need Postgres columns `cancelledAt` / `cancelledByUserId` / `cancelReason` on `sales` (server migrate after app migration `119`). A missing-column error leaves the item FAILED until the server schema is updated.
- **Pending transactions not decreasing**:
  - Verify that the central server has an active PostgreSQL connection. Visit `http://localhost:3001/api/health` — it should return `"database": "connected"`.
- See [Data synchronization](12-data-sync.md) and technical instructions in [POSTGRES_SYNC_SETUP.md](../POSTGRES_SYNC_SETUP.md).

## App shows a blank screen or never reaches login

- Run the desktop app via **`npm run dev`** (or the installed **Sales Management Application** shortcut) — do **not** open `http://localhost:5173` in a browser tab. The UI requires the Electron preload API (`window.api`).
- If the window stays blank after a code update, restart **`npm run dev`** so Vite and Electron reload. Check the terminal for a red **Transform failed** or module import error.
- A broken import in a screen loaded at startup (for example the customers or stock modules) can block the whole app shell, including the login screen.

## Still stuck

Note the invoice/DO number, date, collection point, product, and whether the document is pending or validated — that is enough for support or a developer to trace the row in SQLite / logs. See [Developer guide — domain modules](../developer-guide/05-domain-modules.md).
