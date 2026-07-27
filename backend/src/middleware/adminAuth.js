import jwt from "jsonwebtoken";

const IDLE_SECONDS = 30 * 60; // 30 minutes

function getJwtSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ADMIN_JWT_SECRET must be set (min 32 chars) in production");
    }
    console.warn(
      "[security] ADMIN_JWT_SECRET missing or weak — set a 32+ char secret in backend/.env"
    );
    return "avonix-dev-only-insecure-secret-change-me!!";
  }
  return secret;
}

/** Full session after 2FA — expires in 30 minutes (matches idle policy) */
export function signAdminToken(admin) {
  return jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      type: "session",
      iat: Math.floor(Date.now() / 1000),
    },
    getJwtSecret(),
    { expiresIn: IDLE_SECONDS }
  );
}

/** Short-lived token after password — must complete 2FA within 5 minutes */
export function signPreAuthToken(admin) {
  return jwt.sign(
    {
      id: admin.id,
      email: admin.email,
      role: admin.role,
      type: "pre_2fa",
    },
    getJwtSecret(),
    { expiresIn: "5m" }
  );
}

export function verifyPreAuthToken(token) {
  try {
    return jwt.verify(token.replace(/^Bearer\s+/i, ""), getJwtSecret());
  } catch {
    return null;
  }
}

export function verifyAdminToken(token) {
  try {
    const payload = jwt.verify(token.replace(/^Bearer\s+/i, ""), getJwtSecret());
    if (payload.type !== "session") return null;
    return payload;
  } catch {
    return null;
  }
}

export function requireSuperAdmin(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "Admin authentication required" });
  }

  const payload = verifyAdminToken(header);
  if (!payload || payload.role !== "super_admin") {
    return res.status(403).json({ error: "Super Admin access required" });
  }

  req.admin = payload;
  next();
}

export const ADMIN_IDLE_SECONDS = IDLE_SECONDS;
