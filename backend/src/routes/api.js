import { Router } from "express";
import {
  getUserState,
  generateContent,
  spendFixedCredits,
  subscribeUser,
} from "../services/userService.js";
import { createLead } from "../services/adminService.js";
import {
  startRegistration,
  verifyCodes,
  attachCard,
  getAuthStatus,
  loginVerifiedUser,
  isFullyVerified,
  resendRegistrationOtps,
  requestPasswordReset,
  resendPasswordResetOtp,
  resetPasswordWithCode,
} from "../services/verifyService.js";
import { getWallet, topUpWallet } from "../services/walletService.js";
import { setPendingReviews, runReminderSweep } from "../services/reminderService.js";
import { getCreditConfig } from "../credits.js";
import { getPriceCacheStats, getAllModelPrices } from "../modelPrices.js";
import { analyzeSite } from "../services/siteAnalyzer.js";
import { generateSocialSuite } from "../services/socialSuiteService.js";
import {
  generateAutoPosterSuite,
  listStudioPosts,
  publishStudioPost,
  scheduleStudioPost,
  rewriteStudioPost,
  TONE_PRESETS,
} from "../services/autoPosterService.js";
import connectionsRoutes from "./connections.js";
import workspacesRoutes from "./workspaces.js";
import { assertSessionMatchesEmail } from "../middleware/userAuth.js";
import prisma from "../db.js";

const router = Router();

router.use("/connections", connectionsRoutes);
router.use("/workspaces", workspacesRoutes);

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "avonix-social-api",
    creditConfig: getCreditConfig(),
    modelPrices: getPriceCacheStats(),
    timestamp: new Date().toISOString(),
  });
});

router.post("/leads", async (req, res) => {
  try {
    const result = await createLead({ ...req.body, source: req.body.source || "contact" });
    if (!result.ok) return res.status(400).json(result);
    res.status(201).json({ ok: true, message: "Thank you — we will contact you soon." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Root domain → crawl sitemap/pages/posts → extract primary & secondary keywords */
router.post("/site/analyze", async (req, res) => {
  try {
    const { domain, email, location } = req.body;
    if (!domain || !String(domain).trim()) {
      return res.status(400).json({ ok: false, error: "Domain is required, e.g. example.com" });
    }
    if (email) {
      const user = await prisma.user.findUnique({
        where: { email: String(email).trim().toLowerCase() },
      });
      if (!user || !isFullyVerified(user)) {
        return res.status(403).json({ error: "Verification required" });
      }
    }
    const result = await analyzeSite(domain, { location });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error("[site/analyze]", err);
    res.status(500).json({ ok: false, error: err.message || "Site analysis failed" });
  }
});

/** Multi-step registration: email → OTP → card */
router.post("/auth/register", async (req, res) => {
  try {
    const result = await startRegistration(req.body);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/resend-otp", async (req, res) => {
  try {
    const result = await resendRegistrationOtps(req.body.email);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/verify", async (req, res) => {
  try {
    const result = await verifyCodes(req.body);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/card", async (req, res) => {
  try {
    const result = await attachCard(req.body);
    if (!result.ok) return res.status(400).json(result);
    const state = await getUserState(req.body.email);
    res.json({ ...result, user: state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/auth/status/:email", async (req, res) => {
  try {
    const result = await getAuthStatus(req.params.email);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const result = await loginVerifiedUser(req.body.email, req.body.password);
    if (!result.ok) return res.status(result.status || 400).json(result);
    const state = await getUserState(result.email);
    res.json({ ok: true, user: state, sessionToken: result.sessionToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const result = await requestPasswordReset(req.body.email);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/resend-password-reset", async (req, res) => {
  try {
    const result = await resendPasswordResetOtp(req.body.email);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auth/reset-password", async (req, res) => {
  try {
    const result = await resetPasswordWithCode(req.body);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/:email/credits", async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!isFullyVerified(user)) {
      return res.status(403).json({
        error: "Verification required",
        emailVerified: !!user.emailVerified,
        cardOnFile: !!user.cardOnFile,
        fullyVerified: false,
      });
    }
    const state = await getUserState(email);
    res.json(state);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get("/wallet/:email", async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const wallet = await getWallet(email);
    if (!wallet) return res.status(404).json({ error: "User not found" });
    res.json(wallet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/wallet/topup", async (req, res) => {
  try {
    const gate = assertSessionMatchesEmail(req, req.body.email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const result = await topUpWallet(req.body);
    if (!result.ok) return res.status(400).json(result);
    const state = await getUserState(req.body.email);
    res.json({ ...result, user: state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/users/:email/notifications", async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const {
      notifyEmail,
      notifyWhatsapp,
      notifyTelegram,
      whatsappNumber,
      telegramChatId,
    } = req.body;

    const user = await prisma.user.update({
      where: { email },
      data: {
        ...(notifyEmail !== undefined ? { notifyEmail: !!notifyEmail } : {}),
        ...(notifyWhatsapp !== undefined ? { notifyWhatsapp: !!notifyWhatsapp } : {}),
        ...(notifyTelegram !== undefined ? { notifyTelegram: !!notifyTelegram } : {}),
        ...(whatsappNumber !== undefined ? { whatsappNumber } : {}),
        ...(telegramChatId !== undefined ? { telegramChatId } : {}),
      },
    });

    res.json({
      ok: true,
      notifyEmail: user.notifyEmail,
      notifyWhatsapp: user.notifyWhatsapp,
      notifyTelegram: user.notifyTelegram,
      whatsappNumber: user.whatsappNumber,
      telegramChatId: user.telegramChatId,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/:email/notifications", async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const logs = await prisma.notificationLog.findMany({
      where: { user: { email } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Simulate pending GMB reviews (until real GBP API is connected) */
router.post("/users/:email/pending-reviews", async (req, res) => {
  try {
    await setPendingReviews(req.params.email, req.body.count);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/admin-jobs/reminders", async (_req, res) => {
  try {
    res.json(await runReminderSweep());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/credits/config", (_req, res) => {
  res.json({
    ...getCreditConfig(),
    modelPrices: getPriceCacheStats(),
  });
});

router.get("/models/prices", (_req, res) => {
  const prices = getAllModelPrices();
  const simplified = Object.entries(prices)
    .slice(0, 50)
    .map(([id, p]) => ({
      id,
      name: p.name,
      promptPrice: p.promptPrice,
      completionPrice: p.completionPrice,
    }));
  res.json({ count: Object.keys(prices).length, models: simplified });
});

router.post("/generate", async (req, res) => {
  try {
    const { email, action, prompt, model, metadata } = req.body;
    if (!email || !action || !prompt) {
      return res.status(400).json({ error: "email, action, and prompt are required" });
    }
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const result = await generateContent({ email, action, prompt, model, metadata });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Connected platforms only — format/word limits, no links/emojis, + image */
router.post("/generate/social-suite", async (req, res) => {
  try {
    const { email, workspaceId, intent } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const result = await generateSocialSuite({ email, workspaceId, intent });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    console.error("[generate/social-suite]", err);
    res.status(500).json({ error: err.message });
  }
});

/** Avonix Social — scan ≤15 URLs, keywords, multi-platform posts + images */
router.post("/auto-poster/generate", async (req, res) => {
  try {
    const { email, workspaceId, urls, location, tone } = req.body;
    if (!email) return res.status(400).json({ error: "email is required" });
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const result = await generateAutoPosterSuite({
      email,
      workspaceId,
      urls,
      location,
      tone,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    console.error("[auto-poster/generate]", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/auto-poster/posts", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: "email is required" });
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const result = await listStudioPosts({
      email,
      workspaceId: req.query.workspaceId || undefined,
      status: req.query.status || undefined,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/auto-poster/tones", (_req, res) => {
  res.json({ ok: true, tones: TONE_PRESETS });
});

router.post("/auto-poster/publish", async (req, res) => {
  try {
    const { email, postId, alsoLive } = req.body;
    if (!email || !postId) {
      return res.status(400).json({ error: "email and postId are required" });
    }
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const result = await publishStudioPost({
      email,
      postId,
      // Default true — live OAuth publish unless explicitly disabled
      alsoLive: alsoLive !== false && alsoLive !== "false",
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auto-poster/schedule", async (req, res) => {
  try {
    const { email, postId, scheduledAt } = req.body;
    if (!email || !postId || !scheduledAt) {
      return res.status(400).json({ error: "email, postId, and scheduledAt are required" });
    }
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const result = await scheduleStudioPost({ email, postId, scheduledAt });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auto-poster/rewrite", async (req, res) => {
  try {
    const { email, postId, tone } = req.body;
    if (!email || !postId) {
      return res.status(400).json({ error: "email and postId are required" });
    }
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const result = await rewriteStudioPost({ email, postId, tone });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/credits/spend", async (req, res) => {
  try {
    const { email, action, metadata } = req.body;
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const result = await spendFixedCredits({ email, action, metadata });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/billing/subscribe", async (req, res) => {
  try {
    const { email, plan, gateway, gatewaySubId } = req.body;
    const gate = assertSessionMatchesEmail(req, email);
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    const planSlug =
      plan === "Pro Growth" ? "pro" : plan === "Agency Enterprise" ? "agency" : plan;
    const result = await subscribeUser({ email, planSlug, gateway, gatewaySubId });
    if (!result.ok) return res.status(result.status || 400).json(result);
    const state = await getUserState(email);
    res.json({ ...result, user: state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
