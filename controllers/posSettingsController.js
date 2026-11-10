/*
  DJYum — POS settings, discounts and user roles.
*/
import { Op } from "sequelize";
import { Setting, Discount, User } from "../models/index.js";
import {
  SETTING_DEFAULTS,
  flashError,
  flashSuccess,
  getSettings,
  num,
  toInt,
} from "../utils/pos.js";
import { ASSIGNABLE_ROLES, ROLE_LABELS } from "../utils/permissions.js";

const SETTING_KEYS = {
  restaurantName: 80,
  address: 255,
  contact: 80,
  currency: 8,
  taxRate: 6,
  serviceChargeRate: 6,
  receiptFooter: 255,
  receiptPrefix: 24,
};

export const settingsPage = async (req, res, next) => {
  try {
    const [settings, discounts, users] = await Promise.all([
      getSettings(),
      Discount.findAll({ order: [["status", "ASC"], ["name", "ASC"]] }),
      User.findAll({ order: [["role", "ASC"], ["name", "ASC"]] }),
    ]);

    return res.render("pos/settings", {
      title: "POS Settings",
      active: "settings",
      posSettings: settings,
      discounts,
      users,
      roleLabels: ROLE_LABELS,
      assignableRoles: ASSIGNABLE_ROLES,
    });
  } catch (error) {
    return next(error);
  }
};

export const saveSettings = async (req, res, next) => {
  const updates = {};

  for (const [key, maxLength] of Object.entries(SETTING_KEYS)) {
    if (req.body[key] === undefined) continue;
    const value = String(req.body[key]).trim();
    if (value.length > maxLength) {
      flashError(req, `"${key}" is too long (maximum ${maxLength} characters).`);
      return res.redirect("/pos/settings");
    }
    updates[key] = value;
  }

  for (const key of ["taxRate", "serviceChargeRate"]) {
    if (updates[key] === undefined) continue;
    const value = num(updates[key], -1);
    if (value < 0 || value > 100) {
      flashError(req, "Tax and service charge rates must be between 0 and 100.");
      return res.redirect("/pos/settings");
    }
    updates[key] = String(value);
  }

  if (updates.currency && updates.currency.length === 0) {
    updates.currency = SETTING_DEFAULTS.currency;
  }

  try {
    for (const [key, value] of Object.entries(updates)) {
      await Setting.upsert({ key, value });
    }
    flashSuccess(req, "Restaurant settings saved.");
    return res.redirect("/pos/settings");
  } catch (error) {
    return next(error);
  }
};

export const createDiscount = async (req, res, next) => {
  const name = String(req.body.name || "").trim();
  const type = ["percent", "fixed"].includes(req.body.type) ? req.body.type : "percent";
  const value = num(req.body.value, -1);

  if (name.length < 2 || name.length > 120) {
    flashError(req, "Discount name must be between 2 and 120 characters.");
    return res.redirect("/pos/settings");
  }
  if (value <= 0) {
    flashError(req, "Discount value must be greater than zero.");
    return res.redirect("/pos/settings");
  }
  if (type === "percent" && value > 100) {
    flashError(req, "Percentage discounts cannot exceed 100%.");
    return res.redirect("/pos/settings");
  }

  try {
    const existing = await Discount.findOne({ where: { name } });
    if (existing) {
      flashError(req, `A discount named "${name}" already exists.`);
      return res.redirect("/pos/settings");
    }
    await Discount.create({ name, type, value, status: "active" });
    flashSuccess(req, `Discount "${name}" created.`);
    return res.redirect("/pos/settings");
  } catch (error) {
    return next(error);
  }
};

export const updateDiscount = async (req, res, next) => {
  try {
    const discount = await Discount.findByPk(req.params.id);
    if (!discount) {
      flashError(req, "Discount not found.");
      return res.redirect("/pos/settings");
    }

    if (req.body.action === "toggle") {
      await discount.update({
        status: discount.status === "active" ? "inactive" : "active",
      });
      flashSuccess(
        req,
        `Discount "${discount.name}" is now ${discount.status === "active" ? "active" : "inactive"}.`
      );
      return res.redirect("/pos/settings");
    }

    const name = String(req.body.name || "").trim();
    const type = ["percent", "fixed"].includes(req.body.type)
      ? req.body.type
      : discount.type;
    const value = num(req.body.value, -1);

    if (name.length < 2) {
      flashError(req, "Discount name is required.");
      return res.redirect("/pos/settings");
    }
    if (value <= 0 || (type === "percent" && value > 100)) {
      flashError(req, "Enter a valid discount value.");
      return res.redirect("/pos/settings");
    }
    const duplicate = await Discount.findOne({
      where: { name, id: { [Op.ne]: discount.id } },
    });
    if (duplicate) {
      flashError(req, `Another discount is already named "${name}".`);
      return res.redirect("/pos/settings");
    }

    await discount.update({ name, type, value });
    flashSuccess(req, "Discount updated.");
    return res.redirect("/pos/settings");
  } catch (error) {
    return next(error);
  }
};

export const updateUserRole = async (req, res, next) => {
  const role = String(req.body.role || "");
  const userId = toInt(req.params.id);

  if (!ASSIGNABLE_ROLES.includes(role)) {
    flashError(req, "Invalid role.");
    return res.redirect("/pos/settings");
  }

  try {
    const user = await User.findByPk(userId);
    if (!user) {
      flashError(req, "User not found.");
      return res.redirect("/pos/settings");
    }
    if (user.id === req.user.id && role !== "admin") {
      flashError(req, "You cannot remove your own administrator access.");
      return res.redirect("/pos/settings");
    }
    if (user.role === "admin" && role !== "admin") {
      const adminCount = await User.count({ where: { role: "admin" } });
      if (adminCount <= 1) {
        flashError(req, "At least one administrator account must remain.");
        return res.redirect("/pos/settings");
      }
    }

    await user.update({ role });
    flashSuccess(req, `${user.name} is now ${ROLE_LABELS[role]}.`);
    return res.redirect("/pos/settings");
  } catch (error) {
    return next(error);
  }
};
