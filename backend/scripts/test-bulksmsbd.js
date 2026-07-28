#!/usr/bin/env node
/**
 * Test BulkSMSBD before going live.
 * Usage (on VPS):
 *   cd backend && node scripts/test-bulksmsbd.js 8801611545742
 *
 * Requires backend/.env with BULKSMSBD_API_KEY + BULKSMSBD_SENDER_ID
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env"), override: true });

const to = process.argv[2]?.replace(/\D/g, "") || "";
const apiKey = process.env.BULKSMSBD_API_KEY || "";
const senderid = (process.env.BULKSMSBD_SENDER_ID || "").trim();
const brand = process.env.BULKSMSBD_OTP_BRAND || "Avonix Social";
const testCode = String(Math.floor(100000 + Math.random() * 900000));
const message = `Your ${brand} OTP is ${testCode}`;

if (!to || to.length < 11) {
  console.error("Usage: node scripts/test-bulksmsbd.js 8801611545742");
  process.exit(1);
}
if (!apiKey) {
  console.error("Missing BULKSMSBD_API_KEY in backend/.env");
  process.exit(1);
}
if (!senderid) {
  console.error(
    "Missing BULKSMSBD_SENDER_ID — register Approved Sender ID at bulksmsbd.net (Sender ID Management)."
  );
  process.exit(1);
}
if (apiKey === senderid) {
  console.error("BULKSMSBD_SENDER_ID must NOT be the API key.");
  process.exit(1);
}

const form = new URLSearchParams({
  api_key: apiKey,
  type: "text",
  number: to,
  senderid,
  message,
});

console.log("Sending test OTP to", to);
console.log("Message:", message);
console.log("Sender ID:", senderid);

const res = await fetch("https://bulksmsbd.net/api/smsapi", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: form.toString(),
});
const text = await res.text();
console.log("HTTP", res.status);
console.log("Response:", text);

let json;
try {
  json = JSON.parse(text);
} catch {
  process.exit(res.ok ? 0 : 1);
}

if (Number(json.response_code) === 202) {
  console.log("\n✓ BulkSMSBD accepted (202). Check phone in 1–2 min.");
  console.log("Test code (for manual check only):", testCode);
  process.exit(0);
}

console.error("\n✗ Failed. Common codes:");
console.error("  1002 = Sender ID wrong/disabled");
console.error("  1007 = Balance insufficient");
console.error("  1032 = VPS IP not whitelisted — add server IP in BulkSMSBD dashboard");
process.exit(1);
