/*
  DJYum — non-destructive database bootstrap.
  Creates the database/tables when missing (never drops or resets), adds the
  Users.role column to older installations, and seeds configuration rows.
*/
import { DataTypes } from "sequelize";
import mysql from "mysql2/promise";
import {
  sequelize,
  Setting,
  RestaurantTable,
  Discount,
  User,
} from "../models/index.js";
import { SETTING_DEFAULTS } from "./pos.js";

const DB_NAME = sequelize.config.database;
const DB_HOST = sequelize.config.host || "localhost";
const DB_USER = sequelize.config.username || "root";
const DB_PASS = sequelize.config.password || "";

const ensureDatabaseExists = async () => {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    port: sequelize.config.port || 3306,
  });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }
};

export const initializeDatabase = async () => {
  await ensureDatabaseExists();
  await sequelize.authenticate();

  // Create any missing tables. No force / alter: existing data is preserved.
  await sequelize.sync();

  // Existing installations created before roles existed: add the column safely.
  const queryInterface = sequelize.getQueryInterface();
  const tableName = User.getTableName();
  const userColumns = await queryInterface.describeTable(tableName);
  if (!userColumns.role) {
    await queryInterface.addColumn(tableName, "role", {
      type: DataTypes.ENUM("admin", "cashier", "inventory", "staff"),
      allowNull: false,
      defaultValue: "cashier",
    });
    console.log("✅ Added users.role column (existing users default to cashier)");
  }

  // Seed default restaurant settings only for keys that are missing.
  const existingSettings = await Setting.findAll({ attributes: ["key"] });
  const existingKeys = new Set(existingSettings.map((row) => row.key));
  const missing = Object.entries(SETTING_DEFAULTS).filter(
    ([key]) => !existingKeys.has(key)
  );
  if (missing.length) {
    await Setting.bulkCreate(
      missing.map(([key, value]) => ({ key, value: String(value) })),
      { ignoreDuplicates: true }
    );
  }

  // Seed the dining floor once, so Table Management is usable immediately.
  const tableCount = await RestaurantTable.count();
  if (tableCount === 0) {
    await RestaurantTable.bulkCreate(
      Array.from({ length: 8 }, (_, index) => ({
        name: `Table ${index + 1}`,
        capacity: index < 4 ? 4 : 6,
        location: index < 4 ? "Main Hall" : "Veranda",
        status: "Available",
      }))
    );
  }

  // Seed a few starter discounts; admins can edit or deactivate them.
  const discountCount = await Discount.count();
  if (discountCount === 0) {
    await Discount.bulkCreate([
      { name: "Senior Citizen (20%)", type: "percent", value: 20, status: "active" },
      { name: "PWD Discount (20%)", type: "percent", value: 20, status: "active" },
      { name: "Employee Meal (10%)", type: "percent", value: 10, status: "active" },
      { name: "Promo ₱50 Off", type: "fixed", value: 50, status: "inactive" },
    ]);
  }

  const userCount = await User.count();
  if (userCount === 0) {
    console.log(
      "ℹ️  No users yet — the first account registered at /register becomes the Administrator."
    );
  }

  console.log(`✅ Database ready (${DB_NAME}).`);
  return true;
};
