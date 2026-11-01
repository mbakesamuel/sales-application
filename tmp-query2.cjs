const Database = require("better-sqlite3");
const db = new Database("C:/Users/user/AppData/Roaming/sales-electron/sales.db", { readonly: true });
const rows = db.prepare(`
SELECT s.dateIssued, s.saleDisposition, p.productName,
       COALESCE(sl.qtyUnits, sl.qtyKg) AS units, sl.lineNet,
       pm.code AS payCode, pm.kind AS payKind, pay.amount
FROM Sale s
JOIN SaleLine sl ON sl.saleId = s.id
JOIN Product p ON p.productId = sl.productId
LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
LEFT JOIN Payment pay ON pay.saleId = s.id
LEFT JOIN PaymentMethodDefinition pm ON pm.id = pay.paymentMethodId
WHERE s.status = 'VALIDATED' AND COALESCE(pc.isBottled,0)=1 AND s.dateIssued >= '2026-01-01'
ORDER BY s.dateIssued
`).all();
console.log(JSON.stringify(rows, null, 2));
