/*
  DJYum — database setup.
  Usage: npm run setup
  Safe to run repeatedly: creates missing tables/columns and seed rows only.
*/
import { initializeDatabase } from "./utils/bootstrap.js";
import { sequelize } from "./models/index.js";

try {
  await initializeDatabase();
  console.log("✅ Setup complete. Start the app with: npm run xian");
} catch (error) {
  console.error("❌ Setup failed:", error.message);
  console.error("   Check that MySQL is running and models/db.js credentials are correct.");
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
