import { Router } from "express";
import {
  listConnections,
  startOAuth,
  handleOAuthCallback,
  saveManualLink,
  disconnectAccount,
  getConnectionsSetupStatus,
} from "../services/connectionsService.js";
import { publishContent } from "../services/publishService.js";
import { assertSessionMatchesEmail } from "../middleware/userAuth.js";

const router = Router();

function requireSessionForEmail(req, res, next) {
  const email = req.query.email || req.body?.email;
  if (!email) return res.status(400).json({ error: "Email is required" });
  const gate = assertSessionMatchesEmail(req, email);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
  next();
}

router.get("/setup", (_req, res) => {
  res.json({ ok: true, setup: getConnectionsSetupStatus() });
});

router.post("/publish", requireSessionForEmail, async (req, res) => {
  try {
    const result = await publishContent(req.body);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", requireSessionForEmail, async (req, res) => {
  try {
    const result = await listConnections(req.query.email, req.query.workspaceId);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/manual", requireSessionForEmail, async (req, res) => {
  try {
    const result = await saveManualLink(req.body);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requireSessionForEmail, async (req, res) => {
  try {
    const result = await disconnectAccount({
      email: req.query.email || req.body?.email,
      accountId: req.params.id,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/oauth/:provider/start", requireSessionForEmail, async (req, res) => {
  try {
    const result = await startOAuth({
      email: req.query.email,
      provider: req.params.provider,
      workspaceId: req.query.workspaceId,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    if (req.query.redirect === "1") {
      return res.redirect(result.authUrl);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/oauth/:provider/callback", async (req, res) => {
  try {
    const { redirect } = await handleOAuthCallback({
      provider: req.params.provider,
      code: req.query.code,
      state: req.query.state,
      error: req.query.error,
      errorDescription: req.query.error_description,
    });
    res.redirect(redirect);
  } catch (err) {
    const frontend = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
    res.redirect(
      `${frontend}/dashboard/connections?error=${encodeURIComponent(err.message || "OAuth failed")}`
    );
  }
});

export default router;
