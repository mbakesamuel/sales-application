# Customers and products

## Customers

**Customers** holds registered accounts. Each customer normally has a **customer type**.

Customer type text (code/name) is used on **Reports → Weekly → Sales/Delivery By Product** to classify loose palm oil into:

- Industries  
- Wholesales  
- Retail  
- CDC workers (ration) — also used when the sale disposition is **Ration**

Keep types named consistently so weekly/monthly delivery reports group sales correctly.

Invoice-only / walk-in flows (no registered customer) are available on sales for certain dispositions, and by default on **Bottle Oil sales** (unless App settings enables registered customers there); see [Sales invoices](04-sales-invoices.md).

### Add / edit customer

Use **Add Customer** (or edit from the customers list). The form is a **four-step wizard** (Basic → Contact → Tax & IDs → Service), matching the standard modal layout used elsewhere in the app.

| Step | Fields |
|------|--------|
| **Basic** | Full name, customer type, residency (Domestic / Foreign), optional **POS placeholder** (generic walk-in account). |
| **Contact** | Email, phone, address (all optional except where your process requires them). |
| **Tax & IDs** | Tax regime (optional), **Has TPN?** checkbox, and **Tax Payer's No.** when TPN applies. |
| **Service** | Commercial service (required) and a **Review** summary before save. |

Annual-style figures elsewhere in the app use thousand separators; customer fields are plain text except where noted above.

## Customer Types

Sidebar: **Customers → Customer Types**. Master list of type definitions assigned to customers.

Each type can be marked **exempt from sales tax**. When set, sales for customers of that type are treated as sales-tax exempt (tax lines / totals follow the exemption rules). Changing the flag on an existing type may require an administrator to recalculate affected sales (developers: `npm run recalc:sales-tax-exempt`).

## Products

**Products** is the catalog (name, code, category, etc.).

## Product Categories (important for reports)

Sidebar: **Products → Product Categories**. Category flags that reports use:

| Flag | Meaning for reporting |
|------|------------------------|
| **Main** (`isMain`) | Marks the Palm Oil **category** for budget grouping and category-level report layout. |
| **Bottled** (`isBottled`) | Treated as bottled palm oil (jug/carton packs). |

**Loose LPO (operations)** — customer-type pricing, sales-tank rules, Ration/PR dispositions — applies only to the product with code **LPO**, not to sludge grades in the same category.

**Loose Palm Oil (reports)** — weekly/monthly LPO sections, stock summary, and reconciliation — include canonical **LPO** plus sludge member grades (Bottom Tank Oil Grade A, Palm Sludge Oil Grade B/C). Sludge is not listed separately under **Other products / PKO**.

Products that are **neither** loose LPO (operations) nor bottled (for example Palm Kernel Oil, kernel cake) appear under **Other products / PKO** on **Sales/Delivery By Product** and in dedicated sections on other reports.

If a product shows in the wrong report section, check its category flags first.

## Product Unit Prices

Sidebar: **Products → Product Unit Prices**. Date-effective schedules. Sales and delivery orders resolve unit prices from these schedules (and related pricing rules) as of the document date / customer context.

Next: [Sales invoices](04-sales-invoices.md).
