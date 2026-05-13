import express from "express";
import cors from "cors";
import { config } from "./config";
import chatRoutes from "./routes/chat.routes";
import { initDatabase } from "./utils/database";

const app = express();

// Allow Angular frontend (port 4200) to call this API
app.use(cors({ origin: "http://localhost:4200" }));
app.use(express.json());

// Initialize SQLite database (synchronous — runs immediately)
initDatabase();

// API routes
app.use("/api", chatRoutes);

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Start server
app.listen(config.port, () => {
  console.log(`\n🚀 Server running on http://localhost:${config.port}`);
  console.log(`📋 Health check: http://localhost:${config.port}/health\n`);
});
