import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const InventoryMovement = sequelize.define(
  "InventoryMovement",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    productId: { type: DataTypes.INTEGER, allowNull: false },
    productName: { type: DataTypes.STRING(160), allowNull: true },
    type: {
      type: DataTypes.ENUM(
        "Stock In",
        "Stock Out",
        "Sales Deduction",
        "Adjustment",
        "Void/Reversal"
      ),
      allowNull: false,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 0 },
    },
    previousStock: { type: DataTypes.INTEGER, allowNull: false },
    newStock: { type: DataTypes.INTEGER, allowNull: false },
    referenceNumber: { type: DataTypes.STRING(64), allowNull: true },
    reason: { type: DataTypes.TEXT, allowNull: true },
    performedBy: { type: DataTypes.INTEGER, allowNull: true },
    performedByName: { type: DataTypes.STRING(160), allowNull: true },
  },
  {
    tableName: "inventory_movements",
    updatedAt: false,
    indexes: [
      { fields: ["productId"] },
      { fields: ["type"] },
      { fields: ["referenceNumber"] },
      { fields: ["createdAt"] },
    ],
  }
);
