/*
  DJYum — POS terminal. The browser handles the cart for speed, but every
  price, stock check and total is recomputed from the database on submit.
*/
import {
  sequelize,
  Product,
  Category,
  Inventory,
  Discount,
  Order,
  OrderItem,
} from "../models/index.js";
import {
  PosError,
  computeTotals,
  discountAmountFor,
  flashError,
  flashSuccess,
  generateNumber,
  getSettings,
  num,
  round2,
  toInt,
} from "../utils/pos.js";

export const terminalPage = async (req, res, next) => {
  try {
    const [products, categories, discounts, settings] = await Promise.all([
      Product.findAll({
        where: { status: "active", availability: true },
        include: [
          { model: Category, as: "category", attributes: ["id", "name"] },
          { model: Inventory, as: "inventory", required: false },
        ],
        order: [["name", "ASC"]],
      }),
      Category.findAll({
        where: { status: "active" },
        order: [["name", "ASC"]],
      }),
      Discount.findAll({ where: { status: "active" }, order: [["name", "ASC"]] }),
      getSettings(),
    ]);

    const catalog = products.map((product) => {
      const record = product.toJSON();
      return {
        id: record.id,
        name: record.name,
        price: num(record.price),
        image: record.image || null,
        categoryId: record.categoryId,
        category: record.category?.name || "Uncategorized",
        stock: Number(record.inventory?.currentStock ?? 0),
        unit: record.inventory?.unit || "pcs",
        type: record.type,
      };
    });

    return res.render("pos/terminal", {
      title: "POS Terminal",
      active: "terminal",
      catalog,
      categories,
      discounts,
      posSettings: settings,
    });
  } catch (error) {
    return next(error);
  }
};

const parseCart = (raw) => {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new PosError("The cart could not be read. Please add the items again.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new PosError("Add at least one product to the cart before creating an order.");
  }

  const merged = new Map();
  for (const line of parsed) {
    const productId = toInt(line?.productId);
    const quantity = toInt(line?.quantity);
    if (!Number.isFinite(productId) || productId <= 0) {
      throw new PosError("The cart contains an invalid product.");
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new PosError("Every order quantity must be greater than zero.");
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }

  for (const [productId, quantity] of merged) {
    if (quantity > 999) {
      throw new PosError("A single item quantity cannot exceed 999.");
    }
    merged.set(productId, quantity);
  }

  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
};

/** Validates cart lines against live products, availability and stock. */
export const resolveCart = async ({ rawItems, transaction }) => {
  const lines = parseCart(rawItems);
  const ids = lines.map((line) => line.productId);

  const products = await Product.findAll({
    where: { id: ids, status: "active" },
    include: [{ model: Inventory, as: "inventory", required: false }],
    transaction,
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const items = lines.map((line) => {
    const product = byId.get(line.productId);
    if (!product) throw new PosError("One of the selected products is no longer available.");
    if (!product.availability) {
      throw new PosError(`"${product.name}" is currently marked unavailable.`);
    }

    const inventory = product.inventory;
    const stock = Number(inventory?.currentStock ?? 0);
    if (!inventory) {
      throw new PosError(`No inventory record exists for "${product.name}".`);
    }
    if (stock < line.quantity) {
      throw new PosError(
        `Insufficient stock for "${product.name}". Only ${stock} ${inventory.unit || "pcs"} left.`
      );
    }

    const unitPrice = round2(product.price);
    return {
      productId: product.id,
      productName: product.name,
      unitPrice,
      quantity: line.quantity,
      subtotal: round2(unitPrice * line.quantity),
    };
  });

  return { items, lines };
};

export const createOrder = async (req, res, next) => {
  const orderType = ["Dine-In", "Take-Out"].includes(req.body.orderType)
    ? req.body.orderType
    : "Dine-In";
  const note = String(req.body.note || "").trim().slice(0, 500);

  try {
    const settings = await getSettings();
    let orderId;

    await sequelize.transaction(async (t) => {
      const { items } = await resolveCart({ rawItems: req.body.items, transaction: t });
      const subtotal = round2(items.reduce((sum, item) => sum + item.subtotal, 0));
      const totals = computeTotals(subtotal, 0, settings);

      const order = await Order.create(
        {
          orderNumber: generateNumber("ORD"),
          cashierId: req.user.id,
          cashierName: req.user.name,
          orderType,
          subtotal: totals.subtotal,
          discountAmount: 0,
          taxAmount: totals.taxAmount,
          serviceCharge: totals.serviceCharge,
          totalAmount: totals.totalAmount,
          status: "Pending",
          note: note || null,
        },
        { transaction: t }
      );

      await OrderItem.bulkCreate(
        items.map((item) => ({ ...item, orderId: order.id })),
        { transaction: t }
      );

      orderId = order.id;
    });

    flashSuccess(req, "Order created. Assign a table (for dine-in) and process payment.");
    return res.redirect(`/pos/checkout/${orderId}`);
  } catch (error) {
    if (error instanceof PosError) {
      flashError(req, error.message);
      return res.redirect("/pos/terminal");
    }
    return next(error);
  }
};

/** Used by the checkout screen to preview an authorized discount. */
export const previewDiscount = async (discountId, subtotal) => {
  if (!discountId) return { discount: null, amount: 0 };
  const discount = await Discount.findOne({
    where: { id: discountId, status: "active" },
  });
  return { discount, amount: discountAmountFor(discount, subtotal) };
};
