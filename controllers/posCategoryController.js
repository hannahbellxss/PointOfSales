/*
  DJYum — category management (menu categories).
*/
import { Op, fn, col } from "sequelize";
import { Category, Product } from "../models/index.js";
import { flashError, flashSuccess } from "../utils/pos.js";

export const categoryList = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();

    const where = {};
    if (q) where.name = { [Op.like]: `%${q}%` };
    if (["active", "archived"].includes(status)) where.status = status;

    const categories = await Category.findAll({
      where,
      order: [
        ["status", "ASC"],
        ["name", "ASC"],
      ],
    });

    const counts = await Product.findAll({
      attributes: ["categoryId", [fn("COUNT", col("id")), "total"]],
      group: ["categoryId"],
      raw: true,
    });
    const countMap = new Map(counts.map((row) => [row.categoryId, Number(row.total)]));

    return res.render("pos/categories", {
      title: "Categories",
      active: "categories",
      categories: categories.map((category) => ({
        ...category.toJSON(),
        productCount: countMap.get(category.id) || 0,
      })),
      filters: { q, status },
      totals: {
        all: categories.length,
        active: categories.filter((c) => c.status === "active").length,
        archived: categories.filter((c) => c.status === "archived").length,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const categoryCreate = async (req, res, next) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();

  if (name.length < 2 || name.length > 120) {
    flashError(req, "Category name must be between 2 and 120 characters.");
    return res.redirect("/pos/categories");
  }

  try {
    const existing = await Category.findOne({ where: { name } });
    if (existing) {
      flashError(req, `Category "${name}" already exists.`);
      return res.redirect("/pos/categories");
    }
    await Category.create({ name, description: description || null, status: "active" });
    flashSuccess(req, `Category "${name}" created.`);
    return res.redirect("/pos/categories");
  } catch (error) {
    return next(error);
  }
};

export const categoryUpdate = async (req, res, next) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();

  if (name.length < 2 || name.length > 120) {
    flashError(req, "Category name must be between 2 and 120 characters.");
    return res.redirect("/pos/categories");
  }

  try {
    const category = await Category.findByPk(req.params.id);
    if (!category) {
      flashError(req, "Category not found.");
      return res.redirect("/pos/categories");
    }
    const duplicate = await Category.findOne({
      where: { name, id: { [Op.ne]: category.id } },
    });
    if (duplicate) {
      flashError(req, `Another category is already named "${name}".`);
      return res.redirect("/pos/categories");
    }
    await category.update({ name, description: description || null });
    flashSuccess(req, "Category updated.");
    return res.redirect("/pos/categories");
  } catch (error) {
    return next(error);
  }
};

export const categoryArchive = async (req, res, next) => {
  try {
    const category = await Category.findByPk(req.params.id);
    if (!category) {
      flashError(req, "Category not found.");
      return res.redirect("/pos/categories");
    }
    const activeProducts = await Product.count({
      where: { categoryId: category.id, status: "active" },
    });
    if (activeProducts > 0) {
      flashError(
        req,
        `Archive or reassign the ${activeProducts} active product(s) in "${category.name}" first.`
      );
      return res.redirect("/pos/categories");
    }
    await category.update({ status: "archived" });
    flashSuccess(req, `Category "${category.name}" archived.`);
    return res.redirect("/pos/categories");
  } catch (error) {
    return next(error);
  }
};

export const categoryRestore = async (req, res, next) => {
  try {
    const category = await Category.findByPk(req.params.id);
    if (!category) {
      flashError(req, "Category not found.");
      return res.redirect("/pos/categories");
    }
    await category.update({ status: "active" });
    flashSuccess(req, `Category "${category.name}" restored.`);
    return res.redirect("/pos/categories");
  } catch (error) {
    return next(error);
  }
};
