import express from "express";
import { homePage } from "../controllers/homeController.js";
import {
  loginPage,
  registerPage,
  forgotPasswordPage,
  loginUser,
  registerUser,
  logoutUser,
} from "../controllers/authController.js";
import { dashboardPage, dashboardStats } from "../controllers/dashboardController.js";
import { requireAuth } from "../middleware/auth.js";
import posRoutes from "./posRoutes.js";

const router = express.Router();

router.get("/", homePage);

router.get("/login", loginPage);
router.post("/login", loginUser);
router.get("/register", registerPage);
router.post("/register", registerUser);
router.get("/forgot-password", forgotPasswordPage);
router.get("/logout", logoutUser);

router.get("/dashboard", requireAuth, dashboardPage);
router.get("/api/dashboard/stats", requireAuth, dashboardStats);

router.use("/pos", posRoutes);

export default router;
