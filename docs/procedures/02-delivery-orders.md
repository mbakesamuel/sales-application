# Delivery Order procedures

Sidebar section: **Delivery Order**. Reference: [Delivery orders](../user-guide/05-delivery-orders.md).

---

### P-DO-01 Register Commitments

**Path:** Delivery Order → Register Commitments  
**Who:** Statistics clerk (saves **pending**); supervisor / manager with `validate_delivery_orders` (saves **validated** live)  
**Before you start:** Open month; customers and products exist; collection point known; original paper DO numbers for each outstanding commitment

1. Open **Delivery Order → Register Commitments**.
2. Click **Batch entry**. Select **collection point** and **product**.
3. For each outstanding original DO, **Add line**: choose **customer**, enter **Original DO #** (digits), and **outstanding kg**. The same customer may appear on multiple lines when they have several originals at that point.
4. Click **Save batch**.
5. Read the result message:
   - Clerk without validate: lines appear under **Awaiting validation**; not on Pick DO yet.
   - Validator: commitments are live on reports and Pick DO.

**Check:** After validation, **Sales → Invoicing → Pick DO** shows separate **CF** rows (with original DO #) for each commitment — not one bulk total. **Awaiting validation** clears when a supervisor validates the CF DO (**P-DO-04**).

**If it fails:** Closed month; missing customer/product/original DO #; duplicate original DO #; clerk edits to an already validated CF line return it to pending until re-validated.

---

### P-DO-02 Create a Delivery Order

**Path:** Delivery Order → Delivery Order → **DO list** → **New delivery order**  
**Who:** Sales / statistics clerks with write on delivery-orders  
**Before you start:** Open month; customer; collection point; booklet serial ready **or** App settings auto-generate DO numbers on

1. Open **Delivery Order → Delivery Order** (lands on **DO list**).
2. Click **New delivery order** to open the create/edit modal.
3. Enter **Booklet serial no.** (digits only) unless auto-generate is on — then the system assigns `DO-year-######` on save. If booklet enforcement is on, the serial must be in an **ACTIVE** Delivery-order booklet for that collection point (**P-SA-01 / P-SA-02**).
4. Select **customer** and **collection point**; set **date issued** in the open month.
5. Add product lines (qty, unit price as resolved from schedules).
6. Enter payments so paid total matches the DO total (methods per your site).
7. **Save** (status **PENDING** unless your role validates immediately). Close the modal when done.

**Check:** DO appears on **DO list** for the open month; status **PENDING** until **P-DO-04**.

**If it fails:** Duplicate serial; serial not in active booklet; closed month; payment total mismatch.

---

### P-DO-03 DO list lookup

**Path:** Delivery Order → Delivery Order → tab **DO list**  
**Who:** Anyone with delivery-orders access  
**Before you start:** None

1. Open **Delivery Order → Delivery Order** (**DO list** is the default view).
2. Use period filter: **Open month** (default), **Open year**, or **All time**.
3. Search or open a row: **Edit** (pencil) for **PENDING**, **Open** (eye) for **VALIDATED** — both load the modal.

**Check:** Expected DOs for that period appear; opening a row loads the header and lines in the modal.

**If it fails:** Wrong period filter; DO dated in another month — switch to **All time**.

---

### P-DO-04 Validation queue

**Path:** Delivery Order → Delivery Order → tab **Validation queue**  
**Who:** Supervisor / manager with `validate_delivery_orders`  
**Before you start:** Pending DOs (including CF from **P-DO-01**) exist

1. Open the **Validation queue** tab (hidden if you lack the action).
2. Review pending rows (customer, point, amounts).
3. Select one or more rows.
4. Click **Validate** (bulk if available). Opening a row opens the DO modal when you have write access.

**Check:** DOs become **VALIDATED**; they appear in **Pick DO** on Sales when balance remains; CF rows leave **Awaiting validation** on Register Commitments.

**If it fails:** Action not granted; date outside open month; already validated/cancelled.

---

### P-DO-05 Print Delivery Order

**Path:** Delivery Order → Delivery Order → open DO modal (saved document)  
**Who:** Users who can open the DO  
**Before you start:** DO is saved (pending or validated)

1. Open the delivery order modal (**P-DO-02** or **P-DO-03**).
2. Click **Print delivery order**.
3. Preview the **Delivery Order Report** (company header, lines, taxes, payments, QR, signature lines).
4. Print or save from the preview; close when done.

**Check:** Printout shows correct DO number, customer, collection point, and line qty.

**If it fails:** Document not saved yet; printer / PDF dialog blocked — use in-app print controls.

---

### P-DO-06 DO tracking and tracking report

**Path:** Delivery Order → DO tracking  
**Who:** Anyone with delivery-order-tracking access  
**Before you start:** Know the booklet / DO / CF / DT number

1. Open **Delivery Order → DO tracking**.
2. Enter the DO number and look it up.
3. Review header chips: **Ordered**, **Lifted**, **Remaining**.
4. Review **Commitment by product** and **Lift history** (linked invoices).
5. Optional: **Open in Delivery ordering** to jump to the DO list and open the edit modal.
6. Optional: **Print tracking report** for the printable tracking overlay.

**Check:** Totals match commitment minus validated lifts; transfers out / transferred-from sections appear when **P-DO-07** was used.

**If it fails:** Wrong number; DO never saved; lifts only show invoices linked to that DO.

---

### P-DO-07 Transfer DO balance

**Path:** Delivery Order → Transfer DO balance  
**Who:** Users with action `transfer_delivery_order_balance`  
**Before you start:** Source DO is **validated** with remaining kg; destination collection point exists

1. Open **Delivery Order → Transfer DO balance**.
2. Look up the **source** DO.
3. Enter transfer kg per product (not more than remaining).
4. Choose the **destination collection point**.
5. Confirm the transfer.
6. Note the new destination DO number (`DT-{year}-{seq}`), already **validated**.

**Check:** Source remaining drops; destination Pick DO lists the new DT DO; **P-DO-06** shows transferred-from / transfers-out.

**If it fails:** Action missing; source not validated; transfer qty above remaining; this moves **commitment only** — still run stock **P-ST-04 / P-ST-08** if physical goods must move.
