/*
  DJYum — sales and inventory reports. All figures come from live rows.
*/
import { QueryTypes } from "sequelize";
import { sequelize } from "../models/index.js";
import { getSettings, num, resolvePeriod, round2 } from "../utils/pos.js";

const dateOnly = (value) => {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
      value.getDate()
    ).padStart(2, "0")}`;
  }
  return String(value ?? "").slice(0, 10);
};

const salesAggregates = async (start, end) => {
  const [summary] = await sequelize.query(
    `SELECT COUNT(*) AS transactions,
            COALESCE(SUM(subtotal),0) AS subtotal,
            COALESCE(SUM(discountAmount),0) AS discount,
            COALESCE(SUM(taxAmount),0) AS tax,
            COALESCE(SUM(serviceCharge),0) AS service,
            COALESCE(SUM(totalAmount),0) AS total,
            COALESCE(AVG(totalAmount),0) AS average
     FROM transactions
     WHERE status = 'Completed' AND createdAt BETWEEN :start AND :end`,
    { replacements: { start, end }, type: QueryTypes.SELECT }
  );
  return {
    transactions: Number(summary?.transactions ?? 0),
    subtotal: round2(summary?.subtotal ?? 0),
    discount: round2(summary?.discount ?? 0),
    tax: round2(summary?.tax ?? 0),
    service: round2(summary?.service ?? 0),
    total: round2(summary?.total ?? 0),
    average: round2(summary?.average ?? 0),
  };
};

const salesBreakdowns = async (start, end) => {
  const [daily, byMethod, byType, byCashier, topProducts, cancelled, voided] =
    await Promise.all([
      sequelize.query(
        `SELECT DATE(createdAt) AS day, COUNT(*) AS count, SUM(totalAmount) AS total
         FROM transactions
         WHERE status = 'Completed' AND createdAt BETWEEN :start AND :end
         GROUP BY DATE(createdAt) ORDER BY day DESC`,
        { replacements: { start, end }, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT p.method, COUNT(*) AS count, COALESCE(SUM(p.amount),0) AS total
         FROM payments p
         JOIN transactions t ON t.id = p.transactionId
         WHERE p.status = 'Paid' AND t.createdAt BETWEEN :start AND :end
         GROUP BY p.method ORDER BY total DESC`,
        { replacements: { start, end }, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT o.orderType, COUNT(*) AS count, COALESCE(SUM(t.totalAmount),0) AS total
         FROM transactions t JOIN orders o ON o.id = t.orderId
         WHERE t.status = 'Completed' AND t.createdAt BETWEEN :start AND :end
         GROUP BY o.orderType`,
        { replacements: { start, end }, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT cashierName, COUNT(*) AS count, COALESCE(SUM(totalAmount),0) AS total
         FROM transactions
         WHERE status = 'Completed' AND createdAt BETWEEN :start AND :end
         GROUP BY cashierName ORDER BY total DESC`,
        { replacements: { start, end }, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT oi.productName AS name, SUM(oi.quantity) AS qty,
                COALESCE(SUM(oi.subtotal),0) AS revenue
         FROM order_items oi
         JOIN transactions t ON t.orderId = oi.orderId
         WHERE t.status = 'Completed' AND t.createdAt BETWEEN :start AND :end
         GROUP BY oi.productName ORDER BY qty DESC LIMIT 10`,
        { replacements: { start, end }, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT id, transactionNumber, orderNumber, totalAmount, paymentStatus, createdAt
         FROM transactions
         WHERE status <> 'Completed' AND createdAt BETWEEN :start AND :end
         ORDER BY createdAt DESC LIMIT 50`,
        { replacements: { start, end }, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(totalAmount),0) AS total
         FROM transactions WHERE status = 'Voided' AND createdAt BETWEEN :start AND :end`,
        { replacements: { start, end }, type: QueryTypes.SELECT }
      ),
    ]);

  return {
    daily: daily.map((row) => ({
      day: dateOnly(row.day),
      count: Number(row.count),
      total: round2(row.total),
    })),
    byMethod: byMethod.map((row) => ({ ...row, count: Number(row.count), total: round2(row.total) })),
    byType: byType.map((row) => ({ ...row, count: Number(row.count), total: round2(row.total) })),
    byCashier: byCashier.map((row) => ({ ...row, count: Number(row.count), total: round2(row.total) })),
    topProducts: topProducts.map((row) => ({
      name: row.name,
      qty: Number(row.qty),
      revenue: round2(row.revenue),
    })),
    cancelled,
    voided: { count: Number(voided[0]?.count ?? 0), total: round2(voided[0]?.total ?? 0) },
  };
};

const stockRows = () =>
  sequelize.query(
    `SELECT p.id AS productId, p.name, p.price, c.name AS categoryName,
            i.currentStock, i.minStockLevel, i.unit, i.lastUpdated
     FROM products p
     LEFT JOIN categories c ON c.id = p.categoryId
     LEFT JOIN inventory i ON i.productId = p.id
     WHERE p.status = 'active'
     ORDER BY p.name ASC`,
    { type: QueryTypes.SELECT }
  );

const mapStockRows = (rows) =>
  rows.map((row) => {
    const currentStock = Number(row.currentStock ?? 0);
    const minStockLevel = Number(row.minStockLevel ?? 0);
    return {
      ...row,
      currentStock,
      minStockLevel,
      price: round2(row.price),
      value: round2(currentStock * num(row.price)),
      status:
        currentStock <= 0
          ? "Out of Stock"
          : currentStock <= minStockLevel
          ? "Low Stock"
          : "In Stock",
    };
  });

export const salesReport = async (req, res, next) => {
  try {
    const range = resolvePeriod(req.query);
    const settings = await getSettings();
    const [summary, breakdowns] = await Promise.all([
      salesAggregates(range.start, range.end),
      salesBreakdowns(range.start, range.end),
    ]);

    return res.render("pos/reports/sales", {
      title: "Sales Reports",
      active: "reports-sales",
      range,
      summary,
      ...breakdowns,
      posSettings: settings,
    });
  } catch (error) {
    return next(error);
  }
};

export const inventoryReport = async (req, res, next) => {
  try {
    const range = resolvePeriod(req.query);
    const rows = mapStockRows(await stockRows());

    const [movementSummary, modalMovements] = await Promise.all([
      sequelize.query(
        `SELECT type, COUNT(*) AS count, COALESCE(SUM(quantity),0) AS units
         FROM inventory_movements
         WHERE createdAt BETWEEN :start AND :end
         GROUP BY type`,
        { replacements: { start: range.start, end: range.end }, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT * FROM inventory_movements
         WHERE createdAt BETWEEN :start AND :end
         ORDER BY createdAt DESC LIMIT 100`,
        { replacements: { start: range.start, end: range.end }, type: QueryTypes.SELECT }
      ),
    ]);

    const movementStats = {
      stockIn: { count: 0, units: 0 },
      stockOut: { count: 0, units: 0 },
      salesDeduction: { count: 0, units: 0 },
      adjustment: { count: 0, units: 0 },
      voidReversal: { count: 0, units: 0 },
    };
    const statKeys = {
      "Stock In": "stockIn",
      "Stock Out": "stockOut",
      "Sales Deduction": "salesDeduction",
      Adjustment: "adjustment",
      "Void/Reversal": "voidReversal",
    };
    movementSummary.forEach((row) => {
      const key = statKeys[row.type];
      if (key) {
        movementStats[key] = {
          count: Number(row.count),
          units: Number(row.units),
        };
      }
    });

    return res.render("pos/reports/inventory", {
      title: "Inventory Reports",
      active: "reports-inventory",
      range,
      rows,
      movementSummary,
      movementStats,
      movements: modalMovements,
      totals: {
        products: rows.length,
        units: rows.reduce((sum, row) => sum + row.currentStock, 0),
        value: round2(rows.reduce((sum, row) => sum + row.value, 0)),
        low: rows.filter((row) => row.status === "Low Stock").length,
        out: rows.filter((row) => row.status === "Out of Stock").length,
      },
      movementsByType: Object.fromEntries(
        movementSummary.map((row) => [
          row.type,
          { count: Number(row.count), units: Number(row.units) },
        ])
      ),
    });
  } catch (error) {
    return next(error);
  }
};

const csvCell = (value) => {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const sendCsv = (res, filename, header, rows) => {
  const lines = [header.map(csvCell).join(",")];
  rows.forEach((row) => lines.push(row.map(csvCell).join(",")));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`\uFEFF${lines.join("\r\n")}`);
};

export const exportReport = async (req, res, next) => {
  try {
    const type = String(req.query.type || "sales");
    const range = resolvePeriod(req.query);
    const stamp = `${range.from}_to_${range.to}`;

    if (type === "sales") {
      const [summary, breakdowns] = await Promise.all([
        salesAggregates(range.start, range.end),
        salesBreakdowns(range.start, range.end),
      ]);
      const rows = [
        ["Summary", ""],
        ["Date range", `${range.from} to ${range.to}`],
        ["Transactions", summary.transactions],
        ["Subtotal", summary.subtotal],
        ["Discounts", summary.discount],
        ["Tax", summary.tax],
        ["Service charge", summary.service],
        ["Total sales", summary.total],
        ["Average transaction", summary.average],
        [],
        ["Payment method", "Transactions", "Amount"],
        ...breakdowns.byMethod.map((row) => [row.method, row.count, row.total]),
        [],
        ["Order type", "Transactions", "Amount"],
        ...breakdowns.byType.map((row) => [row.orderType, row.count, row.total]),
        [],
        ["Cashier", "Transactions", "Amount"],
        ...breakdowns.byCashier.map((row) => [row.cashierName, row.count, row.total]),
        [],
        ["Best-selling product", "Quantity", "Revenue"],
        ...breakdowns.topProducts.map((row) => [row.name, row.qty, row.revenue]),
      ];
      return sendCsv(res, `djyum-sales-${stamp}.csv`, ["Metric", "Value", "Extra"], rows);
    }

    if (type === "inventory") {
      const rows = mapStockRows(await stockRows());
      return sendCsv(
        res,
        `djyum-inventory-${stamp}.csv`,
        ["Product", "Category", "Unit", "Current stock", "Minimum level", "Status", "Unit price", "Stock value"],
        rows.map((row) => [
          row.name,
          row.categoryName || "",
          row.unit || "pcs",
          row.currentStock,
          row.minStockLevel,
          row.status,
          row.price,
          row.value,
        ])
      );
    }

    if (type === "movements") {
      const movements = await sequelize.query(
        `SELECT createdAt, type, productName, quantity, previousStock, newStock,
                referenceNumber, reason, performedByName
         FROM inventory_movements
         WHERE createdAt BETWEEN :start AND :end
         ORDER BY createdAt DESC`,
        { replacements: { start: range.start, end: range.end }, type: QueryTypes.SELECT }
      );
      return sendCsv(
        res,
        `djyum-stock-movements-${stamp}.csv`,
        ["Date", "Type", "Product", "Quantity", "Previous stock", "New stock", "Reference", "Reason", "Performed by"],
        movements.map((row) => [
          row.createdAt,
          row.type,
          row.productName,
          row.quantity,
          row.previousStock,
          row.newStock,
          row.referenceNumber || "",
          row.reason || "",
          row.performedByName || "",
        ])
      );
    }

    return res.status(400).send("Unknown export type.");
  } catch (error) {
    return next(error);
  }
};
