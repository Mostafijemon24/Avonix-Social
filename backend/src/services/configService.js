import prisma from "../db.js";

const cache = new Map();

export async function getConfig(key, envFallback = "") {
  if (cache.has(key)) return cache.get(key);

  const row = await prisma.apiConfig.findUnique({ where: { key } });
  const value = row?.value || process.env[key] || envFallback;
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
  const secretKeys = ["SECRET", "KEY", "PASSWORD"];
  if (secretKeys.some((s) => key.includes(s)) && value.length > 8) {
    return value.slice(0, 4) + "••••" + value.slice(-4);
  }
  return value;
}

export function clearConfigCache() {
  cache.clear();
}

/** Apply DB config to process.env for runtime use */
export async function syncConfigToEnv() {
  const raw = await getAllConfigRaw();
  for (const [key, value] of Object.entries(raw)) {
    if (value) process.env[key] = value;
  }
}
