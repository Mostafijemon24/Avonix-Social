import { Router } from "express";
import {
  listConnections,
  startOAuth,
  handleOAuthCallback,
  saveManualLink,
  disconnectAccount,
  getConnectionsSetupStatus,
} from "../services/connectionsService.js";

const router = Router();

router.get("/setup", (_req, res) => {
  res.json({ ok: true, setup: getConnectionsSetupStatus() });
});

router.get("/", async (req, res) => {
  try {
    const result = await listConnections(req.query.email);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/manual", async (req, res) => {
  try {
    const result = await saveManualLink(req.body);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
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

/** Returns { authUrl } — frontend navigates the browser there */
router.get("/oauth/:provider/start", async (req, res) => {
  try {
    const result = await startOAuth({
      email: req.query.email,
      provider: req.params.provider,
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
