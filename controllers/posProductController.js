/*
  DJYum — product management. Products are archived, never deleted, so
  historical order items keep pointing at a real product row.
*/
import { Op } from "sequelize";
import {
  sequelize,
  Product,
  Category,
  Inventory,
  InventoryMovement,
} from "../models/index.js";
import {
  flashError,
  flashSuccess,
  generateNumber,
  num,
  toInt,
} from "../utils/pos.js";
import { validateImagePayload } from "../utils/image.js";

const PRODUCT_TYPES = ["Food", "Beverage", "Dessert", "Combo", "Other"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const loadCategories = () =>
  Category.findAll({
    where: { status: "active" },
    order: [["name", "ASC"]],
  });

export const productList = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const categoryId = toInt(req.query.category) || null;
    const stock = String(req.query.stock || "").trim();
    const status = String(req.query.status || "").trim();

    const where = {};
    if (q) {
      where[Op.or] = [
        { name: { [Op.like]: `%${q}%` } },
        { description: { [Op.like]: `%${q}%` } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (["active", "archived"].includes(status)) where.status = status;

    const products = await Product.findAll({
      where,
      include: [
        { model: Category, as: "category", attributes: ["id", "name"] },
        { model: Inventory, as: "inventory", required: false },
      ],
      order: [
        ["status", "ASC"],
        ["name", "ASC"],
      ],
      limit: 300,
    });

    const rows = products.map((product) => {
      const data = product.toJSON();
      const currentStock = Number(data.inventory?.currentStock ?? 0);
      const minStock = Number(data.inventory?.minStockLevel ?? 0);
      const stockStatus =
        currentStock <= 0
          ? "Out of Stock"
          : currentStock <= minStock
          ? "Low Stock"
          : "In Stock";
      return { ...data, currentStock, minStock, stockStatus };
    });

    const filtered = rows.filter((row) => {
      if (stock === "low") return row.stockStatus === "Low Stock";
      if (stock === "out") return row.stockStatus === "Out of Stock";
      if (stock === "available") return row.stockStatus === "In Stock";
      return true;
    });

    return res.render("pos/products/index", {
      title: "Products",
      active: "products",
      products: filtered,
      categories: await loadCategories(),
      filters: {
        q,
        category: categoryId || "",
        stock,
        status,
      },
      totals: {
        total: rows.filter((r) => r.status === "active").length,
        archived: rows.filter((r) => r.status === "archived").length,
        low: rows.filter((r) => r.stockStatus === "Low Stock").length,
        out: rows.filter((r) => r.stockStatus === "Out of Stock").length,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const productNewPage = async (req, res, next) => {
  try {
    return res.render("pos/products/form", {
      title: "Add Product",
      active: "products",
      mode: "create",
      product: null,
      categories: await loadCategories(),
      productTypes: PRODUCT_TYPES,
    });
  } catch (error) {
    return next(error);
  }
};

const validateProductPayload = (body) => {
  const name = String(body.name || "").trim();
  const description = String(body.description || "").trim();
  const categoryId = toInt(body.categoryId);
  const price = num(body.price, -1);
  const type = PRODUCT_TYPES.includes(body.type) ? body.type : "Food";
  const unit = String(body.unit || "pcs").trim() || "pcs";
  const minStockLevel = toInt(body.minStockLevel ?? 0);
  const initialStock = toInt(body.initialStock ?? 0);

  if (name.length < 2 || name.length > 160) {
    return { error: "Product name must be between 2 and 160 characters." };
  }
  if (!Number.isFinite(categoryId) || categoryId <= 0) {
    return { error: "Select a valid category for this product." };
  }
  if (!Number.isFinite(price) || price <= 0) {
    return { error: "Selling price must be greater than zero." };
  }
  if (price > 999999.99) {
    return { error: "Selling price is too large." };
  }
  if (!Number.isFinite(minStockLevel) || minStockLevel < 0) {
    return { error: "Minimum stock level must be zero or a positive number." };
  }
  if (!Number.isFinite(initialStock) || initialStock < 0) {
    return { error: "Initial stock must be zero or a positive number." };
  }
  if (unit.length > 24) return { error: "Unit of measurement is too long." };

  return {
    values: {
      name,
      description: description || null,
      categoryId,
      price: Math.round(price * 100) / 100,
      type,
      unit,
      minStockLevel,
      initialStock,
    },
  };
};

export const productCreate = async (req, res, next) => {
  const { error, values } = validateProductPayload(req.body);
  if (error) {
    flashError(req, error);
    return res.redirect("/pos/products/new");
  }

  const image = validateImagePayload(req.body.imageData, MAX_IMAGE_BYTES);
  if (image.error) {
    flashError(req, image.error);
    return res.redirect("/pos/products/new");
  }

  try {
    const category = await Category.findByPk(values.categoryId);
    if (!category || category.status !== "active") {
      flashError(req, "The selected category is not available.");
      return res.redirect("/pos/products/new");
    }

    await sequelize.transaction(async (t) => {
      const product = await Product.create(
        {
          name: values.name,
          description: values.description,
          categoryId: values.categoryId,
          price: values.price,
          type: values.type,
          availability: req.body.availability === "on" || req.body.availability === "true",
          image: image.value,
          status: "active",
        },
        { transaction: t }
      );

      await Inventory.create(
        {
          productId: product.id,
          currentStock: values.initialStock,
          minStockLevel: values.minStockLevel,
          unit: values.unit,
          lastUpdated: new Date(),
        },
        { transaction: t }
      );

      if (values.initialStock > 0) {
        await InventoryMovement.create(
          {
            productId: product.id,
            productName: product.name,
            type: "Stock In",
            quantity: values.initialStock,
            previousStock: 0,
            newStock: values.initialStock,
            referenceNumber: generateNumber("INIT"),
            reason: "Initial stock recorded when the product was created.",
            performedBy: req.user.id,
            performedByName: req.user.name,
          },
          { transaction: t }
        );
      }
    });

    flashSuccess(req, `Product "${values.name}" added.`);
    return res.redirect("/pos/products");
  } catch (err) {
    return next(err);
  }
};

export const productEditPage = async (req, res, next) => {
  try {
    const product = await Product.findByPk(req.params.id, {
      include: [
        { model: Category, as: "category", attributes: ["id", "name"] },
        { model: Inventory, as: "inventory", required: false },
      ],
    });
    if (!product) {
      flashError(req, "Product not found.");
      return res.redirect("/pos/products");
    }
    return res.render("pos/products/form", {
      title: `Edit ${product.name}`,
      active: "products",
      mode: "edit",
      product: product.toJSON(),
      categories: await loadCategories(),
      productTypes: PRODUCT_TYPES,
    });
  } catch (error) {
    return next(error);
  }
};

export const productUpdate = async (req, res, next) => {
  const product = await Product.findByPk(req.params.id).catch(() => null);
  if (!product) {
    flashError(req, "Product not found.");
    return res.redirect("/pos/products");
  }

  const { error, values } = validateProductPayload(req.body);
  if (error) {
    flashError(req, error);
    return res.redirect(`/pos/products/${product.id}/edit`);
  }

  const image = validateImagePayload(req.body.imageData, MAX_IMAGE_BYTES);
  if (image.error) {
    flashError(req, image.error);
    return res.redirect(`/pos/products/${product.id}/edit`);
  }

  try {
    const category = await Category.findByPk(values.categoryId);
    if (!category || (category.status !== "active" && category.id !== product.categoryId)) {
      flashError(req, "The selected category is not available.");
      return res.redirect(`/pos/products/${product.id}/edit`);
    }

    await sequelize.transaction(async (t) => {
      const updates = {
        name: values.name,
        description: values.description,
        categoryId: values.categoryId,
        price: values.price,
        type: values.type,
        availability:
          req.body.availability === "on" || req.body.availability === "true",
      };
      if (image.value !== undefined) updates.image = image.value;
      await product.update(updates, { transaction: t });

      const inventory = await Inventory.findOne({
        where: { productId: product.id },
        transaction: t,
      });
      if (inventory) {
        // Stock quantity is intentionally NOT editable here: it may only change
        // through a recorded stock movement (Stock In / Out / Adjustment).
        await inventory.update(
          { minStockLevel: values.minStockLevel, unit: values.unit },
          { transaction: t }
        );
      }
    });

    flashSuccess(req, `Product "${values.name}" updated.`);
    return res.redirect("/pos/products");
  } catch (err) {
    return next(err);
  }
};

export const productArchive = async (req, res, next) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) {
      flashError(req, "Product not found.");
      return res.redirect("/pos/products");
    }
    await product.update({ status: "archived", availability: false });
    flashSuccess(
      req,
      `"${product.name}" archived. Historical orders and stock records were preserved.`
    );
    return res.redirect("/pos/products");
  } catch (error) {
    return next(error);
  }
};

export const productRestore = async (req, res, next) => {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) {
      flashError(req, "Product not found.");
      return res.redirect("/pos/products");
    }
    await product.update({ status: "active", availability: true });
    flashSuccess(req, `"${product.name}" restored to the menu and marked available.`);
    return res.redirect("/pos/products");
  } catch (error) {
    return next(error);
  }
};
