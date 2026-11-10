import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const Setting = sequelize.define(
  "Setting",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    key: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    value: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: "settings" }
);
