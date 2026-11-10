/*
  DJYum — authentication and role-based access control middleware.
*/
import { User } from "../models/index.js";
import { can } from "../utils/permissions.js";

export const requireAuth = async (req, res, next) => {
  if (!req.session?.userId) {
    req.flash("error_msg", "Please sign in to continue.");
    return res.redirect("/login");
  }
  try {
    const user = await User.findByPk(req.session.userId);
    if (!user) {
      return req.session.destroy(() => res.redirect("/login"));
    }
    req.user = user;
    res.locals.currentUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

export const allow = (...roles) => (req, res, next) => {
  if (!req.user) {
    req.flash("error_msg", "Please sign in to continue.");
    return res.redirect("/login");
  }
  if (roles.includes(req.user.role)) return next();
  req.flash("error_msg", "You are not authorized to access that page.");
  return res.redirect("/dashboard");
};

export const requireCapability = (capability) => (req, res, next) => {
  if (!req.user) {
    req.flash("error_msg", "Please sign in to continue.");
    return res.redirect("/login");
  }
  if (can(req.user, capability)) return next();
  req.flash("error_msg", "You are not authorized to perform that action.");
  return res.redirect("/dashboard");
};
