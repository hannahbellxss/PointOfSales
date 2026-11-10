/*
  DJYum — POS & Inventory routes.
  Every POS route requires an authenticated session and an explicit role list;
  the server never trusts the browser for permissions or prices.
*/
import express from "express";
import { requireAuth, allow } from "../middleware/auth.js";
import * as terminal from "../controllers/posTerminalController.js";
import * as orders from "../controllers/posOrderController.js";
import * as checkout from "../controllers/posCheckoutController.js";
import * as products from "../controllers/posProductController.js";
import * as categories from "../controllers/posCategoryController.js";
import * as inventory from "../controllers/posInventoryController.js";
import * as tables from "../controllers/posTableController.js";
import * as transactions from "../controllers/posTransactionController.js";
import * as reports from "../controllers/posReportController.js";
import * as settings from "../controllers/posSettingsController.js";

const router = express.Router();
router.use(requireAuth);

/* POS terminal & orders ------------------------------------------------ */
router.get("/terminal", allow("admin", "cashier"), terminal.terminalPage);
router.post("/orders", allow("admin", "cashier"), terminal.createOrder);

router.get("/orders", allow("admin", "cashier", "inventory", "staff"), orders.orderList);
router.get("/orders/:id", allow("admin", "cashier", "inventory", "staff"), orders.orderShow);
router.post("/orders/:id/status", allow("admin", "staff"), orders.updateOrderStatus);
router.post("/orders/:id/cancel", allow("admin", "cashier"), orders.cancelOrder);

/* Checkout & payment --------------------------------------------------- */
router.get("/checkout/:orderId", allow("admin", "cashier"), checkout.checkoutPage);
router.post("/checkout/:orderId/details", allow("admin", "cashier"), checkout.saveOrderDetails);
router.post("/checkout/:orderId/pay", allow("admin", "cashier"), checkout.processPayment);
router.get(
  "/payment/:transactionId/confirmation",
  allow("admin", "cashier"),
  checkout.paymentConfirmation
);

/* Receipts & transactions ---------------------------------------------- */
router.get("/receipts/:transactionId", allow("admin", "cashier"), transactions.receiptPage);
router.get("/transactions", allow("admin", "cashier"), transactions.transactionList);
router.get("/transactions/:id", allow("admin", "cashier"), transactions.transactionShow);
router.post("/transactions/:id/void", allow("admin"), transactions.voidTransaction);

/* Menu management ------------------------------------------------------ */
router.get("/products", allow("admin"), products.productList);
router.get("/products/new", allow("admin"), products.productNewPage);
router.post("/products", allow("admin"), products.productCreate);
router.get("/products/:id/edit", allow("admin"), products.productEditPage);
router.post("/products/:id", allow("admin"), products.productUpdate);
router.post("/products/:id/archive", allow("admin"), products.productArchive);
router.post("/products/:id/restore", allow("admin"), products.productRestore);

router.get("/categories", allow("admin"), categories.categoryList);
router.post("/categories", allow("admin"), categories.categoryCreate);
router.post("/categories/:id", allow("admin"), categories.categoryUpdate);
router.post("/categories/:id/archive", allow("admin"), categories.categoryArchive);
router.post("/categories/:id/restore", allow("admin"), categories.categoryRestore);

/* Inventory ------------------------------------------------------------ */
router.get("/inventory", allow("admin", "inventory"), inventory.inventoryOverview);
router.get("/inventory/low-stock", allow("admin", "inventory"), inventory.lowStockPage);
router.get("/inventory/out-of-stock", allow("admin", "inventory"), inventory.outOfStockPage);
router.get("/inventory/movements", allow("admin", "inventory"), inventory.movementList);
router.get("/inventory/stock-in", allow("admin", "inventory"), inventory.stockInPage);
router.post("/inventory/stock-in", allow("admin", "inventory"), inventory.stockIn);
router.get("/inventory/stock-out", allow("admin", "inventory"), inventory.stockOutPage);
router.post("/inventory/stock-out", allow("admin", "inventory"), inventory.stockOut);
router.get("/inventory/adjustment", allow("admin", "inventory"), inventory.adjustmentPage);
router.post("/inventory/adjustment", allow("admin", "inventory"), inventory.adjustment);
router.post(
  "/inventory/:productId/min-level",
  allow("admin", "inventory"),
  inventory.updateMinLevel
);
router.get("/inventory/:productId", allow("admin", "inventory"), inventory.inventoryDetail);

/* Tables --------------------------------------------------------------- */
router.get("/tables", allow("admin", "cashier", "staff"), tables.tableList);
router.post("/tables", allow("admin", "cashier"), tables.tableCreate);
router.post("/tables/:id", allow("admin", "cashier"), tables.tableUpdate);
router.post("/tables/:id/status", allow("admin", "cashier", "staff"), tables.tableStatus);

/* Reports -------------------------------------------------------------- */
router.get("/reports/sales", allow("admin"), reports.salesReport);
router.get("/reports/inventory", allow("admin", "inventory"), reports.inventoryReport);
router.get("/reports/export", allow("admin", "inventory"), reports.exportReport);

/* Settings ------------------------------------------------------------- */
router.get("/settings", allow("admin"), settings.settingsPage);
router.post("/settings", allow("admin"), settings.saveSettings);
router.post("/settings/discounts", allow("admin"), settings.createDiscount);
router.post("/settings/discounts/:id", allow("admin"), settings.updateDiscount);
router.post("/settings/users/:id/role", allow("admin"), settings.updateUserRole);

export default router;
