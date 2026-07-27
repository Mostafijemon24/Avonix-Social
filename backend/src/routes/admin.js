import { Router } from "express";
import { requireSuperAdmin, ADMIN_IDLE_SECONDS } from "../middleware/adminAuth.js";
import {
  adminLoginStep1,
  adminLoginStep2,
  changeAdminPassword,
  changeAdminEmail,
  getAdminProfile,
  getDashboardStats,
  getAllUsers,
  getUserDetail,
  adjustUserCredits,
  createUser,
  updateUser,
  setUnlimitedCredits,
  deleteUser,
  getAllSubscriptions,
  getRevenueReport,
  updatePlan,
  createPlan,
  deletePlan,
  getPlans,
  saveApiConfig,
  createLead,
  getLeads,
  updateLead,
  deleteLead,
} from "../services/adminService.js";
import { getAllConfig } from "../services/configService.js";

const router = Router();

function clientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

/** Step 1: password — returns preAuthToken (2FA required next) */
router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await adminLoginStep1(email, password, clientIp(req));
    if (!result.ok) return res.status(401).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Step 2: TOTP code — returns session token */
router.post("/auth/verify-2fa", async (req, res) => {
  try {
    const { preAuthToken, code } = req.body;
    const result = await adminLoginStep2(preAuthToken, code, clientIp(req));
    if (!result.ok) return res.status(401).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/auth/session", requireSuperAdmin, (_req, res) => {
  res.json({
    ok: true,
    idleTimeoutSeconds: ADMIN_IDLE_SECONDS,
    serverTime: Date.now(),
  });
});

router.get("/auth/me", requireSuperAdmin, async (req, res) => {
  try {
    const profile = await getAdminProfile(req.admin.id);
    if (!profile) return res.status(404).json({ error: "Admin not found" });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/auth/password", requireSuperAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword, totpCode } = req.body;
    const result = await changeAdminPassword(
      req.admin.id,
      currentPassword,
      newPassword,
      totpCode
    );
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/auth/email", requireSuperAdmin, async (_req, res) => {
  const result = await changeAdminEmail();
  res.status(403).json(result);
});

/** Explicitly block any HTTP admin creation */
router.post("/auth/register", (_req, res) => {
  res.status(403).json({
    error: "Super Admin registration is only allowed via VPS terminal CLI (npm run admin:create).",
  });
});

router.get("/dashboard", requireSuperAdmin, async (_req, res) => {
  try {
    res.json(await getDashboardStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users", requireSuperAdmin, async (_req, res) => {
  try {
    res.json(await getAllUsers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/:id", requireSuperAdmin, async (req, res) => {
  try {
    const user = await getUserDetail(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/users/:id/credits", requireSuperAdmin, async (req, res) => {
  try {
    const { credits, reason } = req.body;
    const result = await adjustUserCredits(
      req.params.id,
      Number(credits),
      reason || "Admin adjustment"
    );
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/users", requireSuperAdmin, async (req, res) => {
  try {
    const result = await createUser(req.body);
    if (!result.ok) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/users/:id", requireSuperAdmin, async (req, res) => {
  try {
    const result = await updateUser(req.params.id, req.body);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/users/:id/unlimited", requireSuperAdmin, async (req, res) => {
  try {
    const { unlimited, reason } = req.body;
    const result = await setUnlimitedCredits(req.params.id, !!unlimited, reason);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/users/:id", requireSuperAdmin, async (req, res) => {
  try {
    const result = await deleteUser(req.params.id);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/subscriptions", requireSuperAdmin, async (_req, res) => {
  try {
    res.json(await getAllSubscriptions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/revenue", requireSuperAdmin, async (_req, res) => {
  try {
    res.json(await getRevenueReport());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/plans", requireSuperAdmin, async (_req, res) => {
  try {
    res.json(await getPlans());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/plans", requireSuperAdmin, async (req, res) => {
  try {
    const result = await createPlan(req.body);
    if (!result.ok) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/plans/:slug", requireSuperAdmin, async (req, res) => {
  try {
    const plan = await updatePlan(req.params.slug, req.body);
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/plans/:slug", requireSuperAdmin, async (req, res) => {
  try {
    const result = await deletePlan(req.params.slug);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/leads", requireSuperAdmin, async (req, res) => {
  try {
    res.json(await getLeads({ status: req.query.status }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/leads/:id", requireSuperAdmin, async (req, res) => {
  try {
    const result = await updateLead(req.params.id, req.body);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/leads/:id", requireSuperAdmin, async (req, res) => {
  try {
    const result = await deleteLead(req.params.id);
    if (!result.ok) return res.status(404).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Admin can also manually add a lead */
router.post("/leads", requireSuperAdmin, async (req, res) => {
  try {
    const result = await createLead({ ...req.body, source: req.body.source || "admin" });
    if (!result.ok) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/config", requireSuperAdmin, async (_req, res) => {
  try {
    res.json(await getAllConfig());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/config", requireSuperAdmin, async (req, res) => {
  try {
    const config = await saveApiConfig(req.body);
    res.json({ ok: true, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
