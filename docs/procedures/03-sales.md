# Sales procedures

Sidebar section: **Sales**. Reference: [Sales invoices](../user-guide/04-sales-invoices.md).

---

### P-SA-01 Document booklets — issue a range

**Path:** Sales → Document booklets  
**Who:** Users with write on document-booklets (often admin / supervisor)  
**Before you start:** Collection points exist; you know the paper booklet from–to serials

1. Open **Sales → Document booklets**.
2. Start **Issue booklet** (or equivalent new/issue action).
3. Choose kind: **Sales invoice** or **Delivery order**.
4. Select the **collection point** that will use the booklet.
5. Enter booklet code (if required), **start serial**, and **end serial** (digits).
6. Optional notes.
7. If you have validate rights, you may activate immediately; otherwise leave pending for **P-SA-02**.
8. Confirm issue.

**Check:** Booklet appears in the list as **PENDING** or **ACTIVE**. Active ranges can be used when App settings enforce booklet validation.

**If it fails:** Overlapping serial ranges; invalid from–to; wrong collection point.

---

### P-SA-02 Booklet validation

**Path:** Sales → Booklet validation (or validate from Document booklets when allowed)  
**Who:** Supervisor with `validate_document_booklets`  
**Before you start:** Pending booklet issuances exist

1. Open **Sales → Booklet validation**.
2. Review pending booklets (kind, point, serial range).
3. **Validate** approved issuances (status → **ACTIVE**).
4. Reject per site process if the UI offers it.

**Check:** Booklet status **ACTIVE**; clerks can enter serials from that range on invoices/DOs when enforcement is on.

**If it fails:** Action or route missing; booklet already cancelled.

---

### P-SA-03 Invoicing — normal loose sale with Pick DO

**Path:** Sales → Invoicing → **New invoice** (modal)  
**Who:** Sales clerk with write on sales  
**Before you start:** Open month; validated DO with remaining kg (**P-DO-04**); sellable stock as of invoice date; booklet serial or auto-generate on; non-cash payment method configured

1. Open **Sales → Invoicing** (invoice list).
2. Click **New invoice**. In the modal, enter **Booklet serial no.** unless auto-generate invoice numbers is on.
3. Tick **Registered customer** and select the customer; select **collection point**.
4. Set disposition to **normal** (default commercial sale).
5. Set invoice **date** in the open month; enter **vehicle number** when required.
6. Click **Pick DO**:
   - List is filtered to that customer + collection point, validated DOs with remaining kg (CF rows marked **CF**).
   - Click a **product** row — DO links, Add line opens with product / remaining qty / DO price.
7. Confirm storage location (sales tank when App settings require it for LPO) and save the line.
8. Add further lines as needed (Pick DO / Add line).
9. Confirm payment method (cheque / traite / bank transfer — **Cash is hidden** on loose) and locked amount = invoice total. Complete traite/cheque fields if shown.
10. **Save as pending** (or **Validate invoice** if you have direct validate).

**Check:** Invoice saved; appears on **Invoice list** for the open month. After validation (**P-SA-06**), stock deducts and DO remaining drops on **P-DO-06**.

**If it fails:** Pick DO empty — DO not validated, wrong customer/point, or zero remaining; insufficient stock as of invoice date; serial duplicate / not in active booklet; payment total mismatch.

---

### P-SA-04 Invoicing — walk-in, Ration, Public relation

**Path:** Sales → Invoicing → **New invoice** (modal)  
**Who:** Sales clerk  
**Before you start:** App settings allow the disposition / unregistered customer as needed

1. Open **Invoicing** and click **New invoice**.
2. Enter serial (or rely on auto-generate).
3. Choose disposition:
   - **Normal + unregistered** — only if App settings **Use unregistered customer** is on; type invoice name; no Pick DO.
   - **Ration** — LPO category rules; invoice name; payment method locked to Ration (deferred).
   - **Public relation** — only if App settings allow it on loose sales; payment locked to Public relation (complimentary).
4. Add lines (no delivery-order link on special dispositions).
5. Complete locked payment line; save pending or validate per rights.

**Check:** Invoice saves with correct disposition; payment method read-only for Ration/PR.

**If it fails:** Disposition hidden in App settings; Ration product not LPO; trying to Pick DO on special disposition.

---

### P-SA-05 Invoice list and print

**Path:** Sales → Invoicing (invoice list)  
**Who:** Users with sales access  
**Before you start:** Invoices exist

1. Open **Sales → Invoicing** (list is the default screen).
2. Use period filter: open month (default), open year, or all time.
3. Search, then **Edit** / **Open** an invoice in the modal, or use **Print** on the row.
4. From the open invoice modal, use print (loose) for the sales invoice layout with QR.

**Check:** Correct period listing; print preview matches customer, lines, and totals.

**If it fails:** Wrong period filter; Bottle Oil uses cash-receipt print instead (**P-SA-07**).

---

### P-SA-06 Sales validation

**Path:** Sales → Sales validation  
**Who:** Supervisor with `validate_sales`  
**Before you start:** Pending invoices exist

1. Open **Sales → Sales validation** (or Overview **Pending sales** tile).
2. Review each pending invoice (loose and Bottle Oil as listed).
3. Validate individually or in bulk.
4. Optionally open the invoice from Invoicing and use **Validate invoice** there.

**Check:** Status **VALIDATED**; stock deducted as of invoice date; DO lifts update; consignment-eligible sales can proceed to **P-SA-08**.

**If it fails:** Insufficient stock as of invoice date; action missing; already validated/cancelled.

---

### P-SA-07 Bottle Oil sales and cash receipt print

**Path:** Sales → Bottle Oil sales → **New Bottle Oil invoice** (modal)  
**Who:** Store Keeper / bottle-oil writers  
**Before you start:** Open month; Cash payment method; bottled stock available; App settings for registered customers / Ration as needed

1. Open **Sales → Bottle Oil sales** (invoice list) and click **New Bottle Oil invoice**.
2. Enter booklet serial unless auto-generate is on.
3. Customer mode:
   - Default: type **invoice customer name** (no registered checkbox).
   - If App settings **Use registered customers** is on: pick directory customer.
4. Choose disposition (Normal / Ration if allowed / Public relation).
5. Set date; add bottled product lines (units); no Pick DO.
6. Payment is locked: **Cash** (normal), **Ration (deferred)**, or **Public relation (complimentary)**.
7. Save pending or validate per rights.
8. Click print — layout is a **cash receipt** (not the loose invoice table).

**Check:** Invoice/receipt saved; after validation, bottled stock reduces; print shows receipt wording and QR.

**If it fails:** No Cash method; Ration hidden by App settings; stock short as of date.

---

### P-SA-08 Consignment notes — prepare and print

**Path:** Sales → Consignment notes  
**Who:** Users with vehicle-consignment-notes write  
**Before you start:** Sale is **validated**; allowed types: loose sales, or Bottle Oil Ration / Public relation (not normal Bottle Oil cash)

1. Open **Sales → Consignment notes**.
2. Look up by invoice number or VCN number.
3. Complete vehicle / consignment fields required by the form.
4. Save (typically **PENDING**).
5. Print — overlay shows **Original** and **Duplicate** stamps per page.

**Check:** Note saved and linked to the sale; print preview usable.

**If it fails:** Sale still pending; normal Bottle Oil cash sale not eligible; missing write access.

---

### P-SA-09 Consignment validation

**Path:** Sales → Consignment validation  
**Who:** Supervisor with `validate_vehicle_consignment_notes`  
**Before you start:** Pending consignment notes exist

1. Open **Sales → Consignment validation** (or Overview **Pending consignment** tile).
2. Review pending notes.
3. Validate (bulk if available).

**Check:** Notes validated; queue / Overview tile count drops.

**If it fails:** Action or route missing.

---

### P-SA-10 Transportation cost compute

**Path:** Sales → Transportation cost  
**Who:** Users with transport-cost-compute access  
**Before you start:** Transport Rates maintained under General Parameters; open month; App settings Moliwe + SCR MAYA policy understood

1. Open **Sales → Transportation cost**.
2. If **Moliwe + SCR MAYA** policy is **on** (default): the screen auto-computes for Moliwe, SCR MAYA, and Loose Palm Oil (LPO). **Process cost** is hidden.
3. If the policy is **off**: use **Process cost**, select customer, collection point, and product, then compute.
4. Review results (rates and costs are VAT-inclusive); print/export if offered.
5. For the company-wide printable report, use **Reports → Monthly → Transportation cost**.

**Check:** Computed amounts match expected (rate × (1 + VAT)) × kg for the selection; policy filter matches App settings.

**If it fails:** Missing Moliwe / SCR MAYA / LPO master data when policy is on; missing transport rates; no lifts in period; policy excluding non-Moliwe / non-SCR MAYA invoices when that option is on.
