import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const TransactionDiscount = sequelize.define(
  "TransactionDiscount",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    transactionId: { type: DataTypes.INTEGER, allowNull: false },
    discountId: { type: DataTypes.INTEGER, allowNull: true },
    name: { type: DataTypes.STRING(120), allowNull: false },
    type: { type: DataTypes.ENUM("percent", "fixed"), allowNull: false },
    value: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    authorizedBy: { type: DataTypes.INTEGER, allowNull: true },
    authorizedByName: { type: DataTypes.STRING(160), allowNull: true },
  },
  {
    tableName: "transaction_discounts",
    updatedAt: false,
    indexes: [{ fields: ["transactionId"] }],
  }
);
