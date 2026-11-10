/*
  DJYum — restaurant table management for dine-in orders.
*/
import { Op } from "sequelize";
import { RestaurantTable, Order } from "../models/index.js";
import { flashError, flashSuccess, toInt } from "../utils/pos.js";

const ACTIVE_ORDER_STATUSES = ["Pending", "Preparing", "Ready"];

const activeOrdersByTable = async () => {
  const orders = await Order.findAll({
    where: { status: { [Op.in]: ACTIVE_ORDER_STATUSES } },
    order: [["createdAt", "DESC"]],
  });
  const map = new Map();
  orders.forEach((order) => {
    if (order.tableId && !map.has(order.tableId)) map.set(order.tableId, order);
  });
  return map;
};

export const tableList = async (req, res, next) => {
  try {
    const [tables, activeMap] = await Promise.all([
      RestaurantTable.findAll({ order: [["name", "ASC"]] }),
      activeOrdersByTable(),
    ]);

    const rows = tables.map((table) => ({
      ...table.toJSON(),
      activeOrder: activeMap.get(table.id) || null,
    }));

    return res.render("pos/tables", {
      title: "Table Management",
      active: "tables",
      tables: rows,
      totals: {
        total: rows.length,
        available: rows.filter((table) => table.status === "Available").length,
        occupied: rows.filter((table) => table.status === "Occupied").length,
        reserved: rows.filter((table) => table.status === "Reserved").length,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const tableCreate = async (req, res, next) => {
  const name = String(req.body.name || "").trim();
  const capacity = toInt(req.body.capacity);
  const location = String(req.body.location || "").trim();

  if (name.length < 1 || name.length > 60) {
    flashError(req, "Table name is required (maximum 60 characters).");
    return res.redirect("/pos/tables");
  }
  if (!Number.isFinite(capacity) || capacity < 1 || capacity > 40) {
    flashError(req, "Capacity must be between 1 and 40 seats.");
    return res.redirect("/pos/tables");
  }

  try {
    const existing = await RestaurantTable.findOne({ where: { name } });
    if (existing) {
      flashError(req, `A table named "${name}" already exists.`);
      return res.redirect("/pos/tables");
    }
    await RestaurantTable.create({
      name,
      capacity,
      location: location || null,
      status: "Available",
    });
    flashSuccess(req, `Table "${name}" added.`);
    return res.redirect("/pos/tables");
  } catch (error) {
    return next(error);
  }
};

export const tableUpdate = async (req, res, next) => {
  const name = String(req.body.name || "").trim();
  const capacity = toInt(req.body.capacity);

  if (!name) {
    flashError(req, "Table name is required.");
    return res.redirect("/pos/tables");
  }
  if (!Number.isFinite(capacity) || capacity < 1 || capacity > 40) {
    flashError(req, "Capacity must be between 1 and 40 seats.");
    return res.redirect("/pos/tables");
  }

  try {
    const table = await RestaurantTable.findByPk(req.params.id);
    if (!table) {
      flashError(req, "Table not found.");
      return res.redirect("/pos/tables");
    }
    const duplicate = await RestaurantTable.findOne({
      where: { name, id: { [Op.ne]: table.id } },
    });
    if (duplicate) {
      flashError(req, `Another table is already named "${name}".`);
      return res.redirect("/pos/tables");
    }
    await table.update({
      name,
      capacity,
      location: String(req.body.location || "").trim() || null,
    });
    flashSuccess(req, "Table updated.");
    return res.redirect("/pos/tables");
  } catch (error) {
    return next(error);
  }
};

export const tableStatus = async (req, res, next) => {
  const status = String(req.body.status || "");
  if (!["Available", "Occupied", "Reserved"].includes(status)) {
    flashError(req, "Invalid table status.");
    return res.redirect("/pos/tables");
  }

  try {
    const table = await RestaurantTable.findByPk(req.params.id);
    if (!table) {
      flashError(req, "Table not found.");
      return res.redirect("/pos/tables");
    }

    const activeOrder = await Order.findOne({
      where: { tableId: table.id, status: { [Op.in]: ACTIVE_ORDER_STATUSES } },
    });
    if (status === "Available" && activeOrder) {
      flashError(
        req,
        `${table.name} has an active order (${activeOrder.orderNumber}). Complete or cancel it first.`
      );
      return res.redirect("/pos/tables");
    }

    await table.update({ status });
    flashSuccess(req, `${table.name} marked ${status}.`);
    return res.redirect("/pos/tables");
  } catch (error) {
    return next(error);
  }
};
