import { Hono } from "hono";
import { sql } from "../db/index.js";
import { clearOperationalTables } from "../db/clearOperationalData.js";
import { deviceAuthMiddleware } from "../middleware/auth.js";

export const syncRoute = new Hono();

syncRoute.use("*", deviceAuthMiddleware);

syncRoute.post("/push", async (c) => {
  const device = c.get("device");
  const body = await c.req.json();
  const items = body.items || [];
  const committedIds: number[] = [];
  const errors: Array<{ outboxId: number; error: string }> = [];

  for (const item of items) {
    const { outboxId, entityType, action, payload } = item;
    try {
      await sql.begin(async (trx) => {
        if (entityType === "Sale") {
          if (action === "DELETE") {
            await trx`DELETE FROM sales WHERE id = ${payload.id}`;
          } else {
            await trx`
              INSERT INTO sales (
                id, invoice_no, sold_at, customer_id, created_by_user_id,
                customer_name_snapshot, tax_regime_id, vat_rate_snapshot,
                net_amount, vat_amount, gross_amount, financial_year,
                financial_month, reference_number, sales_point_id, status,
                validated_at, validated_by_user_id, vehicle_number, date_issued,
                delivery_order_no, posting_calendar_year, commercial_service_id,
                issuer_phone_snapshot, issuer_address_snapshot,
                commercial_service_name_snapshot, sale_product_mode,
                sale_disposition, cancelled_at, cancelled_by_user_id,
                cancel_reason, origin_device_id, synced_at, updated_at
              ) VALUES (
                ${payload.id}, ${payload.invoiceNo}, ${payload.soldAt || new Date().toISOString()},
                ${payload.customerId || null}, ${payload.createdByUserId}, ${payload.customerNameSnapshot || ""},
                ${payload.taxRegimeId || null}, ${payload.vatRateSnapshot || "0"},
                ${payload.netAmount || "0"}, ${payload.vatAmount || "0"}, ${payload.grossAmount || "0"},
                ${payload.financialYear || null}, ${payload.financialMonth || null},
                ${payload.referenceNumber || null}, ${payload.salesPointId || null},
                ${payload.status || "PENDING"}, ${payload.validatedAt || null},
                ${payload.validatedByUserId || null}, ${payload.vehicleNumber || ""},
                ${payload.dateIssued || ""}, ${payload.deliveryOrderNo || null},
                ${payload.postingCalendarYear || null}, ${payload.commercialServiceId || null},
                ${payload.issuerPhoneSnapshot || null}, ${payload.issuerAddressSnapshot || null},
                ${payload.commercialServiceNameSnapshot || null}, ${payload.saleProductMode || null},
                ${payload.saleDisposition || "NORMAL"}, ${payload.cancelledAt || null},
                ${payload.cancelledByUserId || null}, ${payload.cancelReason || null},
                ${device.id}, NOW(), NOW()
              )
              ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                validated_at = EXCLUDED.validated_at,
                validated_by_user_id = EXCLUDED.validated_by_user_id,
                cancelled_at = EXCLUDED.cancelled_at,
                cancelled_by_user_id = EXCLUDED.cancelled_by_user_id,
                cancel_reason = EXCLUDED.cancel_reason,
                net_amount = EXCLUDED.net_amount,
                vat_amount = EXCLUDED.vat_amount,
                gross_amount = EXCLUDED.gross_amount,
                sale_disposition = EXCLUDED.sale_disposition,
                synced_at = NOW(),
                updated_at = NOW()
            `;

            if (payload.lines && Array.isArray(payload.lines)) {
              await trx`DELETE FROM sale_lines WHERE sale_id = ${payload.id}`;
              for (const line of payload.lines) {
                await trx`
                  INSERT INTO sale_lines (
                    id, sale_id, product_id, qty_kg, unit_price_per_kg,
                    line_net, line_vat, line_gross, qty_units,
                    unit_price_per_unit, storage_location_id
                  ) VALUES (
                    ${line.id}, ${payload.id}, ${line.productId}, ${line.qtyKg},
                    ${line.unitPricePerKg}, ${line.lineNet}, ${line.lineVat},
                    ${line.lineGross}, ${line.qtyUnits || null},
                    ${line.unitPricePerUnit || null}, ${line.storageLocationId || null}
                  )
                `;
              }
            }

            if (payload.taxes && Array.isArray(payload.taxes)) {
              await trx`DELETE FROM sale_applied_taxes WHERE sale_id = ${payload.id}`;
              for (const tax of payload.taxes) {
                await trx`
                  INSERT INTO sale_applied_taxes (
                    id, sale_id, tax_type_id, code_snapshot, label_snapshot,
                    rate_snapshot, amount, created_at
                  ) VALUES (
                    ${tax.id}, ${payload.id}, ${tax.taxTypeId || null},
                    ${tax.codeSnapshot}, ${tax.labelSnapshot}, ${tax.rateSnapshot},
                    ${tax.amount}, ${tax.createdAt || new Date().toISOString()}
                  )
                `;
              }
            }

            if (payload.payments && Array.isArray(payload.payments)) {
              await trx`DELETE FROM payments WHERE sale_id = ${payload.id}`;
              for (const p of payload.payments) {
                await trx`
                  INSERT INTO payments (
                    id, sale_id, amount, cheque_no, paid_at, bank,
                    traite_no, traite_issued_on, traite_maturity_on,
                    payment_method_id, created_at
                  ) VALUES (
                    ${p.id}, ${payload.id}, ${p.amount}, ${p.chequeNo || null},
                    ${p.paidAt || new Date().toISOString()}, ${p.bank || null},
                    ${p.traiteNo || null}, ${p.traiteIssuedOn || null},
                    ${p.traiteMaturityOn || null}, ${p.paymentMethodId},
                    ${p.createdAt || new Date().toISOString()}
                  )
                `;
              }
            }
          }
        } else if (entityType === "DeliveryOrder") {
          if (action === "DELETE") {
            await trx`DELETE FROM delivery_orders WHERE id = ${payload.id}`;
          } else {
            await trx`
              INSERT INTO delivery_orders (
                id, delivery_order_no, date_issued, customer_id, order_ref,
                sales_point_id, financial_year, financial_month, created_by_user_id,
                status, validated_at, validated_by_user_id, posting_calendar_year,
                commercial_service_id, issuer_phone_snapshot, issuer_address_snapshot,
                commercial_service_name_snapshot, reviewed_at, reviewed_by_user_id,
                cancelled_at, cancelled_by_user_id, cancel_reason, source_kind,
                origin_device_id, synced_at
              ) VALUES (
                ${payload.id}, ${payload.deliveryOrderNo}, ${payload.dateIssued},
                ${payload.customerId || null}, ${payload.orderRef || null}, ${payload.salesPointId},
                ${payload.financialYear || null}, ${payload.financialMonth || null},
                ${payload.createdByUserId || null}, ${payload.status || "PENDING"},
                ${payload.validatedAt || null}, ${payload.validatedByUserId || null},
                ${payload.postingCalendarYear || null}, ${payload.commercialServiceId || null},
                ${payload.issuerPhoneSnapshot || null}, ${payload.issuerAddressSnapshot || null},
                ${payload.commercialServiceNameSnapshot || null}, ${payload.reviewedAt || null},
                ${payload.reviewedByUserId || null}, ${payload.cancelledAt || null},
                ${payload.cancelledByUserId || null}, ${payload.cancelReason || null},
                ${payload.sourceKind || "NORMAL"}, ${device.id}, NOW()
              )
              ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                validated_at = EXCLUDED.validated_at,
                validated_by_user_id = EXCLUDED.validated_by_user_id,
                cancelled_at = EXCLUDED.cancelled_at,
                cancelled_by_user_id = EXCLUDED.cancelled_by_user_id,
                cancel_reason = EXCLUDED.cancel_reason,
                synced_at = NOW()
            `;

            if (payload.details && Array.isArray(payload.details)) {
              await trx`DELETE FROM delivery_order_details WHERE delivery_order_id = ${payload.id}`;
              for (const d of payload.details) {
                await trx`
                  INSERT INTO delivery_order_details (
                    delivery_order_id, product_id, order_qty, order_unit,
                    unit_price, pricing_customer_type_id, amount, line_subtotal_ex_tax, vat_rate,
                    vat_amount, other_tax_label, other_tax_amount
                  ) VALUES (
                    ${payload.id}, ${d.productId}, ${d.orderQty}, ${d.orderUnit || null},
                    ${d.unitPrice || null}, ${d.pricingCustomerTypeId || null},
                    ${d.amount || null}, ${d.lineSubtotalExTax || null},
                    ${d.vatRate || null}, ${d.vatAmount || null}, ${d.otherTaxLabel || null},
                    ${d.otherTaxAmount || null}
                  )
                `;
              }
            }

            if (payload.paymentDetails && Array.isArray(payload.paymentDetails)) {
              await trx`DELETE FROM delivery_order_payment_details WHERE delivery_order_id = ${payload.id}`;
              for (const pd of payload.paymentDetails) {
                await trx`
                  INSERT INTO delivery_order_payment_details (
                    delivery_order_id, payment_date, cheque_no, bank,
                    cash_receipt_no, receipt_date, payment_method_id
                  ) VALUES (
                    ${payload.id}, ${pd.paymentDate}, ${pd.chequeNo || null},
                    ${pd.bank || null}, ${pd.cashReceiptNo || null},
                    ${pd.receiptDate || null}, ${pd.paymentMethodId}
                  )
                `;
              }
            }
          }
        } else if (entityType === "StockReceipt") {
          if (action === "DELETE") {
            await trx`DELETE FROM stock_receipts WHERE id = ${payload.id}`;
          } else {
            await trx`
              INSERT INTO stock_receipts (
                id, receipt_no, sales_point_id, received_at, supplier_label,
                status, notes, created_by_user_id, posted_by_user_id,
                posted_at, origin_device_id, synced_at, updated_at
              ) VALUES (
                ${payload.id}, ${payload.receiptNo}, ${payload.salesPointId},
                ${payload.receivedAt || new Date().toISOString()}, ${payload.supplierLabel || ""},
                ${payload.status || "DRAFT"}, ${payload.notes || null},
                ${payload.createdByUserId}, ${payload.postedByUserId || null},
                ${payload.postedAt || null}, ${device.id}, NOW(), NOW()
              )
              ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                posted_by_user_id = EXCLUDED.posted_by_user_id,
                posted_at = EXCLUDED.posted_at,
                notes = EXCLUDED.notes,
                synced_at = NOW(),
                updated_at = NOW()
            `;

            if (payload.lines && Array.isArray(payload.lines)) {
              await trx`DELETE FROM stock_receipt_lines WHERE receipt_id = ${payload.id}`;
              for (const l of payload.lines) {
                await trx`
                  INSERT INTO stock_receipt_lines (
                    id, receipt_id, product_id, qty, storage_location_id
                  ) VALUES (
                    ${l.id}, ${payload.id}, ${l.productId}, ${l.qty}, ${l.storageLocationId || null}
                  )
                `;
              }
            }
          }
        } else if (entityType === "StockTransfer") {
          if (action === "DELETE") {
            await trx`DELETE FROM stock_transfers WHERE id = ${payload.id}`;
          } else {
            await trx`
              INSERT INTO stock_transfers (
                id, transfer_no, from_sales_point_id, to_sales_point_id,
                dispatched_at, notes, status, created_by_user_id,
                posted_by_user_id, posted_at, received_at, received_by_user_id,
                consigned_by, cons_design, cons_date, receive_by,
                receive_by_design, receive_date, origin_device_id, synced_at, updated_at
              ) VALUES (
                ${payload.id}, ${payload.transferNo}, ${payload.fromSalesPointId},
                ${payload.toSalesPointId}, ${payload.dispatchedAt || new Date().toISOString()},
                ${payload.notes || null}, ${payload.status || "DRAFT"},
                ${payload.createdByUserId}, ${payload.postedByUserId || null},
                ${payload.postedAt || null}, ${payload.receivedAt || null},
                ${payload.receivedByUserId || null}, ${payload.consignedBy || null},
                ${payload.consDesign || null}, ${payload.consDate || null},
                ${payload.receiveBy || null}, ${payload.receiveByDesign || null},
                ${payload.receiveDate || null}, ${device.id}, NOW(), NOW()
              )
              ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                posted_by_user_id = EXCLUDED.posted_by_user_id,
                posted_at = EXCLUDED.posted_at,
                received_at = EXCLUDED.received_at,
                received_by_user_id = EXCLUDED.received_by_user_id,
                synced_at = NOW(),
                updated_at = NOW()
            `;

            if (payload.lines && Array.isArray(payload.lines)) {
              await trx`DELETE FROM stock_transfer_lines WHERE transfer_id = ${payload.id}`;
              for (const tl of payload.lines) {
                await trx`
                  INSERT INTO stock_transfer_lines (
                    id, transfer_id, product_id, qty,
                    from_storage_location_id, to_storage_location_id
                  ) VALUES (
                    ${tl.id}, ${payload.id}, ${tl.productId}, ${tl.qty},
                    ${tl.fromStorageLocationId || null}, ${tl.toStorageLocationId || null}
                  )
                `;
              }
            }
          }
        } else if (entityType === "StockAdjustment") {
          if (action === "DELETE") {
            await trx`DELETE FROM stock_adjustments WHERE id = ${payload.id}`;
          } else {
            await trx`
              INSERT INTO stock_adjustments (
                id, adjustment_no, sales_point_id, occurred_at, reason,
                status, created_by_user_id, posted_by_user_id, posted_at,
                source_kind, origin_device_id, synced_at, updated_at
              ) VALUES (
                ${payload.id}, ${payload.adjustmentNo}, ${payload.salesPointId},
                ${payload.occurredAt || new Date().toISOString()}, ${payload.reason || ""},
                ${payload.status || "DRAFT"}, ${payload.createdByUserId},
                ${payload.postedByUserId || null}, ${payload.postedAt || null},
                ${payload.sourceKind || "NORMAL"}, ${device.id}, NOW(), NOW()
              )
              ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                posted_by_user_id = EXCLUDED.posted_by_user_id,
                posted_at = EXCLUDED.posted_at,
                synced_at = NOW(),
                updated_at = NOW()
            `;

            if (payload.lines && Array.isArray(payload.lines)) {
              await trx`DELETE FROM stock_adjustment_lines WHERE adjustment_id = ${payload.id}`;
              for (const al of payload.lines) {
                await trx`
                  INSERT INTO stock_adjustment_lines (
                    id, adjustment_id, product_id, delta_qty,
                    storage_location_id, from_condition, to_condition
                  ) VALUES (
                    ${al.id}, ${payload.id}, ${al.productId}, ${al.deltaQty},
                    ${al.storageLocationId || null}, ${al.fromCondition || null},
                    ${al.toCondition || null}
                  )
                `;
              }
            }
          }
        } else if (entityType === "Customer") {
          if (action === "DELETE") {
            await trx`DELETE FROM customers WHERE id = ${payload.id}`;
          } else {
            await trx`
              INSERT INTO customers (
                id, name, phone, email, address, tax_regime_id, taxpayer_id,
                residency, has_taxpayer_id, is_pos_placeholder,
                commercial_service_id, customer_type_id, updated_at
              ) VALUES (
                ${payload.id}, ${payload.name}, ${payload.phone || null},
                ${payload.email || null}, ${payload.address || null},
                ${payload.taxRegimeId || null}, ${payload.taxpayerId || null},
                ${payload.residency || "LOCAL"}, ${Boolean(payload.hasTaxpayerId)},
                ${Boolean(payload.isPosPlaceholder)}, ${payload.commercialServiceId},
                ${payload.customerTypeId}, NOW()
              )
              ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                phone = EXCLUDED.phone,
                email = EXCLUDED.email,
                address = EXCLUDED.address,
                tax_regime_id = EXCLUDED.tax_regime_id,
                taxpayer_id = EXCLUDED.taxpayer_id,
                customer_type_id = EXCLUDED.customer_type_id,
                updated_at = NOW()
            `;
          }
        } else if (entityType === "DocumentBooklet") {
          await trx`
            INSERT INTO document_booklets (
              id, document_kind, booklet_code, start_serial, end_serial,
              sales_point_id, status, issued_at, issued_by_user_id,
              validated_at, validated_by_user_id, notes, updated_at
            ) VALUES (
              ${payload.id}, ${payload.documentKind}, ${payload.bookletCode || null},
              ${payload.startSerial}, ${payload.endSerial}, ${payload.salesPointId},
              ${payload.status || "PENDING"}, ${payload.issuedAt || new Date().toISOString()},
              ${payload.issuedByUserId || null}, ${payload.validatedAt || null},
              ${payload.validatedByUserId || null}, ${payload.notes || null}, NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              status = EXCLUDED.status,
              validated_at = EXCLUDED.validated_at,
              validated_by_user_id = EXCLUDED.validated_by_user_id,
              notes = EXCLUDED.notes,
              updated_at = NOW()
          `;
        }
      });

      committedIds.push(outboxId);
    } catch (err: unknown) {
      console.error("Sync push error on item:", outboxId, entityType, item.entityId, err);
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ outboxId, error: msg });
    }
  }

  return c.json({
    ok: errors.length === 0,
    committedIds,
    errors: errors.length > 0 ? errors : undefined,
    serverTime: new Date().toISOString(),
  });
});

syncRoute.post("/bootstrap-master", async (c) => {
  const body = (await c.req.json()) as Record<string, unknown[]>;
  const summary: Record<string, number> = {};

  try {
    await sql.begin(async (trx) => {
      // 1. CompanySettings
      if (body.companySettings && Array.isArray(body.companySettings)) {
        for (const cs of body.companySettings as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO company_settings (
              id, company_name, department, vat_rate, fiscal_year_start_month,
              logo_url, ui_theme_preset, hide_zero_report_rows,
              stock_commitment_report_comments, report_comments_json, updated_at
            ) VALUES (
              ${String(cs.id || "default")}, ${String(cs.companyName || "")}, ${cs.department ? String(cs.department) : null},
              ${String(cs.vatRate || "0.1925")}, ${Number(cs.fiscalYearStartMonth) || 1},
              ${cs.logoUrl ? String(cs.logoUrl) : null}, ${String(cs.uiThemePreset || "agro")},
              ${cs.hideZeroReportRows === 1 || cs.hideZeroReportRows === true},
              ${cs.stockCommitmentReportComments ? String(cs.stockCommitmentReportComments) : null},
              ${typeof cs.reportCommentsJson === "string" ? cs.reportCommentsJson : JSON.stringify(cs.reportCommentsJson || {})},
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              company_name = EXCLUDED.company_name,
              department = EXCLUDED.department,
              vat_rate = EXCLUDED.vat_rate,
              fiscal_year_start_month = EXCLUDED.fiscal_year_start_month,
              logo_url = EXCLUDED.logo_url,
              ui_theme_preset = EXCLUDED.ui_theme_preset,
              hide_zero_report_rows = EXCLUDED.hide_zero_report_rows,
              stock_commitment_report_comments = EXCLUDED.stock_commitment_report_comments,
              report_comments_json = EXCLUDED.report_comments_json,
              updated_at = NOW()
          `;
        }
        summary.companySettings = body.companySettings.length;
      }

      // 2. Roles
      if (body.roles && Array.isArray(body.roles)) {
        for (const r of body.roles as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO roles (id, label, is_system, sort_order, updated_at)
            VALUES (
              ${String(r.id)}, ${String(r.label)}, ${r.isSystem === 1 || r.isSystem === true},
              ${Number(r.sortOrder) || 0}, NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              label = EXCLUDED.label,
              is_system = EXCLUDED.is_system,
              sort_order = EXCLUDED.sort_order,
              updated_at = NOW()
          `;
        }
        summary.roles = body.roles.length;
      }

      // 3. SalesPoints
      if (body.salesPoints && Array.isArray(body.salesPoints)) {
        for (const sp of body.salesPoints as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO sales_points (id, name, is_active, attached_to_mill, updated_at)
            VALUES (
              ${Number(sp.id)}, ${String(sp.name)}, ${sp.isActive === 1 || sp.isActive === true},
              ${sp.attachedToMill === 1 || sp.attachedToMill === true}, NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              is_active = EXCLUDED.is_active,
              attached_to_mill = EXCLUDED.attached_to_mill,
              updated_at = NOW()
          `;
        }
        await trx`SELECT setval('sales_points_id_seq', COALESCE((SELECT MAX(id) FROM sales_points), 1))`;
        summary.salesPoints = body.salesPoints.length;
      }

      // 4. Locations
      if (body.locations && Array.isArray(body.locations)) {
        for (const l of body.locations as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO locations (id, location_name, is_active, updated_at)
            VALUES (${Number(l.id)}, ${String(l.locationName)}, ${l.isActive === 1 || l.isActive === true}, NOW())
            ON CONFLICT (id) DO UPDATE SET
              location_name = EXCLUDED.location_name,
              is_active = EXCLUDED.is_active,
              updated_at = NOW()
          `;
        }
        await trx`SELECT setval('locations_id_seq', COALESCE((SELECT MAX(id) FROM locations), 1))`;
        summary.locations = body.locations.length;
      }

      // 5. CommercialServices
      if (body.commercialServices && Array.isArray(body.commercialServices)) {
        for (const cs of body.commercialServices as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO commercial_services (
              id, code, name, invoice_prefix, phone, address, is_active, sort_order, site_kind, enabled_modules, updated_at
            ) VALUES (
              ${String(cs.id)}, ${String(cs.code)}, ${String(cs.name)}, ${String(cs.invoicePrefix)}, ${cs.phone ? String(cs.phone) : null},
              ${cs.address ? String(cs.address) : null}, ${cs.isActive === 1 || cs.isActive === true},
              ${Number(cs.sortOrder) || 0}, ${String(cs.siteKind || "SALES_POINT")},
              ${typeof cs.enabledModules === "string" ? cs.enabledModules : JSON.stringify(cs.enabledModules || [])},
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              code = EXCLUDED.code,
              name = EXCLUDED.name,
              invoice_prefix = EXCLUDED.invoice_prefix,
              phone = EXCLUDED.phone,
              address = EXCLUDED.address,
              is_active = EXCLUDED.is_active,
              sort_order = EXCLUDED.sort_order,
              site_kind = EXCLUDED.site_kind,
              enabled_modules = EXCLUDED.enabled_modules,
              updated_at = NOW()
          `;
        }
        summary.commercialServices = body.commercialServices.length;
      }

      // 6. ProductCats
      if (body.productCats && Array.isArray(body.productCats)) {
        for (const pc of body.productCats as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO product_cats (product_cat_id, product_cat, product_code, is_main, is_bottled, updated_at)
            VALUES (
              ${Number(pc.productCatId)}, ${String(pc.productCat)}, ${String(pc.productCode)},
              ${pc.isMain === 1 || pc.isMain === true},
              ${pc.isBottled === 1 || pc.isBottled === true}, NOW()
            )
            ON CONFLICT (product_cat_id) DO UPDATE SET
              product_cat = EXCLUDED.product_cat,
              product_code = EXCLUDED.product_code,
              is_main = EXCLUDED.is_main,
              is_bottled = EXCLUDED.is_bottled,
              updated_at = NOW()
          `;
        }
        await trx`SELECT setval('product_cats_product_cat_id_seq', COALESCE((SELECT MAX(product_cat_id) FROM product_cats), 1))`;
        summary.productCats = body.productCats.length;
      }

      // 7. CustomerTypeDefinitions
      if (body.customerTypeDefinitions && Array.isArray(body.customerTypeDefinitions)) {
        for (const ct of body.customerTypeDefinitions as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO customer_type_definitions (id, code, name, sort_order, is_active, is_system, updated_at)
            VALUES (
              ${String(ct.id)}, ${String(ct.code)}, ${String(ct.name)}, ${Number(ct.sortOrder) || 0},
              ${ct.isActive === 1 || ct.isActive === true},
              ${ct.isSystem === 1 || ct.isSystem === true}, NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              code = EXCLUDED.code,
              name = EXCLUDED.name,
              sort_order = EXCLUDED.sort_order,
              is_active = EXCLUDED.is_active,
              is_system = EXCLUDED.is_system,
              updated_at = NOW()
          `;
        }
        summary.customerTypeDefinitions = body.customerTypeDefinitions.length;
      }

      // 8. PaymentMethodDefinitions
      if (body.paymentMethodDefinitions && Array.isArray(body.paymentMethodDefinitions)) {
        for (const pm of body.paymentMethodDefinitions as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO payment_method_definitions (id, code, name, kind, sort_order, is_active, is_system, updated_at)
            VALUES (
              ${String(pm.id)}, ${String(pm.code)}, ${String(pm.name)}, ${String(pm.kind || "OTHER")},
              ${Number(pm.sortOrder) || 0}, ${pm.isActive === 1 || pm.isActive === true},
              ${pm.isSystem === 1 || pm.isSystem === true}, NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              code = EXCLUDED.code,
              name = EXCLUDED.name,
              kind = EXCLUDED.kind,
              sort_order = EXCLUDED.sort_order,
              is_active = EXCLUDED.is_active,
              is_system = EXCLUDED.is_system,
              updated_at = NOW()
          `;
        }
        summary.paymentMethodDefinitions = body.paymentMethodDefinitions.length;
      }

      // 9. TaxRegimes
      if (body.taxRegimes && Array.isArray(body.taxRegimes)) {
        for (const tr of body.taxRegimes as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO tax_regimes (id, name, kind, commercial_service_id, is_active, updated_at)
            VALUES (
              ${String(tr.id)}, ${String(tr.name)}, ${String(tr.kind || "SIMPLIFIED")},
              ${tr.commercialServiceId ? String(tr.commercialServiceId) : null},
              ${tr.isActive === 1 || tr.isActive === true}, NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              kind = EXCLUDED.kind,
              commercial_service_id = EXCLUDED.commercial_service_id,
              is_active = EXCLUDED.is_active,
              updated_at = NOW()
          `;
        }
        summary.taxRegimes = body.taxRegimes.length;
      }

      // 10. TaxRateSchedules
      if (body.taxRateSchedules && Array.isArray(body.taxRateSchedules)) {
        for (const trs of body.taxRateSchedules as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO tax_rate_schedules (id, rate_kind, rate, effective_from, is_active, updated_at)
            VALUES (
              ${String(trs.id)}, ${String(trs.rateKind)}, ${String(trs.rate)}, ${String(trs.effectiveFrom)},
              ${trs.isActive === 1 || trs.isActive === true}, NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              rate_kind = EXCLUDED.rate_kind,
              rate = EXCLUDED.rate,
              effective_from = EXCLUDED.effective_from,
              is_active = EXCLUDED.is_active,
              updated_at = NOW()
          `;
        }
        summary.taxRateSchedules = body.taxRateSchedules.length;
      }

      // 11. StorageLocations
      if (body.storageLocations && Array.isArray(body.storageLocations)) {
        for (const sl of body.storageLocations as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO storage_locations (
              id, sales_point_id, location_id, is_default, is_active, is_sales_tank, updated_at
            ) VALUES (
              ${Number(sl.id)}, ${Number(sl.salesPointId)}, ${Number(sl.locationId)},
              ${sl.isDefault === 1 || sl.isDefault === true},
              ${sl.isActive === 1 || sl.isActive === true},
              ${sl.isSalesTank === 1 || sl.isSalesTank === true}, NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              sales_point_id = EXCLUDED.sales_point_id,
              location_id = EXCLUDED.location_id,
              is_default = EXCLUDED.is_default,
              is_active = EXCLUDED.is_active,
              is_sales_tank = EXCLUDED.is_sales_tank,
              updated_at = NOW()
          `;
        }
        await trx`SELECT setval('storage_locations_id_seq', COALESCE((SELECT MAX(id) FROM storage_locations), 1))`;
        summary.storageLocations = body.storageLocations.length;
      }

      // 12. Users
      if (body.users && Array.isArray(body.users)) {
        for (const u of body.users as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO users (
              id, name, role, is_active, username, password_plain,
              sales_point_id, password_hash, must_change_password,
              commercial_service_id, updated_at
            ) VALUES (
              ${String(u.id)}, ${String(u.name)}, ${String(u.role)}, ${u.isActive === 1 || u.isActive === true},
              ${String(u.username)}, ${u.passwordPlain ? String(u.passwordPlain) : null},
              ${u.salesPointId ? Number(u.salesPointId) : null},
              ${u.passwordHash ? String(u.passwordHash) : null},
              ${u.mustChangePassword === 1 || u.mustChangePassword === true},
              ${u.commercialServiceId ? String(u.commercialServiceId) : null}, NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              role = EXCLUDED.role,
              is_active = EXCLUDED.is_active,
              username = EXCLUDED.username,
              password_plain = EXCLUDED.password_plain,
              sales_point_id = EXCLUDED.sales_point_id,
              password_hash = EXCLUDED.password_hash,
              must_change_password = EXCLUDED.must_change_password,
              commercial_service_id = EXCLUDED.commercial_service_id,
              updated_at = NOW()
          `;
        }
        summary.users = body.users.length;
      }

      // 13. RoleRoutePermissions
      if (body.roleRoutePermissions && Array.isArray(body.roleRoutePermissions)) {
        for (const rrp of body.roleRoutePermissions as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO role_route_permissions (role, route_id, access)
            VALUES (${String(rrp.role)}, ${String(rrp.routeId)}, ${String(rrp.access || "NONE")})
            ON CONFLICT (role, route_id) DO UPDATE SET access = EXCLUDED.access
          `;
        }
        summary.roleRoutePermissions = body.roleRoutePermissions.length;
      }

      // 14. RoleActionPermissions
      if (body.roleActionPermissions && Array.isArray(body.roleActionPermissions)) {
        for (const rap of body.roleActionPermissions as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO role_action_permissions (role, action_key, allowed)
            VALUES (${String(rap.role)}, ${String(rap.actionKey)}, ${rap.allowed === 1 || rap.allowed === true})
            ON CONFLICT (role, action_key) DO UPDATE SET allowed = EXCLUDED.allowed
          `;
        }
        summary.roleActionPermissions = body.roleActionPermissions.length;
      }

      // 15. Products
      if (body.products && Array.isArray(body.products)) {
        for (const p of body.products as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO products (
              product_id, product_name, product_code, product_cat_id,
              commercial_service_id, uom, updated_at
            ) VALUES (
              ${Number(p.productId)}, ${String(p.productName)}, ${p.productCode ? String(p.productCode) : null},
              ${Number(p.productCatId)}, ${p.commercialServiceId ? String(p.commercialServiceId) : null},
              ${String(p.uom || "Kg")}, NOW()
            )
            ON CONFLICT (product_id) DO UPDATE SET
              product_name = EXCLUDED.product_name,
              product_code = EXCLUDED.product_code,
              product_cat_id = EXCLUDED.product_cat_id,
              commercial_service_id = EXCLUDED.commercial_service_id,
              uom = EXCLUDED.uom,
              updated_at = NOW()
          `;
        }
        await trx`SELECT setval('products_product_id_seq', COALESCE((SELECT MAX(product_id) FROM products), 1))`;
        summary.products = body.products.length;
      }

      // 16. ProductUnitPriceSchedules
      if (body.productUnitPriceSchedules && Array.isArray(body.productUnitPriceSchedules)) {
        for (const pups of body.productUnitPriceSchedules as Array<Record<string, unknown>>) {
          await trx`
            INSERT INTO product_unit_price_schedules (
              id, product_id, unit_price_ex_tax, effective_from, customer_type_id, updated_at
            ) VALUES (
              ${String(pups.id)}, ${Number(pups.productId)}, ${String(pups.unitPriceExTax)},
              ${String(pups.effectiveFrom)}, ${pups.customerTypeId ? String(pups.customerTypeId) : null}, NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              product_id = EXCLUDED.product_id,
              unit_price_ex_tax = EXCLUDED.unit_price_ex_tax,
              effective_from = EXCLUDED.effective_from,
              customer_type_id = EXCLUDED.customer_type_id,
              updated_at = NOW()
          `;
        }
        summary.productUnitPriceSchedules = body.productUnitPriceSchedules.length;
      }
    });

    return c.json({
      ok: true,
      message: "Master reference data bootstrapped successfully.",
      summary,
      serverTime: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

syncRoute.post("/clear-operational", async (c) => {
  let body: { confirm?: string } = {};
  try {
    body = (await c.req.json()) as { confirm?: string };
  } catch {
    // empty body
  }

  if (body.confirm !== "CLEAR") {
    return c.json(
      {
        ok: false,
        error: 'Confirmation required: confirm must be "CLEAR".',
      },
      400,
    );
  }

  try {
    const { tables } = await clearOperationalTables(sql);
    return c.json({
      ok: true,
      tables,
      serverTime: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});

syncRoute.get("/pull", async (c) => {
  const since = c.req.query("since");
  const sinceDate = since ? new Date(since) : null;

  try {
    const products = sinceDate
      ? await sql`SELECT product_id as "productId", product_name as "productName", product_code as "productCode", product_cat_id as "productCatId", commercial_service_id as "commercialServiceId", uom, created_at as "createdAt", updated_at as "updatedAt" FROM products WHERE updated_at > ${sinceDate}`
      : await sql`SELECT product_id as "productId", product_name as "productName", product_code as "productCode", product_cat_id as "productCatId", commercial_service_id as "commercialServiceId", uom, created_at as "createdAt", updated_at as "updatedAt" FROM products`;

    const productCategories = sinceDate
      ? await sql`SELECT product_cat_id as "productCatId", product_cat as "productCat", product_code as "productCode", is_main as "isMain", is_bottled as "isBottled", created_at as "createdAt", updated_at as "updatedAt" FROM product_cats WHERE updated_at > ${sinceDate}`
      : await sql`SELECT product_cat_id as "productCatId", product_cat as "productCat", product_code as "productCode", is_main as "isMain", is_bottled as "isBottled", created_at as "createdAt", updated_at as "updatedAt" FROM product_cats`;

    const productUnitPrices = sinceDate
      ? await sql`SELECT id, product_id as "productId", unit_price_ex_tax as "unitPriceExTax", effective_from as "effectiveFrom", customer_type_id as "customerTypeId", created_at as "createdAt", updated_at as "updatedAt" FROM product_unit_price_schedules WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, product_id as "productId", unit_price_ex_tax as "unitPriceExTax", effective_from as "effectiveFrom", customer_type_id as "customerTypeId", created_at as "createdAt", updated_at as "updatedAt" FROM product_unit_price_schedules`;

    const customerTypes = sinceDate
      ? await sql`SELECT id, code, name, sort_order as "sortOrder", is_active as "isActive", is_system as "isSystem", created_at as "createdAt", updated_at as "updatedAt" FROM customer_type_definitions WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, code, name, sort_order as "sortOrder", is_active as "isActive", is_system as "isSystem", created_at as "createdAt", updated_at as "updatedAt" FROM customer_type_definitions`;

    const customers = sinceDate
      ? await sql`SELECT id, name, phone, email, address, tax_regime_id as "taxRegimeId", taxpayer_id as "taxpayerId", residency, has_taxpayer_id as "hasTaxpayerId", is_pos_placeholder as "isPosPlaceholder", commercial_service_id as "commercialServiceId", customer_type_id as "customerTypeId", created_at as "createdAt", updated_at as "updatedAt" FROM customers WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, name, phone, email, address, tax_regime_id as "taxRegimeId", taxpayer_id as "taxpayerId", residency, has_taxpayer_id as "hasTaxpayerId", is_pos_placeholder as "isPosPlaceholder", commercial_service_id as "commercialServiceId", customer_type_id as "customerTypeId", created_at as "createdAt", updated_at as "updatedAt" FROM customers`;

    const taxRegimes = sinceDate
      ? await sql`SELECT id, name, kind, commercial_service_id as "commercialServiceId", is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt" FROM tax_regimes WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, name, kind, commercial_service_id as "commercialServiceId", is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt" FROM tax_regimes`;

    const taxRateSchedules = sinceDate
      ? await sql`SELECT id, rate_kind as "rateKind", rate, effective_from as "effectiveFrom", is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt" FROM tax_rate_schedules WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, rate_kind as "rateKind", rate, effective_from as "effectiveFrom", is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt" FROM tax_rate_schedules`;

    const paymentMethods = sinceDate
      ? await sql`SELECT id, code, name, kind, sort_order as "sortOrder", is_active as "isActive", is_system as "isSystem", created_at as "createdAt", updated_at as "updatedAt" FROM payment_method_definitions WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, code, name, kind, sort_order as "sortOrder", is_active as "isActive", is_system as "isSystem", created_at as "createdAt", updated_at as "updatedAt" FROM payment_method_definitions`;

    const salesPoints = sinceDate
      ? await sql`SELECT id, name, is_active as "isActive", attached_to_mill as "attachedToMill", created_at as "createdAt", updated_at as "updatedAt" FROM sales_points WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, name, is_active as "isActive", attached_to_mill as "attachedToMill", created_at as "createdAt", updated_at as "updatedAt" FROM sales_points`;

    const locations = sinceDate
      ? await sql`SELECT id, location_name as "locationName", is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt" FROM locations WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, location_name as "locationName", is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt" FROM locations`;

    const storageLocations = sinceDate
      ? await sql`SELECT id, sales_point_id as "salesPointId", location_id as "locationId", is_default as "isDefault", is_active as "isActive", is_sales_tank as "isSalesTank", created_at as "createdAt", updated_at as "updatedAt" FROM storage_locations WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, sales_point_id as "salesPointId", location_id as "locationId", is_default as "isDefault", is_active as "isActive", is_sales_tank as "isSalesTank", created_at as "createdAt", updated_at as "updatedAt" FROM storage_locations`;

    const roles = sinceDate
      ? await sql`SELECT id, label, is_system as "isSystem", sort_order as "sortOrder", created_at as "createdAt", updated_at as "updatedAt" FROM roles WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, label, is_system as "isSystem", sort_order as "sortOrder", created_at as "createdAt", updated_at as "updatedAt" FROM roles`;

    const users = sinceDate
      ? await sql`SELECT id, name, role, is_active as "isActive", username, password_plain as "passwordPlain", sales_point_id as "salesPointId", password_hash as "passwordHash", must_change_password as "mustChangePassword", commercial_service_id as "commercialServiceId", created_at as "createdAt", updated_at as "updatedAt" FROM users WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, name, role, is_active as "isActive", username, password_plain as "passwordPlain", sales_point_id as "salesPointId", password_hash as "passwordHash", must_change_password as "mustChangePassword", commercial_service_id as "commercialServiceId", created_at as "createdAt", updated_at as "updatedAt" FROM users`;

    const roleRoutePermissions = await sql`SELECT role, route_id as "routeId", access FROM role_route_permissions`;
    const roleActionPermissions = await sql`SELECT role, action_key as "actionKey", allowed FROM role_action_permissions`;

    const companySettingsRows = await sql`SELECT id, company_name as "companyName", department, vat_rate as "vatRate", fiscal_year_start_month as "fiscalYearStartMonth", logo_url as "logoUrl", ui_theme_preset as "uiThemePreset", hide_zero_report_rows as "hideZeroReportRows", stock_commitment_report_comments as "stockCommitmentReportComments", report_comments_json as "reportCommentsJson" FROM company_settings WHERE id = 'default' LIMIT 1`;

    const documentBooklets = sinceDate
      ? await sql`SELECT id, document_kind as "documentKind", booklet_code as "bookletCode", start_serial as "startSerial", end_serial as "endSerial", sales_point_id as "salesPointId", status, issued_at as "issuedAt", issued_by_user_id as "issuedByUserId", validated_at as "validatedAt", validated_by_user_id as "validatedByUserId", notes, created_at as "createdAt", updated_at as "updatedAt" FROM document_booklets WHERE updated_at > ${sinceDate}`
      : await sql`SELECT id, document_kind as "documentKind", booklet_code as "bookletCode", start_serial as "startSerial", end_serial as "endSerial", sales_point_id as "salesPointId", status, issued_at as "issuedAt", issued_by_user_id as "issuedByUserId", validated_at as "validatedAt", validated_by_user_id as "validatedByUserId", notes, created_at as "createdAt", updated_at as "updatedAt" FROM document_booklets`;

    return c.json({
      since: since || null,
      serverTime: new Date().toISOString(),
      products,
      productCategories,
      productUnitPrices,
      customerTypes,
      customers,
      taxRegimes,
      taxRateSchedules,
      paymentMethods,
      salesPoints,
      locations,
      storageLocations,
      roles,
      users,
      roleRoutePermissions,
      roleActionPermissions,
      companySettings: companySettingsRows[0] || null,
      documentBooklets,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 500);
  }
});
