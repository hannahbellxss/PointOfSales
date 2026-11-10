import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Discount = sequelize.define(
  "Discount",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(120), allowNull: false, unique: true },
    type: {
      type: DataTypes.ENUM("percent", "fixed"),
      allowNull: false,
      defaultValue: "percent",
    },
    value: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: { min: 0 },
    },
    status: {
      type: DataTypes.ENUM("active", "inactive"),
      allowNull: false,
      defaultValue: "active",
    },
  },
  { tableName: "discounts" }
);
