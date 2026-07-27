/**
 * Email + SMS OTP verification for registration / security
 */
import crypto from "crypto";
import prisma from "../db.js";
import { notifyUser } from "./notifyService.js";

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

export async function startRegistration({ email, phone, name, company }) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const normalizedPhone = (phone || "").replace(/\s+/g, "");

  if (!normalizedEmail.includes("@")) {
    return { ok: false, error: "Valid email required" };
  }
  if (!normalizedPhone || normalizedPhone.length < 8) {
    return { ok: false, error: "Valid phone number required" };
  }

  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { package: true },
  });

  if (user && isFullyVerified(user)) {
    return { ok: false, error: "Account already verified. Sign in to access the dashboard." };
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
        packageId: freePlan.id,
        remainingCredits: 0, // no credits until verified + card
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
        phone: normalizedPhone,
        name: name || user.name,
        company: company || user.company,
        whatsappNumber: normalizedPhone,
      },
      include: { package: true },
    });
  }

  const emailCode = generateOtp();
  const phoneCode = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.verificationCode.createMany({
    data: [
      {
        userId: user.id,
        email: normalizedEmail,
        channel: "email",
        code: emailCode,
        purpose: "register",
        expiresAt,
      },
      {
        userId: user.id,
        phone: normalizedPhone,
        channel: "sms",
        code: phoneCode,
        purpose: "register",
        expiresAt,
      },
    ],
  });

  // Dispatch OTPs (demo logs codes when providers unset)
  await notifyUser(user.id, {
    type: "verify",
    title: "Your Avonix Social email verification code",
    body: `Your email verification code is: ${emailCode}. Valid for 10 minutes.`,
  });
  if (!IS_PRODUCTION) {
    console.log(`[OTP email→${normalizedEmail}] ${emailCode}`);
    console.log(`[OTP sms→${normalizedPhone}] ${phoneCode}`);
  }

  return {
    ok: true,
    userId: user.id,
    email: user.email,
    phone: user.phone,
    next: "verify_codes",
  };
}

export async function verifyCodes({ email, emailCode, phoneCode }) {
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
  const phoneRow = await prisma.verificationCode.findFirst({
    where: {
      userId: user.id,
      channel: "sms",
      purpose: "register",
      usedAt: null,
      expiresAt: { gt: now },
      code: String(phoneCode || "").trim(),
    },
    orderBy: { createdAt: "desc" },
  });

  if (!emailRow) return { ok: false, error: "Invalid or expired email code" };
  if (!phoneRow) return { ok: false, error: "Invalid or expired phone code" };

  await prisma.$transaction([
    prisma.verificationCode.update({ where: { id: emailRow.id }, data: { usedAt: now } }),
    prisma.verificationCode.update({ where: { id: phoneRow.id }, data: { usedAt: now } }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        phoneVerified: true,
        accountStatus: "pending_card",
      },
    }),
  ]);

  return {
    ok: true,
    emailVerified: true,
    phoneVerified: true,
    next: "add_card",
    message: "Email and phone verified. Add a valid card to activate Free Trial.",
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
  if (!user.emailVerified || !user.phoneVerified) {
    return { ok: false, error: "Verify email and phone before adding a card" };
  }

  const digits = String(cardNumber || "").replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) {
    return { ok: false, error: "Invalid card number" };
  }
  if (!expMonth || !expYear || !cvc || String(cvc).length < 3) {
    return { ok: false, error: "Invalid card expiry or CVC" };
  }

  // Luhn check (basic validity)
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

  // Create trial subscription
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
  return !!(user.emailVerified && user.phoneVerified && user.cardOnFile);
}

export function verificationNextStep(user) {
  if (!user.emailVerified || !user.phoneVerified) return "verify_codes";
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
    phoneVerified: !!user.phoneVerified,
    cardOnFile: !!user.cardOnFile,
    fullyVerified: isFullyVerified(user),
    next: verificationNextStep(user),
  };
}

export async function loginVerifiedUser(email) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!normalizedEmail.includes("@")) {
    return { ok: false, status: 400, error: "Valid email required" };
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    return {
      ok: false,
      status: 404,
      error: "No account found. Complete registration first.",
    };
  }

  if (!isFullyVerified(user)) {
    return {
      ok: false,
      status: 403,
      error: "Account verification incomplete. Finish email, phone, and card verification.",
      email: user.email,
      emailVerified: !!user.emailVerified,
      phoneVerified: !!user.phoneVerified,
      cardOnFile: !!user.cardOnFile,
      next: verificationNextStep(user),
    };
  }

  return { ok: true, email: user.email };
}
