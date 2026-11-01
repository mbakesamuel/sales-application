const Database = require("better-sqlite3");
const db = new Database(
  "C:/Users/user/AppData/Roaming/sales-electron/sales.db",
  { readonly: true },
);

function detect(productName, productCode) {
  const text = `${productName} ${productCode ?? ""}`.toUpperCase();
  if (text.includes("20L") || text.includes("JUG")) return "jug20";
  if (text.includes("3X5") || (text.includes("5L") && text.includes("CTN"))) return "carton5";
  if (text.includes("15L")) return "carton15";
  if (text.includes("1L")) return "unit1";
  return "other";
}

const products = db
  .prepare(
    `SELECT p.productId, p.productName, p.productCode, pc.productCat, pc.isBottled
     FROM Product p
     LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
     WHERE COALESCE(pc.isBottled, 0) = 1
     ORDER BY p.productName`,
  )
  .all()
  .map((p) => ({ ...p, pack: detect(p.productName, p.productCode) }));

console.log("PRODUCTS", JSON.stringify(products, null, 2));

const sales = db
  .prepare(
    `SELECT s.dateIssued, p.productName, p.productCode,
            COALESCE(sl.qtyUnits, sl.qtyKg) AS units, sl.lineNet
     FROM Sale s
     JOIN SaleLine sl ON sl.saleId = s.id
     JOIN Product p ON p.productId = sl.productId
     LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
     WHERE s.status = 'VALIDATED'
       AND COALESCE(pc.isBottled, 0) = 1
       AND s.dateIssued >= '2026-01-01'
     ORDER BY s.dateIssued
     LIMIT 100`,
  )
  .all()
  .map((row) => ({ ...row, pack: detect(row.productName, row.productCode) }));

console.log("SALES", JSON.stringify(sales, null, 2));

const byPack = {};
for (const row of sales) {
  byPack[row.pack] = (byPack[row.pack] ?? 0) + Number(row.units);
}
console.log("UNITS BY PACK", byPack);
