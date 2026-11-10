import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Inventory = sequelize.define(
  "Inventory",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    productId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    currentStock: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 },
    },
    minStockLevel: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
      validate: { min: 0 },
    },
    unit: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "pcs" },
    lastUpdated: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  { tableName: "inventory" }
);
