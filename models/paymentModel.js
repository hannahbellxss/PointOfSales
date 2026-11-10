import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Payment = sequelize.define(
  "Payment",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    transactionId: { type: DataTypes.INTEGER, allowNull: false },
    method: {
      type: DataTypes.ENUM("Cash", "GCash", "Maya", "Credit/Debit Card"),
      allowNull: false,
    },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    amountReceived: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    changeDue: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    referenceNumber: { type: DataTypes.STRING(80), allowNull: true },
    status: {
      type: DataTypes.ENUM("Pending", "Paid", "Failed", "Refunded"),
      allowNull: false,
      defaultValue: "Pending",
    },
    paidAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    tableName: "payments",
    indexes: [{ fields: ["transactionId"] }, { fields: ["method"] }],
  }
);
