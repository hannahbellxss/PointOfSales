/*
  DJYum — role capabilities.
  Routes use allow(...roles) for hard enforcement; `can()` drives navigation
  visibility so users never see links to pages their role cannot open.
*/

export const ROLE_LABELS = {
  admin: "Administrator / Owner",
  cashier: "Cashier",
  inventory: "Inventory Staff",
  staff: "Restaurant Staff",
};

export const ASSIGNABLE_ROLES = Object.keys(ROLE_LABELS);

const CAPABILITIES = {
  admin: ["*"],
  cashier: ["pos", "orders", "tables", "transactions", "reports.none"],
  inventory: [
    "inventory",
    "inventory.manage",
    "orders",
    "reports.inventory",
  ],
  staff: ["orders", "orders.status", "tables"],
};

export const can = (user, capability) => {
  if (!user || !capability) return false;
  const caps = CAPABILITIES[user.role] || [];
  if (caps.includes("*")) return true;
  if (caps.includes(capability)) return true;
  const group = capability.split(".")[0];
  return caps.includes(group);
};
