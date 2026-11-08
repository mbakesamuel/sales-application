# Stock procedures

Sidebar section: **Stock**. Reference: [Inventory and stock](../user-guide/06-inventory-stock.md).

---

### P-ST-01 Opening Stock balances

**Path:** Stock → Opening Stock balances  
**Who:** Statistics clerk (submits **draft**); supervisor / manager with **Validate stock documents** (posts immediately when they enter data themselves)  
**Before you start:** Financial month is open; collection point exists; storage locations are assigned under **General Parameters → Locations Assignment** (except Palm Kernel / Cake products, which need no location)

1. Open **Stock → Opening Stock balances**.
2. Click **New Entry**.
3. Select the **Collection point**.
4. Set the **Date** (must be inside the open financial month). That date becomes the movement date on reports.
5. Click **Add line** for each product:
   - Choose **Product**.
   - Choose **Storage location** (shows **—** for Palm Kernel / Cake — leave as is).
   - Enter the **desired on-hand** quantity (what the balance should be after this opening entry).
6. Repeat **Add line** until all products for that point are entered.
7. Click **Save** (button may show **Saving…** while busy).
8. Read the success message:
   - Clerks without validate rights: lines go to **Awaiting validation** — balances do **not** change yet.
   - Users with validate rights: balances post immediately.

**Check:**

- Draft path: table **Awaiting validation** lists your collection point / products.
- Posted path: balances appear in the posted balances table; **Stock → Stock → On hand** shows the new quantities after refresh.

**If it fails:**

- Closed month or date outside open month.
- Missing storage location on a product that requires one.
- Location mixing rules (bulk products cannot share a tank; bottled and bulk cannot share) — clear conflicting stock first.
- Ask a supervisor to run **P-ST-09** if your lines stay in **Awaiting validation**.

---

### P-ST-02 Stock hub — On hand and Movements

**Path:** Stock → Stock  
**Who:** Anyone with Stock route access  
**Before you start:** None beyond login

1. Open **Stock → Stock**.
2. If you see **Loose / Bottled / All**, use the filter to narrow the product set (unified Stock writers only).
3. Open the **On hand** tab — live balances by product and location.
4. Open the **Movements** tab — ledger of quantity changes; use filters (product, location) as needed.

**Check:** On hand matches what you expect after recent receipts, sales, and transfers. Movements show dated rows for those events.

**If it fails:** Wrong collection-point scope (user assigned to one point); wrong Loose/Bottled filter; looking at report as-at vs live On hand (they can differ).

---

### P-ST-03 Stock — create and post a Receipt

**Path:** Stock → Stock → **Receipts**  
**Who:** Statistics clerk / supervisor with draft and/or post receipt actions  
**Before you start:** Open month; mill-attached collection point; products and locations exist

1. Open **Stock → Stock → Receipts**.
2. Set the view filter if shown (**Loose**, **Bottled**, or **All**) so the products you need appear.
3. Click **New receipt**.
4. Enter **Receipt number** if auto-generate is off (App settings → Stock document numbering); otherwise the system assigns a number on save.
5. Select **Collection point** (only mill-attached points are offered for new receipts).
6. Set **Received date** in the open month; optional supplier / notes.
7. Confirm **Bottled products** checkbox:
   - Locked **on** when the Stock view is **Bottled**.
   - Locked **off** when the view is **Loose**.
   - Editable when the view is **All**.
8. Add lines: product, quantity, storage location.
9. Save:
   - **Save as draft** (or equivalent draft action) if you cannot post directly.
   - **Post** / direct-post if your role has post or direct-post receipt rights.
10. If saved as draft, a supervisor completes **P-ST-09**.

**Check:** Receipt appears in the list as **POSTED** (or **DRAFT** awaiting validation). **On hand** increases for those products/locations after post.

**If it fails:** Empty product list — set filter to **All** or **Bottled** and ensure `receiptProducts` loaded (restart app after upgrades); location mixing; closed month; missing draft/post actions on Role permissions.

---

### P-ST-04 Stock — create and dispatch a Transfer

**Path:** Stock → Stock → **Transfers**  
**Who:** Statistics clerk / supervisor with draft and dispatch transfer actions  
**Before you start:** Open month; source stock on hand; App settings allow inter-site loose Palm Oil if you need that path. **Bottle products cannot be transferred** — use **P-ST-07** Reception at Bota instead.

1. Open **Stock → Stock → Transfers**.
2. Click **New transfer** (wording may be **New** / create).
3. Choose transfer scope: **Within collection point** or **Between collection points**.
   - Between points: loose Palm Oil only if App settings allow it; other loose products stay within-point only. Bottled products are blocked.
4. Set from / to collection points and **Dispatched** date in the open month.
5. Add lines: product, qty, from location (and to location for within-point moves as the form requires).
6. Save as draft if required by your permissions.
7. **Dispatch** when ready (status becomes dispatched / in transit for inter-site), or post within-point moves per your rights.

**Check:** Transfer listed with expected status; destination **On hand** increases and source decreases after post/receive as applicable.

**If it fails:** Insufficient stock at source; product not allowed for inter-site; bottled product selected; missing dispatch actions; closed month.

---

### P-ST-05 Stock — create and post an Adjustment

**Path:** Stock → Stock → **Adjustments**  
**Who:** Users with draft/post adjustment actions  
**Before you start:** Open month; understand whether you are correcting qty or reclassifying

1. Open **Stock → Stock → Adjustments**.
2. Create a new adjustment; set collection point and date in the open month.
3. Add lines (product, location, quantity / direction as the form requires).
4. Save draft or post according to your rights.
5. If draft, use **P-ST-09**.

**Check:** Movement appears under **Movements**; **On hand** matches the correction after post.

**If it fails:** Location rules; closed month; permission actions missing. Prefer **P-ST-01** for true opening / carry-forward balances (tagged differently on reports).

---

### P-ST-06 Bottle Stock — Bin card and Open report

**Path:** Stock → Bottle Stock → **Bin card** (Store Keepers may see Bottle Stock remapped as **Stock**)  
**Who:** Store Keeper; any role with Bottle Stock access  
**Before you start:** Bottled product exists; open month for date pickers

1. Open **Stock → Bottle Stock** (or remapped **Stock**).
2. Stay on **Bin card** (default tab).
3. Select a **bottled product** (required).
4. Optionally set collection point, storage location, condition, and **From / To** dates (limited to the open month).
5. Apply / load the ledger so you see opening balance, In / Out lines, and closing balance.
6. Click **Open report** to open the printable overlay.
7. Use **Print** or **Save PDF** as needed; close the overlay when finished.

**Check:** Ledger shows expected movements; printable report matches filters (A4 portrait).

**If it fails:** “No permission” on Open report — sign out/in after permission upgrade; non-bottled product not listed; empty range.

---

### P-ST-07 Bottle Stock — Reception and Adjustments

**Path:** Stock → Bottle Stock → **Reception** or **Adjustments**  
**Who:** Store Keeper / bottled stock writers at Bota  
**Before you start:** Open month; Bota collection point configured; bottled products and shared bottle storage location exist. Mills deliver bottles to Bota outside the app.

1. Open **Bottle Stock**.
2. **Reception** (consignment note):
   - Click **New Reception**.
   - Collection point is locked to **Bota**.
   - Enter **Supplier Mill**, receipt date in the open month.
   - Enter mill paperwork: **Consignment Note #**, **Consigned by** (optional designation / date), **Received by** (optional designation / date). Consignment Note #, Consigned by, and Received by are required.
   - Add lines for each bottle product type and quantity (same storage location).
   - Save draft or post per your rights; drafts need **P-ST-09**.
3. **Adjustments:** corrections / write-offs only — same pattern as **P-ST-05**, bottled products only.
4. Do **not** create stock transfers for bottle products (inter-site or within Bota).

**Check:** Posted reception increases bottle on-hand at Bota; bin card shows **In** movements from the receipt; print/review shows consignment note and signatures.

**If it fails:** Missing consignment note / consigned by / received by; Bota not found / not selected; mill-attached error should not apply at Bota for bottled receipts; closed month; missing draft/post receipt actions on Bottle Stock.

---

### P-ST-08 Receive transfers (retired)

**Status:** Retired for bottle stock. Bottle intake is **P-ST-07 Reception** at Bota. Do not capture mill → Bota bottle movement as an inter-site transfer.

---

### P-ST-09 Stock validation

**Path:** Stock → Stock validation  
**Who:** Supervisor / manager with **Validate stock documents**  
**Before you start:** Draft receipts, transfers, adjustments, or CF opening balances exist

1. Open **Stock → Stock validation** (or Overview **Pending stock** tile).
2. Review each pending document (type, point, date, lines).
3. Validate / post approved documents (use bulk actions if offered).
4. Reject or return for correction per your site process (if the UI offers reject).

**Check:** Documents leave the validation queue; Opening Stock **Awaiting validation** clears for posted CF lines; On hand updates.

**If it fails:** Route `stock-validation` or action missing; document date outside open month; insufficient stock on transfer post.
