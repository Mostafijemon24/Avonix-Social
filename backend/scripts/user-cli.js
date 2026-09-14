#!/usr/bin/env node
/**
 * User account recovery — VPS / server terminal ONLY.
 * Usage:
 *   npm run user:forgot -- email@example.com
 *
 * Prints the 6-digit reset code when Gmail does not deliver the SMTP message.
 */
import "dotenv/config";
import { requestPasswordReset } from "../src/services/verifyService.js";
import prisma from "../src/db.js";

async function cmdForgot(emailArg) {
  const email = emailArg || process.argv[3];
  if (!email) {
    console.error("Usage: npm run user:forgot -- email@domain.com");
    process.exit(1);
  }
  const result = await requestPasswordReset(email, { revealCode: true });
  if (!result.ok) {
    console.error("ERROR:", result.error);
    process.exit(1);
  }
  if (!result.emailCode) {
    console.error("\nNo user account exists for:", email);
    process.exit(1);
  }
  console.log("\n✓ Reset issued for", result.email);
  console.log("  SMTP:", result.delivery?.email || "unknown", result.delivery?.emailError || "");
  console.log("\n─── EMAIL RESET CODE (valid 10 min) ───");
  console.log("  ", result.emailCode);
  console.log("\nEnter this code on /login → Forgot password, then set a new password.");
  console.log("If Gmail did not arrive, use this terminal code. Older emails will not work.\n");
}

async function main() {
  const cmd = process.argv[2] || "forgot";
  try {
    if (cmd === "forgot") await cmdForgot();
    else {
      console.log("Commands: forgot");
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
