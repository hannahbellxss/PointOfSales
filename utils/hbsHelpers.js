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
    Pending: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    Preparing: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
    Ready: "bg-indigo-500/15 text-indigo-300 ring-indigo-500/30",
    Completed: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    Cancelled: "bg-red-500/15 text-red-300 ring-red-500/30",
    Paid: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    Refunded: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    Failed: "bg-red-500/15 text-red-300 ring-red-500/30",
    Voided: "bg-red-500/15 text-red-300 ring-red-500/30",
    Available: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    Occupied: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
    Reserved: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
    "In Stock": "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    "Low Stock": "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    "Out of Stock": "bg-red-500/15 text-red-300 ring-red-500/30",
    active: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    archived: "bg-white/10 text-zinc-300 ring-white/15",
    inactive: "bg-white/10 text-zinc-300 ring-white/15",
  };
  hbs.registerHelper(
    "statusBadge",
    (status) => STATUS_BADGES[String(status)] || "bg-white/10 text-zinc-300 ring-white/15"
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
