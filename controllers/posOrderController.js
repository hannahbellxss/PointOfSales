/*
  DJYum — order list, order details and lifecycle transitions.
*/
import { Op } from "sequelize";
import {
  Order,
  OrderItem,
  RestaurantTable,
  Transaction as SaleTransaction,
} from "../models/index.js";
import { flashError, flashSuccess, toInt } from "../utils/pos.js";

const ACTIVE = ["Pending", "Preparing", "Ready"];
const ALLOWED_TRANSITIONS = {
  Pending: ["Preparing"],
  Preparing: ["Ready"],
  Ready: ["Completed"],
  Completed: [],
  Cancelled: [],
};

const canAccessOrder = (user, order) =>
  user.role !== "cashier" || order.cashierId === user.id;

export const orderList = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();
    const orderType = String(req.query.type || "").trim();
    const date = String(req.query.date || "").trim();

    const where = {};
    if (["Pending", "Preparing", "Ready", "Completed", "Cancelled"].includes(status)) {
      where.status = status;
    }
    if (["Dine-In", "Take-Out"].includes(orderType)) where.orderType = orderType;
    if (q) where.orderNumber = { [Op.like]: `%${q}%` };
    if (date) {
      const start = new Date(`${date}T00:00:00`);
      const end = new Date(`${date}T23:59:59.999`);
      if (!Number.isNaN(start.getTime())) where.createdAt = { [Op.gte]: start, [Op.lte]: end };
    }
    if (req.user.role === "cashier") where.cashierId = req.user.id;

    const orders = await Order.findAll({
      where,
      include: [{ model: RestaurantTable, as: "table", attributes: ["id", "name"] }],
      order: [["createdAt", "DESC"]],
      limit: 200,
    });

    const statusCounts = await Order.findAll({
      attributes: ["status", [Order.sequelize.fn("COUNT", Order.sequelize.col("id")), "count"]],
      group: ["status"],
      raw: true,
    });

    return res.render("pos/orders/index", {
      title: "Orders",
      active: "orders",
      orders,
      filters: { q, status, type: orderType, date },
      counts: Object.fromEntries(statusCounts.map((row) => [row.status, Number(row.count)])),
      activeStatuses: ACTIVE,
    });
  } catch (error) {
    return next(error);
  }
};

export const orderShow = async (req, res, next) => {
  try {
    const order = await Order.findByPk(req.params.id, {
      include: [
        { model: OrderItem, as: "items" },
        { model: RestaurantTable, as: "table" },
        {
          model: SaleTransaction,
          as: "transaction",
          include: [{ model: SaleTransaction.sequelize.models.Payment, as: "payments" }],
        },
      ],
    });
    if (!order) {
      flashError(req, "Order not found.");
      return res.redirect("/pos/orders");
    }
    if (!canAccessOrder(req.user, order)) {
      flashError(req, "You can only view your own orders.");
      return res.redirect("/pos/orders");
    }

    return res.render("pos/orders/show", {
      title: `Order ${order.orderNumber}`,
      active: "orders",
      order: order.toJSON(),
      allowedTransitions: ALLOWED_TRANSITIONS[order.status] || [],
      canUpdateStatus: ["admin", "staff"].includes(req.user.role),
      canCancel:
        order.status === "Pending" &&
        (req.user.role === "admin" || order.cashierId === req.user.id),
    });
  } catch (error) {
    return next(error);
  }
};

export const updateOrderStatus = async (req, res, next) => {
  const target = String(req.body.status || "");
  try {
    const order = await Order.findByPk(req.params.id);
    if (!order) {
      flashError(req, "Order not found.");
      return res.redirect("/pos/orders");
    }

    const allowed = ALLOWED_TRANSITIONS[order.status] || [];
    if (!allowed.includes(target)) {
      flashError(req, `Order ${order.orderNumber} cannot move from ${order.status} to ${target || "that status"}.`);
      return res.redirect(`/pos/orders/${order.id}`);
    }

    if (target === "Completed") {
      const paid = await SaleTransaction.findOne({
        where: { orderId: order.id, paymentStatus: "Paid", status: "Completed" },
      });
      if (!paid) {
        flashError(req, "This order has not been paid yet. Complete checkout first.");
        return res.redirect(`/pos/orders/${order.id}`);
      }
    }

    await order.update({ status: target });
    flashSuccess(req, `Order ${order.orderNumber} marked ${target}.`);
    return res.redirect(`/pos/orders/${order.id}`);
  } catch (error) {
    return next(error);
  }
};

export const cancelOrder = async (req, res, next) => {
  try {
    const order = await Order.findByPk(req.params.id);
    if (!order) {
      flashError(req, "Order not found.");
      return res.redirect("/pos/orders");
    }
    if (req.user.role === "cashier" && order.cashierId !== req.user.id) {
      flashError(req, "You can only cancel your own orders.");
      return res.redirect("/pos/orders");
    }
    if (order.status !== "Pending") {
      flashError(
        req,
        "Only pending, unpaid orders can be cancelled. Paid sales require an authorized void."
      );
      return res.redirect(`/pos/orders/${order.id}`);
    }

    const paid = await SaleTransaction.findOne({ where: { orderId: order.id } });
    if (paid) {
      flashError(req, "A payment already exists for this order. Use the authorized void instead.");
      return res.redirect(`/pos/orders/${order.id}`);
    }

    await order.update({ status: "Cancelled" });
    if (order.tableId) {
      await RestaurantTable.update(
        { status: "Available" },
        { where: { id: order.tableId } }
      );
    }
    flashSuccess(req, `Order ${order.orderNumber} cancelled.`);
    return res.redirect("/pos/orders");
  } catch (error) {
    return next(error);
  }
};
