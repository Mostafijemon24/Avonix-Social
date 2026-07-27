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

// Always load backend/.env (PM2 may start with a different cwd / stale env)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use("/api", apiRoutes);
app.use("/api/admin", adminRoutes);
app.use("/webhooks", webhookRoutes);

async function bootstrap() {
  await syncConfigToEnv();
  startPriceRefreshInterval();
  startReminderScheduler();

  app.listen(PORT, () => {
    const config = getCreditConfig();
    console.log(`Avonix Social API → http://localhost:${PORT}`);
    console.log(`Admin panel API → http://localhost:${PORT}/api/admin`);
    console.log(
      `Credit: $1 = ${config.creditsPerDollar} credits | Margin: ${config.marginMultiplier}x`
    );
  });
}

bootstrap().catch(console.error);
