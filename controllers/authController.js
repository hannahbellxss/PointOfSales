/*
  DJYum — authentication. Uses the existing Users table; roles are added
  non-destructively by utils/bootstrap.js for older databases.
*/
import bcrypt from "bcrypt";
import { User } from "../models/index.js";
import { flashError, flashSuccess } from "../utils/pos.js";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { Op } from "sequelize";

const mailer = nodemailer.createTransport({
  service: "gmail",
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD,
  },
});
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

export const forgotPassword = async (req, res, next) => {
  const email = String(req.body.email || "").trim().toLowerCase();

  if (!EMAIL_PATTERN.test(email)) {
    flashError(req, "Please enter a valid email address.");
    return res.redirect("/forgot-password");
  }

  if (!process.env.MAIL_USER || !process.env.MAIL_PASSWORD) {
    flashError(req, "Password reset email is unavailable. Please contact the administrator.");
    return res.redirect("/forgot-password");
  }

  try {
    const user = await User.findOne({ where: { email } });

  
    if (!user) {
      flashSuccess(
        req,
        "Kung registered ang email, makakatanggap ka ng password reset link."
      );
      return res.redirect("/forgot-password");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    await user.update({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: new Date(Date.now() + 15 * 60 * 1000),
    });

    const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3010}`;
    const resetUrl = new URL(`/reset-password/${token}`, baseUrl);

    try {
      await mailer.sendMail({
        from: process.env.MAIL_USER,
        to: user.email,
        subject: "DJYum Password Reset",
        text: `I-click ang link na ito para palitan ang password mo:\n\n${resetUrl}\n\nValid lamang ito sa loob ng 15 minuto.`,
      });
    } catch (error) {
      await User.update(
        { resetPasswordToken: null, resetPasswordExpires: null },
        { where: { id: user.id, resetPasswordToken: tokenHash } }
      );
      console.error("Password reset email failed:", error.code || error.name);
    }

    flashSuccess(
      req,
      "Kung registered ang email, makakatanggap ka ng password reset link."
    );
    return res.redirect("/forgot-password");
  } catch (error) {
    return next(error);
  }
};

export const resetPasswordPage = async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  try {
    const tokenHash = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const user = await User.findOne({
      where: {
        resetPasswordToken: tokenHash,
      },
    });

    if (!user || !user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
      return res.status(400).render("error", {
        title: "Invalid Reset Link",
        status: 400,
        message: "Invalid or expired password reset link.",
      });
    }

    return res.render("resetpassword", {
      title: "Reset Password",
      token: req.params.token,
    });
  } catch (error) {
    return next(error);
  }
};

export const resetPassword = async (req, res, next) => {
  const password = String(req.body.password || "");
  const confirmPassword = String(req.body.confirmPassword || "");

  if (password.length < 6) {
    flashError(req, "Password must be at least 6 characters long.");
    return res.redirect(`/reset-password/${req.params.token}`);
  }

  if (Buffer.byteLength(password, "utf8") > 72) {
    flashError(req, "Password must be at most 72 bytes long.");
    return res.redirect(`/reset-password/${req.params.token}`);
  }

  if (password !== confirmPassword) {
    flashError(req, "Passwords do not match.");
    return res.redirect(`/reset-password/${req.params.token}`);
  }

  try {
    const tokenHash = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const user = await User.findOne({
      where: {
        resetPasswordToken: tokenHash,
      },
    });

    if (!user || !user.resetPasswordExpires || user.resetPasswordExpires < new Date()) {
      return res.status(400).render("error", {
        title: "Invalid Reset Link",
        status: 400,
        message: "Invalid or expired password reset link.",
      });
    }

    const [updated] = await User.update(
      {
        password: await bcrypt.hash(password, 10),
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
      {
        where: {
          id: user.id,
          resetPasswordToken: tokenHash,
          resetPasswordExpires: { [Op.gt]: new Date() },
        },
      }
    );
    if (!updated) {
      return res.status(400).render("error", {
        title: "Invalid Reset Link",
        status: 400,
        message: "Invalid or expired password reset link.",
      });
    }

    flashSuccess(req, "Password changed successfully. You may now log in.");
    return res.redirect("/login");
  } catch (error) {
    return next(error);
  }
};


