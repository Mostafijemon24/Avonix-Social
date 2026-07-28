import { Router } from "express";
import {
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  activateWorkspace,
  saveWorkspaceSitemap,
} from "../services/workspaceService.js";
import { assertSessionMatchesEmail } from "../middleware/userAuth.js";

const router = Router();

function requireSessionForEmail(req, res, next) {
  const email = req.query.email || req.body?.email;
  if (!email) return res.status(400).json({ error: "Email is required" });
  const gate = assertSessionMatchesEmail(req, email);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
  next();
}

router.get("/", requireSessionForEmail, async (req, res) => {
  try {
    const result = await listWorkspaces(req.query.email);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", requireSessionForEmail, async (req, res) => {
  try {
    const result = await createWorkspace(req.body);
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id", requireSessionForEmail, async (req, res) => {
  try {
    const result = await updateWorkspace({
      email: req.body.email,
      workspaceId: req.params.id,
      name: req.body.name,
      websiteUrl: req.body.websiteUrl,
      notes: req.body.notes,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", requireSessionForEmail, async (req, res) => {
  try {
    const result = await deleteWorkspace({
      email: req.query.email || req.body?.email,
      workspaceId: req.params.id,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/activate", requireSessionForEmail, async (req, res) => {
  try {
    const result = await activateWorkspace({
      email: req.body.email,
      workspaceId: req.params.id,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:id/sitemap", requireSessionForEmail, async (req, res) => {
  try {
    const result = await saveWorkspaceSitemap({
      email: req.body.email,
      workspaceId: req.params.id,
      sitemap: req.body.sitemap,
    });
    if (!result.ok) return res.status(result.status || 400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
