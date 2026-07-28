/**
 * Shared password strength rules for users & admins
 */
export function validatePasswordStrength(password) {
  if (!password || password.length < 12) {
    return { ok: false, error: "Password must be at least 12 characters" };
  }
  if (!/[A-Z]/.test(password)) {
    return { ok: false, error: "Password must include an uppercase letter" };
  }
  if (!/[a-z]/.test(password)) {
    return { ok: false, error: "Password must include a lowercase letter" };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, error: "Password must include a number" };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, error: "Password must include a special character (!@#$%...)" };
  }
  return { ok: true };
}

export const PASSWORD_HINT =
  "Min 12 chars, with uppercase, lowercase, number, and special character.";
