/*
  DJYum — POS dashboard. Every figure is aggregated from live database rows.
*/
import { Op, QueryTypes } from "sequelize";
import {
  sequelize,
  Order,
  Product,
  InventoryMovement,
  Transaction,
  RestaurantTable,
} from "../models/index.js";
import { startOfDay, endOfDay, getSettings, round2 } from "../utils/pos.js";

const isoDay = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const dayKey = (value) =>
  value instanceof Date ? isoDay(value) : String(value ?? "").slice(0, 10);

const fillBuckets = (rows, buckets, keyField = "day") => {
  const map = new Map(
    rows.map((row) => [dayKey(row[keyField]), row])
  );
  return buckets.map(({ key, label }) => {
    const row = map.get(key);
    return {
      label,
      total: round2(row?.total ?? 0),
      count: Number(row?.count ?? 0),
    };
  });
};

const dailyBuckets = (days = 7) => {
  const list = [];
  const cursor = startOfDay(new Date());
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() + i);
    list.push({
      key: isoDay(date),
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    });
  }
  return list;
};

const monthlyBuckets = (months = 6) => {
  const list = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    list.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    });
  }
  return list;
};

const weeklyBuckets = (weeks = 8) => {
  const list = [];
  const now = new Date();
  const thisMonday = startOfDay(now);
  const weekday = (thisMonday.getDay() + 6) % 7; // Monday = 0
  thisMonday.setDate(thisMonday.getDate() - weekday);

  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = new Date(thisMonday);
    start.setDate(thisMonday.getDate() - i * 7);
    list.push({
      key: isoDay(start),
      label: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    });
  }
  return list;
};

const loadSalesCharts = async () => {
  const dailyFrom = startOfDay(new Date());
  dailyFrom.setDate(dailyFrom.getDate() - 6);
  const weeklyFrom = startOfDay(new Date());
  weeklyFrom.setDate(weeklyFrom.getDate() - 55);
  const monthlyFrom = new Date(new Date().getFullYear(), new Date().getMonth() - 5, 1);

  const [dailyRows, weeklyRows, monthlyRows] = await Promise.all([
    sequelize.query(
      `SELECT DATE(createdAt) AS day, SUM(totalAmount) AS total, COUNT(*) AS count
       FROM transactions
       WHERE status = 'Completed' AND createdAt >= :from
       GROUP BY DATE(createdAt)`,
      { replacements: { from: dailyFrom }, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT DATE_FORMAT(DATE_SUB(createdAt, INTERVAL WEEKDAY(createdAt) DAY), '%Y-%m-%d') AS day,
              SUM(totalAmount) AS total, COUNT(*) AS count
       FROM transactions
       WHERE status = 'Completed' AND createdAt >= :from
       GROUP BY day`,
      { replacements: { from: weeklyFrom }, type: QueryTypes.SELECT }
    ),
    sequelize.query(
      `SELECT DATE_FORMAT(createdAt, '%Y-%m') AS month, SUM(totalAmount) AS total, COUNT(*) AS count
       FROM transactions
       WHERE status = 'Completed' AND createdAt >= :from
       GROUP BY month`,
      { replacements: { from: monthlyFrom }, type: QueryTypes.SELECT }
    ),
  ]);

  return {
    daily: fillBuckets(dailyRows, dailyBuckets(7)),
    weekly: fillBuckets(weeklyRows, weeklyBuckets(8)),
    monthly: fillBuckets(monthlyRows, monthlyBuckets(6), "month"),
  };
};

const loadSummary = async () => {
  const now = new Date();
  const today = { start: startOfDay(now), end: endOfDay(now) };
  const completedToday = {
    status: "Completed",
    createdAt: { [Op.gte]: today.start, [Op.lte]: today.end },
  };

  const [
    salesTodayRow,
    transactionsToday,
    ordersToday,
    totalOrders,
    products,
    stockSummary,
    tables,
    cancelledToday,
  ] = await Promise.all([
    sequelize.query(
      `SELECT COALESCE(SUM(totalAmount),0) AS total, COUNT(*) AS count
       FROM transactions WHERE status = 'Completed' AND createdAt BETWEEN :start AND :end`,
      { replacements: { start: today.start, end: today.end }, type: QueryTypes.SELECT }
    ),
    Transaction.count({ where: completedToday }),
    Order.count({ where: { createdAt: { [Op.gte]: today.start, [Op.lte]: today.end } } }),
    Order.count(),
    Product.count({ where: { status: "active" } }),
    sequelize.query(
      `SELECT COALESCE(SUM(i.currentStock),0) AS totalStock,
              SUM(CASE WHEN i.currentStock = 0 THEN 1 ELSE 0 END) AS outOfStock,
              SUM(CASE WHEN i.currentStock > 0 AND i.currentStock <= i.minStockLevel THEN 1 ELSE 0 END) AS lowStock
       FROM inventory i
       JOIN products p ON p.id = i.productId AND p.status = 'active'`,
      { type: QueryTypes.SELECT }
    ),
    RestaurantTable.findAll({ order: [["name", "ASC"]] }),
    Transaction.count({
      where: {
        createdAt: { [Op.gte]: today.start, [Op.lte]: today.end },
        status: { [Op.ne]: "Completed" },
      },
    }),
  ]);

  const stock = stockSummary[0] || {};
  return {
    salesToday: round2(salesTodayRow[0]?.total ?? 0),
    transactionsToday: Number(transactionsToday),
    ordersToday: Number(ordersToday),
    totalOrders: Number(totalOrders),
    totalProducts: Number(products),
    totalStock: Number(stock.totalStock ?? 0),
    lowStock: Number(stock.lowStock ?? 0),
    outOfStock: Number(stock.outOfStock ?? 0),
    cancelledToday: Number(cancelledToday),
    tablesAvailable: tables.filter((t) => t.status === "Available").length,
    tablesOccupied: tables.filter((t) => t.status === "Occupied").length,
    tablesTotal: tables.length,
  };
};

const loadPanels = async () => {
  const [bestSellers, recentTransactions, recentMovements] = await Promise.all([
    sequelize.query(
      `SELECT oi.productName AS name, SUM(oi.quantity) AS qty, SUM(oi.subtotal) AS revenue
       FROM order_items oi
       JOIN transactions t ON t.orderId = oi.orderId
       WHERE t.status = 'Completed' AND t.createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY oi.productName
       ORDER BY qty DESC
       LIMIT 5`,
      { type: QueryTypes.SELECT }
    ),
    Transaction.findAll({
      where: { status: "Completed" },
      include: [{ model: Order, as: "order", attributes: ["orderType", "status"] }],
      order: [["createdAt", "DESC"]],
      limit: 6,
    }),
    InventoryMovement.findAll({ order: [["createdAt", "DESC"]], limit: 6 }),
  ]);

  return {
    bestSellers: bestSellers.map((row) => ({
      name: row.name,
      qty: Number(row.qty ?? 0),
      revenue: round2(row.revenue ?? 0),
    })),
    recentTransactions,
    recentMovements,
  };
};

export const dashboardPage = async (req, res, next) => {
  try {
    const [summary, charts, panels, settings] = await Promise.all([
      loadSummary(),
      loadSalesCharts(),
      loadPanels(),
      getSettings(),
    ]);
    return res.render("dashboard", {
      title: "Dashboard",
      active: "dashboard",
      summary,
      charts,
      posSettings: settings,
      ...panels,
    });
  } catch (error) {
    return next(error);
  }
};

export const dashboardStats = async (req, res, next) => {
  try {
    const [summary, charts] = await Promise.all([loadSummary(), loadSalesCharts()]);
    return res.json({ success: true, summary, charts });
  } catch (error) {
    return next(error);
  }
};

export const dashboardSummaryOnly = loadSummary;
