import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOMAINS_FILE = path.join(__dirname, "../data/disposable-domains.txt");

let disposableDomains = null;

function loadDisposableDomains() {
  if (disposableDomains) return disposableDomains;

  const set = new Set();

  for (const domain of parseDomainList(process.env.BLOCKED_EMAIL_DOMAINS)) {
    set.add(domain);
  }

  if (fs.existsSync(DOMAINS_FILE)) {
    const content = fs.readFileSync(DOMAINS_FILE, "utf8");
    for (const line of content.split("\n")) {
      const domain = line.trim().toLowerCase();
      if (domain && !domain.startsWith("#")) set.add(domain);
    }
  }

  disposableDomains = set;
  return set;
}

function parseDomainList(raw) {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function extractEmailDomain(email) {
  const normalized = String(email || "").trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 0) return null;
  return normalized.slice(at + 1).trim() || null;
}

export function isDisposableEmail(email) {
  const domain = extractEmailDomain(email);
  if (!domain) return false;
  return loadDisposableDomains().has(domain);
}

export function validateRegistrationEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();

  if (!normalized.includes("@")) {
    return { ok: false, error: "Valid email required" };
  }

  if (isDisposableEmail(normalized)) {
    return {
      ok: false,
      error:
        "Temporary or disposable email addresses are not allowed. Use a permanent email address.",
    };
  }

  return { ok: true, email: normalized };
}
