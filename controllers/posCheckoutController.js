/*
  DJYum — checkout, payment and automatic inventory deduction.
  Payment confirmation, transaction recording and stock deduction all happen in
  ONE database transaction: if anything fails, nothing is written, no stock is
  deducted and the order stays payable.
*/
import { Op } from "sequelize";
import {
  sequelize,
  Order,
  OrderItem,
  Inventory,
  InventoryMovement,
  RestaurantTable,
  Discount,
  TransactionDiscount,
  Transaction as SaleTransaction,
  Payment,
} from "../models/index.js";
import {
  PosError,
  computeTotals,
  discountAmountFor,
  flashError,
  flashSuccess,
  generateNumber,
  getSettings,
  num,
  round2,
  toInt,
} from "../utils/pos.js";

export const PAYMENT_METHODS = ["Cash", "GCash", "Maya", "Credit/Debit Card"];
const ACTIVE_ORDER_STATUSES = ["Pending", "Preparing", "Ready"];

const currency = (value, settings) => `${settings.currency}${round2(value).toFixed(2)}`;

const releaseTable = async (tableId, t, excludeOrderId = null) => {
  if (!tableId) return;
  const where = {
    tableId,
    status: { [Op.in]: ACTIVE_ORDER_STATUSES },
  };
  if (excludeOrderId) where.id = { [Op.ne]: excludeOrderId };
  const stillActive = await Order.findOne({ where, transaction: t });
  if (!stillActive) {
    await RestaurantTable.update(
      { status: "Available" },
      { where: { id: tableId }, transaction: t }
    );
  }
};

const loadOrderForCheckout = async (orderId, transaction) => {
  if (!transaction) {
    return Order.findByPk(orderId, {
      include: [
        { model: OrderItem, as: "items" },
        { model: RestaurantTable, as: "table" },
      ],
    });
  }
  // Lock only the order row, then read its items inside the same transaction.
  const locked = await Order.findByPk(orderId, {
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!locked) return null;
  return Order.findByPk(orderId, {
    include: [
      { model: OrderItem, as: "items" },
      { model: RestaurantTable, as: "table" },
    ],
    transaction,
  });
};

const loadCheckoutContext = async (order) => {
  const [tables, discounts, settings] = await Promise.all([
    RestaurantTable.findAll({ order: [["name", "ASC"]] }),
    Discount.findAll({ where: { status: "active" }, order: [["name", "ASC"]] }),
    getSettings(),
  ]);
  const subtotal = round2(order.items?.reduce((sum, item) => sum + num(item.subtotal), 0) ?? 0);
  return { tables, discounts, settings, subtotal };
};

export const checkoutPage = async (req, res, next) => {
  const orderId = toInt(req.params.orderId);
  try {
    const order = await loadOrderForCheckout(orderId, null);
    if (!order) {
      flashError(req, "Order not found.");
      return res.redirect("/pos/terminal");
    }
    if (order.status !== "Pending") {
      flashError(req, `Order ${order.orderNumber} is ${order.status.toLowerCase()} and cannot be checked out.`);
      return res.redirect(`/pos/orders/${order.id}`);
    }
    if (!order.items?.length) {
      flashError(req, "This order has no items.");
      return res.redirect("/pos/terminal");
    }

    const context = await loadCheckoutContext(order);
    const selectedDiscount = order.discountId
      ? context.discounts.find((discount) => discount.id === order.discountId)
      : null;
    const discountAmount = discountAmountFor(selectedDiscount, context.subtotal);
    const totals = computeTotals(context.subtotal, discountAmount, context.settings);

    return res.render("pos/checkout", {
      title: `Checkout ${order.orderNumber}`,
      active: "terminal",
      order: order.toJSON(),
      totals,
      discountAmount,
      selectedDiscountId: selectedDiscount?.id ?? null,
      tables: context.tables,
      discounts: context.discounts,
      posSettings: context.settings,
      paymentMethods: PAYMENT_METHODS,
    });
  } catch (error) {
    return next(error);
  }
};

export const saveOrderDetails = async (req, res, next) => {
  const orderId = toInt(req.params.orderId);

  try {
    await sequelize.transaction(async (t) => {
      const settings = await getSettings();
      const order = await loadOrderForCheckout(orderId, t);
      if (!order) throw new PosError("Order not found.");
      if (order.status !== "Pending") {
        throw new PosError("Only pending orders can be updated.");
      }

      const orderType = ["Dine-In", "Take-Out"].includes(req.body.orderType)
        ? req.body.orderType
        : order.orderType;
      const tableId = orderType === "Dine-In" ? toInt(req.body.tableId) || null : null;

      let table = null;
      if (tableId) {
        table = await RestaurantTable.findByPk(tableId, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!table) throw new PosError("The selected table no longer exists.");
        const conflict = await Order.findOne({
          where: {
            tableId,
            status: { [Op.in]: ACTIVE_ORDER_STATUSES },
            id: { [Op.ne]: order.id },
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (conflict) {
          throw new PosError(
            `${table.name} is already assigned to order ${conflict.orderNumber}. Choose another table.`
          );
        }
      }

      if (order.tableId && order.tableId !== tableId) {
        await releaseTable(order.tableId, t, order.id);
      }

      let discount = null;
      const discountId = toInt(req.body.discountId) || null;
      if (discountId) {
        discount = await Discount.findOne({
          where: { id: discountId, status: "active" },
          transaction: t,
        });
        if (!discount) throw new PosError("That discount is no longer available.");
      }

      const subtotal = round2(
        order.items.reduce((sum, item) => sum + num(item.subtotal), 0)
      );
      const totals = computeTotals(
        subtotal,
        discountAmountFor(discount, subtotal),
        settings
      );

      await order.update(
        {
          orderType,
          tableId,
          discountId: discount?.id ?? null,
          ...totals,
        },
        { transaction: t }
      );

      if (table) {
        await table.update({ status: "Occupied" }, { transaction: t });
      }
    });

    flashSuccess(req, "Order details saved.");
    return res.redirect(`/pos/checkout/${orderId}`);
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect(`/pos/checkout/${orderId}`);
    }
    return next(error);
  }
};

export const processPayment = async (req, res, next) => {
  const orderId = toInt(req.params.orderId);

  try {
    const settings = await getSettings();
    let transactionId;

    await sequelize.transaction(async (t) => {
      /* 1. Lock the order and make sure it can be paid exactly once. */
      const order = await loadOrderForCheckout(orderId, t);
      if (!order) throw new PosError("Order not found.");
      if (order.status === "Cancelled") {
        throw new PosError("This order was cancelled and cannot be paid.");
      }
      if (order.status !== "Pending") {
        throw new PosError("This order has already been processed. Duplicate payment blocked.");
      }
      const existing = await SaleTransaction.findOne({
        where: { orderId: order.id },
        transaction: t,
      });
      if (existing) {
        throw new PosError(
          `Transaction ${existing.transactionNumber} already exists for this order.`
        );
      }
      if (!order.items?.length) throw new PosError("Cannot check out an empty order.");

      /* 2. Re-validate order type and table against live data. */
      const orderType = ["Dine-In", "Take-Out"].includes(req.body.orderType)
        ? req.body.orderType
        : order.orderType;
      const tableId = orderType === "Dine-In" ? toInt(req.body.tableId) || null : null;

      if (tableId) {
        const table = await RestaurantTable.findByPk(tableId, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!table) throw new PosError("The selected table no longer exists.");
        if (table.status === "Occupied" && table.id !== order.tableId) {
          throw new PosError(`${table.name} is currently occupied.`);
        }
        const conflict = await Order.findOne({
          where: {
            tableId,
            status: { [Op.in]: ACTIVE_ORDER_STATUSES },
            id: { [Op.ne]: order.id },
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (conflict) {
          throw new PosError(`${table.name} is already assigned to another order.`);
        }
      }

      /* 3. Re-validate the discount and recompute every amount on the server. */
      const discountId = toInt(req.body.discountId) || null;
      let discount = null;
      if (discountId) {
        discount = await Discount.findOne({
          where: { id: discountId, status: "active" },
          transaction: t,
        });
        if (!discount) throw new PosError("The selected discount is not available.");
      }

      const subtotal = round2(
        order.items.reduce((sum, item) => sum + num(item.subtotal), 0)
      );
      const discountAmount = discountAmountFor(discount, subtotal);
      const totals = computeTotals(subtotal, discountAmount, settings);

      /* 4. Validate the payment itself. */
      const method = String(req.body.paymentMethod || "");
      if (!PAYMENT_METHODS.includes(method)) {
        throw new PosError("Select a valid payment method.");
      }

      const amountReceived = req.body.amountReceived === "" || req.body.amountReceived == null
        ? null
        : num(req.body.amountReceived, NaN);

      let changeDue = 0;
      let referenceNumber = null;

      if (method === "Cash") {
        if (amountReceived === null || !Number.isFinite(amountReceived)) {
          throw new PosError("Enter the amount received from the customer.");
        }
        if (amountReceived + 0.001 < totals.totalAmount) {
          throw new PosError(
            `Insufficient cash. Amount due is ${currency(totals.totalAmount, settings)}.`
          );
        }
        changeDue = round2(amountReceived - totals.totalAmount);
      } else {
        referenceNumber = String(req.body.referenceNumber || "").trim();
        if (referenceNumber.length < 4) {
          throw new PosError(
            "Electronic payments require a reference number from the provider."
          );
        }
        if (req.body.verified !== "on") {
          throw new PosError("Confirm that the electronic payment was verified before saving.");
        }
        if (amountReceived !== null && Number.isFinite(amountReceived)) {
          if (amountReceived + 0.001 < totals.totalAmount) {
            throw new PosError("Amount received is less than the total due.");
          }
        }
      }

      /* 5. Deduct stock once per line, with a row lock and movement record. */
      for (const item of order.items) {
        if (Number(item.quantity) <= 0) {
          throw new PosError("Order quantities must be greater than zero.");
        }
        const inventory = await Inventory.findOne({
          where: { productId: item.productId },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!inventory) {
          throw new PosError(`No inventory record exists for "${item.productName}".`);
        }
        const previousStock = Number(inventory.currentStock);
        if (previousStock < Number(item.quantity)) {
          throw new PosError(
            `Not enough stock for "${item.productName}". Only ${previousStock} left; ` +
              `${item.quantity} required. Adjust the order before paying.`
          );
        }
        const newStock = previousStock - Number(item.quantity);
        await inventory.update(
          { currentStock: newStock, lastUpdated: new Date() },
          { transaction: t }
        );
        await InventoryMovement.create(
          {
            productId: item.productId,
            productName: item.productName,
            type: "Sales Deduction",
            quantity: Number(item.quantity),
            previousStock,
            newStock,
            referenceNumber: order.orderNumber,
            reason: `Sale completed for order ${order.orderNumber}.`,
            performedBy: req.user.id,
            performedByName: req.user.name,
          },
          { transaction: t }
        );
      }

      /* 6. Persist the sale, the payment and the applied discount. */
      const sale = await SaleTransaction.create(
        {
          transactionNumber: generateNumber("TXN"),
          orderId: order.id,
          orderNumber: order.orderNumber,
          cashierId: req.user.id,
          cashierName: req.user.name,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxAmount: totals.taxAmount,
          serviceCharge: totals.serviceCharge,
          totalAmount: totals.totalAmount,
          paymentStatus: "Paid",
          status: "Completed",
        },
        { transaction: t }
      );

      await Payment.create(
        {
          transactionId: sale.id,
          method,
          amount: totals.totalAmount,
          amountReceived: method === "Cash" ? amountReceived : amountReceived ?? totals.totalAmount,
          changeDue,
          referenceNumber,
          status: "Paid",
          paidAt: new Date(),
        },
        { transaction: t }
      );

      if (discount) {
        await TransactionDiscount.create(
          {
            transactionId: sale.id,
            discountId: discount.id,
            name: discount.name,
            type: discount.type,
            value: discount.value,
            amount: discountAmount,
            authorizedBy: req.user.id,
            authorizedByName: req.user.name,
          },
          { transaction: t }
        );
      }

      await order.update(
        {
          orderType,
          tableId,
          discountId: discount?.id ?? null,
          status: "Completed",
          ...totals,
        },
        { transaction: t }
      );

      if (tableId) {
        await RestaurantTable.update(
          { status: "Available" },
          { where: { id: tableId }, transaction: t }
        );
      } else if (order.tableId) {
        await releaseTable(order.tableId, t, order.id);
      }

      transactionId = sale.id;
    });

    flashSuccess(req, "Payment confirmed. Inventory has been automatically deducted.");
    return res.redirect(`/pos/payment/${transactionId}/confirmation`);
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect(`/pos/checkout/${orderId}`);
    }
    return next(error);
  }
};

export const paymentConfirmation = async (req, res, next) => {
  try {
    const sale = await SaleTransaction.findByPk(req.params.transactionId, {
      include: [
        { model: Payment, as: "payments" },
        { model: TransactionDiscount, as: "discounts" },
        {
          model: Order,
          as: "order",
          include: [
            { model: RestaurantTable, as: "table" },
            { model: OrderItem, as: "items" },
          ],
        },
      ],
    });

    if (!sale) {
      flashError(req, "Transaction not found.");
      return res.redirect("/pos/transactions");
    }
    if (req.user.role === "cashier" && sale.cashierId !== req.user.id) {
      flashError(req, "You can only view your own transactions.");
      return res.redirect("/pos/transactions");
    }

    return res.render("pos/payment-confirmation", {
      title: "Payment Confirmed",
      active: "terminal",
      transaction: sale.toJSON(),
      posSettings: await getSettings(),
    });
  } catch (error) {
    return next(error);
  }
};
