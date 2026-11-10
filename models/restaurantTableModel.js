import { DataTypes } from "sequelize";
import { sequelize } from "./db.js";

export const RestaurantTable = sequelize.define(
  "RestaurantTable",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(60), allowNull: false, unique: true },
    capacity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 4,
      validate: { min: 1 },
    },
    location: { type: DataTypes.STRING(80), allowNull: true },
    status: {
      type: DataTypes.ENUM("Available", "Occupied", "Reserved"),
      allowNull: false,
      defaultValue: "Available",
    },
  },
  { tableName: "restaurant_tables", indexes: [{ fields: ["status"] }] }
);
