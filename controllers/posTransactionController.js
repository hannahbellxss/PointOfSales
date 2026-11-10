/*
  DJYum — transaction history, receipt and authorized void/refund.
*/
import { Op, QueryTypes } from "sequelize";
import {
  sequelize,
  Order,
  OrderItem,
  RestaurantTable,
  Transaction as SaleTransaction,
  Payment,
  TransactionDiscount,
  Inventory,
  InventoryMovement,
} from "../models/index.js";
import {
  PosError,
  flashError,
  flashSuccess,
  getSettings,
  generateNumber,
  num,
  round2,
  toInt,
} from "../utils/pos.js";

const METHOD_FILTERS = ["Cash", "GCash", "Maya", "Credit/Debit Card"];

const scopedWhere = (user, where = {}) => {
  if (user.role === "cashier") where.cashierId = user.id;
  return where;
};

const loadTransaction = (id, extra = {}) =>
  SaleTransaction.findByPk(id, {
    include: [
      { model: Payment, as: "payments" },
      { model: TransactionDiscount, as: "discounts" },
      {
        model: Order,
        as: "order",
        include: [
          { model: OrderItem, as: "items" },
          { model: RestaurantTable, as: "table" },
        ],
      },
    ],
    ...extra,
  });

export const transactionList = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const method = String(req.query.method || "").trim();
    const cashierId = toInt(req.query.cashier) || null;
    const status = String(req.query.status || "").trim();

    const where = {};
    if (q) {
      where[Op.or] = [
        { transactionNumber: { [Op.like]: `%${q}%` } },
        { orderNumber: { [Op.like]: `%${q}%` } },
      ];
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt[Op.gte] = new Date(`${from}T00:00:00`);
      if (to) where.createdAt[Op.lte] = new Date(`${to}T23:59:59.999`);
    }
    if (cashierId) where.cashierId = cashierId;
    if (["Paid", "Pending", "Failed", "Refunded"].includes(status)) {
      where.paymentStatus = status;
    }
    scopedWhere(req.user, where);

    const paymentInclude = {
      model: Payment,
      as: "payments",
      required: false,
    };
    if (METHOD_FILTERS.includes(method)) {
      paymentInclude.where = { method };
      paymentInclude.required = true;
    }

    const [transactions, summary] = await Promise.all([
      SaleTransaction.findAll({
        where,
        include: [paymentInclude],
        order: [["createdAt", "DESC"]],
        limit: 200,
      }),
      sequelize.query(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN status = 'Completed' THEN totalAmount ELSE 0 END),0) AS completedSales,
                COALESCE(SUM(CASE WHEN status <> 'Completed' THEN totalAmount ELSE 0 END),0) AS voidedSales
         FROM transactions
         WHERE (:cashierScope = 0 OR cashierId = :cashierId)`,
        {
          replacements: {
            cashierScope: req.user.role === "cashier" ? 1 : 0,
            cashierId: req.user.id,
          },
          type: QueryTypes.SELECT,
        }
      ),
    ]);

    const cashiers = await SaleTransaction.findAll({
      attributes: ["cashierId", "cashierName"],
      group: ["cashierId", "cashierName"],
      raw: true,
    });

    return res.render("pos/transactions/index", {
      title: "Transaction History",
      active: "transactions",
      transactions,
      cashiers,
      methods: METHOD_FILTERS,
      filters: { q, from, to, method, cashier: cashierId || "", status },
      summary: {
        count: Number(summary[0]?.count ?? 0),
        completedSales: round2(summary[0]?.completedSales ?? 0),
        voidedSales: round2(summary[0]?.voidedSales ?? 0),
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const transactionShow = async (req, res, next) => {
  try {
    const transaction = await loadTransaction(req.params.id);
    if (!transaction) {
      flashError(req, "Transaction not found.");
      return res.redirect("/pos/transactions");
    }
    if (req.user.role === "cashier" && transaction.cashierId !== req.user.id) {
      flashError(req, "You can only view your own transactions.");
      return res.redirect("/pos/transactions");
    }

    const movements = await InventoryMovement.findAll({
      where: { referenceNumber: transaction.orderNumber },
      order: [["createdAt", "ASC"]],
    });

    return res.render("pos/transactions/show", {
      title: `Transaction ${transaction.transactionNumber}`,
      active: "transactions",
      transaction: transaction.toJSON(),
      movements,
      posSettings: await getSettings(),
      canVoid:
        req.user.role === "admin" &&
        transaction.status === "Completed" &&
        transaction.paymentStatus === "Paid",
    });
  } catch (error) {
    return next(error);
  }
};

export const receiptPage = async (req, res, next) => {
  try {
    const transaction = await loadTransaction(req.params.transactionId);
    if (!transaction) {
      flashError(req, "Transaction not found.");
      return res.redirect("/pos/transactions");
    }
    if (req.user.role === "cashier" && transaction.cashierId !== req.user.id) {
      flashError(req, "You can only print your own receipts.");
      return res.redirect("/pos/transactions");
    }

    return res.render("pos/receipt", {
      layout: false,
      title: `Receipt ${transaction.transactionNumber}`,
      transaction: transaction.toJSON(),
      posSettings: await getSettings(),
    });
  } catch (error) {
    return next(error);
  }
};

export const voidTransaction = async (req, res, next) => {
  const reason = String(req.body.reason || "").trim();
  const id = toInt(req.params.id);

  if (reason.length < 5) {
    flashError(req, "A reason of at least 5 characters is required to void a transaction.");
    return res.redirect(`/pos/transactions/${id}`);
  }

  try {
    await sequelize.transaction(async (t) => {
      const locked = await SaleTransaction.findByPk(id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!locked) throw new PosError("Transaction not found.");
      const sale = await SaleTransaction.findByPk(id, {
        include: [{ model: Order, as: "order", include: [{ model: OrderItem, as: "items" }] }],
        transaction: t,
      });
      if (sale.status !== "Completed" || sale.paymentStatus !== "Paid") {
        throw new PosError("Only completed, paid transactions can be voided. This one is already reversed.");
      }
      if (!sale.order?.items?.length) {
        throw new PosError("The related order has no items to restock.");
      }

      for (const item of sale.order.items) {
        const inventory = await Inventory.findOne({
          where: { productId: item.productId },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!inventory) continue;

        const previousStock = Number(inventory.currentStock);
        const newStock = previousStock + Number(item.quantity);
        await inventory.update(
          { currentStock: newStock, lastUpdated: new Date() },
          { transaction: t }
        );
        await InventoryMovement.create(
          {
            productId: item.productId,
            productName: item.productName,
            type: "Void/Reversal",
            quantity: Number(item.quantity),
            previousStock,
            newStock,
            referenceNumber: sale.transactionNumber,
            reason: `Void of ${sale.transactionNumber}: ${reason}`,
            performedBy: req.user.id,
            performedByName: req.user.name,
          },
          { transaction: t }
        );
      }

      await sale.update(
        {
          status: "Voided",
          paymentStatus: "Refunded",
          voidReason: reason,
          voidedBy: req.user.id,
          voidedAt: new Date(),
        },
        { transaction: t }
      );

      await Payment.update(
        { status: "Refunded" },
        { where: { transactionId: sale.id }, transaction: t }
      );

      if (sale.order) {
        await sale.order.update({ status: "Cancelled" }, { transaction: t });
        if (sale.order.tableId) {
          await RestaurantTable.update(
            { status: "Available" },
            { where: { id: sale.order.tableId }, transaction: t }
          );
        }
      }
    });

    flashSuccess(req, "Transaction voided. Stock restored and payment marked Refunded.");
    return res.redirect(`/pos/transactions/${id}`);
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect(`/pos/transactions/${id}`);
    }
    return next(error);
  }
};

export const transactionHelpers = { loadTransaction, num, generateNumber };
