/*
  DJYum — authentication. Uses the existing Users table; roles are added
  non-destructively by utils/bootstrap.js for older databases.
*/
import bcrypt from "bcrypt";
import { User } from "../models/index.js";
import { flashError, flashSuccess } from "../utils/pos.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const loginPage = (req, res) => {
  if (req.session?.userId) return res.redirect("/dashboard");
  return res.render("login", { title: "Sign In" });
};

export const registerPage = async (req, res, next) => {
  if (req.session?.userId) return res.redirect("/dashboard");
  try {
    const userCount = await User.count();
    return res.render("register", { title: "Create Account", isFirstUser: userCount === 0 });
  } catch (error) {
    return next(error);
  }
};

export const forgotPasswordPage = (req, res) =>
  res.render("forgotpassword", { title: "Forgot Password" });

export const loginUser = async (req, res, next) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!EMAIL_PATTERN.test(email) || !password) {
    flashError(req, "Enter a valid email address and password.");
    return res.redirect("/login");
  }

  try {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      flashError(req, "No account matches those credentials.");
      return res.redirect("/login");
    }
    const matches = await bcrypt.compare(password, user.password);
    if (!matches) {
      flashError(req, "Incorrect password. Please try again.");
      return res.redirect("/login");
    }

    // Regenerate the session id to prevent session fixation.
    return req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.save(() => res.redirect("/dashboard"));
    });
  } catch (error) {
    return next(error);
  }
};

export const registerUser = async (req, res, next) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (name.length < 2) {
    flashError(req, "Please enter your full name.");
    return res.redirect("/register");
  }
  if (!EMAIL_PATTERN.test(email)) {
    flashError(req, "Please enter a valid email address.");
    return res.redirect("/register");
  }
  if (password.length < 6) {
    flashError(req, "Password must be at least 6 characters long.");
    return res.redirect("/register");
  }

  try {
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      flashError(req, "An account with that email already exists.");
      return res.redirect("/login");
    }

    // The very first account owns the system; everyone else starts as cashier.
    const isFirstUser = (await User.count()) === 0;
    const user = await User.create({
      name,
      email,
      password: await bcrypt.hash(password, 10),
      role: isFirstUser ? "admin" : "cashier",
    });

    return req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.save(() => {
        flashSuccess(
          req,
          isFirstUser
            ? "Administrator account created. Welcome to DJYum!"
            : "Account created. You are signed in as a cashier."
        );
        res.redirect("/dashboard");
      });
    });
  } catch (error) {
    return next(error);
  }
};

export const logoutUser = (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
};
