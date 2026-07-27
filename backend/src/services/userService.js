import prisma from "../db.js";
import { usdCostToCredits, getFixedCost } from "../credits.js";
import { recordPayment } from "./adminService.js";
import { callOpenRouter, extractUsage } from "../openrouter.js";
import { ACTION_MODELS } from "../credits.js";
import { getModelPricing } from "../modelPrices.js";
import { assertNotFrozen, debitWalletForUsage } from "./walletService.js";
import { stampActivity } from "./reminderService.js";
import { isFullyVerified } from "./verifyService.js";

async function requireUser(email) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: { package: true },
  });
  if (!user) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }
  return user;
}

export async function getUserState(email) {
  const user = await requireUser(email);
  const logs = await prisma.usageLog.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const usage = aggregateUsage(logs);

  return {
    email: user.email,
    name: user.name,
    phone: user.phone,
    company: user.company,
    planId: user.package.slug,
    planName: user.package.name,
    credits: user.unlimitedCredits ? 999999 : user.remainingCredits,
    creditLimit: user.unlimitedCredits ? 999999 : user.package.monthlyCredits,
    unlimitedCredits: !!user.unlimitedCredits,
    walletBalanceUsd: user.walletBalanceUsd ?? 0,
    accountStatus: user.accountStatus || "pending_verification",
    emailVerified: !!user.emailVerified,
    phoneVerified: !!user.phoneVerified,
    cardOnFile: !!user.cardOnFile,
    cardLast4: user.cardLast4,
    fullyVerified: isFullyVerified(user),
    notifyEmail: user.notifyEmail !== false,
    notifyWhatsapp: !!user.notifyWhatsapp,
    notifyTelegram: !!user.notifyTelegram,
    whatsappNumber: user.whatsappNumber,
    telegramChatId: user.telegramChatId,
    source: user.source,
    registeredAt: user.createdAt,
    usage,
    transactions: logs.map(formatLogAsTransaction),
  };
}

function aggregateUsage(logs) {
  return logs.reduce(
    (acc, log) => {
      if (log.action === "sitemap_parse") acc.scrapedPages += 1;
      if (log.action === "social_post") {
        acc.uniquePosts += 1;
        acc.aiImages += 1;
      }
      if (log.action === "gbp_post") acc.uniquePosts += 1;
      if (log.action === "review_reply") acc.gbpReplies += 1;
      return acc;
    },
    { scrapedPages: 0, uniquePosts: 0, aiImages: 0, gbpReplies: 0 }
  );
}

function formatLogAsTransaction(log) {
  return {
    id: log.id,
    type: "debit",
    amount: log.creditsDeducted,
    label: `${log.action}${log.model ? ` (${log.model.split("/").pop()})` : ""}`,
    balanceAfter: null,
    timestamp: log.createdAt.toISOString(),
    tokens: log.totalTokens,
    costUsd: log.apiCostUsd,
  };
}

/**
 * Main generate workflow:
 * Pre-check → Validate model pricing → OpenRouter → USD cost → Credits → Deduct → Log
 */
export async function generateContent({ email, action, prompt, model, metadata = {} }) {
  const gate = await assertNotFrozen(email);
  if (!gate.ok) {
    return { ok: false, status: gate.frozen ? 402 : 403, ...gate };
  }

  const user = gate.user;
  const unlimited = !!user.unlimitedCredits;

  if (!unlimited && user.remainingCredits <= 0 && (user.walletBalanceUsd || 0) <= 0) {
    return {
      ok: false,
      status: 403,
      error: "Insufficient credits and wallet balance. Please top up.",
      creditsLeft: 0,
      walletBalanceUsd: user.walletBalanceUsd,
    };
  }

  const selectedModel = model || ACTION_MODELS[action] || ACTION_MODELS.social_post;
  const pricing = getModelPricing(selectedModel);

  if (!pricing) {
    return {
      ok: false,
      status: 400,
      error: `Invalid or unsupported model: ${selectedModel}. Prices may still be loading.`,
    };
  }

  let data;
  try {
    data = await callOpenRouter({
      model: selectedModel,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err.message,
      creditsLeft: user.remainingCredits,
    };
  }

  if (!data?.usage) {
    return {
      ok: false,
      status: 502,
      error: "Usage metrics not returned from OpenRouter. No credits were deducted.",
      creditsLeft: user.remainingCredits,
    };
  }

  const usageData = extractUsage(data, selectedModel);
  if (!usageData) {
    return {
      ok: false,
      status: 502,
      error: "Could not calculate usage cost. No credits were deducted.",
      creditsLeft: user.remainingCredits,
    };
  }

  const { promptTokens, completionTokens, totalTokens, apiCostUsd } = usageData;
  const creditsToDeduct = unlimited ? 0 : usdCostToCredits(apiCostUsd);

  if (!unlimited && user.remainingCredits < creditsToDeduct) {
    return {
      ok: false,
      status: 402,
      error: `This request requires ${creditsToDeduct} credits ($${apiCostUsd.toFixed(6)} USD) but you only have ${user.remainingCredits}.`,
      creditsRequired: creditsToDeduct,
      creditsLeft: user.remainingCredits,
      usageDetails: {
        modelUsed: selectedModel,
        promptTokens,
        completionTokens,
        actualCostUSD: apiCostUsd.toFixed(6),
        creditsDeducted: creditsToDeduct,
      },
    };
  }

  const newBalance = unlimited ? user.remainingCredits : user.remainingCredits - creditsToDeduct;

  if (unlimited) {
    await prisma.usageLog.create({
      data: {
        userId: user.id,
        action,
        model: selectedModel,
        promptTokens,
        completionTokens,
        totalTokens,
        apiCostUsd,
        creditsDeducted: 0,
        metadata: JSON.stringify({
          ...metadata,
          modelName: usageData.modelName,
          unlimited: true,
          wouldHaveCost: usdCostToCredits(apiCostUsd),
        }),
      },
    });
  } else {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { remainingCredits: newBalance },
      }),
      prisma.usageLog.create({
        data: {
          userId: user.id,
          action,
          model: selectedModel,
          promptTokens,
          completionTokens,
          totalTokens,
          apiCostUsd,
          creditsDeducted: creditsToDeduct,
          metadata: JSON.stringify({ ...metadata, modelName: usageData.modelName }),
        },
      }),
    ]);
  }

  const content = data.choices?.[0]?.message?.content || "";

  const walletResult = await debitWalletForUsage(user.id, apiCostUsd, {
    action,
    model: selectedModel,
  });
  await stampActivity(user.id, action);

  return {
    ok: true,
    content,
    creditsDeducted: creditsToDeduct,
    creditsLeft: unlimited ? 999999 : newBalance,
    unlimitedCredits: unlimited,
    walletBalanceUsd: walletResult.walletBalanceUsd,
    usage: { promptTokens, completionTokens, totalTokens, apiCostUsd },
    usageDetails: {
      modelUsed: selectedModel,
      modelName: usageData.modelName,
      promptTokens,
      completionTokens,
      actualCostUSD: apiCostUsd.toFixed(6),
      creditsDeducted: creditsToDeduct,
      promptPricePerToken: pricing.promptPrice,
      completionPricePerToken: pricing.completionPrice,
      unlimited,
    },
    model: selectedModel,
    mock: !!data._mock,
  };
}

/**
 * Fixed-cost actions (sitemap parse — no OpenRouter call)
 */
export async function spendFixedCredits({ email, action, metadata = {} }) {
  const gate = await assertNotFrozen(email);
  if (!gate.ok) {
    return { ok: false, status: gate.frozen ? 402 : 403, ...gate };
  }

  const user = gate.user;
  const cost = getFixedCost(action);
  const unlimited = !!user.unlimitedCredits;

  if (!cost) {
    return { ok: false, status: 400, error: `Unknown fixed action: ${action}` };
  }

  if (!unlimited && user.remainingCredits < cost) {
    return {
      ok: false,
      status: 403,
      error: "Insufficient credits. Please upgrade your package.",
      creditsRequired: cost,
      creditsLeft: user.remainingCredits,
    };
  }

  const deduct = unlimited ? 0 : cost;
  const newBalance = unlimited ? user.remainingCredits : user.remainingCredits - cost;

  if (unlimited) {
    await prisma.usageLog.create({
      data: {
        userId: user.id,
        action,
        creditsDeducted: 0,
        metadata: JSON.stringify({ ...metadata, unlimited: true, wouldHaveCost: cost }),
      },
    });
  } else {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { remainingCredits: newBalance },
      }),
      prisma.usageLog.create({
        data: {
          userId: user.id,
          action,
          creditsDeducted: deduct,
          metadata: JSON.stringify(metadata),
        },
      }),
    ]);
  }

  return {
    ok: true,
    creditsDeducted: deduct,
    creditsLeft: unlimited ? 999999 : newBalance,
    unlimitedCredits: unlimited,
  };
}

export async function subscribeUser({ email, planSlug, gateway, gatewaySubId }) {
  const plan = await prisma.package.findUnique({ where: { slug: planSlug } });
  if (!plan) return { ok: false, status: 404, error: "Plan not found" };

  const user = await requireUser(email);

  if (!user.emailVerified || !user.phoneVerified) {
    return {
      ok: false,
      status: 403,
      error: "Verify email and phone before joining a plan.",
    };
  }
  if (!user.cardOnFile && plan.priceUsd === 0) {
    return {
      ok: false,
      status: 403,
      error: "Add a valid card to start Free Trial (security requirement).",
    };
  }
  if (!user.cardOnFile && plan.priceUsd > 0) {
    return {
      ok: false,
      status: 403,
      error: "Add a valid payment method before subscribing.",
    };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      packageId: plan.id,
      remainingCredits: plan.monthlyCredits,
      accountStatus: plan.priceUsd === 0 ? "trial" : "active",
    },
  });

  const existingSub = await prisma.subscription.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + plan.renewalDays);

  if (existingSub) {
    await prisma.subscription.update({
      where: { id: existingSub.id },
      data: {
        packageId: plan.id,
        status: "active",
        gateway,
        gatewaySubId,
        currentPeriodEnd: periodEnd,
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        userId: user.id,
        packageId: plan.id,
        status: "active",
        gateway,
        gatewaySubId,
        currentPeriodEnd: periodEnd,
      },
    });
  }

  if (plan.priceUsd > 0) {
    await recordPayment({
      userId: user.id,
      packageId: plan.id,
      amountUsd: plan.priceUsd,
      gateway,
      gatewayPaymentId: gatewaySubId,
    });
  }

  return {
    ok: true,
    plan: plan.name,
    credits: plan.monthlyCredits,
    creditLimit: plan.monthlyCredits,
    periodEnd: periodEnd.toISOString(),
  };
}

export async function renewSubscription(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { package: true, subscriptions: { where: { status: "active" }, take: 1 } },
  });

  if (!user) return { ok: false, error: "User not found" };

  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + user.package.renewalDays);

  await prisma.user.update({
    where: { id: userId },
    data: { remainingCredits: user.package.monthlyCredits },
  });

  if (user.subscriptions[0]) {
    await prisma.subscription.update({
      where: { id: user.subscriptions[0].id },
      data: { currentPeriodEnd: periodEnd },
    });
  }

  return {
    ok: true,
    credits: user.package.monthlyCredits,
    periodEnd: periodEnd.toISOString(),
  };
}
