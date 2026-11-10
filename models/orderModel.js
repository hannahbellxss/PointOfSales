import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Order = sequelize.define(
  "Order",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    orderNumber: { type: DataTypes.STRING(40), allowNull: false, unique: true },
    cashierId: { type: DataTypes.INTEGER, allowNull: false },
    cashierName: { type: DataTypes.STRING(160), allowNull: true },
    orderType: {
      type: DataTypes.ENUM("Dine-In", "Take-Out"),
      allowNull: false,
      defaultValue: "Dine-In",
    },
    tableId: { type: DataTypes.INTEGER, allowNull: true },
    discountId: { type: DataTypes.INTEGER, allowNull: true },
    subtotal: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    discountAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    taxAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    serviceCharge: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    status: {
      type: DataTypes.ENUM("Pending", "Preparing", "Ready", "Completed", "Cancelled"),
      allowNull: false,
      defaultValue: "Pending",
    },
    note: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    tableName: "orders",
    indexes: [{ fields: ["status"] }, { fields: ["createdAt"] }, { fields: ["cashierId"] }],
  }
);
