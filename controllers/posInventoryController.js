/*
  DJYum — inventory management.
  Stock quantities can only change through a validated movement (Stock In,
  Stock Out, Adjustment, Sales Deduction, Void/Reversal), inside a DB
  transaction with a row lock, and every change is recorded.
*/
import { Op, QueryTypes } from "sequelize";
import {
  sequelize,
  Inventory,
  InventoryMovement,
  Product,
  Category,
} from "../models/index.js";
import {
  PosError,
  flashError,
  flashSuccess,
  generateNumber,
  num,
  round2,
  stockStatus,
  toInt,
} from "../utils/pos.js";

const MOVEMENT_TYPES = [
  "Stock In",
  "Stock Out",
  "Sales Deduction",
  "Adjustment",
  "Void/Reversal",
];

const loadProductOptions = () =>
  Product.findAll({
    where: { status: "active" },
    include: [
      { model: Inventory, as: "inventory", required: false },
      { model: Category, as: "category", attributes: ["id", "name"] },
    ],
    order: [["name", "ASC"]],
  });

const stockRows = async () => {
  const rows = await sequelize.query(
    `SELECT p.id AS productId, p.name, p.price, p.image, p.type,
            c.id AS categoryId, c.name AS categoryName,
            i.id AS inventoryId, i.currentStock, i.minStockLevel, i.unit, i.lastUpdated
     FROM products p
     LEFT JOIN categories c ON c.id = p.categoryId
     LEFT JOIN inventory i ON i.productId = p.id
     WHERE p.status = 'active'
     ORDER BY p.name ASC`,
    { type: QueryTypes.SELECT }
  );

  return rows.map((row) => ({
    ...row,
    currentStock: Number(row.currentStock ?? 0),
    minStockLevel: Number(row.minStockLevel ?? 0),
    price: round2(row.price),
    stockStatus: stockStatus(row.currentStock, row.minStockLevel),
  }));
};

const summarize = (rows) => ({
  totalProducts: rows.length,
  totalUnits: rows.reduce((sum, row) => sum + row.currentStock, 0),
  lowStock: rows.filter((row) => row.stockStatus === "Low Stock").length,
  outOfStock: rows.filter((row) => row.stockStatus === "Out of Stock").length,
  stockValue: round2(
    rows.reduce((sum, row) => sum + row.currentStock * row.price, 0)
  ),
});

const matchesFilters = (row, { q, categoryId, status }) => {
  if (q) {
    const needle = q.toLowerCase();
    if (
      !row.name.toLowerCase().includes(needle) &&
      !(row.categoryName || "").toLowerCase().includes(needle)
    ) {
      return false;
    }
  }
  if (categoryId && Number(row.categoryId) !== Number(categoryId)) return false;
  if (status === "in" && row.stockStatus !== "In Stock") return false;
  if (status === "low" && row.stockStatus !== "Low Stock") return false;
  if (status === "out" && row.stockStatus !== "Out of Stock") return false;
  return true;
};

const readFilters = (query) => ({
  q: String(query.q || "").trim(),
  categoryId: toInt(query.category) || null,
  status: String(query.status || "").trim(),
});

const findInventoryForUpdate = async (productId, t) => {
  const inventory = await Inventory.findOne({
    where: { productId },
    transaction: t,
    lock: t.LOCK.UPDATE,
  });
  return inventory;
};

export const inventoryOverview = async (req, res, next) => {
  try {
    const filters = readFilters(req.query);
    const allRows = await stockRows();
    const rows = allRows.filter((row) => matchesFilters(row, filters));

    return res.render("pos/inventory/index", {
      title: "Inventory Overview",
      active: "inventory",
      rows,
      summary: summarize(allRows),
      filters,
      categories: await Category.findAll({
        where: { status: "active" },
        order: [["name", "ASC"]],
      }),
    });
  } catch (error) {
    return next(error);
  }
};

export const lowStockPage = async (req, res, next) => {
  try {
    const rows = (await stockRows()).filter(
      (row) => row.stockStatus === "Low Stock"
    );
    return res.render("pos/inventory/alert", {
      title: "Low Stock Products",
      active: "inventory",
      rows,
      mode: "low",
      summary: summarize(rows),
    });
  } catch (error) {
    return next(error);
  }
};

export const outOfStockPage = async (req, res, next) => {
  try {
    const rows = (await stockRows()).filter(
      (row) => row.stockStatus === "Out of Stock"
    );
    return res.render("pos/inventory/alert", {
      title: "Out of Stock Products",
      active: "inventory",
      rows,
      mode: "out",
      summary: summarize(rows),
    });
  } catch (error) {
    return next(error);
  }
};

export const inventoryDetail = async (req, res, next) => {
  try {
    const productId = toInt(req.params.productId);
    const product = await Product.findByPk(productId, {
      include: [
        { model: Category, as: "category", attributes: ["id", "name"] },
        { model: Inventory, as: "inventory", required: false },
      ],
    });
    if (!product) {
      flashError(req, "Product not found.");
      return res.redirect("/pos/inventory");
    }

    const movements = await InventoryMovement.findAll({
      where: { productId },
      order: [["createdAt", "DESC"]],
      limit: 60,
    });

    const data = product.toJSON();
    const currentStock = Number(data.inventory?.currentStock ?? 0);
    const minStockLevel = Number(data.inventory?.minStockLevel ?? 0);

    return res.render("pos/inventory/detail", {
      title: data.name,
      active: "inventory",
      product: data,
      inventory: {
        ...(data.inventory || {}),
        currentStock,
        minStockLevel,
        stockStatus: stockStatus(currentStock, minStockLevel),
      },
      stockValue: round2(currentStock * num(data.price)),
      movements,
    });
  } catch (error) {
    return next(error);
  }
};

const movementFormPage = async (req, res, next, mode) => {
  try {
    const products = await loadProductOptions();
    const selected = toInt(req.query.product) || null;
    const titleByMode = {
      in: "Record Stock In",
      out: "Record Stock Out",
      adjust: "Stock Adjustment",
    };
    return res.render("pos/inventory/form", {
      title: titleByMode[mode],
      active: "inventory",
      mode,
      selected,
      products,
    });
  } catch (error) {
    return next(error);
  }
};

export const stockInPage = (req, res, next) => movementFormPage(req, res, next, "in");
export const stockOutPage = (req, res, next) => movementFormPage(req, res, next, "out");
export const adjustmentPage = (req, res, next) =>
  movementFormPage(req, res, next, "adjust");

const requireProduct = async (productId, transaction) => {
  const product = await Product.findByPk(productId, { transaction });
  if (!product) throw new PosError("Product not found.");
  if (product.status !== "active") {
    throw new PosError("Archived products cannot receive stock movements.");
  }
  return product;
};

export const stockIn = async (req, res, next) => {
  const productId = toInt(req.body.productId);
  const quantity = toInt(req.body.quantity);
  const reason = String(req.body.reason || "").trim();
  const reference = String(req.body.referenceNumber || "").trim();

  if (!Number.isFinite(productId) || productId <= 0) {
    flashError(req, "Select a product.");
    return res.redirect("/pos/inventory/stock-in");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    flashError(req, "Quantity must be a positive whole number.");
    return res.redirect(`/pos/inventory/stock-in?product=${productId}`);
  }
  if (quantity > 100000) {
    flashError(req, "Quantity is unrealistically large.");
    return res.redirect(`/pos/inventory/stock-in?product=${productId}`);
  }

  try {
    await sequelize.transaction(async (t) => {
      const product = await requireProduct(productId, t);
      let inventory = await findInventoryForUpdate(productId, t);
      if (!inventory) {
        inventory = await Inventory.create(
          {
            productId,
            currentStock: 0,
            minStockLevel: 5,
            unit: "pcs",
            lastUpdated: new Date(),
          },
          { transaction: t }
        );
      }

      const previousStock = Number(inventory.currentStock);
      const newStock = previousStock + quantity;
      await inventory.update(
        { currentStock: newStock, lastUpdated: new Date() },
        { transaction: t }
      );
      await InventoryMovement.create(
        {
          productId,
          productName: product.name,
          type: "Stock In",
          quantity,
          previousStock,
          newStock,
          referenceNumber: reference || generateNumber("IN"),
          reason: reason || "Stock received.",
          performedBy: req.user.id,
          performedByName: req.user.name,
        },
        { transaction: t }
      );
    });

    flashSuccess(req, "Stock In recorded. Inventory updated.");
    return res.redirect("/pos/inventory");
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect(`/pos/inventory/stock-in?product=${productId}`);
    }
    throw error;
  }
};

export const stockOut = async (req, res, next) => {
  const productId = toInt(req.body.productId);
  const quantity = toInt(req.body.quantity);
  const reason = String(req.body.reason || "").trim();
  const reference = String(req.body.referenceNumber || "").trim();

  if (!Number.isFinite(productId) || productId <= 0) {
    flashError(req, "Select a product.");
    return res.redirect("/pos/inventory/stock-out");
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    flashError(req, "Quantity must be a positive whole number.");
    return res.redirect(`/pos/inventory/stock-out?product=${productId}`);
  }
  if (reason.length < 3) {
    flashError(req, "A reason is required for Stock Out (spoilage, transfer, waste).");
    return res.redirect(`/pos/inventory/stock-out?product=${productId}`);
  }

  try {
    await sequelize.transaction(async (t) => {
      const product = await requireProduct(productId, t);
      const inventory = await findInventoryForUpdate(productId, t);
      if (!inventory) throw new PosError("This product has no inventory record.");

      const previousStock = Number(inventory.currentStock);
      if (previousStock < quantity) {
        throw new PosError(
          `Cannot remove ${quantity} ${inventory.unit}. Only ${previousStock} on hand.`
        );
      }

      const newStock = previousStock - quantity;
      await inventory.update(
        { currentStock: newStock, lastUpdated: new Date() },
        { transaction: t }
      );
      await InventoryMovement.create(
        {
          productId,
          productName: product.name,
          type: "Stock Out",
          quantity,
          previousStock,
          newStock,
          referenceNumber: reference || generateNumber("OUT"),
          reason,
          performedBy: req.user.id,
          performedByName: req.user.name,
        },
        { transaction: t }
      );
    });

    flashSuccess(req, "Stock Out recorded. Inventory updated.");
    return res.redirect("/pos/inventory");
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect(`/pos/inventory/stock-out?product=${productId}`);
    }
    throw error;
  }
};

export const adjustment = async (req, res, next) => {
  const productId = toInt(req.body.productId);
  const newStock = toInt(req.body.newStock);
  const reason = String(req.body.reason || "").trim();

  if (!Number.isFinite(productId) || productId <= 0) {
    flashError(req, "Select a product.");
    return res.redirect("/pos/inventory/adjustment");
  }
  if (!Number.isFinite(newStock) || newStock < 0) {
    flashError(req, "Counted stock must be zero or a positive whole number.");
    return res.redirect(`/pos/inventory/adjustment?product=${productId}`);
  }
  if (reason.length < 5) {
    flashError(req, "A detailed reason is required for stock adjustments.");
    return res.redirect(`/pos/inventory/adjustment?product=${productId}`);
  }

  try {
    await sequelize.transaction(async (t) => {
      const product = await requireProduct(productId, t);
      const inventory = await findInventoryForUpdate(productId, t);
      if (!inventory) throw new PosError("This product has no inventory record.");

      const previousStock = Number(inventory.currentStock);
      if (previousStock === newStock) {
        throw new PosError("The counted stock already matches the system stock.");
      }

      await inventory.update(
        { currentStock: newStock, lastUpdated: new Date() },
        { transaction: t }
      );
      await InventoryMovement.create(
        {
          productId,
          productName: product.name,
          type: "Adjustment",
          quantity: Math.abs(newStock - previousStock),
          previousStock,
          newStock,
          referenceNumber: generateNumber("ADJ"),
          reason,
          performedBy: req.user.id,
          performedByName: req.user.name,
        },
        { transaction: t }
      );
    });

    flashSuccess(req, "Stock adjustment recorded and inventory updated.");
    return res.redirect("/pos/inventory");
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect(`/pos/inventory/adjustment?product=${productId}`);
    }
    throw error;
  }
};

export const updateMinLevel = async (req, res, next) => {
  const productId = toInt(req.params.productId);
  const minStockLevel = toInt(req.body.minStockLevel);
  if (!Number.isFinite(minStockLevel) || minStockLevel < 0) {
    flashError(req, "Minimum stock level must be zero or a positive number.");
    return res.redirect("/pos/inventory");
  }

  try {
    const inventory = await Inventory.findOne({ where: { productId } });
    if (!inventory) {
      flashError(req, "This product has no inventory record.");
      return res.redirect("/pos/inventory");
    }
    await inventory.update({
      minStockLevel,
      lastUpdated: new Date(),
    });
    flashSuccess(req, "Minimum stock level updated.");
    return res.redirect(`/pos/inventory/${productId}`);
  } catch (error) {
    return next(error);
  }
};

export const movementList = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const type = String(req.query.type || "").trim();
    const productId = toInt(req.query.product) || null;
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();

    const where = {};
    if (MOVEMENT_TYPES.includes(type)) where.type = type;
    if (productId) where.productId = productId;
    if (q) {
      where[Op.or] = [
        { productName: { [Op.like]: `%${q}%` } },
        { referenceNumber: { [Op.like]: `%${q}%` } },
        { reason: { [Op.like]: `%${q}%` } },
        { performedByName: { [Op.like]: `%${q}%` } },
      ];
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt[Op.gte] = new Date(`${from}T00:00:00`);
      if (to) where.createdAt[Op.lte] = new Date(`${to}T23:59:59.999`);
    }

    const [movements, summaryRows, products] = await Promise.all([
      InventoryMovement.findAll({
        where,
        order: [["createdAt", "DESC"]],
        limit: 300,
      }),
      sequelize.query(
        `SELECT type, COUNT(*) AS count, COALESCE(SUM(quantity),0) AS units
         FROM inventory_movements GROUP BY type`,
        { type: QueryTypes.SELECT }
      ),
      Product.findAll({
        where: { status: "active" },
        attributes: ["id", "name"],
        order: [["name", "ASC"]],
      }),
    ]);

    const summary = Object.fromEntries(
      MOVEMENT_TYPES.map((movementType) => {
        const row = summaryRows.find((item) => item.type === movementType);
        return [movementType, { count: Number(row?.count ?? 0), units: Number(row?.units ?? 0) }];
      })
    );

    return res.render("pos/inventory/movements", {
      title: "Inventory Movements",
      active: "inventory",
      movements,
      summary,
      types: MOVEMENT_TYPES,
      products,
      filters: { q, type, product: productId || "", from, to },
    });
  } catch (error) {
    return next(error);
  }
};
