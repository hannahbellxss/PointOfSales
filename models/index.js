/*
  DJYum — POS & Inventory model registry.
  All associations live here so every controller sees the same relationship graph.
*/
import { sequelize } from "./db.js";
import { User } from "./userModel.js";
import { Category } from "./categoryModel.js";
import { Product } from "./productModel.js";
import { Inventory } from "./inventoryModel.js";
import { InventoryMovement } from "./inventoryMovementModel.js";
import { Order } from "./orderModel.js";
import { OrderItem } from "./orderItemModel.js";
import { Payment } from "./paymentModel.js";
import { Transaction } from "./transactionModel.js";
import { RestaurantTable } from "./restaurantTableModel.js";
import { Discount } from "./discountModel.js";
import { TransactionDiscount } from "./transactionDiscountModel.js";
import { Setting } from "./settingModel.js";

/* Menu ---------------------------------------------------------------- */
Category.hasMany(Product, { foreignKey: "categoryId", as: "products" });
Product.belongsTo(Category, { foreignKey: "categoryId", as: "category" });

/* Inventory ----------------------------------------------------------- */
Product.hasOne(Inventory, {
  foreignKey: "productId",
  as: "inventory",
  onDelete: "CASCADE",
});
Inventory.belongsTo(Product, { foreignKey: "productId", as: "product" });

Product.hasMany(InventoryMovement, { foreignKey: "productId", as: "movements" });
InventoryMovement.belongsTo(Product, { foreignKey: "productId", as: "product" });

/* Orders -------------------------------------------------------------- */
User.hasMany(Order, { foreignKey: "cashierId", as: "orders" });
Order.belongsTo(User, { foreignKey: "cashierId", as: "cashier" });

Order.hasMany(OrderItem, {
  foreignKey: "orderId",
  as: "items",
  onDelete: "CASCADE",
});
OrderItem.belongsTo(Order, { foreignKey: "orderId", as: "order" });
OrderItem.belongsTo(Product, { foreignKey: "productId", as: "product" });
Product.hasMany(OrderItem, { foreignKey: "productId", as: "orderItems" });

RestaurantTable.hasMany(Order, { foreignKey: "tableId", as: "orders" });
Order.belongsTo(RestaurantTable, { foreignKey: "tableId", as: "table" });

/* Checkout / payments ------------------------------------------------- */
Order.hasOne(Transaction, { foreignKey: "orderId", as: "transaction" });
Transaction.belongsTo(Order, { foreignKey: "orderId", as: "order" });
Transaction.belongsTo(User, { foreignKey: "cashierId", as: "cashier" });
User.hasMany(Transaction, { foreignKey: "cashierId", as: "transactions" });

Transaction.hasMany(Payment, { foreignKey: "transactionId", as: "payments" });
Payment.belongsTo(Transaction, { foreignKey: "transactionId", as: "transaction" });

Transaction.hasMany(TransactionDiscount, {
  foreignKey: "transactionId",
  as: "discounts",
});
TransactionDiscount.belongsTo(Transaction, {
  foreignKey: "transactionId",
  as: "transaction",
});
TransactionDiscount.belongsTo(Discount, { foreignKey: "discountId", as: "discount" });

export {
  sequelize,
  User,
  Category,
  Product,
  Inventory,
  InventoryMovement,
  Order,
  OrderItem,
  Payment,
  Transaction,
  RestaurantTable,
  Discount,
  TransactionDiscount,
  Setting,
};
