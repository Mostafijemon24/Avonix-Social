import prisma from "../db.js";

const cache = new Map();

function stripQuotes(value) {
  if (typeof value !== "string") return value;
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/** Prefer process.env (.env / PM2) over DB so VPS secrets always win */
export async function getConfig(key, envFallback = "") {
  if (cache.has(key)) return cache.get(key);

  const envValue = process.env[key];
  if (envValue !== undefined && envValue !== "") {
    const value = stripQuotes(envValue);
    cache.set(key, value);
    return value;
  }

  const row = await prisma.apiConfig.findUnique({ where: { key } });
  const value = stripQuotes(row?.value || envFallback || "");
  cache.set(key, value);
  return value;
}

export async function setConfig(key, value) {
  await prisma.apiConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
  cache.set(key, value);
}

export async function getAllConfig() {
  const rows = await prisma.apiConfig.findMany({ orderBy: { key: "asc" } });
  const result = {};
  for (const row of rows) {
    result[row.key] = maskSecret(row.key, row.value);
  }
  return result;
}

export async function getAllConfigRaw() {
  const rows = await prisma.apiConfig.findMany();
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

function maskSecret(key, value) {
  if (!value) return "";
  const secretKeys = ["SECRET", "KEY", "PASSWORD", "PASS", "TOKEN"];
  if (secretKeys.some((s) => key.includes(s)) && value.length > 8) {
    return value.slice(0, 4) + "••••" + value.slice(-4);
  }
  return value;
}

export function clearConfigCache() {
  cache.clear();
}

/** Apply DB config to process.env — never overwrite existing .env values */
export async function syncConfigToEnv() {
  const raw = await getAllConfigRaw();
  for (const [key, value] of Object.entries(raw)) {
    if (!value) continue;
    if (process.env[key]) continue; // keep .env / PM2 values
    process.env[key] = value;
  }
}
