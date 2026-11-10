/*
  DJYum — Handlebars helpers used by the .xian templates.
*/
import { can } from "./permissions.js";
import { stockStatus, stockBadgeClass, money as moneyValue } from "./pos.js";

const formatNumber = (value) => moneyValue(value);

export const registerHelpers = (hbs) => {
  hbs.registerHelper("eq", (a, b) => a === b || String(a) === String(b));
  hbs.registerHelper("ne", (a, b) => !(a === b || String(a) === String(b)));
  hbs.registerHelper("gt", (a, b) => Number(a) > Number(b));
  hbs.registerHelper("gte", (a, b) => Number(a) >= Number(b));
  hbs.registerHelper("lt", (a, b) => Number(a) < Number(b));
  hbs.registerHelper("lte", (a, b) => Number(a) <= Number(b));
  hbs.registerHelper("and", (...args) =>
    args.slice(0, -1).every((value) => Boolean(value))
  );
  hbs.registerHelper("or", (...args) =>
    args.slice(0, -1).some((value) => Boolean(value))
  );
  hbs.registerHelper("not", (value) => !value);

  hbs.registerHelper("money", function (value, options) {
    const currency = options?.data?.root?.posSettings?.currency || "\u20b1";
    return `${currency}${formatNumber(value)}`;
  });
  hbs.registerHelper("int", (value) =>
    String(parseInt(value, 10) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  );
  hbs.registerHelper("percent", (value) => `${Number(value || 0)}%`);

  hbs.registerHelper("date", (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  });
  hbs.registerHelper("datetime", (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  });
  hbs.registerHelper("time", (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  });

  hbs.registerHelper("stockStatus", (current, min) => stockStatus(current, min));
  hbs.registerHelper("badge", (status) => stockBadgeClass(status));

  const STATUS_BADGES = {
    Pending: "bg-amber-100 text-amber-800 ring-amber-200",
    Preparing: "bg-sky-100 text-sky-700 ring-sky-200",
    Ready: "bg-indigo-100 text-indigo-700 ring-indigo-200",
    Completed: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    Cancelled: "bg-red-100 text-red-700 ring-red-200",
    Paid: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    Refunded: "bg-amber-100 text-amber-800 ring-amber-200",
    Failed: "bg-red-100 text-red-700 ring-red-200",
    Voided: "bg-red-100 text-red-700 ring-red-200",
    Available: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    Occupied: "bg-orange-100 text-orange-700 ring-orange-200",
    Reserved: "bg-sky-100 text-sky-700 ring-sky-200",
    "In Stock": "bg-emerald-100 text-emerald-700 ring-emerald-200",
    "Low Stock": "bg-amber-100 text-amber-800 ring-amber-200",
    "Out of Stock": "bg-red-100 text-red-700 ring-red-200",
    active: "bg-emerald-100 text-emerald-700 ring-emerald-200",
    archived: "bg-stone-200 text-stone-600 ring-stone-300",
    inactive: "bg-stone-200 text-stone-600 ring-stone-300",
  };
  hbs.registerHelper(
    "statusBadge",
    (status) => STATUS_BADGES[String(status)] || "bg-stone-100 text-stone-600 ring-stone-200"
  );

  hbs.registerHelper("initials", (name) =>
    String(name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("")
  );

  hbs.registerHelper("json", (value) =>
    JSON.stringify(value ?? null).replace(/</g, "\\u003c")
  );

  hbs.registerHelper("ifCond", function (a, operator, b, options) {
    const map = {
      "==": (x, y) => x == y, // eslint-disable-line eqeqeq
      "===": (x, y) => x === y,
      "!=": (x, y) => x != y, // eslint-disable-line eqeqeq
      ">": (x, y) => x > y,
      "<": (x, y) => x < y,
      ">=": (x, y) => x >= y,
      "<=": (x, y) => x <= y,
    };
    const fn = map[operator] || map["=="];
    return fn(a, b) ? options.fn(this) : options.inverse(this);
  });

  hbs.registerHelper("can", function (capability, options) {
    const user = options.data?.root?.currentUser;
    return can(user, capability) ? options.fn(this) : options.inverse(this);
  });

  hbs.registerHelper("checked", (value) => (value ? "checked" : ""));
  hbs.registerHelper("selected", (a, b) =>
    String(a) === String(b) ? "selected" : ""
  );
};
