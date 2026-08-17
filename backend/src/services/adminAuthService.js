import bcrypt from "bcryptjs";
import crypto from "crypto";
import { generateSecret, generateURI, verifySync } from "otplib";
import prisma from "../db.js";
import {
  signAdminToken,
  signPreAuthToken,
  verifyPreAuthToken,
} from "../middleware/adminAuth.js";
import { validatePasswordStrength, PASSWORD_HINT } from "../password.js";
import { sendAdminPasswordResetEmail } from "./notifyService.js";

export { validatePasswordStrength };

/** Hard limit — cannot create more than 2 super admins */
export const MAX_SUPER_ADMINS = 2;

const ISSUER = "Avonix Social Admin";

const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const resetRequestAttempts = new Map();
const MAX_RESET_REQUESTS = 5;
const RESET_WINDOW_MS = 15 * 60 * 1000;

function attemptKey(email, ip) {
  return `${(email || "").toLowerCase()}|${ip || "unknown"}`;
}

function checkRateLimit(email, ip) {
  const key = attemptKey(email, ip);
  const entry = loginAttempts.get(key);
  if (!entry) return { ok: true };

  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60000);
    return { ok: false, error: `Too many failed attempts. Try again in ${mins} minute(s).` };
  }
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    loginAttempts.delete(key);
  }
  return { ok: true };
}

function recordFailedLogin(email, ip) {
  const key = attemptKey(email, ip);
  const entry = loginAttempts.get(key) || { count: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginAttempts.set(key, entry);
}

function clearLoginAttempts(email, ip) {
  loginAttempts.delete(attemptKey(email, ip));
}

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

function checkResetRequestLimit(email, ip) {
  const key = attemptKey(email, ip);
  const entry = resetRequestAttempts.get(key);
  if (!entry) return { ok: true };
  if (Date.now() - entry.firstAt > RESET_WINDOW_MS) {
    resetRequestAttempts.delete(key);
    return { ok: true };
  }
  if (entry.count >= MAX_RESET_REQUESTS) {
    return { ok: false, error: "Too many reset requests. Try again in 15 minutes." };
  }
  return { ok: true };
}

function recordResetRequest(email, ip) {
  const key = attemptKey(email, ip);
  const entry = resetRequestAttempts.get(key);
  if (!entry || Date.now() - entry.firstAt > RESET_WINDOW_MS) {
    resetRequestAttempts.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count += 1;
}

function verifyTotp(secret, token) {
  try {
    const result = verifySync({ secret, token: String(token || "").replace(/\s/g, "") });
    return result?.valid === true;
  } catch {
    return false;
  }
}

export async function getAdminCount() {
  return prisma.admin.count({ where: { role: "super_admin" } });
}

export async function canCreateAdmin() {
  const count = await getAdminCount();
  return {
    ok: count < MAX_SUPER_ADMINS,
    count,
    remaining: Math.max(0, MAX_SUPER_ADMINS - count),
  };
}

/**
 * Create Super Admin — CLI / VPS terminal ONLY.
 * Never expose via HTTP.
 */
export async function createSuperAdminViaCli({ email, password, name }) {
  const slot = await canCreateAdmin();
  if (!slot.ok) {
    return {
      ok: false,
      error: `Maximum ${MAX_SUPER_ADMINS} Super Admins allowed. Currently: ${slot.count}.`,
    };
  }

  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    return { ok: false, error: "Valid email required" };
  }

  const strength = validatePasswordStrength(password);
  if (!strength.ok) return strength;

  const existing = await prisma.admin.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    return { ok: false, error: "Admin with this email already exists" };
  }

  const totpSecret = generateSecret();
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.admin.create({
    data: {
      email: normalizedEmail,
      name: name || "Super Admin",
      passwordHash,
      role: "super_admin",
      totpSecret,
      totpEnabled: true,
    },
  });

  const otpauthUrl = generateURI({
    issuer: ISSUER,
    label: normalizedEmail,
    secret: totpSecret,
  });

  return {
    ok: true,
    admin: { id: admin.id, email: admin.email, name: admin.name },
    totpSecret,
    otpauthUrl,
    remainingSlots: MAX_SUPER_ADMINS - (slot.count + 1),
  };
}

/** Step 1: email + password → pre-auth token (2FA still required) */
export async function adminLoginStep1(email, password, ip = "unknown") {
  const rate = checkRateLimit(email, ip);
  if (!rate.ok) return rate;

  const admin = await prisma.admin.findUnique({
    where: { email: (email || "").trim().toLowerCase() },
  });

  if (!admin) {
    await bcrypt.compare(
      password || "",
      "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G2oQ.YzqKxqKxq"
    );
    recordFailedLogin(email, ip);
    return { ok: false, error: "Invalid credentials" };
  }

  const valid = await bcrypt.compare(password || "", admin.passwordHash);
  if (!valid) {
    recordFailedLogin(email, ip);
    return { ok: false, error: "Invalid credentials" };
  }

  if (!admin.totpEnabled || !admin.totpSecret) {
    recordFailedLogin(email, ip);
    return {
      ok: false,
      error: "2FA is not configured for this account. Recreate admin via VPS CLI.",
    };
  }

  const preAuthToken = signPreAuthToken(admin);
  return {
    ok: true,
    requires2fa: true,
    preAuthToken,
    email: admin.email,
  };
}

/** Step 2: pre-auth token + TOTP code → full session (30 min idle JWT) */
export async function adminLoginStep2(preAuthToken, totpCode, ip = "unknown") {
  const payload = verifyPreAuthToken(preAuthToken);
  if (!payload || payload.type !== "pre_2fa") {
    return { ok: false, error: "2FA session expired. Sign in again." };
  }

  const rate = checkRateLimit(payload.email, ip);
  if (!rate.ok) return rate;

  const admin = await prisma.admin.findUnique({ where: { id: payload.id } });
  if (!admin || !admin.totpSecret) {
    return { ok: false, error: "Invalid 2FA session" };
  }

  if (!verifyTotp(admin.totpSecret, totpCode)) {
    recordFailedLogin(payload.email, ip);
    return { ok: false, error: "Invalid authenticator code" };
  }

  clearLoginAttempts(payload.email, ip);
  const token = signAdminToken(admin);
  return {
    ok: true,
    token,
    expiresInSeconds: 30 * 60,
    idleTimeoutSeconds: 30 * 60,
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
  };
}

const ADMIN_RESET_GENERIC = {
  ok: true,
  next: "reset_password",
  message:
    "If that Super Admin email exists, a reset code was sent. Check inbox and spam. You will also need your authenticator code.",
};

/**
 * Super Admin forgot password — email OTP. Always generic (no enumeration).
 * Completing the reset still requires authenticator TOTP.
 */
export async function requestAdminPasswordReset(email, ip = "unknown", options = {}) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    return { ok: false, error: "Valid email required" };
  }

  const rate = checkResetRequestLimit(normalizedEmail, ip);
  if (!rate.ok) return rate;
  recordResetRequest(normalizedEmail, ip);

  const admin = await prisma.admin.findUnique({ where: { email: normalizedEmail } });
  if (!admin) {
    await bcrypt.compare(
      "timing",
      "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G2oQ.YzqKxqKxq"
    );
    return { ...ADMIN_RESET_GENERIC, email: normalizedEmail };
  }

  const emailCode = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.verificationCode.create({
    data: {
      email: normalizedEmail,
      channel: "email",
      code: emailCode,
      purpose: "admin_password_reset",
      expiresAt,
    },
  });

  const delivery = await sendAdminPasswordResetEmail(admin, { emailCode });
  console.log(
    `[OTP admin-password-reset→${normalizedEmail}] ${emailCode} (${delivery.email?.status})`
  );

  return {
    ...ADMIN_RESET_GENERIC,
    email: normalizedEmail,
    delivery: {
      email: delivery.email?.status,
      emailError: delivery.email?.error || null,
    },
    ...(options.revealCode ? { emailCode, smtpFrom: delivery.email?.from || null } : {}),
  };
}

export async function resendAdminPasswordReset(email, ip = "unknown", options = {}) {
  return requestAdminPasswordReset(email, ip, options);
}

/**
 * Email reset code + authenticator TOTP + new strong password.
 */
export async function resetAdminPasswordWithCode(
  { email, code, totpCode, password, confirmPassword },
  ip = "unknown"
) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    return { ok: false, error: "Valid email required" };
  }

  const rate = checkRateLimit(normalizedEmail, ip);
  if (!rate.ok) return rate;

  if (password !== confirmPassword) {
    return { ok: false, error: "Password and confirmation do not match" };
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return { ok: false, error: `${strength.error}. ${PASSWORD_HINT}` };
  }

  const admin = await prisma.admin.findUnique({ where: { email: normalizedEmail } });
  if (!admin) {
    recordFailedLogin(normalizedEmail, ip);
    return { ok: false, error: "Invalid reset code or authenticator code" };
  }

  const now = new Date();
  const row = await prisma.verificationCode.findFirst({
    where: {
      email: normalizedEmail,
      channel: "email",
      purpose: "admin_password_reset",
      usedAt: null,
      expiresAt: { gt: now },
      code: String(code || "").trim(),
    },
    orderBy: { createdAt: "desc" },
  });

  if (!row) {
    recordFailedLogin(normalizedEmail, ip);
    return { ok: false, error: "Invalid or expired reset code" };
  }

  if (!admin.totpEnabled || !admin.totpSecret) {
    recordFailedLogin(normalizedEmail, ip);
    return {
      ok: false,
      error: "2FA is not configured. Recreate this admin via VPS CLI.",
    };
  }

  if (!verifyTotp(admin.totpSecret, totpCode)) {
    recordFailedLogin(normalizedEmail, ip);
    return { ok: false, error: "Invalid authenticator code" };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.verificationCode.update({ where: { id: row.id }, data: { usedAt: now } }),
    prisma.admin.update({ where: { id: admin.id }, data: { passwordHash } }),
  ]);

  await prisma.verificationCode.updateMany({
    where: {
      email: normalizedEmail,
      purpose: "admin_password_reset",
      usedAt: null,
    },
    data: { usedAt: now },
  });

  clearLoginAttempts(normalizedEmail, ip);
  console.log(`[admin-password-reset] password updated for ${normalizedEmail}`);

  return {
    ok: true,
    email: admin.email,
    next: "signin",
    message: "Password updated. Sign in with your new password and authenticator code.",
  };
}

export async function changeAdminPassword(adminId, currentPassword, newPassword, totpCode) {
  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) return strength;

  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin) return { ok: false, error: "Admin not found" };

  const valid = await bcrypt.compare(currentPassword || "", admin.passwordHash);
  if (!valid) return { ok: false, error: "Current password is incorrect" };

  if (!verifyTotp(admin.totpSecret, totpCode)) {
    return { ok: false, error: "Invalid authenticator code" };
  }

  if (currentPassword === newPassword) {
    return { ok: false, error: "New password must be different from current password" };
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.admin.update({ where: { id: adminId }, data: { passwordHash } });
  return { ok: true, message: "Password updated. Sign in again with the new password." };
}

/** Email change disabled on web for security — use CLI only if needed */
export async function changeAdminEmail() {
  return {
    ok: false,
    error: "Email cannot be changed via web. Use VPS terminal CLI to manage admins.",
  };
}

export async function getAdminProfile(adminId) {
  return prisma.admin.findUnique({
    where: { id: adminId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      totpEnabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export function generateSecurePassword(length = 20) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

/** Delete admin — CLI only */
export async function deleteSuperAdminViaCli(email) {
  const normalized = (email || "").trim().toLowerCase();
  const admin = await prisma.admin.findUnique({ where: { email: normalized } });
  if (!admin) return { ok: false, error: "Admin not found" };

  await prisma.admin.delete({ where: { id: admin.id } });
  const remaining = await getAdminCount();
  return { ok: true, deleted: normalized, remaining };
}

export async function listAdminsViaCli() {
  return prisma.admin.findMany({
    where: { role: "super_admin" },
    select: { id: true, email: true, name: true, totpEnabled: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}
