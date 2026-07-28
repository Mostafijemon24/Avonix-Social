/**
 * Email OTP verification for registration
 */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import prisma from "../db.js";
import { sendRegistrationEmailOtp, sendPasswordResetEmail, normalizePhone } from "./notifyService.js";
import { validatePasswordStrength, PASSWORD_HINT } from "../password.js";
import { signUserSession } from "../middleware/userAuth.js";
import { validateRegistrationEmail } from "../emailPolicy.js";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const TEST_CARD_NUMBERS = new Set([
  "4242424242424242",
  "4000000000000002",
  "4000000000003220",
  "5555555555554444",
  "378282246310005",
]);

function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

export async function startRegistration({
  email,
  phone,
  name,
  company,
  password,
  confirmPassword,
}) {
  const emailCheck = validateRegistrationEmail(email);
  if (!emailCheck.ok) {
    return emailCheck;
  }
  const normalizedEmail = emailCheck.email;
  const normalizedPhone = phone ? normalizePhone(phone) : null;

  if (password !== confirmPassword) {
    return { ok: false, error: "Password and confirmation do not match" };
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return { ok: false, error: `${strength.error}. ${PASSWORD_HINT}` };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { package: true },
  });

  if (user && isFullyVerified(user)) {
    return { ok: false, error: "Account already verified. Sign in with your email and password." };
  }

  if (!user) {
    const freePlan = await prisma.package.findUnique({ where: { slug: "free" } });
    if (!freePlan) throw new Error("Packages not seeded");

    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        phone: normalizedPhone,
        name: name || normalizedEmail.split("@")[0],
        company: company || null,
        passwordHash,
        packageId: freePlan.id,
        remainingCredits: 0,
        source: "signup",
        accountStatus: "pending_verification",
        whatsappNumber: normalizedPhone,
      },
      include: { package: true },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        phone: normalizedPhone ?? user.phone,
        name: name || user.name,
        company: company || user.company,
        whatsappNumber: normalizedPhone ?? user.whatsappNumber,
        passwordHash,
      },
      include: { package: true },
    });
  }

  const emailCode = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.verificationCode.create({
    data: {
      userId: user.id,
      email: normalizedEmail,
      channel: "email",
      code: emailCode,
      purpose: "register",
      expiresAt,
    },
  });

  const delivery = await sendRegistrationEmailOtp(user, { emailCode });

  console.log(`[OTP email→${normalizedEmail}] ${emailCode} (${delivery.email?.status})`);
  console.log("[OTP delivery]", {
    email: delivery.email?.status,
    emailError: delivery.email?.error || null,
  });

  return {
    ok: true,
    userId: user.id,
    email: user.email,
    phone: user.phone,
    next: "verify_codes",
    delivery: {
      email: delivery.email?.status,
      emailError: delivery.email?.error || null,
    },
  };
}

/** Resend email OTP for an incomplete registration */
export async function resendRegistrationOtps(email) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) return { ok: false, error: "User not found" };
  if (isFullyVerified(user)) {
    return { ok: false, error: "Account already verified. Sign in instead." };
  }
  if (user.emailVerified) {
    return { ok: false, error: "Email already verified. Continue to add card." };
  }

  const emailCode = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.verificationCode.create({
    data: {
      userId: user.id,
      email: normalizedEmail,
      channel: "email",
      code: emailCode,
      purpose: "register",
      expiresAt,
    },
  });

  const delivery = await sendRegistrationEmailOtp(user, { emailCode });

  console.log(`[OTP resend email→${normalizedEmail}] ${emailCode} (${delivery.email?.status})`);

  return {
    ok: true,
    email: user.email,
    phone: user.phone,
    next: "verify_codes",
    delivery: {
      email: delivery.email?.status,
      emailError: delivery.email?.error || null,
    },
  };
}

export async function verifyCodes({ email, emailCode }) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) return { ok: false, error: "User not found" };

  const now = new Date();
  const emailRow = await prisma.verificationCode.findFirst({
    where: {
      userId: user.id,
      channel: "email",
      purpose: "register",
      usedAt: null,
      expiresAt: { gt: now },
      code: String(emailCode || "").trim(),
    },
    orderBy: { createdAt: "desc" },
  });

  if (!emailRow) return { ok: false, error: "Invalid or expired email code" };

  await prisma.$transaction([
    prisma.verificationCode.update({ where: { id: emailRow.id }, data: { usedAt: now } }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        accountStatus: "pending_card",
      },
    }),
  ]);

  return {
    ok: true,
    emailVerified: true,
    next: "add_card",
    message: "Email verified. Add a valid card to activate Free Trial.",
  };
}

/**
 * Store card on file (demo accepts mock card; production uses Stripe SetupIntent)
 */
export async function attachCard({ email, cardNumber, expMonth, expYear, cvc, brand }) {
  const user = await prisma.user.findUnique({
    where: { email: (email || "").trim().toLowerCase() },
    include: { package: true },
  });
  if (!user) return { ok: false, error: "User not found" };
  if (!user.emailVerified) {
    return { ok: false, error: "Verify your email before adding a card" };
  }

  const digits = String(cardNumber || "").replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) {
    return { ok: false, error: "Invalid card number" };
  }
  if (!expMonth || !expYear || !cvc || String(cvc).length < 3) {
    return { ok: false, error: "Invalid card expiry or CVC" };
  }

  if (!luhnCheck(digits)) {
    return { ok: false, error: "Card number failed validation" };
  }
  if (IS_PRODUCTION && TEST_CARD_NUMBERS.has(digits)) {
    return { ok: false, error: "Test cards are not accepted. Use a real payment card." };
  }

  const freePlan = await prisma.package.findUnique({ where: { slug: "free" } });
  const last4 = digits.slice(-4);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      cardOnFile: true,
      cardLast4: last4,
      cardBrand: brand || detectBrand(digits),
      stripePaymentMethodId: IS_PRODUCTION ? null : `pm_dev_${last4}_${Date.now()}`,
      accountStatus: "trial",
      remainingCredits: freePlan?.monthlyCredits ?? 10,
      packageId: freePlan?.id || user.packageId,
    },
    include: { package: true },
  });

  await prisma.subscription.create({
    data: {
      userId: updated.id,
      packageId: updated.packageId,
      status: "active",
      gateway: "card_on_file",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return {
    ok: true,
    cardLast4: last4,
    cardBrand: updated.cardBrand,
    accountStatus: "trial",
    credits: updated.remainingCredits,
    message: "Card saved. Free Trial activated.",
  };
}

function detectBrand(digits) {
  if (digits.startsWith("4")) return "visa";
  if (/^5[1-5]/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  return "card";
}

function luhnCheck(num) {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function isFullyVerified(user) {
  return !!(user.emailVerified && user.cardOnFile);
}

export function verificationNextStep(user) {
  if (!user.emailVerified) return "verify_codes";
  if (!user.cardOnFile) return "add_card";
  return "dashboard";
}

export async function getAuthStatus(email) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    return { ok: false, error: "Email required" };
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    return { ok: false, error: "No account found. Register first." };
  }

  return {
    ok: true,
    email: user.email,
    phone: user.phone,
    emailVerified: !!user.emailVerified,
    cardOnFile: !!user.cardOnFile,
    fullyVerified: isFullyVerified(user),
    next: verificationNextStep(user),
  };
}

export async function loginVerifiedUser(email, password) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    return { ok: false, status: 400, error: "Valid email required" };
  }
  if (!password) {
    return { ok: false, status: 400, error: "Password is required" };
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    await bcrypt.compare(
      password,
      "$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.G2oQ.5Y5Y5Y5Y5u"
    );
    return {
      ok: false,
      status: 401,
      error: "Invalid email or password.",
    };
  }

  if (!user.passwordHash) {
    return {
      ok: false,
      status: 403,
      error:
        "This account has no password set. Register again with a strong password, or contact support.",
    };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return { ok: false, status: 401, error: "Invalid email or password." };
  }

  if (!isFullyVerified(user)) {
    return {
      ok: false,
      status: 403,
      error: "Account verification incomplete. Finish email and card verification.",
      email: user.email,
      emailVerified: !!user.emailVerified,
      cardOnFile: !!user.cardOnFile,
      next: verificationNextStep(user),
    };
  }

  const sessionToken = signUserSession({ id: user.id, email: user.email });

  return { ok: true, email: user.email, sessionToken };
}

/**
 * Request password reset — always returns ok (no email enumeration).
 * Sends 6-digit code to email when account exists.
 */
export async function requestPasswordReset(email) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    return { ok: false, error: "Valid email required" };
  }

  const generic = {
    ok: true,
    email: normalizedEmail,
    next: "reset_password",
    message: "If an account exists for this email, a reset code was sent. Check inbox and spam.",
  };

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    console.log(`[password-reset] no account for ${normalizedEmail}`);
    return generic;
  }

  const emailCode = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.verificationCode.create({
    data: {
      userId: user.id,
      email: normalizedEmail,
      channel: "email",
      code: emailCode,
      purpose: "password_reset",
      expiresAt,
    },
  });

  const delivery = await sendPasswordResetEmail(user, { emailCode });
  console.log(
    `[OTP password-reset→${normalizedEmail}] ${emailCode} (${delivery.email?.status})`
  );

  return {
    ...generic,
    delivery: {
      email: delivery.email?.status,
      emailError: delivery.email?.error || null,
    },
  };
}

/** Resend password-reset OTP */
export async function resendPasswordResetOtp(email) {
  return requestPasswordReset(email);
}

/**
 * Verify reset code + set new strong password
 */
export async function resetPasswordWithCode({
  email,
  code,
  password,
  confirmPassword,
}) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    return { ok: false, error: "Valid email required" };
  }

  if (password !== confirmPassword) {
    return { ok: false, error: "Password and confirmation do not match" };
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return { ok: false, error: `${strength.error}. ${PASSWORD_HINT}` };
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    return { ok: false, error: "Invalid or expired reset code" };
  }

  const now = new Date();
  const row = await prisma.verificationCode.findFirst({
    where: {
      userId: user.id,
      channel: "email",
      purpose: "password_reset",
      usedAt: null,
      expiresAt: { gt: now },
      code: String(code || "").trim(),
    },
    orderBy: { createdAt: "desc" },
  });

  if (!row) {
    return { ok: false, error: "Invalid or expired reset code" };
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction([
    prisma.verificationCode.update({ where: { id: row.id }, data: { usedAt: now } }),
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    }),
  ]);

  // Invalidate any other unused reset codes for this user
  await prisma.verificationCode.updateMany({
    where: {
      userId: user.id,
      purpose: "password_reset",
      usedAt: null,
    },
    data: { usedAt: now },
  });

  console.log(`[password-reset] password updated for ${normalizedEmail}`);

  return {
    ok: true,
    email: user.email,
    next: "signin",
    message: "Password updated. Sign in with your new password.",
  };
}
