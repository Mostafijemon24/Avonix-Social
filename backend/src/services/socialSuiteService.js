/**
 * Connected-platform social post suite:
 * - Only generates for publish-ready OAuth connections
 * - Platform-specific formats & word limits
 * - No links, no emojis
 * - Related image via OpenRouter
 */
import { generateContent } from "./userService.js";
import { listConnections } from "./connectionsService.js";
import { resolveActiveWorkspace } from "./workspaceService.js";
import { generateImage, stripLinksAndEmojis, enforceWordLimit } from "../openrouter.js";
import prisma from "../db.js";

export const PLATFORM_RULES = {
  facebook: {
    label: "Facebook",
    action: "social_post",
    maxWords: 150,
    tone: "conversational B2B Facebook Page post; short paragraphs; strong hook in first line",
  },
  instagram: {
    label: "Instagram",
    action: "social_post",
    maxWords: 80,
    tone: "Instagram Business caption; punchy and visual-led; 2-4 short lines",
  },
  google_business: {
    label: "Google Business Profile",
    action: "gbp_post",
    maxWords: 100,
    tone: "Google Business Profile local update; helpful and local; include city naturally in prose (no URL)",
  },
  linkedin: {
    label: "LinkedIn",
    action: "social_post",
    maxWords: 180,
    tone: "LinkedIn Company Page post; professional insight-led; first person plural or brand voice",
  },
};

function buildPrompt({ provider, primaryKeyword, secondaryKeywords, location, address, intent }) {
  const rules = PLATFORM_RULES[provider];
  const secondary = (secondaryKeywords || []).slice(0, 6).join(", ");
  return `Write one ${rules.label} post.

Rules (strict):
- Zero emojis
- Zero URLs / links / www / http
- Zero hashtags
- Zero markdown
- Maximum ${rules.maxWords} words
- ${rules.tone}

Business context:
- Primary keyword: ${primaryKeyword}
- Secondary keywords: ${secondary || "n/a"}
- Location: ${location || "n/a"}
- Address: ${address || "n/a"}
- Content intent: ${intent || "Educational"}

Return ONLY the post text.`;
}

function parseSecondary(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* ignore */
  }
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Generate posts only for connected platforms + one shared related image.
 */
export async function generateSocialSuite({
  email,
  workspaceId,
  intent = "Educational",
}) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalized) return { ok: false, status: 400, error: "Email is required" };

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return { ok: false, status: 404, error: "User not found" };

  const { activeId, workspace } = await resolveActiveWorkspace(user);
  const wid = workspaceId || activeId || workspace?.id;
  if (!wid) {
    return { ok: false, status: 400, error: "No active client workspace" };
  }

  const ws =
    workspace?.id === wid
      ? workspace
      : await prisma.clientWorkspace.findFirst({ where: { id: wid, userId: user.id } });

  if (!ws) return { ok: false, status: 404, error: "Workspace not found" };

  const primaryKeyword = ws.primaryKeyword;
  if (!primaryKeyword) {
    return {
      ok: false,
      status: 400,
      error: "Run Sitemap & Keywords first so primary keyword is saved for this workspace.",
    };
  }

  const secondaryKeywords = parseSecondary(ws.secondaryKeywords);
  const location = ws.location || "";
  const address = ws.address || "";

  const conn = await listConnections(normalized, wid);
  if (!conn.ok) return conn;

  const connected = (conn.accounts || []).filter((a) => a.publishReady);
  const byProvider = {};
  for (const a of connected) {
    if (!byProvider[a.provider]) byProvider[a.provider] = a;
  }

  const providers = Object.keys(PLATFORM_RULES).filter((p) => byProvider[p]);
  const skipped = Object.keys(PLATFORM_RULES)
    .filter((p) => !byProvider[p])
    .map((p) => ({
      provider: p,
      reason: "Not connected with OAuth (publish-ready)",
    }));

  if (!providers.length) {
    return {
      ok: false,
      status: 400,
      error:
        "No publish-ready social connections. Connect Facebook, Instagram, Google Business, or LinkedIn first.",
      skipped,
    };
  }

  const posts = {};
  let creditsLeft = user.remainingCredits;
  let totalCredits = 0;
  const usageParts = [];

  for (const provider of providers) {
    const rules = PLATFORM_RULES[provider];
    const prompt = buildPrompt({
      provider,
      primaryKeyword,
      secondaryKeywords,
      location,
      address,
      intent,
    });

    const result = await generateContent({
      email: normalized,
      action: rules.action,
      prompt,
      metadata: {
        suite: true,
        provider,
        intent,
        keyword: primaryKeyword,
        location,
      },
    });

    if (!result.ok) {
      return {
        ...result,
        posts,
        skipped,
        partial: Object.keys(posts).length > 0,
      };
    }

    let text = stripLinksAndEmojis(result.content || "");
    text = enforceWordLimit(text, rules.maxWords);

    posts[provider] = {
      provider,
      label: rules.label,
      content: text,
      maxWords: rules.maxWords,
      accountName: byProvider[provider]?.accountName || null,
      connectionId: byProvider[provider]?.id || null,
      creditsDeducted: result.creditsDeducted,
      usageDetails: result.usageDetails,
    };

    totalCredits += result.creditsDeducted || 0;
    creditsLeft = result.creditsLeft;
    usageParts.push(result.usageDetails);
  }

  // One shared image for the suite (Instagram publish needs it)
  let image = null;
  try {
    const imgPrompt = `Professional marketing photo for a local business social post. Topic: ${primaryKeyword}. Location vibe: ${location || "general"}. Clean, realistic, no text, no logos, no watermarks.`;
    image = await generateImage({ prompt: imgPrompt });
  } catch (err) {
    console.error("[socialSuite image]", err.message);
    image = { ok: false, error: err.message };
  }

  return {
    ok: true,
    workspaceId: wid,
    primaryKeyword,
    secondaryKeywords,
    location,
    intent,
    posts,
    skipped,
    imageUrl: image?.ok ? image.url : null,
    imageError: image?.ok ? null : image?.error || null,
    creditsDeducted: totalCredits,
    creditsLeft,
    usageParts,
  };
}
