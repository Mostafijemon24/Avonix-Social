import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import apiRoutes from "./src/routes/api.js";
import adminRoutes from "./src/routes/admin.js";
import webhookRoutes from "./src/routes/webhooks.js";
import { startPriceRefreshInterval } from "./src/modelPrices.js";
import { getCreditConfig } from "./src/credits.js";
import { syncConfigToEnv } from "./src/services/configService.js";
import { startReminderScheduler } from "./src/services/reminderService.js";
import { startJobWorker, drainForShutdown } from "./src/services/jobQueue.js";
import { registerAutoPosterJobs } from "./src/services/autoPosterService.js";
import prisma from "./src/db.js";

// Always load backend/.env (PM2 may start with a different cwd / stale env)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(
  "/api/uploads/generated",
  express.static(path.join(__dirname, "uploads", "generated"), {
    maxAge: "7d",
    fallthrough: false,
  })
);
app.use(
  "/uploads/generated",
  express.static(path.join(__dirname, "uploads", "generated"), {
    maxAge: "7d",
    fallthrough: false,
  })
);
app.use("/api", apiRoutes);
app.use("/api/admin", adminRoutes);
app.use("/webhooks", webhookRoutes);

async function bootstrap() {
  await syncConfigToEnv();
  startPriceRefreshInterval();
  startReminderScheduler();

  // Batch 5: durable background job worker (image generation, etc.). Handlers
  // must be registered before the worker starts polling. recoverStuckJobs runs
  // inside startJobWorker so interrupted jobs resume after a restart.
  registerAutoPosterJobs();
  const jobWorker = startJobWorker();

  const host = process.env.HOST || "0.0.0.0";
  const server = app.listen(PORT, host, () => {
    const config = getCreditConfig();
    console.log(`Avonix Social API → http://${host}:${PORT}`);
    console.log(`Admin panel API → http://${host}:${PORT}/api/admin`);
    console.log(
      `Credit: $1 = ${config.creditsPerDollar} credits | Margin: ${config.marginMultiplier}x`
    );
  });

  server.on("error", (err) => {
    console.error("[avonix-api] listen failed:", err.message);
    process.exit(1);
  });

  // Graceful shutdown: stop accepting new HTTP + new jobs, let in-flight jobs
  // drain, then disconnect. Unfinished queued jobs resume on the next boot.
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[avonix-api] ${signal} received — draining…`);
    jobWorker.stop();
    server.close(() => console.log("[avonix-api] HTTP server closed"));
    try {
      await drainForShutdown({ timeoutMs: 15000 });
    } catch (err) {
      console.error("[avonix-api] drain error:", err.message);
    }
    try {
      await prisma.$disconnect();
    } catch { /* ignore */ }
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  console.error("[avonix-api] bootstrap failed:", err);
  process.exit(1);
});

