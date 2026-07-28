/**
 * Wallet top-up, auto-debit on usage, freeze when empty
 */
import prisma from "../db.js";
import { notifyFrozen, notifyLowBalance } from "./notifyService.js";
import {
  allowDemoTopUp,
  canUseWalletBalance,
  isGatewayConfigured,
  isPaidPlanSlug,
} from "../walletPolicy.js";

const LOW_BALANCE_USD = 2;

export async function getWallet(email) {
  const user = await prisma.user.findUnique({
    where: { email: (email || "").trim().toLowerCase() },
  });
  if (!user) return null;

  const txns = await prisma.walletTransaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return {
    email: user.email,
    walletBalanceUsd: user.walletBalanceUsd,
    accountStatus: user.accountStatus,
    cardOnFile: user.cardOnFile,
    cardLast4: user.cardLast4,
    cardBrand: user.cardBrand,
    transactions: txns,
  };
}

/**
 * Top-up wallet — paid plans only; requires configured payment gateway (no silent demo credit).
 */
export async function topUpWallet({ email, amountUsd, gateway = "stripe" }) {
  const amount = Number(amountUsd);
  if (!amount || amount < 1) {
    return { ok: false, error: "Minimum top-up is $1.00" };
  }
  if (amount > 10000) {
    return { ok: false, error: "Maximum top-up is $10,000" };
  }

  const user = await prisma.user.findUnique({
    where: { email: (email || "").trim().toLowerCase() },
    include: { package: true },
  });
  if (!user) return { ok: false, error: "User not found" };
  if (!user.emailVerified) {
    return { ok: false, error: "Verify email before topping up" };
  }

  const planSlug = user.package?.slug || "free";
  if (!isPaidPlanSlug(planSlug)) {
    return {
      ok: false,
      status: 403,
      error:
        "Wallet top-up is for Pro and Agency plans only. Upgrade under Plan & Price — Free Trial uses included credits.",
    };
  }

  if (!allowDemoTopUp()) {
    if (!isGatewayConfigured(gateway)) {
      return {
        ok: false,
        status: 503,
        error: `${gateway === "paypal" ? "PayPal" : "Stripe"} is not configured on the server yet. Contact support or upgrade your plan for monthly credits.`,
      };
    }
    return {
      ok: false,
      status: 501,
      error:
        "Online wallet top-up is not enabled yet. Use your plan’s monthly credits or contact support to enable payments.",
    };
  }

  if (!user.cardOnFile && gateway === "stripe") {
    return { ok: false, error: "Add a valid card on file before Stripe top-up" };
  }

  const newBalance = Math.round((user.walletBalanceUsd + amount) * 100) / 100;

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        walletBalanceUsd: newBalance,
        accountStatus:
          user.accountStatus === "frozen" ? "active" : user.accountStatus,
      },
    }),
    prisma.walletTransaction.create({
      data: {
        userId: user.id,
        type: "topup",
        amountUsd: amount,
        balanceAfter: newBalance,
        gateway,
        status: "completed",
        metadata: JSON.stringify({ demo: true, devOnly: true }),
      },
    }),
  ]);

  if (user.accountStatus === "frozen") {
    await prisma.subscription.updateMany({
      where: { userId: user.id, status: "frozen" },
      data: { status: "active", frozenAt: null, freezeReason: null },
    });
  }

  return {
    ok: true,
    walletBalanceUsd: newBalance,
    amountUsd: amount,
    message: `Topped up $${amount.toFixed(2)} (dev demo). New balance: $${newBalance.toFixed(2)}`,
  };
}

/**
 * Debit wallet for API usage cost (USD). Freeze if cannot cover.
 */
export async function debitWalletForUsage(userId, amountUsd, meta = {}) {
  if (!amountUsd || amountUsd <= 0) {
    return { ok: true, skipped: true };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { package: true },
  });
  if (!user) return { ok: false, error: "User not found" };
  if (user.unlimitedCredits) {
    return { ok: true, skipped: true, unlimited: true };
  }
  if (!canUseWalletBalance(user)) {
    return {
      ok: false,
      error: "Wallet spending requires a Pro or Agency plan.",
      walletSkipped: true,
    };
  }

  const cost = Math.round(amountUsd * 1e6) / 1e6;

  if (user.walletBalanceUsd < cost && user.remainingCredits <= 0) {
    await freezeAccount(userId, "Insufficient wallet balance and credits");
    return { ok: false, frozen: true, error: "Account frozen — wallet empty" };
  }

  // Prefer wallet USD for actual API cost; credits tracked separately
  if (user.walletBalanceUsd >= cost) {
    const newBalance = Math.round((user.walletBalanceUsd - cost) * 1e6) / 1e6;
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { walletBalanceUsd: newBalance },
      }),
      prisma.walletTransaction.create({
        data: {
          userId,
          type: "debit_usage",
          amountUsd: -cost,
          balanceAfter: newBalance,
          status: "completed",
          metadata: JSON.stringify(meta),
        },
      }),
    ]);

    if (newBalance < LOW_BALANCE_USD && newBalance > 0) {
      await notifyLowBalance(userId, newBalance);
    }
    if (newBalance <= 0 && user.remainingCredits <= 0) {
      await freezeAccount(userId, "Wallet balance depleted");
    }

    return { ok: true, walletBalanceUsd: newBalance, debited: cost };
  }

  // Wallet insufficient but credits remain — warn, don't freeze yet
  if (user.walletBalanceUsd < LOW_BALANCE_USD) {
    await notifyLowBalance(userId, user.walletBalanceUsd);
  }

  return {
    ok: true,
    walletSkipped: true,
    walletBalanceUsd: user.walletBalanceUsd,
    message: "Using plan credits; wallet balance low — top up recommended",
  };
}

export async function freezeAccount(userId, reason) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.accountStatus === "frozen") return;

  await prisma.user.update({
    where: { id: userId },
    data: { accountStatus: "frozen" },
  });
  await prisma.subscription.updateMany({
    where: { userId, status: "active" },
    data: {
      status: "frozen",
      frozenAt: new Date(),
      freezeReason: reason,
    },
  });
  await prisma.walletTransaction.create({
    data: {
      userId,
      type: "freeze",
      amountUsd: 0,
      balanceAfter: user.walletBalanceUsd,
      status: "completed",
      metadata: JSON.stringify({ reason }),
    },
  });
  await notifyFrozen(userId, reason);
}

export async function assertNotFrozen(email) {
  const user = await prisma.user.findUnique({
    where: { email: (email || "").trim().toLowerCase() },
    include: { package: true },
  });
  if (!user) return { ok: false, error: "User not found" };
  if (user.accountStatus === "frozen") {
    return {
      ok: false,
      frozen: true,
      error: "Subscription frozen. Top up your wallet to continue.",
      walletBalanceUsd: user.walletBalanceUsd,
    };
  }
  if (user.accountStatus === "pending_verification" || user.accountStatus === "pending_card") {
    return {
      ok: false,
      error: "Complete email and card verification before using the dashboard.",
      accountStatus: user.accountStatus,
    };
  }
  return { ok: true, user };
}
