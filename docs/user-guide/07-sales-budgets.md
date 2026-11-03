# Sales budgets

Sidebar section: **Sales Budget**.

## 12 Months Phasing

Screen: **Sales Budget → 12 Months Phasing** (on-screen title may still say **Sales budget phasing**).

Define **annual budgets by product category** — quantity (kg) and unit price (XAF/kg). Each category row shows **annual qty**, **unit price**, and a read-only **revenue (XAF)** field on one line (revenue updates live as you type qty × price). Use **Save** to store the budget and **Clear budget** to remove it.

Monthly phasing is edited per category via **Edit phasing** (opens a dialog with **FY months 1–12 (%)**). Twelve percentages must total **100%**; quantities are phased into fiscal months, then spread across ISO weeks for the crosstab views under **Reports**.

| Field | Notes |
|-------|--------|
| **Annual qty (kg)** | Rounded to **0 decimal places** on save; displayed with **thousand separators** (e.g. `1,250,000`). |
| **Unit price (XAF/kg)** | Shown with thousand separators; up to 2 decimal places allowed. |
| **Revenue (XAF)** | Read-only; annual qty × unit price, rounded to 0 dp with thousand separators. |

The **Phasing preview** section at the bottom runs the phase engine for a chosen category without saving budget rows.

Typography and spacing on this screen match other operational modules (14px base) rather than the larger default app shell font.

## Crosstab reports (budget views)

These open under **Reports** (not under Sales Budget). Sidebar labels:

| Sidebar (Reports) | Purpose |
|-------------------|---------|
| **Weekly → Quantity Phasing** | Crosstab of phased **kg** by ISO week × budget group × calendar month. |
| **Weekly → Revenue Phasing** | Crosstab of phased **revenue (XAF)** by ISO week × budget group × calendar month. |
| **Monthly → 12-MTH Quantity Phasing** | Crosstab of phased **kg** by budget group × calendar month (Jan–Dec). |
| **Monthly → 12-MTH Revenue Phasing** | Crosstab of phased **revenue (XAF)** by budget group × calendar month (Jan–Dec). |

These are planning views derived from category budgets + phasing, not live sales. They support **year pickers**, **Print**, **Save PDF**, and **Export CSV** like other reports. Use the links on the kg crosstab screens to jump to the matching revenue crosstab (and back). Comments can be attached per report (see [Reports](08-reports.md)).

Kg cells use **thousand separators** and **0 decimal places**; revenue cells use **thousand separators** and **0 decimal places** (full FCFA, not '000 FRS). Layout and fonts align with the main phasing screen and other report chrome.

Next: [Reports](08-reports.md).
