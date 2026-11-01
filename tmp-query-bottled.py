import json
import sqlite3

db = sqlite3.connect(r"C:\Users\user\AppData\Roaming\sales-electron\sales.db")
db.row_factory = sqlite3.Row


def detect(product_name, product_code):
    text = f"{product_name} {product_code or ''}".upper()
    if "20L" in text or "JUG" in text:
        return "jug20"
    if "3X5" in text or ("5L" in text and "CTN" in text):
        return "carton5"
    if "15L" in text:
        return "carton15"
    if "1L" in text:
        return "unit1"
    return "other"


products = []
for row in db.execute(
    """
    SELECT p.productId, p.productName, p.productCode, pc.productCat, pc.isBottled
    FROM Product p
    LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
    WHERE COALESCE(pc.isBottled, 0) = 1
    ORDER BY p.productName
    """
):
    item = dict(row)
    item["pack"] = detect(item["productName"], item["productCode"])
    products.append(item)

print("PRODUCTS")
print(json.dumps(products, indent=2))

sales = []
for row in db.execute(
    """
    SELECT s.dateIssued, p.productName, p.productCode,
           COALESCE(sl.qtyUnits, sl.qtyKg) AS units, sl.lineNet
    FROM Sale s
    JOIN SaleLine sl ON sl.saleId = s.id
    JOIN Product p ON p.productId = sl.productId
    LEFT JOIN ProductCat pc ON pc.productCatId = p.productCatId
    WHERE s.status = 'VALIDATED'
      AND COALESCE(pc.isBottled, 0) = 1
      AND s.dateIssued >= '2026-01-01'
    ORDER BY s.dateIssued
    LIMIT 100
    """
):
    item = dict(row)
    item["pack"] = detect(item["productName"], item["productCode"])
    sales.append(item)

print("SALES")
print(json.dumps(sales, indent=2))

by_pack = {}
for row in sales:
    by_pack[row["pack"]] = by_pack.get(row["pack"], 0) + float(row["units"] or 0)
print("UNITS BY PACK", by_pack)
