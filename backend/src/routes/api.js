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
} from "../services/verifyService.js";
import { getWallet, topUpWallet } from "../services/walletService.js";
import { setPendingReviews, runReminderSweep } from "../services/reminderService.js";
import { getCreditConfig } from "../credits.js";
import { getPriceCacheStats, getAllModelPrices } from "../modelPrices.js";
import prisma from "../db.js";

const router = Router();

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

/** Multi-step registration: email + phone → OTPs */
router.post("/auth/register", async (req, res) => {
  try {
    const result = await startRegistration(req.body);
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
    const result = await loginVerifiedUser(req.body.email);
    if (!result.ok) return res.status(result.status || 400).json(result);
    const state = await getUserState(result.email);
    res.json({ ok: true, user: state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/:email/credits", async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!isFullyVerified(user)) {
      return res.status(403).json({
        error: "Verification required",
        emailVerified: !!user.emailVerified,
        phoneVerified: !!user.phoneVerified,
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
    const wallet = await getWallet(req.params.email);
    if (!wallet) return res.status(404).json({ error: "User not found" });
    res.json(wallet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/wallet/topup", async (req, res) => {
  try {
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
    const logs = await prisma.notificationLog.findMany({
      where: { user: { email: req.params.email.trim().toLowerCase() } },
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
    const result = await generateContent({ email, action, prompt, model, metadata });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/credits/spend", async (req, res) => {
  try {
    const { email, action, metadata } = req.body;
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
