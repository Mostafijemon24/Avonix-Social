import prisma from "../db.js";
import bcrypt from "bcryptjs";
import { setConfig, getAllConfig, syncConfigToEnv, clearConfigCache } from "./configService.js";
import { validatePasswordStrength, PASSWORD_HINT } from "../password.js";
import { sendAdminWelcomeEmail } from "./notifyService.js";

export {
  adminLoginStep1,
  adminLoginStep2,
  changeAdminPassword,
  changeAdminEmail,
  getAdminProfile,
  validatePasswordStrength,
  MAX_SUPER_ADMINS,
  requestAdminPasswordReset,
  resendAdminPasswordReset,
  resetAdminPasswordWithCode,
} from "./adminAuthService.js";

/** @deprecated — use adminLoginStep1 + adminLoginStep2 */
export async function adminLogin() {
  return {
    ok: false,
    error: "Use /auth/login then /auth/verify-2fa. Direct login disabled.",
  };
}

export async function getDashboardStats() {
  const [userCount, activeSubs, payments, usageAgg, recentUsers] = await Promise.all([
    prisma.user.count(),
    prisma.subscription.count({ where: { status: "active" } }),
    prisma.paymentLog.findMany({ where: { status: "completed" } }),
    prisma.usageLog.aggregate({
      _sum: { apiCostUsd: true, creditsDeducted: true, totalTokens: true },
      _count: true,
    }),
    prisma.user.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { package: true },
    }),
  ]);

  const totalRevenue = payments.reduce((s, p) => s + p.amountUsd, 0);
  const monthlyRevenue = payments
    .filter((p) => {
      const d = new Date(p.createdAt);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, p) => s + p.amountUsd, 0);

  return {
    userCount,
    activeSubscriptions: activeSubs,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    monthlyRevenue: Math.round(monthlyRevenue * 100) / 100,
    totalApiCostUsd: Math.round((usageAgg._sum.apiCostUsd || 0) * 1000000) / 1000000,
    totalCreditsUsed: usageAgg._sum.creditsDeducted || 0,
    totalRequests: usageAgg._count || 0,
    profitEstimate: Math.round((monthlyRevenue - (usageAgg._sum.apiCostUsd || 0)) * 100) / 100,
    recentUsers: recentUsers.map(formatUserSummary),
  };
}

export async function getAllUsers() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      package: true,
      subscriptions: { where: { status: "active" }, take: 1 },
      _count: { select: { usageLogs: true } },
    },
  });

  return users.map((u) => ({
    ...formatUserSummary(u),
    usageCount: u._count.usageLogs,
    subscription: u.subscriptions[0]
      ? {
          gateway: u.subscriptions[0].gateway,
          status: u.subscriptions[0].status,
          periodEnd: u.subscriptions[0].currentPeriodEnd,
        }
      : null,
  }));
}

export async function getUserDetail(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      package: true,
      subscriptions: { orderBy: { createdAt: "desc" } },
      paymentLogs: { orderBy: { createdAt: "desc" }, include: { package: true } },
      usageLogs: { orderBy: { createdAt: "desc" }, take: 100 },
    },
  });

  if (!user) return null;

  const usageStats = user.usageLogs.reduce(
    (acc, log) => {
      acc.totalCredits += log.creditsDeducted;
      acc.totalTokens += log.totalTokens;
      acc.totalApiCost += log.apiCostUsd;
      if (log.action === "sitemap_parse") acc.sitemapParses += 1;
      if (log.action === "social_post") acc.socialPosts += 1;
      if (log.action === "gbp_post") acc.gbpPosts += 1;
      if (log.action === "review_reply") acc.reviewReplies += 1;
      return acc;
    },
    {
      totalCredits: 0,
      totalTokens: 0,
      totalApiCost: 0,
      sitemapParses: 0,
      socialPosts: 0,
      gbpPosts: 0,
      reviewReplies: 0,
    }
  );

  return {
    ...formatUserSummary(user),
    subscriptions: user.subscriptions,
    paymentLogs: user.paymentLogs.map((p) => ({
      id: p.id,
      amountUsd: p.amountUsd,
      gateway: p.gateway,
      plan: p.package.name,
      status: p.status,
      createdAt: p.createdAt,
    })),
    usageStats,
    usageLogs: user.usageLogs,
    registration: {
      email: user.email,
      name: user.name,
      phone: user.phone,
      company: user.company,
      source: user.source,
      notes: user.notes,
      registeredAt: user.createdAt,
      lastUpdated: user.updatedAt,
      plan: user.package?.name,
      unlimitedCredits: user.unlimitedCredits,
      hasPassword: !!user.passwordHash,
      emailVerified: !!user.emailVerified,
      cardOnFile: !!user.cardOnFile,
      accountStatus: user.accountStatus,
    },
  };
}

export async function adjustUserCredits(userId, credits, reason) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "User not found" };

  const diff = credits - user.remainingCredits;
  const type = diff >= 0 ? "credit" : "debit";

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { remainingCredits: credits },
    }),
    prisma.usageLog.create({
      data: {
        userId,
        action: "admin_adjustment",
        creditsDeducted: type === "debit" ? Math.abs(diff) : 0,
        metadata: JSON.stringify({ reason, adminCredits: credits, type, amount: Math.abs(diff) }),
      },
    }),
  ]);

  return { ok: true, credits, previous: user.remainingCredits };
}

export async function createUser({
  email,
  name,
  phone,
  company,
  planSlug = "free",
  credits,
  unlimitedCredits = false,
  notes,
  source = "admin",
  password,
  sendWelcomeEmail = true,
}) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized.includes("@")) return { ok: false, error: "Valid email required" };

  if (!password) {
    return { ok: false, error: "Password is required so the user can sign in" };
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return { ok: false, error: `${strength.error}. ${PASSWORD_HINT}` };
  }

  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) return { ok: false, error: "User already exists" };

  const plan = await prisma.package.findUnique({ where: { slug: planSlug } });
  if (!plan) return { ok: false, error: "Plan not found" };

  const passwordHash = await bcrypt.hash(password, 12);
  const accountStatus = plan.slug === "free" ? "trial" : "active";

  const user = await prisma.user.create({
    data: {
      email: normalized,
      name: name || normalized.split("@")[0],
      phone: phone || null,
      company: company || null,
      passwordHash,
      packageId: plan.id,
      remainingCredits: credits != null ? Number(credits) : plan.monthlyCredits,
      unlimitedCredits: !!unlimitedCredits,
      notes: notes || null,
      source,
      // Admin-provisioned users can sign in immediately (no OTP/card funnel)
      emailVerified: true,
      cardOnFile: true,
      accountStatus,
    },
    include: { package: true },
  });

  let emailDelivery = null;
  if (sendWelcomeEmail !== false) {
    emailDelivery = await sendAdminWelcomeEmail(user, { appUrl: process.env.APP_URL || "" });
  }

  return {
    ok: true,
    user: formatUserSummary(user),
    delivery: {
      email: emailDelivery?.status || null,
      emailError: emailDelivery?.error || null,
    },
  };
}

/** Set / reset password for an existing user (admin). Activates login if needed. */
export async function setUserPassword(userId, password) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { package: true },
  });
  if (!user) return { ok: false, error: "User not found" };

  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return { ok: false, error: `${strength.error}. ${PASSWORD_HINT}` };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const accountStatus =
    user.accountStatus === "pending_verification" || user.accountStatus === "pending_card"
      ? user.package?.slug === "free"
        ? "trial"
        : "active"
      : user.accountStatus;

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      emailVerified: true,
      cardOnFile: true,
      accountStatus,
    },
    include: { package: true },
  });

  return { ok: true, user: formatUserSummary(updated) };
}

export async function updateUser(userId, data) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "User not found" };

  const update = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.phone !== undefined) update.phone = data.phone;
  if (data.company !== undefined) update.company = data.company;
  if (data.notes !== undefined) update.notes = data.notes;
  if (data.unlimitedCredits !== undefined) update.unlimitedCredits = !!data.unlimitedCredits;
  if (data.credits !== undefined) update.remainingCredits = Number(data.credits);

  if (data.planSlug) {
    const plan = await prisma.package.findUnique({ where: { slug: data.planSlug } });
    if (!plan) return { ok: false, error: "Plan not found" };
    update.packageId = plan.id;
    if (data.credits === undefined && data.resetCreditsOnPlanChange) {
      update.remainingCredits = plan.monthlyCredits;
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: update,
    include: { package: true },
  });

  return { ok: true, user: formatUserSummary(updated) };
}

export async function setUnlimitedCredits(userId, unlimited, reason = "Admin grant") {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { package: true } });
  if (!user) return { ok: false, error: "User not found" };

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { unlimitedCredits: !!unlimited },
    include: { package: true },
  });

  await prisma.usageLog.create({
    data: {
      userId,
      action: "admin_unlimited",
      creditsDeducted: 0,
      metadata: JSON.stringify({ reason, unlimited: !!unlimited }),
    },
  });

  return { ok: true, user: formatUserSummary(updated) };
}

export async function deleteUser(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "User not found" };

  await prisma.user.delete({ where: { id: userId } });
  return { ok: true, deleted: user.email };
}

export async function createPlan(data) {
  const slug = (data.slug || data.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) return { ok: false, error: "Plan slug required" };

  const existing = await prisma.package.findUnique({ where: { slug } });
  if (existing) return { ok: false, error: "Plan slug already exists" };

  const plan = await prisma.package.create({
    data: {
      slug,
      name: data.name || slug,
      monthlyCredits: Number(data.monthlyCredits ?? 0),
      priceUsd: Number(data.priceUsd ?? 0),
      renewalDays: Number(data.renewalDays ?? 30),
      isActive: data.isActive !== false,
    },
  });
  return { ok: true, plan };
}

export async function deletePlan(slug) {
  const plan = await prisma.package.findUnique({
    where: { slug },
    include: { _count: { select: { users: true } } },
  });
  if (!plan) return { ok: false, error: "Plan not found" };
  if (plan._count.users > 0) {
    return {
      ok: false,
      error: `Cannot delete: ${plan._count.users} user(s) still on this plan. Move them first.`,
    };
  }
  if (["free", "pro", "agency"].includes(slug)) {
    // Soft-delete system plans
    await prisma.package.update({ where: { slug }, data: { isActive: false } });
    return { ok: true, softDeleted: true, plan: slug };
  }
  await prisma.package.delete({ where: { slug } });
  return { ok: true, deleted: slug };
}

export async function createLead(data) {
  const email = (data.email || "").trim().toLowerCase();
  if (!email.includes("@") || !(data.name || "").trim()) {
    return { ok: false, error: "Name and valid email required" };
  }
  const lead = await prisma.lead.create({
    data: {
      name: data.name.trim(),
      email,
      phone: data.phone || null,
      company: data.company || null,
      message: data.message || null,
      source: data.source || "contact",
      status: "new",
    },
  });
  return { ok: true, lead };
}

export async function getLeads({ status } = {}) {
  return prisma.lead.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export async function updateLead(id, data) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return { ok: false, error: "Lead not found" };
  const updated = await prisma.lead.update({
    where: { id },
    data: {
      status: data.status ?? lead.status,
      notes: data.notes !== undefined ? data.notes : lead.notes,
    },
  });
  return { ok: true, lead: updated };
}

export async function deleteLead(id) {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) return { ok: false, error: "Lead not found" };
  await prisma.lead.delete({ where: { id } });
  return { ok: true, deleted: id };
}

export async function getAllSubscriptions() {
  return prisma.subscription.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { email: true, name: true, remainingCredits: true } },
      package: true,
    },
  });
}

export async function getRevenueReport() {
  const payments = await prisma.paymentLog.findMany({
    where: { status: "completed" },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { email: true } },
      package: { select: { name: true } },
    },
  });

  const byGateway = {};
  const byPlan = {};
  for (const p of payments) {
    byGateway[p.gateway] = (byGateway[p.gateway] || 0) + p.amountUsd;
    byPlan[p.package.name] = (byPlan[p.package.name] || 0) + p.amountUsd;
  }

  return {
    total: payments.reduce((s, p) => s + p.amountUsd, 0),
    byGateway,
    byPlan,
    payments: payments.map((p) => ({
      id: p.id,
      email: p.user.email,
      plan: p.package.name,
      amountUsd: p.amountUsd,
      gateway: p.gateway,
      createdAt: p.createdAt,
    })),
  };
}

export async function updatePlan(slug, data) {
  const plan = await prisma.package.update({
    where: { slug },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.monthlyCredits !== undefined
        ? { monthlyCredits: Number(data.monthlyCredits) }
        : {}),
      ...(data.priceUsd !== undefined ? { priceUsd: Number(data.priceUsd) } : {}),
      ...(data.renewalDays !== undefined ? { renewalDays: Number(data.renewalDays) } : {}),
      ...(data.isActive !== undefined ? { isActive: !!data.isActive } : {}),
    },
  });
  return plan;
}

export async function getPlans() {
  return prisma.package.findMany({ orderBy: { priceUsd: "asc" } });
}

export async function saveApiConfig(config) {
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      await setConfig(key, String(value));
    }
  }
  clearConfigCache();
  await syncConfigToEnv();
  return getAllConfig();
}

export async function recordPayment({ userId, packageId, amountUsd, gateway, gatewayPaymentId }) {
  return prisma.paymentLog.create({
    data: { userId, packageId, amountUsd, gateway, gatewayPaymentId, status: "completed" },
  });
}

function formatUserSummary(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone || null,
    company: user.company || null,
    notes: user.notes || null,
    source: user.source || "signup",
    planId: user.package?.slug,
    planName: user.package?.name,
    credits: user.unlimitedCredits ? 999999 : user.remainingCredits,
    creditLimit: user.unlimitedCredits ? 999999 : user.package?.monthlyCredits,
    unlimitedCredits: !!user.unlimitedCredits,
    priceUsd: user.package?.priceUsd,
    hasPassword: !!user.passwordHash,
    emailVerified: !!user.emailVerified,
    cardOnFile: !!user.cardOnFile,
    accountStatus: user.accountStatus || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
