/*
  DJYum — shared POS helpers: money math, numbering, settings, stock status.
*/
import crypto from "crypto";
import { Setting, Inventory } from "../models/index.js";

/** Business-rule failure that is safe to show to the user. */
export class PosError extends Error {
  constructor(message) {
    super(message);
    this.name = "PosError";
  }
}

export const num = (value, fallback = 0) => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const round2 = (value) =>
  Math.round((num(value) + Number.EPSILON) * 100) / 100;

export const money = (value) =>
  round2(value)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export const toInt = (value) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : NaN;
};

export const generateNumber = (prefix) => {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${stamp}-${random}`;
};

export const startOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

export const endOfDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

/**
 * Normalise a period filter coming from the query string.
 * Supported: today | week | month | year | custom(from,to)
 */
export const resolvePeriod = (query = {}) => {
  const period = query.period || "month";
  const now = new Date();
  let start;
  let end = endOfDay(now);

  switch (period) {
    case "today":
      start = startOfDay(now);
      break;
    case "week": {
      start = startOfDay(now);
      start.setDate(start.getDate() - 6);
      break;
    }
    case "year":
      start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      break;
    case "custom": {
      start = query.from ? new Date(`${query.from}T00:00:00`) : startOfDay(now);
      end = query.to ? new Date(`${query.to}T23:59:59.999`) : end;
      break;
    }
    case "month":
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      break;
  }

  if (Number.isNaN(start.getTime())) start = startOfDay(now);
  if (Number.isNaN(end.getTime())) end = endOfDay(now);
  if (start > end) [start, end] = [startOfDay(end), endOfDay(start)];

  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;

  return {
    period,
    start,
    end,
    from: iso(start),
    to: iso(end),
  };
};

export const SETTING_DEFAULTS = {
  restaurantName: "DJ's Restaurant",
  address: "Poblacion, Mindoro, Philippines",
  contact: "(043) 000-0000",
  currency: "₱",
  taxRate: "0",
  serviceChargeRate: "0",
  receiptFooter: "Thank you for dining with DJ's Restaurant!",
  receiptPrefix: "DJYum",
};

export const getSettings = async () => {
  const rows = await Setting.findAll();
  const map = { ...SETTING_DEFAULTS };
  rows.forEach((row) => {
    map[row.key] = row.value ?? "";
  });
  return {
    restaurantName: map.restaurantName || SETTING_DEFAULTS.restaurantName,
    address: map.address || "",
    contact: map.contact || "",
    currency: map.currency || "₱",
    taxRate: num(map.taxRate, 0),
    serviceChargeRate: num(map.serviceChargeRate, 0),
    receiptFooter: map.receiptFooter || "",
    receiptPrefix: map.receiptPrefix || "DJYum",
    taxEnabled: num(map.taxRate, 0) > 0,
    serviceChargeEnabled: num(map.serviceChargeRate, 0) > 0,
  };
};

/** Single source of truth for order / transaction totals. */
export const computeTotals = (subtotal, discountAmount, settings) => {
  const sub = round2(subtotal);
  const discount = Math.min(Math.max(round2(discountAmount), 0), sub);
  const taxable = round2(sub - discount);
  const serviceCharge = round2((taxable * num(settings?.serviceChargeRate)) / 100);
  const tax = round2(((taxable + serviceCharge) * num(settings?.taxRate)) / 100);
  return {
    subtotal: sub,
    discountAmount: discount,
    serviceCharge,
    taxAmount: tax,
    totalAmount: round2(taxable + serviceCharge + tax),
  };
};

export const discountAmountFor = (discount, subtotal) => {
  if (!discount) return 0;
  const value = num(discount.value);
  const amount =
    discount.type === "percent" ? (num(subtotal) * value) / 100 : value;
  return round2(Math.min(Math.max(amount, 0), num(subtotal)));
};

export const stockStatus = (currentStock, minStockLevel) => {
  const stock = num(currentStock);
  if (stock <= 0) return "Out of Stock";
  if (stock <= num(minStockLevel)) return "Low Stock";
  return "In Stock";
};

export const stockBadgeClass = (status) => {
  switch (status) {
    case "Out of Stock":
      return "bg-red-100 text-red-700 ring-red-200";
    case "Low Stock":
      return "bg-amber-100 text-amber-800 ring-amber-200";
    case "Occupied":
      return "bg-orange-100 text-orange-700 ring-orange-200";
    case "Reserved":
      return "bg-sky-100 text-sky-700 ring-sky-200";
    default:
      return "bg-emerald-100 text-emerald-700 ring-emerald-200";
  }
};

export const flashError = (req, message) => req.flash("error_msg", message);
export const flashSuccess = (req, message) => req.flash("success_msg", message);

export const variantLabel = (value) => String(value ?? "");

/** Attach an inventory record to products that somehow have none. */
export const ensureInventoryRow = async (productId, defaults = {}) => {
  const [row] = await Inventory.findOrCreate({
    where: { productId },
    defaults: {
      productId,
      currentStock: 0,
      minStockLevel: 5,
      unit: "pcs",
      lastUpdated: new Date(),
      ...defaults,
    },
  });
  return row;
};
