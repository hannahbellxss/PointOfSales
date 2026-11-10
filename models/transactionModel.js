import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Transaction = sequelize.define(
  "Transaction",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    transactionNumber: { type: DataTypes.STRING(40), allowNull: false, unique: true },
    orderId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    orderNumber: { type: DataTypes.STRING(40), allowNull: true },
    cashierId: { type: DataTypes.INTEGER, allowNull: false },
    cashierName: { type: DataTypes.STRING(160), allowNull: true },
    subtotal: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    discountAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    taxAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    serviceCharge: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    totalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    paymentStatus: {
      type: DataTypes.ENUM("Pending", "Paid", "Failed", "Refunded"),
      allowNull: false,
      defaultValue: "Pending",
    },
    status: {
      type: DataTypes.ENUM("Completed", "Voided", "Refunded"),
      allowNull: false,
      defaultValue: "Completed",
    },
    voidReason: { type: DataTypes.TEXT, allowNull: true },
    voidedBy: { type: DataTypes.INTEGER, allowNull: true },
    voidedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: "transactions",
    indexes: [
      { fields: ["createdAt"] },
      { fields: ["paymentStatus"] },
      { fields: ["cashierId"] },
    ],
  }
);
