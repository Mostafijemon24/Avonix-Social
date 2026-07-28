import jwt from "jsonwebtoken";

const SESSION_DAYS = 7;

function getUserJwtSecret() {
  const secret =
    process.env.USER_JWT_SECRET ||
    process.env.ADMIN_JWT_SECRET ||
    process.env.CONNECTIONS_STATE_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[security] USER_JWT_SECRET missing — using fallback. Set USER_JWT_SECRET (32+ chars) in backend/.env"
      );
    }
    return "avonix-user-dev-only-insecure-secret-change-me!";
  }
  return secret;
}

export function signUserSession({ id, email }) {
  return jwt.sign(
    {
      id,
      email,
      type: "user_session",
    },
    getUserJwtSecret(),
    { expiresIn: `${SESSION_DAYS}d` }
  );
}

export function verifyUserSession(token) {
  try {
    const payload = jwt.verify(
      String(token || "").replace(/^Bearer\s+/i, ""),
      getUserJwtSecret()
    );
    if (payload.type !== "user_session" || !payload.email) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Require Authorization: Bearer <user session JWT> */
export function requireUserSession(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "Sign in required. Please log in with email and password." });
  }
  const payload = verifyUserSession(header);
  if (!payload) {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
  req.userSession = payload;
  next();
}

/**
 * Optional: if Authorization present, must match email in params/body/query.
 * Used to tighten email-based routes without breaking OTP registration steps.
 */
export function assertSessionMatchesEmail(req, email) {
  const header = req.headers.authorization;
  if (!header) return { ok: false, status: 401, error: "Sign in required" };
  const payload = verifyUserSession(header);
  if (!payload) return { ok: false, status: 401, error: "Session expired. Please sign in again." };
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (payload.email !== normalized) {
    return { ok: false, status: 403, error: "Session does not match this account" };
  }
  return { ok: true, payload };
}
