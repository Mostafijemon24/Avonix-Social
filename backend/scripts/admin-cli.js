#!/usr/bin/env node
/**
 * Super Admin registration — VPS / server terminal ONLY.
 * Usage:
 *   npm run admin:create
 *   npm run admin:list
 *   npm run admin:delete -- email@example.com
 *   npm run admin:forgot -- email@example.com
 *
 * Max 2 Super Admins. 2FA (TOTP) is mandatory.
 */
import "dotenv/config";
import readline from "readline";
import qrcode from "qrcode-terminal";
import {
  createSuperAdminViaCli,
  deleteSuperAdminViaCli,
  listAdminsViaCli,
  requestAdminPasswordReset,
  canCreateAdmin,
  MAX_SUPER_ADMINS,
} from "../src/services/adminAuthService.js";
import prisma from "../src/db.js";

function ask(rl, question, { silent = false } = {}) {
  if (!silent) {
    return new Promise((resolve) => rl.question(question, resolve));
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let input = "";
    const onData = (buf) => {
      const str = buf.toString("utf8");
      for (const ch of str) {
        if (ch === "\n" || ch === "\r" || ch === "\u0004") {
          stdin.removeListener("data", onData);
          if (stdin.isTTY) stdin.setRawMode(!!wasRaw);
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (ch === "\u0003") process.exit(1);
        if (ch === "\u007f") {
          input = input.slice(0, -1);
          continue;
        }
        input += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

async function cmdCreate() {
  const slot = await canCreateAdmin();
  console.log("\n══════════════════════════════════════════");
  console.log("  Avonix Social — Super Admin Registration");
  console.log("  (VPS terminal only · Max " + MAX_SUPER_ADMINS + ")");
  console.log("══════════════════════════════════════════\n");
  console.log(`Slots used: ${slot.count}/${MAX_SUPER_ADMINS} · Remaining: ${slot.remaining}\n`);

  if (!slot.ok) {
    console.error(`ERROR: Maximum ${MAX_SUPER_ADMINS} Super Admins already exist.`);
    console.error("Delete one first: npm run admin:delete -- email@domain.com\n");
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const email = (await ask(rl, "Admin email: ")).trim();
  const name = (await ask(rl, "Display name (optional): ")).trim() || "Super Admin";
  const password = await ask(rl, "Password (min 12, upper/lower/number/special): ", {
    silent: true,
  });
  const confirm = await ask(rl, "Confirm password: ", { silent: true });
  rl.close();

  if (password !== confirm) {
    console.error("\nERROR: Passwords do not match.");
    process.exit(1);
  }

  const result = await createSuperAdminViaCli({ email, password, name });
  if (!result.ok) {
    console.error("\nERROR:", result.error);
    process.exit(1);
  }

  console.log("\n✓ Super Admin created:", result.admin.email);
  console.log("  Remaining slots:", result.remainingSlots);
  console.log("\n─── MANDATORY 2FA SETUP ───");
  console.log("1. Open Google Authenticator / Authy / 1Password");
  console.log("2. Scan this QR code OR enter the secret manually:\n");
  console.log("   Secret:", result.totpSecret);
  console.log("");
  qrcode.generate(result.otpauthUrl, { small: true });
  console.log("\n3. Login at /admin/login → password → then enter 6-digit code");
  console.log("4. Session auto-expires after 30 minutes of idle.\n");
  console.log("⚠  Save the secret offline. It will not be shown again.\n");
}

async function cmdList() {
  const admins = await listAdminsViaCli();
  console.log(`\nSuper Admins (${admins.length}/${MAX_SUPER_ADMINS}):\n`);
  if (admins.length === 0) {
    console.log("  (none — run: npm run admin:create)\n");
    return;
  }
  for (const a of admins) {
    console.log(`  • ${a.email}`);
    console.log(`    name: ${a.name || "—"} | 2FA: ${a.totpEnabled ? "ON" : "OFF"}`);
    console.log(`    created: ${a.createdAt.toISOString()}\n`);
  }
}

async function cmdDelete(emailArg) {
  const email = emailArg || process.argv[3];
  if (!email) {
    console.error("Usage: npm run admin:delete -- email@domain.com");
    process.exit(1);
  }
  const result = await deleteSuperAdminViaCli(email);
  if (!result.ok) {
    console.error("ERROR:", result.error);
    process.exit(1);
  }
  console.log(`✓ Deleted ${result.deleted}. Remaining: ${result.remaining}/${MAX_SUPER_ADMINS}`);
}

async function cmdForgot(emailArg) {
  const email = emailArg || process.argv[3];
  if (!email) {
    console.error("Usage: npm run admin:forgot -- email@domain.com");
    process.exit(1);
  }
  const result = await requestAdminPasswordReset(email, "cli", { revealCode: true });
  if (!result.ok) {
    console.error("ERROR:", result.error);
    process.exit(1);
  }
  if (!result.emailCode) {
    console.error("\nNo Super Admin exists for:", email);
    console.error("Create one first: npm run admin:create\n");
    process.exit(1);
  }
  console.log("\n✓ Reset issued for", result.email);
  console.log("  SMTP:", result.delivery?.email || "unknown", result.delivery?.emailError || "");
  console.log("\n─── EMAIL RESET CODE (valid 10 min) ───");
  console.log("  ", result.emailCode);
  console.log("\nEnter this code on /admin/login → Forgot password, plus your authenticator code.");
  console.log("If Gmail did not arrive, check Spam / Promotions, or use this terminal code.\n");
}

async function main() {
  const cmd = process.argv[2] || "create";
  try {
    if (cmd === "create") await cmdCreate();
    else if (cmd === "list") await cmdList();
    else if (cmd === "delete") await cmdDelete();
    else if (cmd === "forgot") await cmdForgot();
    else {
      console.log("Commands: create | list | delete | forgot");
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
