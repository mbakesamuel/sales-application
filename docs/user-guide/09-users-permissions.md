# Users and permissions

Sidebar section: **Users & access**.

| Sidebar item | Purpose |
|--------------|---------|
| **Manage Users** | Login accounts and role assignment |
| **Manage roles** | Create, rename, delete roles; copy permissions from another role |
| **Role permissions** | Route access matrix and action toggles |

When you create a user (or reset their password), enter a **temporary password** and share it with them. On first sign-in they must change that password before they can use the app.

**Naming note:** Role permissions labels often follow the internal route catalog (e.g. “Sales Invoice”, “Bottled Stock”, “Carry-forward commitments”). The **sidebar** may use different wording (**Invoicing**, **Bottle Stock**, **Register Commitments**). Grant the route that matches the screen the user needs.

## Roles (defaults)

Default route access is defined per role (admins can change the matrix):

| Role | Typical access |
|------|----------------|
| **ADMIN** | All routes write; manage permissions and roles. Commercial Overview. |
| **MANAGER** | Most routes write (not user admin); validate sales/DOs/consignments/booklets; can cancel validated DOs and validated sales invoices. Commercial Overview. |
| **SENIOR_SALES_SUPERVISOR** | Operations, customers, inventory read/write; validate sales/DOs/consignments. **Supervisor Overview** (queues + stock). |
| **JNR_SALES_SUP** (junior sales supervisor) | Custom/manageable role (may already exist in production DBs). Shares **Supervisor Overview** with senior supervisors when granted matching routes. |
| **STATISTICS_CLERK** | Broad **read** on operations, budgets, reports, and financial/tax screens; **write** on **Stock**, **Bottle Stock**, **Opening Stock balances**, and **Register Commitments** for company-wide transfers (bulk + bottled) and carry-forward entry. Primary transfer operator — draft, dispatch, and location moves across all collection points. Carry-forward saves stay pending until a supervisor validates them. No validate actions by default. Commercial Overview. |
| **STORE_KEEPER** | **Bottle Stock** at Bota (Bin card, **Reception** / consignment note, Adjustments) and Bottle Oil sales; selected reports; **Bottle Oil Overview**. Cannot validate by default. |

## Route access vs actions

- **Route access** — `none` / `read` / `write` per screen (sidebar entry).
- **Actions** (separate toggles):

| Action | Meaning |
|--------|---------|
| `validate_sales` | Validate sales invoices (POS, invoice list, or **Sales validation**). |
| `direct_validate_sales` | Create and validate a sales invoice in one step from the POS screen (skip pending). |
| `cancel_validated_sales` | Cancel (void) an already validated sales invoice with a reason; restores stock and DO balance. Requires route **write** on Invoicing / Bottle Oil Sales as well. |
| `delete_validated_sales` | Permanently delete a validated or cancelled sales invoice (ADMIN by default). |
| `validate_delivery_orders` | Validate delivery orders (including the **Validation queue** tab under Delivery Order). |
| `cancel_validated_delivery_order` | Cancel an already validated DO. |
| `transfer_delivery_order_balance` | Move remaining DO kg to another collection point (**Transfer DO balance**). |
| `validate_vehicle_consignment_notes` | Validate vehicle consignment notes (**Consignment validation**). |
| `validate_document_booklets` | Validate pending document booklet issuances (**Booklet validation** / booklets screen). |
| `manage_permissions` | Edit the permission matrix (**Role permissions**). |

Opening **Invoicing** does not by itself allow validation — the action flag must be on. The Delivery Order **Validation queue** tab appears only when `validate_delivery_orders` is granted. **Consignment validation** needs route access plus `validate_vehicle_consignment_notes`. **Booklet validation** needs route access plus `validate_document_booklets`.

### Sales / consignment / booklet routes

| Route | Sidebar screen |
|-------|----------------|
| `sales` | Invoicing |
| `bottle-oil-sales` | Bottle Oil sales |
| `sales-validation` | Sales validation |
| `document-booklets` | Document booklets |
| `booklet-validation` | Booklet validation |
| `transport-cost-compute` | Transportation cost |
| `vehicle-consignment-notes` | Consignment notes |
| `vehicle-consignment-validation` | Consignment validation |

### Delivery order routes

| Route | Sidebar screen |
|-------|----------------|
| `delivery-orders` | Delivery Order (create / list / validation queue) |
| `delivery-order-tracking` | DO tracking |
| `delivery-order-transfer` | Transfer DO balance |
| `carry-forward-commitments` | Register Commitments |

## Stock routes

After changing the matrix, affected users must **log out and sign in again** for buttons to update.

| Route | Sidebar / behaviour | None | Read | Write |
|-------|---------------------|------|------|-------|
| `stock` | **Stock** (unified when write) | Hidden | View | Draft/post stock documents (plus actions) |
| `bottled-stock` | **Bottle Stock** (Store Keeper nav may show as **Stock**) | Hidden | View bottled tabs | Reception / Adjustments; **Bin card** tab |
| `stock-validation` | **Stock validation** | Hidden | View queue | Validate when action granted |
| `carry-forward-stock` | **Opening Stock balances** | Hidden | View | Batch-set opening quantities (clerks submit drafts; supervisors with validate post immediately) |
| `stock-bin-card` | Bin card filters (permission matrix; not a separate sidebar item) | Hidden | View / filter | Same as read unless write on related stock routes |
| `stock-bin-card-report` | Printable bin card overlay (from Bin card → **Open report**) | Hidden | Open printable report | Same as read |

Legacy matrix rows (`stock-balance`, `stock-movements`, `stock-receipts`, …) may still appear for older databases; the live hub is gated mainly by **`stock`** / **`bottled-stock`**.

**Store Keeper note:** Defaults use **`bottled-stock`** with receipt/adjustment actions for Bota **Reception**, plus seeded **`stock-bin-card`** / **`stock-bin-card-report`**. If **Open report** is denied after an upgrade, confirm those routes are not **None**, then sign out and back in.

### Stock document actions

| Action | Allows |
|--------|--------|
| Draft stock receipts | New receipt / Bottle Stock **Reception**, edit/delete drafts |
| Post stock receipts | Post and cancel posted receipts (including Bota consignment notes) |
| Draft stock transfers | New loose transfer, edit/delete drafts (Statistics clerk / supervisors) |
| Post / dispatch stock transfers | Post location moves, dispatch inter-site loose transfers, cancel posted |
| Draft stock adjustments | New adjustment, edit/delete drafts |
| Post stock adjustments | Post (including reclassify) and cancel posted |
| Post stock receipts directly (skip draft review) | Create and post a new receipt in one step |
| Post stock transfers directly (skip draft review) | Create and finalize a new transfer in one step |
| Validate stock documents | Validate pending documents on **Stock → Stock validation** |

Example: **Statistics clerk** drafts and dispatches **loose** transfers company-wide. **Store Keeper** posts Bottle Oil **Reception** (consignment notes) at Bota. Supervisors clear drafts on **Stock validation**. Carry-forward opening balances submitted by clerks stay **draft** until a user with **Validate stock documents** posts them.

## Manage roles

**Manage roles** lets admins create custom roles (copying route/action defaults from an existing role such as Store Keeper), rename labels, and delete non-system roles. System roles (ADMIN, MANAGER, …) cannot be deleted.

## Role permissions screen

**Role permissions** is admin-only by default. Adjust route and action matrices carefully; incorrect settings can block clerks from selling or allow unauthorized validation. Supervisor Overview tiles require grants for `sales-validation`, `stock-validation`, and `vehicle-consignment-validation` as applicable.

Next: [Troubleshooting](10-troubleshooting.md).
