/**
 * Avonix Social:
 * - Scan up to 15 page URLs in parallel
 * - Extract 1 primary + 1 secondary + 4 general keywords per page
 * - Generate FB / IG / LinkedIn / GMB posts by platform rules + tone
 * - Platform-sized realistic images
 * - Publish lock, schedule, rewrite
 */
import crypto from "crypto";
import {
  callOpenRouter,
  generateImage,
  sanitizeEnglishPost,
  persistImageUrl,
} from "../openrouter.js";
import {
  computeOverlayLayout,
  buildOverlaySvg,
  normalizeOverlayConfig,
} from "./imageOverlay.js";
import { resolveActiveWorkspace } from "./workspaceService.js";
import { publishContent } from "./publishService.js";
import {
  normalizeDomain,
  discoverSitemapUrls,
  urlPriority,
} from "./siteAnalyzer.js";
import {
  safeFetchText,
  mapWithConcurrency,
  assertSafeUrl,
  cacheGet,
  cacheSet,
  cacheStats,
} from "./crawlUtils.js";
import {
  persistInventory,
  getSelection,
  saveSelection,
  getSelectedForGeneration,
} from "./pageSelectionService.js";
import { selectBestStudioProviders } from "./studioProviderRouter.js";
import { enqueueJob, registerJobHandler } from "./jobQueue.js";
import { buildCta, buildGbpCallToAction } from "./ctaEngine.js";
import {
  resolveFreeImage,
  freeImageRateLimitPause,
  buildRelevantImagePrompt,
} from "./freeImageService.js";
import prisma from "../db.js";
import {
  GMB_CHAR,
  GMB_CATEGORY_IDS,
  GMB_RULESET_VERSION,
  buildGmbRefinePrompt,
  buildGmbSystemPrompt,
  buildGmbUserPrompt,
  detectVerifiedOffer,
  getGmbCategory,
  inferPageType,
  isGmbCategoryId,
  pickRelevantSourcePage,
  resolveGmbCta,
  gmbCtaInstruction,
  stripUnverifiedNap,
  ensureGmbHashtags,
  extractVerifiedServices,
  ensureFaqQuestionHook,
  uiCatalog as gmbUiCatalog,
} from "../content/gmbContentRules.js";
import { validateGmbPost, validateSocialPost } from "../content/gmbValidator.js";
import {
  varyOpening,
  replaceCliches,
  stripRoboticTransitions,
  reduceKeywordStuffing,
  scoreNaturalness,
} from "../content/naturalWriting.js";
import { scrubForeignIdentity } from "../content/identityIsolation.js";
import { getBrandVoice, buildVoicePromptBlock } from "./brandVoice.js";
import { findRecentSimilar, findMostSimilar } from "./similarityService.js";
import { createTimer, aggregateSummaries } from "./metrics.js";
import {
  countText as policyCountText,
  validateHashtags as policyValidateHashtags,
  policyFreshness,
} from "../content/platformPolicy.js";

async function stampPostActivity(userId, platform) {
  const data =
    platform === "GMB"
      ? { lastGbpPostAt: new Date() }
      : { lastSocialPostAt: new Date() };
  await prisma.user.update({ where: { id: userId }, data });
}

const FETCH_TIMEOUT_MS = Number(process.env.SITE_FETCH_TIMEOUT_MS || 10000);
// Fan-out cap for POST GENERATION (platforms × pages ⇒ credits). Kept modest
// but configurable; this is NOT the analysis cap.
const MAX_URLS = Number(process.env.STUDIO_MAX_GENERATE_PAGES || 15);
// Pages the ANALYSIS stage will crawl. This is the number that used to be
// wrongly pinned to 15; a 143-page site must be fully analysable.
const MAX_ANALYZE_URLS = Number(process.env.STUDIO_MAX_ANALYZE_PAGES || 150);
// Bounded concurrency for the per-page crawl/analyze stage.
const ANALYZE_CONCURRENCY = Number(process.env.STUDIO_ANALYZE_CONCURRENCY || 8);
// TTL for a cached whole-site analysis (ms).
const ANALYSIS_CACHE_TTL_MS = Number(process.env.STUDIO_ANALYSIS_CACHE_TTL_MS || 15 * 60 * 1000);

// ── Batch 4: duplicate-generation guard ──────────────────────────────────
// A single generation can take many seconds (AI text per page × platforms).
// A double-click / retry / impatient refresh must NOT spawn a second parallel
// run that creates duplicate drafts. We hold a short-lived in-flight lock
// keyed by the exact request shape; a concurrent duplicate is rejected with
// 409 instead of racing. (Durable cross-process jobs are Batch 5.)
const GENERATE_INFLIGHT = new Map(); // key -> startedAt (ms)
const GENERATE_INFLIGHT_TTL_MS = Number(process.env.STUDIO_GENERATE_LOCK_TTL_MS || 2 * 60 * 1000);

export function buildGenerateKey({ userId, wid, genOrigin, platforms, urls, prePages }) {
  const pageSig = Array.isArray(prePages) && prePages.length
    ? prePages.map((p) => p.url).sort().join(",")
    : Array.isArray(urls)
      ? [...urls].sort().join(",")
      : "";
  return [
    userId,
    wid || "",
    genOrigin || "",
    [...(platforms || [])].sort().join("+"),
    pageSig,
  ].join("::");
}

export function acquireGenerateLock(key) {
  const now = Date.now();
  const existing = GENERATE_INFLIGHT.get(key);
  if (existing && now - existing < GENERATE_INFLIGHT_TTL_MS) return false;
  GENERATE_INFLIGHT.set(key, now);
  return true;
}

export function releaseGenerateLock(key) {
  GENERATE_INFLIGHT.delete(key);
}

export const TONE_PRESETS = [
  "Professional",
  "Enthusiastic",
  "Empathetic",
  "Authoritative",
  "Storytelling",
];

const STOP_WORDS = new Set(
  `a an the and or but if in on at to for of from by with as is are was were be been being
  this that these those it its you your we our they their he she his her them
  not no yes do does did doing done have has had having will would can could should
  may might must shall about into over under again further then once here there when
  where why how all each few more most other some such only own same so than too very
  just also back new home page click learn read more contact us privacy terms
  cookie cookies login signup menu search copyright reserved rights website online
  get started today free best top`.split(/\s+/)
);

/**
 * Platform rules for SEO-led social posts.
 * minWords is a hard floor (never shorter). maxWords allows a small overshoot only.
 */
export const PLATFORM_CONFIG = {
  Facebook: {
    key: "facebook",
    minWords: 120,
    maxWords: 160,
    allowLinks: true,
    allowHashtags: true,
    // Link preview / feed — HD landscape
    image: { width: 1920, height: 1008, aspect: "16:9" },
  },
  Instagram: {
    key: "instagram",
    minWords: 70,
    maxWords: 100,
    allowLinks: false,
    allowHashtags: true,
    image: { width: 1080, height: 1080, aspect: "1:1" },
  },
  LinkedIn: {
    key: "linkedin",
    minWords: 150,
    maxWords: 200,
    allowLinks: true,
    allowHashtags: true,
    // LinkedIn shared image — HD landscape
    image: { width: 1920, height: 1005, aspect: "16:9" },
  },
  GMB: {
    key: "google_business",
    minWords: 90,
    maxWords: 180,
    minChars: GMB_CHAR.min,
    maxChars: GMB_CHAR.max,
    targetCharsMin: GMB_CHAR.targetMin,
    targetCharsMax: GMB_CHAR.targetMax,
    allowLinks: false,
    allowHashtags: true,
    image: { width: 1200, height: 900, aspect: "4:3" },
  },
  X: {
    key: "x",
    // X (Twitter) is char-capped at 280. Word bounds stay low so output fits;
    // the X path also hard-caps the final caption to maxChars.
    minWords: 18,
    maxWords: 38,
    minChars: 120,
    maxChars: 280,
    allowLinks: true,
    allowHashtags: true,
    // 16:9 in-stream image (optional on X)
    image: { width: 1600, height: 900, aspect: "16:9" },
  },
  Pinterest: {
    key: "pinterest",
    // Pin description — keyword-rich, image is mandatory (portrait 2:3).
    minWords: 20,
    maxWords: 70,
    maxChars: 500,
    allowLinks: true,
    allowHashtags: true,
    imageRequired: true,
    image: { width: 1000, height: 1500, aspect: "2:3" },
  },
};

/**
 * Per-platform VOICE / STYLE guide.
 *
 * PLATFORM_CONFIG above already enforces hard structural differences per
 * platform (word/char bounds, links, hashtags). This map adds the *editorial*
 * difference so the same topic reads distinctly on each network instead of
 * being duplicated verbatim — a LinkedIn post should not sound like an X post.
 * It is injected into the generation prompt (see generatePostContentWithAi).
 */
export const PLATFORM_STYLE = {
  Facebook:
    "Warm, conversational and community-first. Open with a relatable hook, keep it to 1–2 short paragraphs, and invite engagement with a light question or soft CTA. Friendly but still credible.",
  Instagram:
    "Punchy and visual-first. Lead with a scroll-stopping first line, use short snackable sentences with line breaks, keep it upbeat and aspirational, and finish with a tight CTA plus relevant hashtags.",
  LinkedIn:
    "Professional and insight-led. Share a clear point of view or practical takeaway in confident, value-driven language with short line breaks for readability. Credible and useful, never salesy or hype-y.",
  GMB:
    "Local-first and action-oriented, written for Google Business Profile readers near the business, highlighting the offer and a clear next step.",
  X:
    "Extremely concise and sharp. One strong idea with a bold hook and zero fluff. Must comfortably fit within 280 characters.",
  Pinterest:
    "Descriptive, keyword-rich and inspirational — written as a search-friendly Pin description that helps the image get discovered.",
};

/** Part 2 target platforms — 15 URLs × 6 platforms */
export const STUDIO_POST_PLATFORMS = [
  "Facebook",
  "Instagram",
  "LinkedIn",
  "GMB",
  "X",
  "Pinterest",
];

const TONE_OPENER = {
  Professional: "Here is a clear update from our team.",
  Enthusiastic: "We have something worth sharing.",
  Empathetic: "If you have been searching for the right fit, this is for you.",
  Authoritative: "Results matter — and consistency wins.",
  Storytelling: "Every strong brand starts with a clear next step.",
};

function fingerprintOf(url, platform, primary) {
  const raw = `${normalizeUrl(url)}|${platform}|${String(primary || "")
    .toLowerCase()
    .trim()}`;
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/** Denver, TX — not "Denver Tx" */
export function normalizeLocation(loc) {
  return String(loc || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase();
      return part
        .split(/\s+/)
        .map((w) => {
          if (/^[a-z]{2}$/i.test(w) && w.length === 2) return w.toUpperCase();
          return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        })
        .join(" ");
    })
    .join(", ");
}

function locationTokens(loc) {
  return String(loc || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

function phraseHasLocation(phrase, loc) {
  const p = String(phrase || "").toLowerCase();
  return locationTokens(loc).some((t) => t.length >= 3 && p.includes(t));
}

/** Fix "Logo Design Denver Tx" → align state casing with location */
function polishKeyword(kw, loc) {
  let s = String(kw || "").trim().replace(/\s+/g, " ");
  s = s.replace(/\b\w/g, (c) => c.toUpperCase());
  const state = String(loc || "").match(/,\s*([A-Za-z]{2})\s*$/);
  if (state) {
    const st = state[1].toUpperCase();
    s = s.replace(new RegExp(`\\b${state[1]}\\b`, "gi"), st);
  }
  s = s.replace(/\bSeo\b/g, "SEO").replace(/\bGbp\b/g, "GBP");
  return s;
}

/** "primary in Location" only when location is not already in the phrase */
function withLocation(phrase, loc) {
  const p = polishKeyword(phrase, loc);
  const place = normalizeLocation(loc);
  if (!place || phraseHasLocation(p, place)) return p;
  return `${p} in ${place}`;
}

/** Avoid "a Services" / "a Solutions" */
function asProvider(phrase) {
  const p = String(phrase || "").trim();
  if (!p) return "a trusted local team";
  if (/^(a|an|the|our)\s/i.test(p)) return p;
  if (/\b(services|solutions|products|designs|experts|agency|studio)\b/i.test(p)) {
    return p;
  }
  const an = /^[aeiou]/i.test(p);
  return `${an ? "an" : "a"} ${p}`;
}

function asOffering(phrase) {
  const p = String(phrase || "").trim();
  if (!p) return "premium service";
  if (/^(a|an|the|our)\s/i.test(p)) return p;
  return p;
}

function normalizeUrl(input) {
  let raw = String(input || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}

/** Root origin for grouping / archive tables, e.g. https://example.com */
export function websiteOriginFromUrl(input) {
  const n = normalizeUrl(input);
  if (!n) return null;
  try {
    const u = new URL(n);
    return `${u.protocol}//${u.host}`;
  } catch {
    return normalizeDomain(input);
  }
}

/**
 * SSRF-safe HTML fetch. Returns the response body, or null with the failure
 * reason exposed via the second element for accurate stats.
 */
async function fetchText(url) {
  const res = await safeFetchText(url, { timeoutMs: FETCH_TIMEOUT_MS, accept: "text/html,*/*" });
  return res.ok ? res.text : null;
}

/** Like fetchText but returns { html, reason } so callers can record failures. */
async function fetchHtmlDetailed(url) {
  const res = await safeFetchText(url, { timeoutMs: FETCH_TIMEOUT_MS, accept: "text/html,*/*" });
  return res.ok ? { html: res.text, reason: null } : { html: null, reason: res.reason };
}

function tagText(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = html.match(re);
  return m ? stripHtml(m[1]).slice(0, 300) : "";
}

function metaContent(html, name) {
  const re = new RegExp(
    `<meta[^>]*(?:name|property)=["'](?:og:)?${name}["'][^>]*content=["']([^"']+)["']`,
    "i"
  );
  const re2 = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:og:)?${name}["']`,
    "i"
  );
  return (html.match(re)?.[1] || html.match(re2)?.[1] || "").trim();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function ngrams(words, n) {
  const out = [];
  for (let i = 0; i <= words.length - n; i++) {
    out.push(words.slice(i, i + n).join(" "));
  }
  return out;
}

function pretty(s) {
  return String(s || "")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bSeo\b/g, "SEO")
    .replace(/\bGbp\b/g, "GBP");
}

function scorePageKeywords(page, location) {
  const scores = new Map();
  const bump = (phrase, w) => {
    if (!phrase || phrase.length < 3) return;
    scores.set(phrase, (scores.get(phrase) || 0) + w);
  };

  const titleWords = tokenize(page.title);
  const h1Words = tokenize(page.h1);
  const bodyWords = tokenize(page.bodyText).slice(0, 800);
  const descWords = tokenize(page.description);

  for (const g of ngrams(titleWords, 2)) bump(g, 8);
  for (const g of ngrams(titleWords, 3)) bump(g, 10);
  for (const w of titleWords) bump(w, 3);
  for (const g of ngrams(h1Words, 2)) bump(g, 7);
  for (const g of ngrams(h1Words, 3)) bump(g, 9);
  for (const w of h1Words) bump(w, 2.5);
  for (const g of ngrams(descWords, 2)) bump(g, 4);
  for (const g of ngrams(bodyWords, 2)) bump(g, 1.2);
  for (const g of ngrams(bodyWords, 3)) bump(g, 1.8);
  for (const w of bodyWords) bump(w, 0.3);

  const locToken = String(location || "")
    .split(",")[0]
    ?.trim()
    .toLowerCase();
  if (locToken) {
    for (const [p, s] of scores) {
      if (p.includes(locToken)) scores.set(p, s * 1.35);
    }
  }

  const ranked = [...scores.entries()]
    .filter(([p]) => p.split(/\s+/).length <= 5)
    .sort((a, b) => b[1] - a[1]);

  const multi = ranked.filter(([p]) => p.includes(" "));
  const pool = multi.length >= 5 ? multi : ranked;

  const primary = pool[0]?.[0] || page.h1 || page.title || "local business services";
  // Do not append location into primary — copy adds location cleanly when needed
  const rest = pool
    .slice(1)
    .map(([p]) => p)
    .filter((p) => p.toLowerCase() !== primary.toLowerCase());

  const secondary = [
    rest[0] || `custom ${primary}`,
    rest[1] || `${primary} experts`,
    rest[2] || "affordable packages",
    rest[3] || "local branding services",
  ]
    .slice(0, 4)
    .map((k) => polishKeyword(k, location));

  return {
    primary: polishKeyword(primary, location),
    /** @deprecated prefer secondary[0] — kept for post templates */
    secondary: secondary[0],
    /** Exactly 4 secondary keywords (user + SEO pack) */
    secondaryKeywords: secondary,
    general: secondary,
  };
}

/**
 * Infer page writing intent from URL path + on-page signals.
 */
function inferWritingIntent(page) {
  const path = (() => {
    try {
      return new URL(page.url).pathname.toLowerCase();
    } catch {
      return String(page.url || "").toLowerCase();
    }
  })();
  const blob = `${page.title} ${page.h1} ${page.description}`.toLowerCase();

  if (/\/(contact|get-in-touch|book|quote|appointment)/.test(path) || /\bcontact\b|\bget a quote\b/.test(blob)) {
    return {
      intent: "Conversion",
      masterIntent:
        "Drive inquiries and bookings — clear CTA, trust signals, low friction next step.",
    };
  }
  if (/\/(about|team|story|who-we-are)/.test(path) || /\babout us\b|\bour story\b/.test(blob)) {
    return {
      intent: "Brand Trust",
      masterIntent:
        "Build credibility — experience, values, and why the brand is the safer local choice.",
    };
  }
  if (/\/(blog|news|article|insights?|guide|tips)/.test(path) || /\bhow to\b|\bguide\b|\btips\b/.test(blob)) {
    return {
      intent: "Educational",
      masterIntent:
        "Teach a useful takeaway — authority content that ranks and nurtures consideration.",
    };
  }
  if (/\/(pricing|packages?|cost|rates)/.test(path) || /\bpricing\b|\bpackages?\b/.test(blob)) {
    return {
      intent: "Commercial",
      masterIntent:
        "Clarify value vs cost — packages, outcomes, and why the investment pays off locally.",
    };
  }
  if (/\/(services?|solutions?|what-we-do|offerings?)/.test(path) || /\bservices?\b|\bsolutions?\b/.test(blob)) {
    return {
      intent: "Service Sell",
      masterIntent:
        "Sell the service clearly — problem → solution → proof → soft CTA for the service area.",
    };
  }
  if (/\/(locations?|areas?-we-serve|service-area|near-me)/.test(path)) {
    return {
      intent: "Local Coverage",
      masterIntent:
        "Reinforce geographic coverage — neighborhoods served and why locals choose this provider.",
    };
  }
  if (path === "/" || path === "") {
    return {
      intent: "Brand Overview",
      masterIntent:
        "Introduce the brand in one hook — who you help, where you serve, and the primary offer.",
    };
  }
  return {
    intent: "Awareness",
    masterIntent:
      "Grow awareness for the page topic — keyword-led, helpful, and shareable for social.",
  };
}

/**
 * Extract area / service-coverage hints from page copy.
 */
function inferAreaCoverage(page, fallbackLocation) {
  const text = `${page.title} ${page.h1} ${page.description} ${String(page.bodyText || "").slice(0, 2500)}`;
  const found = new Set();

  const cityState = text.match(
    /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*([A-Z]{2})\b/g
  );
  if (cityState) {
    for (const m of cityState.slice(0, 6)) found.add(m.trim());
  }

  const serving = text.match(
    /(?:serving|based in|located in|areas? we serve|service area(?:s)?)\s*[:\-]?\s*([A-Za-z0-9,\s&.-]{4,80})/gi
  );
  if (serving) {
    for (const m of serving.slice(0, 4)) {
      const cleaned = m.replace(/^[^:]+:\s*/i, "").replace(/^(serving|based in|located in|areas? we serve|service area(?:s)?)\s*/i, "").trim();
      if (cleaned.length >= 4) found.add(cleaned.slice(0, 80));
    }
  }

  const list = [...found];
  if (!list.length && fallbackLocation) list.push(normalizeLocation(fallbackLocation));
  return {
    areas: list.slice(0, 8),
    summary: list.length
      ? list.slice(0, 4).join(" · ")
      : fallbackLocation
        ? normalizeLocation(fallbackLocation)
        : "Coverage not detected — set target location manually",
  };
}

async function refineKeywordsWithAi(page, location, heuristic) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  try {
    const data = await callOpenRouter({
      model: process.env.KEYWORD_MODEL || "openai/gpt-4o-mini",
      maxTokens: 360,
      messages: [
        {
          role: "system",
          content:
            "You are an SEO + generative-AI keyword analyst. Return ONLY JSON: {primary:string, secondary:[exactly 4 strings], writingIntent:string, masterIntent:string, areaCoverage:string}. Prefer commercial Google search intent. No markdown.",
        },
        {
          role: "user",
          content: `URL: ${page.url}
Location: ${location || "n/a"}
Title: ${page.title}
H1: ${page.h1}
Description: ${page.description}
Body sample: ${page.bodyText.slice(0, 1800)}
Heuristic guess: ${JSON.stringify({
            primary: heuristic.primary,
            secondary: heuristic.secondaryKeywords || heuristic.general,
          })}

Pick 1 primary keyword and exactly 4 secondary keywords best for Google + AI Overviews.
Also set writingIntent (short label) and masterIntent (1 sentence for social copy direction).
areaCoverage = city/region phrase for this page.`,
        },
      ],
    });

    const content = data?.choices?.[0]?.message?.content || "";
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const secondaryRaw = Array.isArray(parsed.secondary)
      ? parsed.secondary
      : [parsed.secondary, ...(parsed.general || [])].filter(Boolean);
    const secondary = secondaryRaw
      .map((k) => polishKeyword(String(k).trim(), location))
      .filter(Boolean)
      .slice(0, 4);
    while (secondary.length < 4) {
      secondary.push(
        polishKeyword(
          heuristic.secondaryKeywords?.[secondary.length] ||
            `${parsed.primary || heuristic.primary} tip ${secondary.length + 1}`,
          location
        )
      );
    }
    if (!parsed.primary) return null;
    return {
      primary: polishKeyword(parsed.primary, location),
      secondary: secondary[0],
      secondaryKeywords: secondary,
      general: secondary,
      writingIntent: String(parsed.writingIntent || "").trim() || null,
      masterIntent: String(parsed.masterIntent || "").trim() || null,
      areaCoverage: String(parsed.areaCoverage || "").trim() || null,
    };
  } catch (err) {
    console.error("[autoPoster keywords AI]", err.message);
    return null;
  }
}

function keywordLinkHtml(url, keyword) {
  // Deprecated for social publish — platforms do not keep inline rich links in the caption.
  // Kept for any legacy callers; prefer plain CTA lines instead.
  return String(keyword || "");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Preview HTML = escaped plain text (no <a> tags). UI uses whitespace-pre-wrap. */
function plainToPreviewHtml(text) {
  return escapeHtml(text);
}

function stripInlineHtmlLinks(text) {
  return String(text || "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<\/?[^>]+>/g, "");
}

/** Strip CTA blocks, raw URLs, and hashtag lines so padding runs on body copy only. */
function stripCtaHashtagsAndUrls(text) {
  let out = String(text || "").trim();
  out = out.replace(/(?:^|\n)\s*(?:#[A-Za-z0-9_]+(?:\s+#[A-Za-z0-9_]+)*)\s*(?=\n|$)/g, "\n");
  out = out.replace(
    /(?:^|\n)\s*(?:Learn more|Discover more|See the full|Explore options|Explore how|Ready to|Want the details|Compare how|Compare options|Book a|Read the full|Get the details|See how we)[^\n]*\n?\s*https?:\/\/\S+\s*/gi,
    "\n"
  );
  out = out.replace(/(?:^|\n)\s*https?:\/\/\S+\s*/gi, "\n");
  out = out.replace(/\n*Learn more:\s*[^\n]*/gi, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

/**
 * Relevant bottom CTA for platforms that allow links (Facebook / LinkedIn).
 * Instagram captions cannot use links — bio only.
 */
function buildBottomCta({ platform, url, primary, place, writingIntent }) {
  const topic = String(primary || "our services").trim();
  const where = String(place || "").trim();
  const intent = String(writingIntent || "Awareness").toLowerCase();
  const localHint = where && !phraseHasLocation(topic, where) ? ` in ${where}` : "";

  let line = "";
  if (platform === "LinkedIn") {
    if (/convert|transaction|lead|book|buy/i.test(intent)) {
      line = `Ready to talk about ${topic}${localHint}? See the full overview:`;
    } else if (/consider|compare|evaluat/i.test(intent)) {
      line = `Compare how we support teams with ${topic}${localHint}:`;
    } else {
      line = `See how we approach ${topic}${localHint}:`;
    }
  } else {
    // Facebook (and any other link-allowed feed)
    if (/convert|transaction|lead|book|buy/i.test(intent)) {
      line = `Ready to get started with ${topic}${localHint}?`;
    } else if (/consider|compare|evaluat/i.test(intent)) {
      line = `Explore options for ${topic}${localHint}:`;
    } else if (/service|support|help/i.test(intent)) {
      line = `Want the details on ${topic}${localHint}?`;
    } else {
      line = `Discover more about ${topic}${localHint}:`;
    }
  }

  return `${line}\n${url}`.trim();
}

/**
 * Facebook / LinkedIn: relevant plain-URL CTA at the bottom — not keyword hyperlinks.
 * Instagram: hashtags + square image (no caption links).
 * Hashtags only on platforms that support them.
 */
function finalizeSocialCaption(
  body,
  { platform, url, primary, secondary, place, writingIntent }
) {
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.Facebook;
  let out = stripCtaHashtagsAndUrls(stripInlineHtmlLinks(body));

  if (cfg.allowLinks && url) {
    const cleanUrl = String(url).trim();
    if (cleanUrl) {
      out = `${out}\n\n${buildBottomCta({
        platform,
        url: cleanUrl,
        primary,
        place,
        writingIntent,
      })}`.trim();
    }
  }

  if (cfg.allowHashtags) {
    const tags =
      platform === "LinkedIn"
        ? hashtagify("BusinessGrowth", primary, "Leadership", place)
        : platform === "Instagram"
          ? hashtagify(
              primary,
              secondary,
              place,
              "LocalBusiness",
              "SmallBusiness",
              "InstagramMarketing"
            )
          : hashtagify(place, primary, secondary || "LocalSEO");
    if (tags) out = `${out}\n\n${tags}`.trim();
  }

  return out;
}

function hashtagify(...parts) {
  return parts
    .map((p) =>
      String(p || "")
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, "")
    )
    .filter(Boolean)
    .map((t) => `#${t}`)
    .join(" ");
}

function stripTags(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * P1 — split a finalized social caption into its editorial BODY and its
 * trailing TAIL (CTA line + URL + hashtag line). Humanization must only touch
 * the body so the CTA/URL/hashtags the platform depends on are never mangled.
 */
const CTA_OPENER_RE =
  /^(discover more|see how|explore options|explore how|want the details|ready to|compare how|compare options|see the full|ready to talk|save this|link in|get the details|read the full)/i;

function splitBodyTail(content) {
  const paras = String(content || "").split(/\n{2,}/);
  let tailStart = paras.length;
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i].trim();
    if (/https?:\/\//i.test(p) || /^#/.test(p) || CTA_OPENER_RE.test(p)) {
      tailStart = i;
      break;
    }
  }
  return {
    body: paras.slice(0, tailStart).join("\n\n"),
    tail: paras.slice(tailStart).join("\n\n"),
  };
}

/**
 * P1 — natural-writing + identity-isolation polish for a non-GMB caption.
 * Removes foreign-identity leakage, strips the owner's personal name, and
 * humanizes the body (vary generic openings, drop clichés + robotic
 * transitions, reduce keyword stuffing) WITHOUT changing the CTA/URL/hashtags
 * and WITHOUT dropping below the platform's minimum word floor.
 */
function polishSocialCopy(
  content,
  { platform, keywords = {}, origin = null, foreignNames = [], ownerName = "", seed = "", minWords = 0 } = {}
) {
  let text = scrubForeignIdentity(String(content || ""), { ownOrigin: origin, foreignNames });
  if (ownerName) text = stripOwnerNameFromContent(text, ownerName);

  const { body, tail } = splitBodyTail(text);
  const secondaryKeywords =
    keywords.secondaryKeywords || keywords.general || (keywords.secondary ? [keywords.secondary] : []);

  // Length-SAFE transforms first (these roughly preserve word count): vary a
  // generic opening, drop clichés + robotic transitions. These always apply so
  // a templated opening is never left in place.
  let safeBody = replaceCliches(body);
  safeBody = stripRoboticTransitions(safeBody);
  safeBody = varyOpening(safeBody, { topic: keywords.primary || "", seed });

  // Aggressive transform (may shorten): reduce keyword stuffing. Only keep it if
  // it does not push the body below the platform's SEO word floor.
  let reducedBody = safeBody;
  for (const ph of [keywords.primary, ...secondaryKeywords].filter(Boolean)) {
    reducedBody = reduceKeywordStuffing(reducedBody, ph);
  }
  const chosenBody =
    minWords && countWords(reducedBody) < minWords && countWords(safeBody) >= minWords
      ? safeBody
      : reducedBody;

  return (tail ? `${chosenBody}\n\n${tail}` : chosenBody).trim();
}

/**
 * P1 — apply the social polish to a generation result and refresh its derived
 * fields + naturalness score. No-op for GMB (handled in its own pipeline) and
 * for falsy results.
 */
function finalizeNonGmbResult(res, ctx) {
  if (!res || ctx.platform === "GMB" || res.error) return res;
  const cfg = PLATFORM_CONFIG[ctx.platform] || PLATFORM_CONFIG.Facebook;
  let content = polishSocialCopy(res.content, {
    platform: ctx.platform,
    keywords: ctx.keywords,
    origin: ctx.origin,
    foreignNames: ctx.foreignNames,
    ownerName: ctx.ownerName,
    seed: ctx.seed,
    minWords: cfg.minWords,
  });
  if (ctx.platform === "X" && cfg.maxChars && countChars(content) > cfg.maxChars) {
    const sliced = content.slice(0, cfg.maxChars);
    const cut = sliced.lastIndexOf(" ");
    content = (cut > 0 ? sliced.slice(0, cut) : sliced).trim();
  }
  const naturalness = scoreNaturalness(content, { keywords: ctx.keywords });
  return {
    ...res,
    content,
    contentHtml: plainToPreviewHtml(content),
    wordCount: countWords(content),
    charCount: countChars(content),
    validation: { ...(res.validation || {}), naturalness },
  };
}

export function countWords(text) {
  const plain = stripTags(text);
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

export function countChars(text) {
  return String(text || "").length;
}

function unpackKeywordPack(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    if (Array.isArray(v)) return { keywords: v.map(String), meta: {} };
    if (v && typeof v === "object") {
      const keywords = Array.isArray(v.keywords)
        ? v.keywords.map(String)
        : [];
      return { keywords, meta: v };
    }
  } catch {
    /* ignore */
  }
  return { keywords: [], meta: {} };
}

function packKeywordPack(keywords, meta = {}) {
  return JSON.stringify({
    keywords: (keywords || []).map(String).slice(0, 8),
    gmbCategory: meta.gmbCategory || null,
    cta: meta.cta || null,
    sourceTitle: meta.sourceTitle || null,
    validation: meta.validation || null,
    ruleset: meta.ruleset || GMB_RULESET_VERSION,
  });
}

/**
 * Normalize a human name for comparison (lowercase, collapse whitespace).
 */
function normalizeName(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Remove the authenticated account owner's personal name from generated copy.
 * The owner is the app user, NOT the business's verified provider — their name
 * must never appear in marketing content unless the website independently
 * verifies it (which we do not assume here). Defense-in-depth against the model
 * echoing a name that leaked in through context.
 */
export function stripOwnerNameFromContent(text, ownerName) {
  const owner = String(ownerName || "").trim();
  if (!text || owner.length < 3) return text;
  let out = String(text);
  const variants = new Set([owner]);
  const parts = owner.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) variants.add(parts.join(" "));
  // Also strip distinctive individual name tokens (length >= 5) so a lone
  // first/last name of the OWNER cannot slip through (e.g. "Mostafij's clinic").
  // Short, common tokens (<5) are left alone to avoid over-stripping.
  for (const part of parts) {
    if (part.length >= 5) variants.add(part);
  }
  // Longest-first so full-name variants are removed before partials.
  const ordered = [...variants].sort((a, b) => b.length - a.length);
  for (const v of ordered) {
    if (v.length < 3) continue;
    const esc = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Remove possessive and plain occurrences, tidy leftover punctuation/space.
    // Consume trailing spaces/tabs only (NOT newlines) so a removal never
    // collapses a paragraph break into the next line.
    out = out.replace(new RegExp(`\\b${esc}'?s?\\b[,:;\\-]?[ \\t]*`, "gi"), "");
  }
  // Collapse only horizontal whitespace runs — preserve newlines / paragraph
  // structure (GMB NAP + hashtag lines, social CTA/hashtag blocks) which later
  // steps (splitBodyTail, hashtag parsing) depend on.
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

async function resolveBusinessContext(userId, workspaceId, workspace, ownerName = "") {
  const owner = normalizeName(ownerName);
  // The business name must come from a VERIFIED source (an explicit workspace
  // business name or GBP), never the account owner's personal name.
  const workspaceName = String(workspace?.name || "").trim();
  const workspaceNameIsOwner = owner && normalizeName(workspaceName) === owner;
  const business = {
    name: workspaceNameIsOwner ? "" : workspaceName,
    nameVerified: false,
    address: workspace?.address || "",
    city: workspace?.location || "",
    phone: "",
    hours: "",
    differentiators: "",
  };
  try {
    const gbp = await prisma.connectedAccount.findFirst({
      where: {
        userId,
        provider: "google_business",
        ...(workspaceId ? { workspaceId } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });
    if (gbp) {
      let meta = {};
      try {
        meta = gbp.metadata ? JSON.parse(gbp.metadata) : {};
      } catch {
        meta = {};
      }
      const verifiedName = meta.locationName || meta.locationTitle || gbp.accountName || "";
      // A GBP-verified name is authoritative — but still never the owner's name.
      if (verifiedName && normalizeName(verifiedName) !== owner) {
        business.name = verifiedName;
        business.nameVerified = true;
      }
      business.address = meta.address || meta.formattedAddress || business.address;
      business.phone = meta.phone || meta.primaryPhone || business.phone;
      business.hours = meta.hours || meta.regularHours || business.hours;
    }
  } catch {
    /* optional */
  }
  return business;
}

/**
 * P1 — names of OTHER businesses the same user manages (sibling workspaces +
 * other connected GBP locations), so identity isolation can scrub a foreign
 * business name that might leak into this website's copy. The CURRENT business
 * name / workspace is always excluded.
 */
async function resolveForeignBusinessNames(userId, currentWorkspaceId, currentBusinessName = "") {
  if (!userId) return [];
  const current = normalizeName(currentBusinessName);
  const names = new Set();
  try {
    const workspaces = await prisma.clientWorkspace.findMany({
      where: { userId, ...(currentWorkspaceId ? { id: { not: currentWorkspaceId } } : {}) },
      select: { name: true },
    });
    for (const w of workspaces) {
      const n = String(w.name || "").trim();
      if (n.length >= 3 && normalizeName(n) !== current) names.add(n);
    }
    const accounts = await prisma.connectedAccount.findMany({
      where: {
        userId,
        provider: "google_business",
        ...(currentWorkspaceId ? { workspaceId: { not: currentWorkspaceId } } : {}),
      },
      select: { accountName: true, metadata: true },
    });
    for (const a of accounts) {
      let meta = {};
      try {
        meta = a.metadata ? JSON.parse(a.metadata) : {};
      } catch {
        meta = {};
      }
      const n = String(meta.locationTitle || meta.locationName || a.accountName || "").trim();
      if (n.length >= 3 && normalizeName(n) !== current) names.add(n);
    }
  } catch {
    /* non-fatal — isolation still covers URLs/domains + owner name */
  }
  return [...names];
}

/**
 * P1 — generate one post, then compare it against RECENT posts for the same
 * website + platform and revise ONLY when meaningful duplication is detected.
 * Similarity + optional revision + per-stage timing are recorded on the result.
 */
async function generatePostWithDedup({ platform, keywords, location, url, tone, options, dedup = {} }) {
  const timer = createTimer(`gen:${platform}`);
  let postData = await generatePostContentWithAi(platform, keywords, location, url, tone, options);
  timer.mark("ai_text");
  if (postData?.error) {
    postData.__timing = timer.end();
    return postData;
  }

  let sim = { duplicate: false, maxScore: 0, mostSimilar: null, comparedCount: 0 };
  if (dedup.userId && postData.content) {
    try {
      sim = await findRecentSimilar({
        userId: dedup.userId,
        workspaceId: dedup.workspaceId,
        websiteOrigin: dedup.websiteOrigin,
        platform,
        content: postData.content,
      });
    } catch (err) {
      console.error("[generatePostWithDedup similarity]", err.message);
    }
  }
  timer.mark("similarity");

  let revised = false;
  if (
    sim.duplicate &&
    platform !== "GMB" &&
    options.writingModel &&
    process.env.OPENROUTER_API_KEY
  ) {
    try {
      const retry = await generatePostContentWithAi(platform, keywords, location, url, tone, {
        ...options,
        avoidSample: sim.mostSimilar?.content,
      });
      if (retry && !retry.error) {
        const after = findMostSimilar(
          retry.content,
          sim.mostSimilar ? [sim.mostSimilar] : []
        );
        if (after.maxScore < sim.maxScore) {
          postData = retry;
          revised = true;
          sim.maxScore = after.maxScore;
        }
      }
    } catch (err) {
      console.error("[generatePostWithDedup revise]", err.message);
    }
    timer.mark("dedup_revise");
  }

  postData.validation = {
    ...(postData.validation || {}),
    similarity: {
      maxScore: Math.round(sim.maxScore * 1000) / 1000,
      duplicate: sim.duplicate,
      revised,
      mostSimilarId: sim.mostSimilar?.id || null,
      comparedCount: sim.comparedCount || 0,
    },
  };
  postData.__timing = timer.end();
  return postData;
}

function buildGmbTemplatePost({
  categoryId,
  keywords,
  location,
  url,
  business = {},
  sourceTitle,
  sourcePage,
  selectedPages,
  allowedServices,
}) {
  const cat = getGmbCategory(categoryId);
  const place = normalizeLocation(location) || "your area";
  const primary = polishKeyword(keywords.primary, place);
  let services = extractVerifiedServices({
    keywords,
    sourcePage: sourcePage || { title: sourceTitle, url, keywords },
    selectedPages: selectedPages || [],
    business,
  });
  // Honour an explicit user service selection when one was persisted: only
  // services the user kept selected may surface in generated content.
  if (allowedServices && allowedServices.size) {
    const filtered = services.filter((s) => allowedServices.has(String(s).toLowerCase()));
    if (filtered.length) services = filtered;
  }
  const cta = resolveGmbCta(categoryId, business);
  const name = String(business.name || "").trim();
  const address = String(business.address || "").trim();
  const phone = String(business.phone || "").trim();
  const hours = String(business.hours || "").trim();
  const city = String(place).split(",")[0].trim() || place;
  const displayName = name || "Our team";

  const nap = [name, address, phone, hours].filter(Boolean).join("\n");
  const ctaLine = gmbCtaInstruction(cta);

  const cityTag = city.replace(/[^\w]/g, "");
  const svcTag = primary.replace(/[^\w]/g, "");
  const tags = [`#${cityTag}`, `#${svcTag}`, `#${cityTag}NearMe`, `#Local${svcTag}`, `#${cityTag}Local`]
    .filter((t) => t.length > 2)
    .slice(0, 5)
    .join(" ");

  let heading = "";
  let body = "";
  const serviceBlock = services.length
    ? `Core services:\n${services.map((s) => `• ${s}`).join("\n")}`
    : "";

  if (cat.id === GMB_CATEGORY_IDS.INTENT_PROXIMITY) {
    heading = `Looking for ${primary} near you in ${city}?`;
    body = `${heading} ${displayName} is ready to help nearby customers in ${place} who need ${primary} today.

We serve local families and businesses around ${city} with clear communication and practical next steps.${hours ? ` Hours: ${hours}.` : ""}
${serviceBlock ? `\n${serviceBlock}\n` : ""}
Why choose us: our ${city} team focuses on reliable ${primary}${services[0] ? ` and ${services[0]}` : ""}, with straightforward guidance from the first call. We do not make unverified ranking claims — we let verified work and local availability speak for us.

${nap}

${ctaLine}

${tags}`;
  } else if (cat.id === GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT) {
    heading = `Special ${primary} offer in ${city}`;
    body = `${heading}: see the verified details from our ${sourceTitle || "service"} page${name ? ` and visit ${name}` : ""} to learn what currently applies.

If a promotion, package, or event is listed on the selected website pages, our team will confirm eligibility, dates, and any limits before you redeem. We will not invent discounts or expiration dates.

How to redeem:
• Call or visit our ${city} location
• Mention this Google post
• Ask which verified offer is active
• Follow any posted registration steps

This opportunity is for customers in and around ${place}.

${nap}

${ctaLine}

${tags}`;
  } else if (cat.id === GMB_CATEGORY_IDS.AUTHORITY_TRUST_PROOF) {
    heading = `Why ${city} customers choose ${displayName} for ${primary}`;
    body = `${heading}. Choosing the right local provider matters when you need ${primary} you can trust.

Our team focuses on verified capabilities described on the selected website pages — training, process, and on-site support when those facts are published. We will not invent ratings, certifications, years of experience, or awards.

Customer benefit: a clearer process, local access in ${city}, and practical help with ${services[0] || primary} without unsupported guarantees.

Neighbors across ${place} can reach us for ${primary}${services.length ? ` and related needs such as ${services.slice(0, 3).join(", ")}` : ""}.

${nap}

${ctaLine}

${tags}`;
  } else {
    heading = `When should you get help with ${primary} in ${city}?`;
    body = `${heading} If you are searching for clear, local guidance, here is a straightforward answer${name ? ` from ${name}` : ""}.

Most people need professional ${primary} when the problem is recurring, urgent, or beyond a simple home or DIY fix. Use the selected website page for the detailed process that applies to your situation.

Helpful tips:
• Note your symptoms, timing, or project scope
• Check whether same-day or scheduled help is available
• Ask what to bring or prepare before you visit
• Call if you are unsure whether you need ${primary} now

Our ${city} team is here if you need professional ${primary} in ${place}.

${nap}

${ctaLine}

${tags}`;
  }

  body = body.replace(/\n{3,}/g, "\n\n").trim();
  body = padGmbToTarget(body, {
    primary,
    place,
    name: displayName,
    services,
    ctaLine,
  });
  return { heading, content: body, cta };
}

function padGmbToTarget(text, { primary, place, name, services, ctaLine }) {
  let body = String(text || "").trim();
  const hashMatch = body.match(/(\n\n(?:#[A-Za-z0-9_]+(?:\s+#[A-Za-z0-9_]+)+)\s*)$/);
  const tags = hashMatch ? hashMatch[1] : "";
  if (tags) body = body.slice(0, -tags.length).trim();

  const verifiedBits = [
    place && primary && `${primary} for people in ${place} starts with a clear local next step.`.trim(),
    ctaLine,
    name && place && primary && `${name} helps customers looking for ${primary} in ${place}.`,
  ].filter(Boolean);

  let i = 0;
  while (body.length + tags.length < GMB_CHAR.targetMin && i < 12 && verifiedBits.length) {
    const extra = verifiedBits[i % verifiedBits.length];
    const projected = body.length + 2 + extra.length + tags.length;
    if (projected > GMB_CHAR.max) break;
    body = `${body}\n\n${extra}`.trim();
    i += 1;
  }

  let combined = `${body}${tags}`.trim();
  if (combined.length < GMB_CHAR.targetMin && place && primary) {
    const filler = ` Local ${primary} in ${place}.`;
    while (combined.length < GMB_CHAR.targetMin) {
      const room = Math.min(GMB_CHAR.max - combined.length, GMB_CHAR.targetMin - combined.length);
      if (room < 8) break;
      const next = filler.slice(0, Math.min(filler.length, room));
      if (!next) break;
      combined += next;
    }
  }
  if (combined.length > GMB_CHAR.max) {
    combined = `${body}${tags}`.trim();
  }
  return combined;
}

function enforceMaxWords(text, max) {
  const paragraphs = String(text || "")
    .trim()
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  let count = 0;
  const out = [];
  for (const para of paragraphs) {
    const words = stripTags(para).split(/\s+/).filter(Boolean);
    const rawWords = para.split(/\s+/).filter(Boolean);
    if (count >= max) break;
    if (count + words.length <= max) {
      out.push(rawWords.join(" "));
      count += words.length;
    } else {
      const keep = Math.max(0, max - count);
      out.push(rawWords.slice(0, keep).join(" "));
      break;
    }
  }
  return out.join("\n\n");
}

/** Expand body until it meets minWords (SEO floor). Never leave content shorter than min. */
function padToMinWords(text, min, ctx) {
  let body = String(text || "").trim();
  if (countWords(body) >= min) return body;

  const { primary, secondary, offering, proof, promo, place, provider } = ctx;
  const pads = [
    `Businesses searching for ${primary} in ${place} need clear answers, reliable delivery, and proof that the work will last. That is why our process starts with listening, then moves into a practical plan built around ${secondary}.`,
    `We emphasize ${offering} so every project stays on brief, on timeline, and aligned with local search intent. Clients also value ${proof}, which helps convert browsers into booked conversations.`,
    `If you are comparing options for ${promo}, ask about scope, materials or methods, communication cadence, and how success is measured after launch. Strong ${provider} support reduces rework and protects your ranking signals over time.`,
    `Consistent publishing around ${primary} and ${secondary} helps search engines and customers understand what you do, where you serve, and why your offer is relevant in ${place}. Reach out when you are ready for the next step.`,
  ];

  for (const para of pads) {
    if (countWords(body) >= min) break;
    body = `${body}\n\n${para}`.trim();
  }

  while (countWords(body) < min) {
    body = `${body} ${primary} in ${place} pairs naturally with ${secondary} for customers who want dependable ${offering}.`.trim();
  }
  return body;
}

/**
 * Professional heading + SEO body per platform (hard min word count).
 * Follows page masterIntent / writingIntent when provided.
 */
export function generatePostContent(platform, keywords, location, url, tone, options = {}) {
  const place = normalizeLocation(location) || "your area";
  const primary = polishKeyword(keywords.primary, place);
  const secondaryList = (
    keywords.secondaryKeywords ||
    keywords.general ||
    [keywords.secondary]
  )
    .map((x) => polishKeyword(x, place))
    .filter(Boolean);
  if (platform !== "GMB") {
    while (secondaryList.length < 4) {
      secondaryList.push(polishKeyword(`${primary} related ${secondaryList.length + 1}`, place));
    }
  }
  const secondary = secondaryList[0];
  const g = secondaryList.slice();

  const cfg = PLATFORM_CONFIG[platform];
  const opener = TONE_OPENER[tone] || TONE_OPENER.Professional;
  const primaryLocal = withLocation(primary, place);
  const provider = asProvider(g[0]);
  const offering = asOffering(g[1]);
  const proof = asOffering(g[2]);
  const promo = asOffering(g[3]);
  const padCtx = { primary, secondary, offering, proof, promo, place, provider };

  const writingIntent = String(options.writingIntent || "Awareness").trim();
  const masterIntent = String(
    options.masterIntent ||
      `Publish keyword-led updates for ${primary} that match ${writingIntent} intent in ${place}.`
  ).trim();
  const intentLead = `Intent focus (${writingIntent}): ${masterIntent}`;

  let heading = "";
  let plain = "";
  let html = "";

  if (platform === "Facebook") {
    heading = `Discover ${primaryLocal}`;
    plain = `${opener}

${intentLead}

Looking for ${secondary}? Our team in ${place} delivers ${offering} with care, clarity, and a process built for local search visibility. Customers choose us when they need dependable ${proof} without guesswork.

We help people comparing ${promo} understand scope, timeline, and expected outcomes up front. That transparency builds trust and supports stronger rankings for ${primary} queries across ${place}.

Explore how ${provider} support can move your project forward, then take the next step with a clear call to action.`;
    plain = finalizeSocialCaption(plain, {
      platform: "Facebook",
      url,
      primary,
      secondary,
      place,
      writingIntent,
    });
    html = plainToPreviewHtml(plain);
  } else if (platform === "Instagram") {
    heading = `${primary} — crafted with care`;
    plain = `${opener}

${intentLead}

${secondary} for businesses and homeowners in ${place}.

We focus on ${offering} and ${proof}, so every detail supports both real-world results and search-friendly messaging around ${primary}. Ready for ${promo}?

Save this post, share it with someone who needs ${provider} help, and check the link in bio for the full story.`;
    plain = finalizeSocialCaption(plain, {
      platform: "Instagram",
      url,
      primary,
      secondary,
      place,
      writingIntent,
    });
    html = plainToPreviewHtml(plain);
  } else if (platform === "LinkedIn") {
    heading = phraseHasLocation(primary, place)
      ? `${primary} — practical value for growing teams`
      : `${primary} for teams in ${place}`;
    const bridge =
      tone === "Storytelling"
        ? "Strong brands are built through clear positioning, useful content, and steady execution in the markets they serve."
        : "In competitive markets, clear positioning, useful content, and reliable delivery separate category leaders from everyone else.";
    plain = `${opener} ${bridge}

${intentLead}

We support organizations with ${offering}, backed by ${proof}. Our specialists help clients move from idea to polished identity through ${provider}, while aligning messaging to high-intent searches for ${primary} and ${secondary} in ${place}.

Leaders evaluating ${promo} should prioritize process transparency, measurable milestones, and content that reinforces topical authority. That combination improves both customer trust and organic discoverability.`;
    plain = finalizeSocialCaption(plain, {
      platform: "LinkedIn",
      url,
      primary,
      secondary,
      place,
      writingIntent,
    });
    html = plainToPreviewHtml(plain);
  } else if (platform === "X") {
    // X (Twitter) — one tight, keyword-led line. Capped to 280 chars after range.
    heading = primaryLocal;
    plain = `${secondary || primary} in ${place} — ${offering} backed by ${proof}. Built for people searching ${primary}.`;
    plain = finalizeSocialCaption(plain, {
      platform: "X",
      url,
      primary,
      secondary,
      place,
      writingIntent,
    });
    html = plainToPreviewHtml(plain);
  } else if (platform === "Pinterest") {
    // Pinterest — keyword-rich pin description (image required, portrait 2:3).
    heading = primaryLocal;
    plain = `${secondary || primary} in ${place}.

${offering} backed by ${proof} — a practical look for anyone exploring ${primary} and ${promo}. Save this pin and tap through for the full guide.`;
    plain = finalizeSocialCaption(plain, {
      platform: "Pinterest",
      url,
      primary,
      secondary,
      place,
      writingIntent,
    });
    html = plainToPreviewHtml(plain);
  } else {
    // GMB — master category rules (character-based, hashtags + NAP + CTA required)
    const gmbCategoryId = isGmbCategoryId(options.gmbCategory)
      ? options.gmbCategory
      : GMB_CATEGORY_IDS.INTENT_PROXIMITY;
    const gmb = buildGmbTemplatePost({
      categoryId: gmbCategoryId,
      keywords,
      location: place,
      url,
      business: options.business || {},
      sourceTitle: options.sourceTitle || "",
      sourcePage: options.sourcePage,
      selectedPages: options.selectedPages,
      allowedServices: options.allowedServices,
    });
    heading = gmb.heading;
    plain = gmb.content;
    html = plainToPreviewHtml(plain);
  }

  const applyRange = (body) => {
    // GMB is char-based; X is a single tight line already finalized above — neither
    // gets word-padding (padding + the 280 cap would truncate X mid-sentence).
    if (platform === "GMB" || platform === "X") return body;
    // Pad body copy only — CTA / hashtags are re-attached after
    let next = stripCtaHashtagsAndUrls(body);
    next = padToMinWords(next, cfg.minWords, padCtx);
    if (countWords(next) > cfg.maxWords) {
      const clipped = enforceMaxWords(next, cfg.maxWords);
      // SEO floor wins: never clip below minWords (slight overshoot OK)
      next = countWords(clipped) >= cfg.minWords ? clipped : next;
    }
    if (countWords(next) < cfg.minWords) {
      next = padToMinWords(next, cfg.minWords, padCtx);
    }
    return finalizeSocialCaption(next, {
      platform,
      url,
      primary,
      secondary,
      place,
      writingIntent,
    });
  };

  if (platform !== "GMB") {
    plain = applyRange(plain);
  }
  if (platform === "X" && countChars(plain) > cfg.maxChars) {
    // Hard-cap to the X limit at a whitespace boundary (never mid-word).
    const sliced = plain.slice(0, cfg.maxChars);
    const cut = sliced.lastIndexOf(" ");
    plain = (cut > 0 ? sliced.slice(0, cut) : sliced).trim();
  }
  html = plainToPreviewHtml(plain);

  const gmbCategoryId = isGmbCategoryId(options.gmbCategory)
    ? options.gmbCategory
    : platform === "GMB"
      ? GMB_CATEGORY_IDS.INTENT_PROXIMITY
      : null;
  const gmbValidation =
    platform === "GMB"
      ? validateGmbPost({
          content: plain,
          heading,
          categoryId: gmbCategoryId,
          location: place,
          keywords,
          business: options.business || {},
          sourceTitle: options.sourceTitle || "",
        })
      : null;
  const socialValidation =
    platform === "GMB"
      ? null
      : validateSocialPost({
          content: plain,
          platform,
          minWords: cfg.minWords,
          maxWords: cfg.maxWords,
        });

  return {
    heading,
    content: plain,
    contentHtml: html || plain,
    wordCount: countWords(plain),
    charCount: countChars(plain),
    minWords: cfg.minWords,
    maxWords: cfg.maxWords,
    writingIntent,
    masterIntent,
    gmbCategory: gmbCategoryId,
    cta: platform === "GMB" ? resolveGmbCta(gmbCategoryId, options.business || {}) : null,
    validation: gmbValidation || socialValidation,
  };
}

/**
 * Part 6 — write post via AI-selected model; falls back to template on failure.
 */
export async function generatePostContentWithAi(
  platform,
  keywords,
  location,
  url,
  tone,
  options = {}
) {
  const template = generatePostContent(platform, keywords, location, url, tone, options);
  const model = options.writingModel;
  const ownerName = options.ownerName || "";
  const scrub = (obj) => {
    if (ownerName && obj && typeof obj === "object") {
      if (obj.content) obj.content = stripOwnerNameFromContent(obj.content, ownerName);
      if (obj.heading) obj.heading = stripOwnerNameFromContent(obj.heading, ownerName);
    }
    return obj;
  };

  // P1 — context for natural-writing + identity-isolation polish (non-GMB).
  const nonGmbCtx = {
    platform,
    keywords: {
      primary: keywords.primary,
      secondaryKeywords:
        keywords.secondaryKeywords ||
        keywords.general ||
        (keywords.secondary ? [keywords.secondary] : []),
    },
    origin: options.websiteOrigin || options.origin || websiteOriginFromUrl(url),
    foreignNames: options.foreignNames || [],
    ownerName,
    seed: `${url}|${platform}`,
  };
  const voiceBlock = buildVoicePromptBlock(options.voice, platform);

  if (platform === "GMB") {
    return scrub(
      await generateGmbWithMasterRules({
        keywords,
        location,
        url,
        options,
        template,
        model,
      })
    );
  }

  if (!model || !process.env.OPENROUTER_API_KEY) {
    return finalizeNonGmbResult({ ...template, writingProvider: "template" }, nonGmbCtx);
  }

  const cfg = PLATFORM_CONFIG[platform];
  const place = normalizeLocation(location) || "your area";
  const primary = polishKeyword(keywords.primary, place);
  const secondaryList = (
    keywords.secondaryKeywords ||
    keywords.general ||
    [keywords.secondary]
  )
    .map((x) => polishKeyword(x, place))
    .filter(Boolean)
    .slice(0, 4);

  try {
    const data = await callOpenRouter({
      model,
      maxTokens: 700,
      messages: [
        {
          role: "system",
          content: `You write SEO-led social posts for ${platform}. Return ONLY JSON: {heading:string, content:string}. English only, no emojis, no markdown, no HTML, no inline hyperlinks. Word count between ${cfg.minWords} and ${cfg.maxWords}. Tone: ${tone}.
Platform voice & style (write distinctly for ${platform}; do NOT reuse the same wording or structure you would use on another platform): ${PLATFORM_STYLE[platform] || ""}
${voiceBlock ? `${voiceBlock}\n` : ""}Write like a real person for this specific business:
- Do NOT open with a generic template line (avoid "Here is a clear update", "In today's world", "Looking for...", "Are you looking for").
- Avoid generic marketing clichés (e.g. "take your business to the next level", "cutting-edge", "world-class", "one-stop shop", "seamless", "unlock the power", "elevate your", "game-changer").
- Avoid robotic transitions ("Furthermore", "Moreover", "In conclusion", "First and foremost").
- Use the primary keyword naturally — never stuff or repeat it.
- Only state facts supported by this website; never mention another business, brand, or external domain.
Rules:
- Never wrap keywords in links or HTML.
- Do NOT put a URL in the middle of a sentence.
- If links are allowed, end with a short relevant CTA line that mentions the primary keyword (or intent), then the URL on the next line. Examples: "Discover more about {keyword}:" / "See how we approach {keyword}:" / "Ready to get started with {keyword}?" — never a bare "Learn more:" with no context.
- If hashtags are allowed, end with 3–5 relevant hashtags on the last line.
- If links/hashtags are not allowed, omit them entirely.`,
        },
        {
          role: "user",
          content: `Platform: ${platform}
Location: ${place}
Primary keyword: ${primary}
Secondary keywords: ${secondaryList.join(", ")}
Page URL for bottom CTA only (if allowed): ${url}
Writing intent: ${options.writingIntent || "Awareness"}
Master intent: ${options.masterIntent || "n/a"}
Allow links (bottom CTA only): ${cfg.allowLinks}
Allow hashtags: ${cfg.allowHashtags}
${
  options.avoidSample
    ? `\nAVOID DUPLICATION — a recent ${platform} post for this website reads:\n"""${String(options.avoidSample).slice(0, 600)}"""\nWrite something clearly different in angle, opening, and structure.\n`
    : ""
}
Write one complete post body that naturally uses the primary keyword and at least two secondary keywords. Follow the master intent.`,
        },
      ],
    });

    const raw = data?.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return finalizeNonGmbResult({ ...template, writingProvider: "template-fallback" }, nonGmbCtx);
    const parsed = JSON.parse(m[0]);
    let content = sanitizeEnglishPost(String(parsed.content || "").trim());
    let heading = sanitizeEnglishPost(String(parsed.heading || template.heading).trim());
    if (!content || countWords(content) < Math.min(40, cfg.minWords)) {
      return finalizeNonGmbResult({ ...template, writingProvider: "template-fallback" }, nonGmbCtx);
    }

    const padCtx = {
      primary,
      secondary: secondaryList[0],
      offering: asOffering(secondaryList[1] || primary),
      proof: asOffering(secondaryList[2] || "reliable results"),
      promo: asOffering(secondaryList[3] || primary),
      place,
      provider: asProvider(secondaryList[0] || primary),
    };
    content = stripCtaHashtagsAndUrls(content);
    content = padToMinWords(content, cfg.minWords, padCtx);
    if (countWords(content) > cfg.maxWords) {
      const clipped = enforceMaxWords(content, cfg.maxWords);
      content = countWords(clipped) >= cfg.minWords ? clipped : content;
    }

    content = finalizeSocialCaption(content, {
      platform,
      url,
      primary,
      secondary: secondaryList[0],
      place,
      writingIntent: options.writingIntent || "Awareness",
    });

    if (platform === "X" && cfg.maxChars && countChars(content) > cfg.maxChars) {
      const sliced = content.slice(0, cfg.maxChars);
      const cut = sliced.lastIndexOf(" ");
      content = (cut > 0 ? sliced.slice(0, cut) : sliced).trim();
    }

    const socialValidation = validateSocialPost({
      content,
      platform,
      minWords: cfg.minWords,
      maxWords: cfg.maxWords,
    });

    if (ownerName) {
      content = stripOwnerNameFromContent(content, ownerName);
      heading = stripOwnerNameFromContent(heading, ownerName);
    }
    return finalizeNonGmbResult(
      {
        heading: heading || template.heading,
        content,
        contentHtml: plainToPreviewHtml(content),
        wordCount: countWords(content),
        charCount: countChars(content),
        minWords: cfg.minWords,
        maxWords: cfg.maxWords,
        writingIntent: options.writingIntent || template.writingIntent,
        masterIntent: options.masterIntent || template.masterIntent,
        writingProvider: model,
        validation: socialValidation,
      },
      nonGmbCtx
    );
  } catch (err) {
    console.error("[generatePostContentWithAi]", err.message);
    return finalizeNonGmbResult({ ...template, writingProvider: "template-fallback" }, nonGmbCtx);
  }
}

function parseModelJson(raw) {
  const m = String(raw || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

async function generateGmbWithMasterRules({
  keywords,
  location,
  url,
  options,
  template,
  model,
}) {
  const categoryId = isGmbCategoryId(options.gmbCategory)
    ? options.gmbCategory
    : GMB_CATEGORY_IDS.INTENT_PROXIMITY;
  const business = options.business || {};
  const selectedPages = options.selectedPages || [
    { url, title: options.sourceTitle, keywords },
  ];
  const verifiedOffer = options.verifiedOffer || detectVerifiedOffer(selectedPages);

  if (
    categoryId === GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT &&
    !verifiedOffer.found
  ) {
    return {
      ...template,
      error: "NO_VERIFIED_OFFER",
      gmbCategory: categoryId,
      validation: {
        status: "NEEDS_REVISION",
        ready: false,
        issues: [
          "No verified offer or event found for this content type. Choose another category or provide verified promotional facts.",
        ],
      },
      writingProvider: "gmb-master-blocked",
    };
  }

  const sourcePage = options.sourcePage || {
    url,
    title: options.sourceTitle || "",
    keywords,
  };

  const gmbOrigin =
    options.websiteOrigin || websiteOriginFromUrl(url) || websiteOriginFromUrl(sourcePage?.url);
  const gmbForeignNames = options.foreignNames || [];

  const applyValidation = (heading, content, provider) => {
    const validation = validateGmbPost({
      content,
      heading,
      categoryId,
      location,
      keywords,
      business,
      sourceTitle: options.sourceTitle || sourcePage?.title || "",
    });
    // P1 — informational naturalness score (does not change GMB ready/hard-fail).
    validation.naturalness = scoreNaturalness(content, { keywords });
    return {
      heading,
      content,
      contentHtml: plainToPreviewHtml(content),
      wordCount: countWords(content),
      charCount: countChars(content),
      minWords: PLATFORM_CONFIG.GMB.minWords,
      maxWords: PLATFORM_CONFIG.GMB.maxWords,
      writingIntent: options.writingIntent || template.writingIntent,
      masterIntent: options.masterIntent || template.masterIntent,
      writingProvider: provider,
      gmbCategory: categoryId,
      cta: resolveGmbCta(categoryId, { ...business, offerSummary: verifiedOffer.summary }),
      validation,
      ruleset: GMB_RULESET_VERSION,
    };
  };

  const polishGmbCandidate = (heading, content, provider) => {
    const place = normalizeLocation(location) || "";
    const primary = polishKeyword(keywords.primary, place);
    const services = extractVerifiedServices({
      keywords,
      sourcePage,
      selectedPages,
      business,
    });
    const cta = resolveGmbCta(categoryId, { ...business, offerSummary: verifiedOffer.summary });
    const ctaLine = gmbCtaInstruction(cta);
    let next = stripUnverifiedNap(content, business);
    // P1 — identity isolation (no foreign site/business leakage) + light
    // natural-writing cleanup. Front-load/length rules are preserved because
    // padGmbToTarget re-fits the body below; openings are NOT varied for GMB
    // (the first 150 chars must keep service+city+intent / question hooks).
    next = scrubForeignIdentity(next, { ownOrigin: gmbOrigin, foreignNames: gmbForeignNames });
    next = stripRoboticTransitions(replaceCliches(next));
    if (categoryId === GMB_CATEGORY_IDS.FAQ_EDUCATIONAL) {
      next = ensureFaqQuestionHook(next, {
        heading,
        sourceTitle: options.sourceTitle || sourcePage?.title || "",
        keywords,
      });
    }
    next = ensureGmbHashtags(next, {
      location: place,
      primary,
      categoryId,
    });
    next = padGmbToTarget(next, {
      primary,
      place,
      name: String(business.name || "").trim(),
      services,
      ctaLine,
    });
    next = stripUnverifiedNap(next, business);
    return applyValidation(heading, next, provider);
  };

  let result = polishGmbCandidate(template.heading, template.content, "template");

  if (!model || !process.env.OPENROUTER_API_KEY) {
    return result;
  }

  try {
    const data = await callOpenRouter({
      model,
      maxTokens: 1200,
      messages: [
        { role: "system", content: buildGmbSystemPrompt(categoryId) },
        {
          role: "user",
          content: `${buildGmbUserPrompt({
            categoryId,
            business,
            location,
            keywords,
            sourcePage,
            selectedPages,
            verifiedOffer,
          })}${
            buildVoicePromptBlock(options.voice, "GMB")
              ? `\n\n${buildVoicePromptBlock(options.voice, "GMB")}`
              : ""
          }`,
        },
      ],
    });
    const parsed = parseModelJson(data?.choices?.[0]?.message?.content);
    if (parsed?.error === "NO_VERIFIED_OFFER") {
      return applyValidation(template.heading, template.content, "gmb-master-blocked");
    }
    if (parsed?.content) {
      const heading = sanitizeEnglishPost(String(parsed.heading || template.heading).trim());
      const content = sanitizeEnglishPost(String(parsed.content || "").trim());
      if (content && countChars(content) >= 400) {
        result = polishGmbCandidate(heading, content, model);
      }
    }
  } catch (err) {
    console.error("[generateGmbWithMasterRules]", err.message);
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const needsRefine =
      result.validation &&
      (!result.validation.ready ||
        result.charCount < GMB_CHAR.min ||
        result.charCount > GMB_CHAR.max);
    if (!needsRefine || !model || !process.env.OPENROUTER_API_KEY) break;
    try {
      const refine = await callOpenRouter({
        model,
        maxTokens: 1200,
        messages: [
          { role: "system", content: buildGmbSystemPrompt(categoryId) },
          {
            role: "user",
            content: buildGmbRefinePrompt({
              categoryId,
              content: result.content,
              issues: result.validation?.issues || [],
              verifiedServices: extractVerifiedServices({
                keywords,
                sourcePage,
                selectedPages,
                business,
              }),
              sourceTitle: options.sourceTitle || sourcePage?.title || "",
            }),
          },
        ],
      });
      const parsed = parseModelJson(refine?.choices?.[0]?.message?.content);
      if (!parsed?.content) break;
      const heading = sanitizeEnglishPost(String(parsed.heading || result.heading).trim());
      const content = sanitizeEnglishPost(String(parsed.content).trim());
      const refined = polishGmbCandidate(heading, content, `${model}+refine`);
      const fewerIssues =
        (refined.validation?.issues || []).length <= (result.validation?.issues || []).length;
      if (refined.validation?.ready || fewerIssues) {
        result = refined;
      }
      if (result.validation?.ready) break;
    } catch (err) {
      console.error("[generateGmbWithMasterRules refine]", err.message);
      break;
    }
  }

  return result;
}

/** Scene-based photoreal prompt — keyword → visual subject, never render text/logos */
function buildPhotorealImagePrompt(keyword, location, heading, platform) {
  return buildRelevantImagePrompt({ keyword, location, heading, platform });
}

/**
 * Photoreal images — quality-first (paid ChatGPT/Gemini) with free fallback.
 * Part 6: preferredModel / imageSource from AI router.
 * Default STUDIO_IMAGE_DEFAULT=quality → AI decides best paid model.
 * @param {"auto"|"ai"|"free"} [imageSource="auto"]
 */
export async function generateStudioImage({
  keyword,
  location,
  platform,
  heading,
  imageSource = "auto",
  preferredModel,
}) {
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.Facebook;
  const { width, height } = cfg.image;
  const prompt = buildPhotorealImagePrompt(keyword, location, heading, platform);
  const aspectRatio =
    platform === "Instagram"
      ? "1:1"
      : platform === "GMB"
        ? "4:3"
        : "16:9";
  const mode = ["auto", "ai", "free"].includes(imageSource) ? imageSource : "auto";
  const freeOnly =
    process.env.STUDIO_FREE_IMAGES_ONLY === "1" ||
    String(process.env.STUDIO_IMAGE_DEFAULT || "quality").toLowerCase() === "free";

  // Only use free-first when user/env explicitly wants $0
  if (mode === "free" || (mode === "auto" && freeOnly)) {
    const free = await resolveFreeImage({
      prompt,
      keyword,
      location,
      heading,
      width,
      height,
      platform,
    });
    return free;
  }

  // Quality path: paid OpenRouter image models (gpt-image-1 etc.)
  if (process.env.OPENROUTER_API_KEY && (mode === "auto" || mode === "ai")) {
    try {
      const img = await generateImage({
        prompt,
        aspectRatio,
        preferredModel: preferredModel || process.env.IMAGE_MODEL || "openai/gpt-image-1",
      });
      if (img?.ok && img.url) {
        return {
          url: img.url,
          source: "ai",
          provider: img.model || preferredModel || "openrouter",
          width,
          height,
        };
      }
    } catch (err) {
      console.error("[autoPoster ChatGPT image]", err.message);
    }
  }

  if (mode === "ai") {
    return { url: null, source: "ai", provider: null, error: "AI image unavailable" };
  }

  // auto fallback → free stack if paid failed
  const free = await resolveFreeImage({
    prompt,
    keyword,
    location,
    heading,
    width,
    height,
    platform,
  });
  return { ...free, fallbackFromAi: true };
}

/** Resolve image URL string for persistence (back-compat with older callers) */
async function resolveImageUrl(opts) {
  const result = await generateStudioImage(opts);
  if (typeof result === "string") return result;
  return result?.url || null;
}

/** @deprecated use generateStudioImage */
export function getRealisticImageUrl(keyword, platform) {
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.Facebook;
  const { width, height } = cfg.image;
  const prompt = buildPhotorealImagePrompt(keyword, "", keyword);
  return resolveFreeImage({
    prompt,
    keyword,
    location: "",
    heading: keyword,
    width,
    height,
  }).then((r) => r.url);
}

function packKeywordResult(keywords, page, location) {
  const intentFallback = inferWritingIntent(page || { url: "", title: "", h1: "", description: "" });
  const coverage = inferAreaCoverage(
    page || { url: "", title: "", h1: "", description: "", bodyText: "" },
    location
  );
  const secondary =
    keywords.secondaryKeywords ||
    keywords.general ||
    [keywords.secondary].filter(Boolean);

  const secondaryKeywords = [...secondary].map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8);

  return {
    primary: keywords.primary,
    secondary: secondaryKeywords[0],
    secondaryKeywords,
    general: secondaryKeywords,
    writingIntent: keywords.writingIntent || intentFallback.intent,
    masterIntent: keywords.masterIntent || intentFallback.masterIntent,
    areaCoverage: keywords.areaCoverage || coverage.summary,
    areaList: coverage.areas,
  };
}

async function scanOneUrl(rawUrl, location) {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;

  const { html, reason: failReason } = await fetchHtmlDetailed(url);
  if (!html) {
    // Fallback keywords from URL slug when page is unreachable
    const slug = url
      .replace(/^https?:\/\//, "")
      .split(/[/?#]/)[0]
      .split(/[./]/)
      .pop();
    const primary = polishKeyword(`${slug} services`, location);
    const secondaryKeywords = [
      polishKeyword(`custom ${slug} design`, location),
      polishKeyword(`${slug} experts`, location),
      "Affordable Packages",
      "Local Branding Services",
    ];
    const pageStub = { url, title: slug, h1: slug, description: "", bodyText: "" };
    const packed = packKeywordResult(
      { primary, secondary: secondaryKeywords[0], secondaryKeywords, general: secondaryKeywords },
      pageStub,
      location
    );
    return {
      url,
      reachable: false,
      failReason: failReason || "fetch-failed",
      title: slug,
      keywords: packed,
      writingIntent: packed.writingIntent,
      masterIntent: packed.masterIntent,
      areaCoverage: packed.areaCoverage,
    };
  }

  const page = {
    url,
    title: tagText(html, "title"),
    h1: tagText(html, "h1"),
    description: metaContent(html, "description") || metaContent(html, "og:description"),
    bodyText: stripHtml(html).slice(0, 12000),
  };

  const heuristic = scorePageKeywords(page, location);
  const ai = await refineKeywordsWithAi(page, location, heuristic);
  const packed = packKeywordResult(ai || heuristic, page, location);
  return {
    url,
    reachable: true,
    failReason: null,
    title: page.title,
    // Keep the extracted page body/description so service aggregation can mine
    // evidence across every page (not just the homepage).
    description: page.description,
    bodyText: page.bodyText,
    keywords: packed,
    writingIntent: packed.writingIntent,
    masterIntent: packed.masterIntent,
    areaCoverage: packed.areaCoverage,
  };
}

/**
 * Scan ≤15 URLs in parallel batches and return keyword packs.
 */
export async function scanUrlsForKeywords(urlsInput, location) {
  const urls = [...new Set(
    (Array.isArray(urlsInput) ? urlsInput : String(urlsInput || "").split(/\n+/))
      .map((u) => String(u).trim())
      .filter(Boolean)
      .map(normalizeUrl)
      .filter(Boolean)
  )].slice(0, MAX_URLS);

  if (!urls.length) {
    return { ok: false, status: 400, error: "Provide 1–15 website URLs (one per line)." };
  }
  if (!String(location || "").trim()) {
    return { ok: false, status: 400, error: "Target location is required." };
  }

  const analyzed = [];
  for (let i = 0; i < urls.length; i += 5) {
    const batch = urls.slice(i, i + 5);
    const results = await Promise.all(batch.map((u) => scanOneUrl(u, location)));
    for (const r of results) if (r) analyzed.push(r);
  }

  return {
    ok: true,
    location: String(location).trim(),
    count: analyzed.length,
    analyzed,
  };
}

async function resolveUser(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return { ok: false, status: 400, error: "Email is required" };
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return { ok: false, status: 404, error: "User not found" };
  return { ok: true, user, email: normalized };
}

/**
 * Part 1 — Website root → discover pages → area coverage + writing intent +
 * 1 primary + 4 secondary keywords per page (no posts yet).
 */
export async function analyzeWebsiteForStudio({
  email,
  workspaceId,
  websiteUrl,
  location,
  maxPages = null,
  forceRefresh = false,
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const { user } = auth;
  const { activeId, workspace } = await resolveActiveWorkspace(user);
  const wid = workspaceId || activeId || workspace?.id || null;

  const origin = normalizeDomain(websiteUrl);
  if (!origin) {
    return {
      ok: false,
      status: 400,
      error: "Enter a valid website URL, e.g. https://example.com",
    };
  }

  const loc = normalizeLocation(
    String(location || "").trim() || workspace?.location || ""
  );

  const startedAt = Date.now();
  const discovered = await discoverSitemapUrls(origin);
  const homepage = `${origin}/`;

  // ── Build an accurate URL inventory ───────────────────────────────────
  // discovered → eligible (unique, in-scope, SSRF-safe) vs excluded.
  const rawCandidates = [homepage, ...discovered];
  const seen = new Set();
  const eligibleUrls = [];
  const excluded = []; // { url, reason }
  let duplicateCount = 0;

  for (const raw of rawCandidates) {
    const n = normalizeUrl(raw) || raw;
    if (!n) {
      excluded.push({ url: String(raw), reason: "invalid-url" });
      continue;
    }
    if (seen.has(n)) {
      duplicateCount++;
      continue;
    }
    seen.add(n);
    // In-scope: same origin only.
    let sameOrigin = false;
    try {
      sameOrigin = new URL(n).origin === new URL(origin).origin;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      excluded.push({ url: n, reason: "out-of-scope" });
      continue;
    }
    const safe = await assertSafeUrl(n);
    if (!safe.ok) {
      excluded.push({ url: n, reason: safe.reason });
      continue;
    }
    eligibleUrls.push(n);
  }

  // Prioritise so the most useful pages are first when a safety cap applies.
  eligibleUrls.sort((a, b) => {
    if (a === homepage) return -1;
    if (b === homepage) return 1;
    return urlPriority(b) - urlPriority(a);
  });

  // Analysis cap: large but configurable. A requested maxPages can lower it,
  // but never silently pins the whole site to 15.
  const requested = Number(maxPages);
  const analyzeCap = Math.min(
    MAX_ANALYZE_URLS,
    requested && requested > 0 ? Math.max(requested, 1) : MAX_ANALYZE_URLS
  );
  const queuedUrls = eligibleUrls.slice(0, analyzeCap);
  const remainingCount = Math.max(eligibleUrls.length - queuedUrls.length, 0);

  if (!queuedUrls.length) {
    return {
      ok: false,
      status: 400,
      error: "No pages discovered on this website. Check the URL is public.",
    };
  }

  // ── Cache: reuse a recent whole-site analysis for the same scope ───────
  const cacheKey = `studio-analyze:${origin}:${loc || ""}:${analyzeCap}`;
  const cached = cacheGet(cacheKey);
  if (cached && !forceRefresh) {
    // Selection lives in the DB independently of the crawl cache, so always
    // return the *current* persisted selection even on a cache hit.
    let selection = null;
    try {
      selection = await getSelection({ userId: user.id, workspaceId: wid, websiteOrigin: origin });
    } catch { /* non-fatal */ }
    return { ...cached, cached: true, selection };
  }

  // ── Fetch + analyse with bounded concurrency (no fixed 5-page batches) ─
  const scanned = await mapWithConcurrency(
    queuedUrls,
    ANALYZE_CONCURRENCY,
    (u) => scanOneUrl(u, loc || "Local")
  );

  const analyzed = [];
  const failed = []; // { url, reason }
  for (let i = 0; i < scanned.length; i++) {
    const r = scanned[i];
    if (!r) {
      failed.push({ url: queuedUrls[i], reason: "scan-error" });
      continue;
    }
    if (r.reachable === false) {
      failed.push({ url: r.url, reason: r.failReason || "unreachable" });
      // A failed page is isolated — it does NOT abort the whole job, but it is
      // not counted as a successful analysis either.
      continue;
    }
    analyzed.push(r);
  }

  if (!analyzed.length) {
    return {
      ok: false,
      status: 400,
      error:
        "Discovered pages but none could be fetched. The site may be blocking bots or temporarily down.",
    };
  }

  const areaPool = new Set();
  for (const row of analyzed) {
    if (row.areaCoverage) areaPool.add(row.areaCoverage);
    for (const a of row.keywords?.areaList || []) areaPool.add(a);
  }

  const intentCounts = {};
  for (const row of analyzed) {
    const key = row.writingIntent || "Awareness";
    intentCounts[key] = (intentCounts[key] || 0) + 1;
  }
  const dominantIntent =
    Object.entries(intentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "Awareness";

  const masterIntent =
    analyzed.find((a) => a.masterIntent)?.masterIntent ||
    `Publish keyword-led social updates for ${origin} that match each page intent and cover ${
      loc || "the local service area"
    }.`;

  const pages = analyzed.map((row) => ({
    url: row.url,
    reachable: row.reachable,
    title: row.title || "",
    pageType: inferPageType(row.url, row.title || ""),
    areaCoverage: row.areaCoverage,
    writingIntent: row.writingIntent,
    masterIntent: row.masterIntent,
    keywords: {
      primary: row.keywords.primary,
      secondary: row.keywords.secondaryKeywords || row.keywords.general || [],
    },
  }));

  const primaryKeywords = [
    ...new Set(pages.map((p) => p.keywords.primary).filter(Boolean)),
  ].slice(0, 6);
  const secondaryKeywords = [
    ...new Set(pages.flatMap((p) => p.keywords.secondary || []).filter(Boolean)),
  ].slice(0, 8);

  // ── Aggregate SERVICES across every analysed page (not just the homepage).
  // extractVerifiedServices already filters fabricated / educational labels;
  // we run it per page and union the results, tracking which pages are
  // evidence for each detected service so false positives can be reviewed.
  const serviceEvidence = new Map(); // normalizedName → { name, pages:Set, pageTypes:Set }
  for (const row of analyzed) {
    const detected = extractVerifiedServices({
      keywords: row.keywords,
      sourcePage: { title: row.title, keywords: row.keywords },
    });
    const pageType = inferPageType(row.url, row.title || "");
    for (const svc of detected) {
      const key = svc.toLowerCase();
      if (!serviceEvidence.has(key)) {
        serviceEvidence.set(key, { name: svc, pages: new Set(), pageTypes: new Set() });
      }
      const entry = serviceEvidence.get(key);
      entry.pages.add(row.url);
      entry.pageTypes.add(pageType);
    }
  }
  const services = [...serviceEvidence.values()]
    .map((e) => ({
      name: e.name,
      pages: [...e.pages],
      pageCount: e.pages.size,
      pageTypes: [...e.pageTypes],
    }))
    // Prefer services with the most cross-page evidence.
    .sort((a, b) => b.pageCount - a.pageCount)
    .slice(0, 20);

  const servicePageCount = pages.filter((p) => p.pageType === "Services").length;

  // ── Honest inventory — discovered / eligible / queued / success / failed /
  // excluded / remaining — never conflate a partial run with a complete one.
  const inventory = {
    discovered: rawCandidates.length,
    duplicates: duplicateCount,
    eligible: eligibleUrls.length,
    excluded: excluded.length,
    queued: queuedUrls.length,
    analyzedSuccess: analyzed.length,
    failed: failed.length,
    remaining: remainingCount,
    complete: failed.length === 0 && remainingCount === 0,
  };

  const result = {
    ok: true,
    workspaceId: wid,
    websiteUrl: origin,
    location: loc,
    needsLocation: !loc,
    discoveredCount: eligibleUrls.length,
    pageCount: pages.length,
    inventory,
    excludedSample: excluded.slice(0, 20),
    failedSample: failed.slice(0, 20),
    services,
    areaCoverage: {
      summary: [...areaPool].slice(0, 6).join(" · ") || loc || "Set target location",
      areas: [...areaPool].slice(0, 12),
    },
    masterIntent,
    dominantIntent,
    pages,
    metrics: {
      durationMs: Date.now() - startedAt,
      concurrency: ANALYZE_CONCURRENCY,
      cache: cacheStats(),
    },
    intelligence: {
      primaryKeywords,
      secondaryKeywords,
      location: loc,
      pagesAnalyzed: pages.length,
      // servicesFound now reflects distinct detected services, not just the
      // count of pages that looked like a "Services" page.
      servicesFound: services.length,
      servicePageCount,
      linksFound: eligibleUrls.length,
      discovered: inventory.discovered,
      failed: inventory.failed,
      excluded: inventory.excluded,
      remaining: inventory.remaining,
    },
  };

  // Persist the inventory + merge/seed selection (survives refresh / re-login).
  let selection = null;
  try {
    selection = await persistInventory({
      userId: user.id,
      workspaceId: wid,
      websiteOrigin: origin,
      pages,
      services,
      failed,
      excluded,
    });
  } catch (err) {
    console.error("[analyzeWebsiteForStudio persistInventory]", err.message);
  }
  result.selection = selection;

  cacheSet(cacheKey, result, ANALYSIS_CACHE_TTL_MS);
  return result;
}

/** Resolve (userId, workspaceId, websiteOrigin) for a selection request. */
async function resolveSelectionScope({ email, workspaceId, websiteUrl }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;
  const { user } = auth;
  const { activeId, workspace } = await resolveActiveWorkspace(user);
  const wid = workspaceId || activeId || workspace?.id || null;
  const origin = websiteOriginFromUrl(websiteUrl) || normalizeDomain(websiteUrl);
  if (!origin) {
    return { ok: false, status: 400, error: "A valid websiteUrl is required." };
  }
  return { ok: true, userId: user.id, workspaceId: wid, websiteOrigin: origin };
}

/** GET persisted inventory + selection for one website (survives refresh). */
export async function getStudioSelection({ email, workspaceId, websiteUrl }) {
  const scope = await resolveSelectionScope({ email, workspaceId, websiteUrl });
  if (!scope.ok) return scope;
  return getSelection(scope);
}

/** Persist a user's page/service selection with server-side validation. */
export async function saveStudioSelection({
  email,
  workspaceId,
  websiteUrl,
  selectedUrls,
  selectedServices,
}) {
  const scope = await resolveSelectionScope({ email, workspaceId, websiteUrl });
  if (!scope.ok) return scope;
  return saveSelection({ ...scope, selectedUrls, selectedServices });
}

/**
 * Part 2 — Full pipeline: keywords → Facebook / Instagram / LinkedIn / GMB posts (≤60)
 * Optional images (Part 3). Skips fingerprints already published+locked.
 *
 * @param {object} opts
 * @param {Array} [opts.pages] — Part 1 analyzed pages (skips re-crawl when provided)
 * @param {string} [opts.masterIntent]
 * @param {boolean} [opts.includeImages=false] — Part 3 flip; default off for speed
 * @param {"auto"|"ai"|"free"} [opts.imageSource="auto"]
 * @param {string[]} [opts.platforms] — defaults to STUDIO_POST_PLATFORMS
 */
export async function generateAutoPosterSuite({
  email,
  workspaceId,
  urls,
  location,
  tone = "Professional",
  pages: prePages,
  masterIntent: siteMasterIntent,
  includeImages = false,
  imageSource = "auto",
  platforms: platformOverride,
  websiteUrl,
  gmbCategory,
  // Batch 4: when true (default) and images are requested, text drafts are
  // returned immediately with imageStatus="pending" and images are generated
  // out-of-band via /auto-poster/attach-images. deferImages=false keeps the
  // legacy inline (blocking) behaviour for callers that need images in-band.
  deferImages = true,
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const { user } = auth;
  const { activeId, workspace } = await resolveActiveWorkspace(user);
  const wid = workspaceId || activeId || workspace?.id || null;

  const selectedTone = TONE_PRESETS.includes(tone) ? tone : "Professional";
  const loc = normalizeLocation(
    String(location || "").trim() || workspace?.location || ""
  );

  const platforms = (platformOverride || STUDIO_POST_PLATFORMS).filter(
    (p) => PLATFORM_CONFIG[p]
  );
  if (!platforms.length) {
    return { ok: false, status: 400, error: "No valid platforms selected." };
  }

  const wantsGmb = platforms.includes("GMB");
  const gmbCategoryId = isGmbCategoryId(gmbCategory)
    ? gmbCategory
    : wantsGmb
      ? GMB_CATEGORY_IDS.INTENT_PROXIMITY
      : null;

  if (wantsGmb && gmbCategory && !isGmbCategoryId(gmbCategory)) {
    return { ok: false, status: 400, error: "Invalid GMB category." };
  }

  // ── Server-side selection enforcement ────────────────────────────────
  // Only pages the user actually selected (and that exist in the persisted,
  // authorised inventory) may enter generation. Stale client state or a
  // manipulated request cannot smuggle in unselected / unknown pages.
  const genOrigin =
    websiteOriginFromUrl(websiteUrl) ||
    websiteOriginFromUrl(Array.isArray(prePages) && prePages[0]?.url) ||
    null;
  let allowedServiceNames = null;
  if (genOrigin) {
    try {
      const sel = await getSelectedForGeneration({
        userId: user.id,
        workspaceId: wid,
        websiteOrigin: genOrigin,
      });
      if (sel) {
        allowedServiceNames = sel.serviceNames;
        if (Array.isArray(prePages) && prePages.length) {
          const before = prePages.length;
          prePages = prePages.filter((p) => sel.urls.has(normalizeUrl(p.url) || p.url));
          if (!prePages.length) {
            return {
              ok: false,
              status: 400,
              error:
                before > 0
                  ? "None of the submitted pages are in your saved selection. Open the selection step and choose at least one eligible page."
                  : "Select at least one website page before generating content.",
            };
          }
        }
      }
    } catch (err) {
      console.error("[generateAutoPosterSuite enforce selection]", err.message);
    }
  }

  let analyzed = [];

  if (Array.isArray(prePages) && prePages.length) {
    analyzed = prePages.slice(0, MAX_URLS).map((p) => {
      const secondary = Array.isArray(p.keywords?.secondary)
        ? p.keywords.secondary
        : Array.isArray(p.keywords?.secondaryKeywords)
          ? p.keywords.secondaryKeywords
          : Array.isArray(p.keywords?.general)
            ? p.keywords.general
            : [p.keywords?.secondary].filter(Boolean);
      const secondaryKeywords = secondary.map(String).filter(Boolean).slice(0, 8);
      return {
        url: normalizeUrl(p.url) || p.url,
        reachable: p.reachable !== false,
        title: p.title || "",
        writingIntent: p.writingIntent || "Awareness",
        masterIntent: p.masterIntent || siteMasterIntent || "",
        areaCoverage: p.areaCoverage || loc,
        keywords: {
          primary: p.keywords?.primary || "local business services",
          secondary: secondaryKeywords[0],
          secondaryKeywords,
          general: secondaryKeywords,
        },
      };
    });
  } else {
    const scan = await scanUrlsForKeywords(urls, loc);
    if (!scan.ok) return scan;
    analyzed = scan.analyzed;
  }

  if (!analyzed.length) {
    return { ok: false, status: 400, error: "No pages to generate posts from." };
  }

  const verifiedOffer = detectVerifiedOffer(analyzed);
  let gmbSkipped = null;
  if (
    wantsGmb &&
    gmbCategoryId === GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT &&
    !verifiedOffer.found
  ) {
    gmbSkipped = {
      reason:
        "No verified offer or event found for this content type. Choose another GMB category or select pages that contain a real promotion.",
    };
  }

  const business = await resolveBusinessContext(user.id, wid, workspace, user.name);
  // P1 — other managed businesses' names, so none can leak into this site's copy.
  const foreignNames = await resolveForeignBusinessNames(user.id, wid, business.name);
  const selectedPagesForGmb = analyzed.map((p) => ({
    url: p.url,
    title: p.title,
    keywords: p.keywords,
    writingIntent: p.writingIntent,
    masterIntent: p.masterIntent,
  }));

  const origin =
    websiteOriginFromUrl(websiteUrl) ||
    websiteOriginFromUrl(analyzed[0]?.url) ||
    null;

  // Batch 4: reject a concurrent duplicate run (double-click / retry) so we
  // never create two sets of drafts for the same request. Released in finally.
  const genKey = buildGenerateKey({
    userId: user.id,
    wid,
    genOrigin: origin,
    platforms,
    urls,
    prePages,
  });
  if (!acquireGenerateLock(genKey)) {
    return {
      ok: false,
      status: 409,
      error:
        "A content generation for this website is already running. Please wait for it to finish before generating again.",
    };
  }

  try {
  const activeSample = await prisma.studioPost.findFirst({
    where: {
      userId: user.id,
      ...(wid ? { workspaceId: wid } : {}),
      archived: false,
    },
    select: { websiteOrigin: true },
    orderBy: { updatedAt: "desc" },
  });

  const switchingWebsite =
    !!origin &&
    !!activeSample?.websiteOrigin &&
    activeSample.websiteOrigin !== origin;

  // Generation must not archive, delete, publish, or reschedule existing posts.
  const archivedCount = 0;

  // Locked fingerprints for this user (never regenerate / republish same combo)
  const locked = await prisma.studioPost.findMany({
    where: { userId: user.id, locked: true, status: "published", archived: false },
    select: { fingerprint: true },
  });
  const lockedSet = new Set(locked.map((l) => l.fingerprint));

  // —— Part 6: AI picks best writing model + image provider for the whole batch ——
  const providerDecision = await selectBestStudioProviders({
    websiteUrl: origin || websiteUrl,
    location: loc,
    masterIntent: siteMasterIntent || analyzed[0]?.masterIntent,
    dominantIntent: analyzed[0]?.writingIntent,
    pageSample: analyzed,
    includeImages: !!includeImages,
    forceImageSource: imageSource === "auto" ? undefined : imageSource,
  });

  const resolvedImageSource =
    includeImages
      ? imageSource === "auto"
        ? providerDecision.image.source
        : imageSource
      : "free";
  const preferredImageModel = providerDecision.image.model || undefined;
  const writingModel = providerDecision.writing.model;

  // P1 — derive (and cache) THIS website's distinct brand voice once, reusing
  // the already-crawled page intelligence (no extra AI call unless enriched).
  const suiteTimer = createTimer("generateSuite");
  const genTimings = [];
  const brandVoice = await getBrandVoice({
    userId: user.id,
    workspaceId: wid,
    websiteOrigin: origin,
    pages: analyzed,
    keywords: analyzed[0]?.keywords || {},
    location: loc,
    business,
    model: writingModel,
    enrich: !!process.env.OPENROUTER_API_KEY,
  });
  suiteTimer.mark("brand_voice");

  // Batch 4: when images are requested we default to deferring them so the
  // (fast) text drafts return immediately; images are filled out-of-band.
  const deferImageGen = !!includeImages && deferImages;
  const inlineImageGen = !!includeImages && !deferImages;

  const posts = [];
  const imagesPending = []; // postIds awaiting out-of-band image generation
  const skippedLocked = [];
  const expectedTotal = analyzed.length * platforms.filter((p) => !(p === "GMB" && gmbSkipped)).length;

  for (const item of analyzed) {
    for (const platform of platforms) {
      if (platform === "GMB") continue;

      const sourceItem =
        platform === "GMB"
          ? pickRelevantSourcePage(selectedPagesForGmb, gmbCategoryId, loc) || item
          : item;
      const sourceUrl = platform === "GMB" ? sourceItem.url || item.url : item.url;
      const sourceKeywords = platform === "GMB" ? sourceItem.keywords || item.keywords : item.keywords;

      const fp = fingerprintOf(sourceUrl, platform, sourceKeywords.primary);
      if (lockedSet.has(fp)) {
        skippedLocked.push({ url: sourceUrl, platform, reason: "Already published & locked" });
        continue;
      }

      const postData = await generatePostWithDedup({
        platform,
        keywords: sourceKeywords,
        location: loc,
        url: sourceUrl,
        tone: platform === "GMB" ? gmbCategoryId : selectedTone,
        options: {
          writingIntent: sourceItem.writingIntent || item.writingIntent,
          masterIntent: sourceItem.masterIntent || item.masterIntent || siteMasterIntent,
          writingModel,
          ownerName: user.name,
          gmbCategory: platform === "GMB" ? gmbCategoryId : undefined,
          business,
          voice: brandVoice,
          websiteOrigin: origin,
          foreignNames,
          sourceTitle: sourceItem.title || item.title,
          sourcePage: {
            url: sourceUrl,
            title: sourceItem.title || item.title,
            keywords: sourceKeywords,
          },
          selectedPages: selectedPagesForGmb,
          allowedServices: allowedServiceNames,
          verifiedOffer,
        },
        dedup: { userId: user.id, workspaceId: wid, websiteOrigin: origin },
      });
      if (postData.__timing) { genTimings.push(postData.__timing); delete postData.__timing; }

      if (platform === "GMB" && postData?.error === "NO_VERIFIED_OFFER") {
        gmbSkipped = {
          reason:
            "No verified offer or event found for this content type. Choose another GMB category.",
        };
        continue;
      }

      let imageUrl = null;
      let imageStatus = null;
      if (inlineImageGen) {
        imageUrl = await resolveImageUrl({
          keyword: sourceKeywords.primary,
          location: loc,
          platform,
          heading: postData.heading,
          imageSource: resolvedImageSource,
          preferredModel: preferredImageModel,
        });
        imageStatus = imageUrl ? "ready" : "failed";
        if (resolvedImageSource === "free") {
          await freeImageRateLimitPause();
        }
      } else if (deferImageGen) {
        imageStatus = "pending";
      }

      const secondaryPack =
        sourceKeywords.secondaryKeywords || sourceKeywords.general || [sourceKeywords.secondary];

      const row = await prisma.studioPost.create({
        data: {
          userId: user.id,
          workspaceId: wid,
          fingerprint: fp,
          websiteOrigin: origin || websiteOriginFromUrl(sourceUrl),
          sourceUrl,
          platform,
          tone: platform === "GMB" ? gmbCategoryId : selectedTone,
          location: loc,
          primaryKeyword: polishKeyword(sourceKeywords.primary, loc),
          secondaryKeyword: polishKeyword(secondaryPack[0] || sourceKeywords.secondary, loc),
          generalKeywords: packKeywordPack(
            secondaryPack.map((k) => polishKeyword(k, loc)).slice(0, 4),
            {
              gmbCategory: platform === "GMB" ? gmbCategoryId : null,
              cta: postData.cta || null,
              sourceTitle: sourceItem.title || item.title || "",
              validation: postData.validation || null,
              ruleset: postData.ruleset || (platform === "GMB" ? GMB_RULESET_VERSION : null),
            }
          ),
          heading: postData.heading,
          content: postData.content,
          contentHtml: postData.contentHtml,
          imageUrl,
          imageStatus,
          status: "draft",
          locked: false,
          archived: false,
        },
      });

      if (imageStatus === "pending") imagesPending.push(row.id);
      posts.push(serializePost(row));
    }
  }

  if (wantsGmb && !gmbSkipped) {
    const sourceItem =
      pickRelevantSourcePage(selectedPagesForGmb, gmbCategoryId, loc) || analyzed[0];
    const sourceUrl = sourceItem.url;
    const sourceKeywords = sourceItem.keywords || analyzed[0].keywords;
    const fp = fingerprintOf(sourceUrl, "GMB", sourceKeywords.primary);
    if (lockedSet.has(fp)) {
      skippedLocked.push({ url: sourceUrl, platform: "GMB", reason: "Already published & locked" });
    } else {
      const postData = await generatePostWithDedup({
        platform: "GMB",
        keywords: sourceKeywords,
        location: loc,
        url: sourceUrl,
        tone: gmbCategoryId,
        options: {
          writingIntent: sourceItem.writingIntent,
          masterIntent: sourceItem.masterIntent || siteMasterIntent,
          writingModel,
          ownerName: user.name,
          gmbCategory: gmbCategoryId,
          business,
          voice: brandVoice,
          websiteOrigin: origin,
          foreignNames,
          sourceTitle: sourceItem.title,
          sourcePage: {
            url: sourceUrl,
            title: sourceItem.title,
            keywords: sourceKeywords,
          },
          selectedPages: selectedPagesForGmb,
          allowedServices: allowedServiceNames,
          verifiedOffer,
        },
        dedup: { userId: user.id, workspaceId: wid, websiteOrigin: origin },
      });
      if (postData.__timing) { genTimings.push(postData.__timing); delete postData.__timing; }
      if (postData?.error === "NO_VERIFIED_OFFER") {
        gmbSkipped = {
          reason:
            "No verified offer or event found for this content type. Choose another GMB category.",
        };
      } else {
        let imageUrl = null;
        let imageStatus = null;
        if (inlineImageGen) {
          imageUrl = await resolveImageUrl({
            keyword: sourceKeywords.primary,
            location: loc,
            platform: "GMB",
            heading: postData.heading,
            imageSource: resolvedImageSource,
            preferredModel: preferredImageModel,
          });
          imageStatus = imageUrl ? "ready" : "failed";
        } else if (deferImageGen) {
          imageStatus = "pending";
        }
        const secondaryPack =
          sourceKeywords.secondaryKeywords ||
          sourceKeywords.general ||
          [sourceKeywords.secondary];
        const row = await prisma.studioPost.create({
          data: {
            userId: user.id,
            workspaceId: wid,
            fingerprint: fp,
            websiteOrigin: origin || websiteOriginFromUrl(sourceUrl),
            sourceUrl,
            platform: "GMB",
            tone: gmbCategoryId,
            location: loc,
            primaryKeyword: polishKeyword(sourceKeywords.primary, loc),
            secondaryKeyword: polishKeyword(
              secondaryPack[0] || sourceKeywords.secondary,
              loc
            ),
            generalKeywords: packKeywordPack(
              secondaryPack.map((k) => polishKeyword(k, loc)).slice(0, 4),
              {
                gmbCategory: gmbCategoryId,
                cta: postData.cta || null,
                sourceTitle: sourceItem.title || "",
                validation: postData.validation || null,
                ruleset: postData.ruleset || GMB_RULESET_VERSION,
              }
            ),
            heading: postData.heading,
            content: postData.content,
            contentHtml: postData.contentHtml,
            imageUrl,
            imageStatus,
            status: "draft",
            locked: false,
            archived: false,
          },
        });
        if (imageStatus === "pending") imagesPending.push(row.id);
        posts.push(serializePost(row));
      }
    }
  }

  // Batch 5: commit a durable image job per pending post BEFORE responding.
  // The in-process worker generates them out-of-band and survives restarts;
  // the client only needs to poll post state. Enqueue is idempotent per post.
  if (deferImageGen && imagesPending.length) {
    for (const pid of imagesPending) {
      try {
        await enqueueImageJob({
          postId: pid,
          userId: user.id,
          workspaceId: wid,
          websiteOrigin: origin,
          imageSource: resolvedImageSource,
        });
      } catch (err) {
        console.error("[generate enqueue image]", pid, err.message);
      }
    }
  }

  return {
    ok: true,
    workspaceId: wid,
    location: loc,
    tone: selectedTone,
    platforms,
    gmbCategory: gmbCategoryId,
    gmbSkipped,
    expectedTotal,
    pageCount: analyzed.length,
    websiteOrigin: origin,
    switchingWebsite,
    archivedCount,
    masterIntent: siteMasterIntent || analyzed[0]?.masterIntent || null,
    analyzed,
    posts,
    skippedLocked,
    includeImages: !!includeImages,
    imageSource: includeImages ? resolvedImageSource : null,
    // Batch 4: text drafts are ready now; these postIds still need images.
    // The client should call /auto-poster/attach-images with these ids and
    // render a per-card image placeholder until each one resolves.
    imagesDeferred: deferImageGen,
    imagesPending,
    providerDecision,
    tones: TONE_PRESETS,
    ruleset: GMB_RULESET_VERSION,
    // P1 — the distinct voice profile used for this website (debug/observability).
    brandVoice: {
      voiceId: brandVoice.voiceId,
      industry: brandVoice.industry,
      audience: brandVoice.audience,
      tones: brandVoice.tones,
      formality: brandVoice.formality,
      source: brandVoice.source,
      cached: brandVoice.cached,
    },
    // P2 — ACTUAL measured generation latency by stage (not estimates).
    metrics: {
      ...suiteTimer.end(),
      perPost: aggregateSummaries(genTimings),
    },
  };
  } finally {
    releaseGenerateLock(genKey);
  }
}

function liveGmbValidation(row, packed) {
  const meta = packed.meta || {};
  const gmbCategory =
    meta.gmbCategory ||
    (row.platform === "GMB" && isGmbCategoryId(row.tone) ? row.tone : null);
  const validation = validateGmbPost({
    content: row.content,
    heading: row.heading,
    categoryId: gmbCategory || GMB_CATEGORY_IDS.INTENT_PROXIMITY,
    location: row.location,
    keywords: {
      primary: row.primaryKeyword,
      secondary: row.secondaryKeyword,
      general: packed.keywords,
    },
    sourceTitle: meta.sourceTitle || "",
  });
  // P1 — informational naturalness score, consistent with the social path.
  validation.naturalness = scoreNaturalness(row.content, {
    keywords: { primary: row.primaryKeyword, secondary: row.secondaryKeyword, general: packed.keywords },
  });
  return validation;
}

/** Parse the stored title-overlay JSON config; never throws on legacy/bad data. */
function parseOverlayConfig(raw) {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

/**
 * P2 — policy snapshot for a post: accurate (platform-aware) character count,
 * placement/method-aware hashtag validation, and policy freshness. Replaces the
 * previous hardcoded hashtag/length assumptions at the serialization boundary.
 */
export function buildPostPolicy(platform, content) {
  const count = policyCountText(platform, content);
  const hashtags = policyValidateHashtags({
    platform,
    text: content,
    placement: platform === "Instagram" ? "caption" : platform === "Pinterest" ? "description" : "body",
    publishingMethod: platform === "GMB" ? "api" : "api",
  });
  const fresh = policyFreshness(platform);
  return {
    charCount: count.count,
    charLimit: count.limit,
    charRemaining: count.remaining,
    overLimit: count.overLimit,
    countMethod: count.method,
    hashtags: {
      supported: hashtags.supported,
      count: hashtags.count,
      max: hashtags.max ?? null,
      recommended: hashtags.recommended ?? null,
      overLimit: hashtags.overLimit,
      issues: hashtags.issues,
      advisories: hashtags.advisories,
    },
    freshness: fresh
      ? {
          policyVersion: fresh.policyVersion,
          documentedAt: fresh.documentedAt,
          stale: fresh.stale,
          verificationMethod: fresh.verificationMethod,
          source: fresh.source,
        }
      : null,
  };
}

export function serializePost(row) {
  const packed = unpackKeywordPack(row.generalKeywords);
  const general = packed.keywords;
  const meta = packed.meta || {};
  const gmbCategory =
    meta.gmbCategory ||
    (row.platform === "GMB" && isGmbCategoryId(row.tone) ? row.tone : null);
  const validation =
    row.platform === "GMB"
      ? liveGmbValidation(row, packed)
      : meta.validation ||
        validateSocialPost({
          content: row.content,
          platform: row.platform,
          minWords: PLATFORM_CONFIG[row.platform]?.minWords,
          maxWords: PLATFORM_CONFIG[row.platform]?.maxWords,
        });
  return {
    id: row.id,
    url: row.sourceUrl,
    platform: row.platform,
    tone: row.tone,
    location: row.location,
    keywords: {
      primary: row.primaryKeyword,
      secondary: row.secondaryKeyword,
      general,
    },
    heading: row.heading,
    content: row.content,
    contentHtml: row.contentHtml || row.content,
    wordCount: countWords(row.content || row.contentHtml || ""),
    charCount: countChars(row.content || ""),
    image: row.imageUrl,
    imageSourceUrl: row.imageSourceUrl || null,
    overlay: parseOverlayConfig(row.overlayConfig),
    imageStatus: row.imageStatus || (row.imageUrl ? "ready" : null),
    imagePending: row.imageStatus === "pending",
    // Structured, validated CTA — tells the UI the REAL link capability so a
    // plain-text phrase is never shown as a clickable button (P0 CTA fix).
    // Exposed under `ctaInfo` so the legacy string `cta` (label text) is kept.
    ctaInfo: buildCta({
      platform: row.platform,
      gmbLabel: row.platform === "GMB" ? resolveGmbCta(gmbCategory, {}) : undefined,
      destinationUrl: row.sourceUrl,
      businessOrigin: row.websiteOrigin || websiteOriginFromUrl(row.sourceUrl),
    }),
    // P2 — policy-aware character count + hashtag validation from the versioned
    // registry (NOT hardcoded assumptions). For GMB, hashtags are honestly
    // reported as an unsupported/advisory platform feature, not a "5" rule.
    policy: buildPostPolicy(row.platform, row.content || ""),
    status: row.status,
    locked: row.locked,
    scheduledDate: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    fingerprint: row.fingerprint,
    websiteOrigin: row.websiteOrigin || websiteOriginFromUrl(row.sourceUrl),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    workspaceId: row.workspaceId,
    archived: !!row.archived,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    publishLocked: !!(row.locked && row.status === "published"),
    gmbCategory,
    cta: meta.cta || null,
    sourceTitle: meta.sourceTitle || null,
    validation,
    ruleset: meta.ruleset || (row.platform === "GMB" ? GMB_RULESET_VERSION : null),
    // 30-Day Automation metadata (only present for Google-Sheet posts).
    sheet:
      meta.source === "google-sheet"
        ? {
            generated: meta.generated === true,
            generateImage: !!meta.generateImage,
            plannedScheduleAt: meta.plannedScheduleAt || null,
            scheduleNote: meta.scheduleNote || null,
            imageError: meta.imageError || null,
            rowId: meta.rowId || null,
            rowNumber: meta.rowNumber ?? null,
          }
        : null,
  };
}

export async function listStudioPosts({
  email,
  workspaceId,
  status,
  archived = false,
  includeArchived = false,
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const includeAll = includeArchived === true || includeArchived === "true";
  const where = {
    userId: auth.user.id,
  };
  if (workspaceId) where.workspaceId = workspaceId;
  if (!includeAll) {
    where.archived = archived === true || archived === "true";
  }
  if (status) where.status = status;

  const rows = await prisma.studioPost.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });

  for (const row of rows) {
    if (row.platform !== "GMB") continue;
    if (row.archived || row.status !== "draft") continue;
    const packed = unpackKeywordPack(row.generalKeywords);
    const stored = packed.meta?.validation;
    if (!stored?.ready) continue;
    const live = liveGmbValidation(row, packed);
    if (live.ready) continue;
    try {
      await prisma.studioPost.update({
        where: { id: row.id },
        data: {
          generalKeywords: packKeywordPack(packed.keywords, {
            ...packed.meta,
            validation: live,
          }),
        },
      });
    } catch {
      /* listing still returns live validation even if persist fails */
    }
  }

  return { ok: true, posts: rows.map(serializePost), archived: includeAll ? null : where.archived };
}

export async function archiveStudioPosts({ email, postIds, confirm, workspaceId }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  if (confirm !== true && confirm !== "true") {
    return {
      ok: false,
      status: 400,
      error: "Confirmation required. Pass confirm: true to archive posts.",
    };
  }

  const ids = Array.isArray(postIds)
    ? [...new Set(postIds.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  if (!ids.length) {
    return { ok: false, status: 400, error: "postIds are required" };
  }

  const ownedWhere = { id: { in: ids }, userId: auth.user.id };
  if (workspaceId) ownedWhere.workspaceId = workspaceId;

  const owned = await prisma.studioPost.findMany({
    where: ownedWhere,
    select: { id: true },
  });
  const ownedIds = owned.map((p) => p.id);
  if (!ownedIds.length) {
    return { ok: false, status: 404, error: "No matching posts to archive" };
  }

  const result = await prisma.studioPost.updateMany({
    where: { id: { in: ownedIds }, userId: auth.user.id, archived: false },
    data: { archived: true, archivedAt: new Date() },
  });

  return { ok: true, archived: result.count };
}

/**
 * Part 5 — Archived posts grouped into tables by websiteOrigin.
 */
export async function listArchivedStudioPosts({ email, workspaceId }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const where = {
    userId: auth.user.id,
    archived: true,
  };
  if (workspaceId) where.workspaceId = workspaceId;

  const rows = await prisma.studioPost.findMany({
    where,
    orderBy: [{ websiteOrigin: "asc" }, { updatedAt: "desc" }],
  });

  const byWebsite = new Map();
  for (const row of rows) {
    const origin =
      row.websiteOrigin || websiteOriginFromUrl(row.sourceUrl) || "Unknown website";
    if (!byWebsite.has(origin)) {
      byWebsite.set(origin, {
        websiteOrigin: origin,
        archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
        posts: [],
      });
    }
    const bucket = byWebsite.get(origin);
    bucket.posts.push(serializePost(row));
    if (row.archivedAt) {
      const iso = row.archivedAt.toISOString();
      if (!bucket.archivedAt || iso > bucket.archivedAt) bucket.archivedAt = iso;
    }
  }

  const tables = [...byWebsite.values()].map((t) => ({
    ...t,
    count: t.posts.length,
    lockedCount: t.posts.filter((p) => p.publishLocked).length,
  }));

  return {
    ok: true,
    total: rows.length,
    websiteCount: tables.length,
    tables,
  };
}

/**
 * Part 5 — Clear archive (confirm required). Optional per-website.
 */
export async function clearStudioArchive({
  email,
  workspaceId,
  websiteOrigin,
  confirm,
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  if (confirm !== true && confirm !== "true" && confirm !== "CLEAR") {
    return {
      ok: false,
      status: 400,
      error: "Confirmation required. Pass confirm: true to permanently clear archive.",
    };
  }

  const where = {
    userId: auth.user.id,
    archived: true,
  };
  if (workspaceId) where.workspaceId = workspaceId;
  if (websiteOrigin) {
    where.OR = [
      { websiteOrigin: String(websiteOrigin) },
      // legacy rows without origin that match host
      {
        websiteOrigin: null,
        sourceUrl: { contains: String(websiteOrigin).replace(/^https?:\/\//, "") },
      },
    ];
  }

  const result = await prisma.studioPost.deleteMany({ where });
  return {
    ok: true,
    deleted: result.count,
    websiteOrigin: websiteOrigin || null,
  };
}

export async function publishStudioPost({ email, postId, alsoLive = true }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const post = await prisma.studioPost.findFirst({
    where: { id: postId, userId: auth.user.id },
  });
  if (!post) return { ok: false, status: 404, error: "Post not found" };
  if (post.locked && post.status === "published") {
    return { ok: false, status: 409, error: "Post is already published and locked." };
  }

  // Block if another locked published post shares fingerprint
  const dup = await prisma.studioPost.findFirst({
    where: {
      userId: auth.user.id,
      fingerprint: post.fingerprint,
      locked: true,
      status: "published",
      NOT: { id: post.id },
    },
  });
  if (dup) {
    return {
      ok: false,
      status: 409,
      error: "An identical keyword/platform/page combo was already published and locked.",
    };
  }

  const provider = PLATFORM_CONFIG[post.platform]?.key;
  if (!provider) {
    return { ok: false, status: 400, error: `Unknown platform: ${post.platform}` };
  }

  // Live OAuth publish is required by default — do not fake-success in DB only
  let live = null;
  if (alsoLive !== false) {
    try {
      live = await publishContent({
        email: auth.email,
        content: post.content,
        action: provider === "google_business" ? "gbp_post" : "social_suite",
        providers: [provider],
        contentByProvider: { [provider]: post.content },
        imageUrl: post.imageUrl || undefined,
        workspaceId: post.workspaceId || undefined,
        cta: provider === "google_business" ? { google_business: buildPostCta(post) } : undefined,
      });
    } catch (err) {
      live = { ok: false, status: 502, error: err.message || "Live publish failed" };
    }

    if (!live?.ok) {
      return {
        ok: false,
        status: live?.status || 502,
        error:
          live?.error ||
          live?.message ||
          "Live publish failed. Connect this platform under Connections for the active client, then try again.",
        live,
      };
    }
  }

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: {
      status: "published",
      locked: true,
      publishedAt: new Date(),
      scheduledAt: null,
    },
  });

  await stampPostActivity(auth.user.id, post.platform).catch(() => {});

  return { ok: true, post: serializePost(updated), live };
}

export async function scheduleStudioPost({ email, postId, scheduledAt }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
    return { ok: false, status: 400, error: "Pick a future date and time." };
  }

  const post = await prisma.studioPost.findFirst({
    where: { id: postId, userId: auth.user.id },
  });
  if (!post) return { ok: false, status: 404, error: "Post not found" };
  if (post.locked && post.status === "published") {
    return { ok: false, status: 409, error: "Published posts are locked. Regenerate first." };
  }

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: {
      status: "scheduled",
      scheduledAt: when,
      locked: false,
    },
  });

  return { ok: true, post: serializePost(updated) };
}

/** Part 4 — cancel a scheduled auto-post → back to draft */
export async function unscheduleStudioPost({ email, postId }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const post = await prisma.studioPost.findFirst({
    where: { id: postId, userId: auth.user.id },
  });
  if (!post) return { ok: false, status: 404, error: "Post not found" };
  if (post.status !== "scheduled") {
    return { ok: false, status: 400, error: "Post is not scheduled." };
  }

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: {
      status: "draft",
      scheduledAt: null,
      locked: false,
    },
  });

  return { ok: true, post: serializePost(updated) };
}

/**
 * Delete / cancel a post with status-aware, race-safe semantics.
 *
 * - draft / failed / canceled: hard-delete the local record.
 * - scheduled: atomically CANCEL future publication first (guarded on the
 *   scheduled state), which races safely against the publishing worker — exactly
 *   one of {cancel, claim} can win. Only after the row is proven out of the
 *   scheduled state is it removed. If the worker already claimed it ("publishing")
 *   or it already published, we report the real state instead of pretending we
 *   stopped it.
 * - published: delete only the LOCAL library record. The external post is NOT
 *   removed — that requires explicit, provider-supported remote deletion.
 *
 * Every branch is scoped to the authenticated user's id (no IDOR / cross-tenant).
 */
export async function deleteStudioPost({ email, postId }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const post = await prisma.studioPost.findFirst({
    where: { id: postId, userId: auth.user.id },
  });
  if (!post) return { ok: false, status: 404, error: "Post not found" };

  if (post.status === "scheduled") {
    const canceled = await prisma.studioPost.updateMany({
      where: { id: post.id, userId: auth.user.id, status: "scheduled" },
      data: { status: "canceled", scheduledAt: null, canceledAt: new Date() },
    });
    if (canceled.count === 1) {
      await prisma.studioPost.deleteMany({
        where: { id: post.id, userId: auth.user.id, status: "canceled" },
      });
      return { ok: true, deleted: true, postId: post.id, wasScheduled: true };
    }
    // Lost the race — report the actual state honestly.
    const fresh = await prisma.studioPost.findUnique({ where: { id: post.id } });
    if (fresh?.status === "publishing") {
      return {
        ok: false,
        status: 409,
        error:
          "This post is being published right now and can no longer be canceled. Refresh to see its final state.",
      };
    }
    if (fresh?.status === "published") {
      return {
        ok: false,
        status: 409,
        error:
          "This scheduled post has already been published to the platform and can't be canceled. You can delete the published record from Archive.",
      };
    }
    return { ok: false, status: 409, error: "Post state changed — refresh and try again." };
  }

  if (post.status === "publishing") {
    return {
      ok: false,
      status: 409,
      error: "This post is publishing right now. Try again once it finishes.",
    };
  }

  const wasPublished = post.status === "published";
  // Guard on `status: { not: "publishing" }` so we never delete a row that a
  // worker is actively publishing (defense in depth; publishing is handled above).
  const removed = await prisma.studioPost.deleteMany({
    where: { id: post.id, userId: auth.user.id, status: { not: "publishing" } },
  });
  if (removed.count !== 1) {
    return { ok: false, status: 409, error: "Post state changed — refresh and try again." };
  }

  return {
    ok: true,
    deleted: true,
    postId: post.id,
    wasPublished,
    remoteNote: wasPublished
      ? "Removed from your Avonix library only — the post already published on the external platform was not deleted."
      : undefined,
  };
}

/**
 * Part 4 — Regenerate unlocks a published post for reuse.
 * New fingerprint so the same page/platform/keyword can be published again
 * without colliding with the previous locked publish.
 * Image follows the same lock rule: stays until regenerate with includeImages.
 */
export async function rewriteStudioPost({
  email,
  postId,
  tone,
  includeImages = false,
  imageSource = "auto",
  gmbCategory,
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const post = await prisma.studioPost.findFirst({
    where: { id: postId, userId: auth.user.id },
  });
  if (!post) return { ok: false, status: 404, error: "Post not found" };

  const packed = unpackKeywordPack(post.generalKeywords);
  const general = packed.keywords;
  const storedCategory =
    packed.meta?.gmbCategory ||
    (post.platform === "GMB" && isGmbCategoryId(post.tone) ? post.tone : null);
  const gmbCategoryId = isGmbCategoryId(gmbCategory) ? gmbCategory : storedCategory;

  const selectedTone =
    post.platform === "GMB"
      ? gmbCategoryId || GMB_CATEGORY_IDS.INTENT_PROXIMITY
      : TONE_PRESETS.includes(tone)
        ? tone
        : post.tone;

  const keywords = {
    primary: post.primaryKeyword,
    secondary: post.secondaryKeyword,
    secondaryKeywords: general.length ? general : [post.secondaryKeyword],
    general: general.length ? general : [post.secondaryKeyword],
  };

  const intentMatch = String(post.content || "").match(
    /Intent focus \(([^)]+)\):\s*(.+?)(?:\n|$)/
  );
  const writingIntent = intentMatch?.[1] || "Awareness";
  const masterIntent =
    intentMatch?.[2]?.trim() ||
    `Rewrite for ${post.platform} using ${post.primaryKeyword} in ${post.location}`;

  const workspace = post.workspaceId
    ? await prisma.clientWorkspace.findUnique({ where: { id: post.workspaceId } })
    : null;
  const business = await resolveBusinessContext(auth.user.id, post.workspaceId, workspace, auth.user.name);
  const foreignNames = await resolveForeignBusinessNames(auth.user.id, post.workspaceId, business.name);
  const rewriteOrigin = post.websiteOrigin || websiteOriginFromUrl(post.sourceUrl);
  const verifiedOffer = detectVerifiedOffer([
    {
      url: post.sourceUrl,
      title: packed.meta?.sourceTitle,
      keywords,
    },
  ]);

  const providerDecision = await selectBestStudioProviders({
    websiteUrl: post.websiteOrigin || post.sourceUrl,
    location: post.location,
    masterIntent,
    dominantIntent: writingIntent,
    pageSample: [{ url: post.sourceUrl, writingIntent, keywords: { primary: post.primaryKeyword } }],
    includeImages: !!includeImages,
    forceImageSource: imageSource === "auto" ? undefined : imageSource,
  });

  // P1 — reuse this website's cached distinct brand voice for the rewrite.
  const brandVoice = await getBrandVoice({
    userId: auth.user.id,
    workspaceId: post.workspaceId,
    websiteOrigin: rewriteOrigin,
    pages: [{ url: post.sourceUrl, title: packed.meta?.sourceTitle, keywords }],
    keywords,
    location: post.location,
    business,
    model: providerDecision.writing.model,
    enrich: !!process.env.OPENROUTER_API_KEY,
  });

  const rewritten = await generatePostContentWithAi(
    post.platform,
    keywords,
    post.location,
    post.sourceUrl,
    selectedTone,
    {
      writingIntent,
      masterIntent,
      writingModel: providerDecision.writing.model,
      ownerName: auth.user.name,
      gmbCategory: post.platform === "GMB" ? selectedTone : undefined,
      business,
      voice: brandVoice,
      websiteOrigin: rewriteOrigin,
      foreignNames,
      sourceTitle: packed.meta?.sourceTitle,
      sourcePage: {
        url: post.sourceUrl,
        title: packed.meta?.sourceTitle,
        keywords,
      },
      selectedPages: [
        {
          url: post.sourceUrl,
          title: packed.meta?.sourceTitle,
          keywords,
        },
      ],
      verifiedOffer,
    }
  );

  const newFingerprint = fingerprintOf(
    post.sourceUrl,
    post.platform,
    `${keywords.primary}|regen-${Date.now()}`
  );

  let imageUrl = post.imageUrl;
  let imageStatus = post.imageStatus || (post.imageUrl ? "ready" : null);
  if (includeImages) {
    const resolvedSource =
      imageSource === "auto" ? providerDecision.image.source : imageSource;
    imageUrl = await resolveImageUrl({
      keyword: keywords.primary,
      location: post.location,
      platform: post.platform,
      heading: rewritten.heading,
      imageSource: resolvedSource,
      preferredModel: providerDecision.image.model || undefined,
    });
    imageStatus = imageUrl ? "ready" : "failed";
  }

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: {
      fingerprint: newFingerprint,
      tone: selectedTone,
      heading: rewritten.heading,
      content: rewritten.content,
      contentHtml: rewritten.contentHtml,
      generalKeywords: packKeywordPack(keywords.secondaryKeywords, {
        gmbCategory: post.platform === "GMB" ? selectedTone : packed.meta?.gmbCategory,
        cta: rewritten.cta || packed.meta?.cta || null,
        sourceTitle: packed.meta?.sourceTitle || "",
        validation: rewritten.validation || null,
        ruleset: rewritten.ruleset || packed.meta?.ruleset || null,
      }),
      imageUrl,
      imageStatus,
      status: "draft",
      locked: false,
      scheduledAt: null,
      archived: false,
      archivedAt: null,
      rewriteOfId: post.rewriteOfId || post.id,
    },
  });

  return {
    ok: true,
    post: serializePost(updated),
    unlocked: true,
    restoredFromArchive: !!post.archived,
    previousPublishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
    providerDecision,
  };
}

export async function updateStudioPostContent({ email, postId, content, heading }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const post = await prisma.studioPost.findFirst({
    where: { id: postId, userId: auth.user.id },
  });
  if (!post) return { ok: false, status: 404, error: "Post not found" };
  if (post.locked && post.status === "published") {
    return {
      ok: false,
      status: 409,
      error: "Published posts are locked. Regenerate first to edit.",
    };
  }

  const packed = unpackKeywordPack(post.generalKeywords);
  const nextHeading = heading != null ? String(heading) : post.heading;
  const nextContent = content != null ? String(content) : post.content;
  const gmbCategory =
    packed.meta?.gmbCategory ||
    (post.platform === "GMB" && isGmbCategoryId(post.tone) ? post.tone : null);

  const validation =
    post.platform === "GMB"
      ? validateGmbPost({
          content: nextContent,
          heading: nextHeading,
          categoryId: gmbCategory || GMB_CATEGORY_IDS.INTENT_PROXIMITY,
          location: post.location,
          keywords: {
            primary: post.primaryKeyword,
            secondary: post.secondaryKeyword,
            general: packed.keywords,
          },
        })
      : validateSocialPost({
          content: nextContent,
          platform: post.platform,
          minWords: PLATFORM_CONFIG[post.platform]?.minWords,
          maxWords: PLATFORM_CONFIG[post.platform]?.maxWords,
        });

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: {
      heading: nextHeading,
      content: nextContent,
      contentHtml: plainToPreviewHtml(nextContent),
      generalKeywords: packKeywordPack(packed.keywords, {
        ...packed.meta,
        validation,
      }),
    },
  });

  return { ok: true, post: serializePost(updated), validation };
}

/**
 * Feature D — apply (or remove) a professional title overlay on a post image.
 *
 * Non-destructive: the first time an overlay is applied the original image URL
 * is captured in `imageSourceUrl`, so the user can re-adjust or remove the
 * overlay later without losing the source. The browser composites the pixels on
 * a <canvas> and sends the result as a data URL (`renderedImage`) — the preview
 * is therefore identical to the exported/published asset. A server-side SVG
 * fallback is used only when no browser raster is provided.
 */
export async function applyStudioImageOverlay({
  email,
  postId,
  overlayConfig,
  renderedImage,
  removeOverlay = false,
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const post = await prisma.studioPost.findFirst({
    where: { id: postId, userId: auth.user.id },
  });
  if (!post) return { ok: false, status: 404, error: "Post not found" };
  if (post.locked && post.status === "published") {
    return {
      ok: false,
      status: 409,
      error: "Published posts are locked. Regenerate first to edit the image.",
    };
  }

  // The original source is captured once so overlays stay non-destructive.
  const sourceUrl = post.imageSourceUrl || post.imageUrl || null;

  if (removeOverlay) {
    if (!sourceUrl) {
      return { ok: false, status: 400, error: "No original image to restore." };
    }
    const restored = await prisma.studioPost.update({
      where: { id: post.id },
      data: { imageUrl: sourceUrl, overlayConfig: null },
    });
    return { ok: true, post: serializePost(restored) };
  }

  if (!sourceUrl) {
    return {
      ok: false,
      status: 400,
      error: "This post has no image to overlay. Attach an image first.",
    };
  }

  let finalUrl = null;
  if (renderedImage && /^data:image\//.test(String(renderedImage))) {
    // Browser canvas export — persist the composited raster (preview == export).
    try {
      finalUrl = await persistImageUrl(renderedImage);
    } catch (err) {
      console.error("[autoPoster overlay persist]", err.message);
      finalUrl = null;
    }
  } else {
    // Server-side fallback: embed the source in a self-contained SVG overlay.
    try {
      const cfg = normalizeOverlayConfig(overlayConfig || {});
      const dims = PLATFORM_CONFIG[post.platform]?.image || { width: 1080, height: 1080 };
      const layout = computeOverlayLayout({
        imageWidth: dims.width,
        imageHeight: dims.height,
        title: (overlayConfig && overlayConfig.title) || post.heading,
        config: cfg,
      });
      const svg = buildOverlaySvg({ layout, imageHref: sourceUrl, config: cfg });
      finalUrl = await persistImageUrl(
        `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
      );
    } catch (err) {
      console.error("[autoPoster overlay svg]", err.message);
      finalUrl = null;
    }
  }

  if (!finalUrl) {
    // Rendering failed — leave the draft and the original image untouched.
    return {
      ok: false,
      status: 502,
      error: "Overlay render failed. Your original image is unchanged.",
    };
  }

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: {
      imageSourceUrl: sourceUrl, // preserve original (idempotent once set)
      imageUrl: finalUrl,
      overlayConfig: JSON.stringify({
        ...(overlayConfig || {}),
        appliedAt: new Date().toISOString(),
      }),
      imageStatus: "ready",
    },
  });

  return { ok: true, post: serializePost(updated) };
}

export function getGmbRulesCatalog() {
  return gmbUiCatalog();
}

/**
 * Part 3 — Attach / regenerate / clear image on a single post.
 * Locked published posts cannot change images until rewrite unlocks them.
 */
export async function setStudioPostImage({
  email,
  postId,
  action = "generate", // generate | clear
  imageSource = "auto",
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const post = await prisma.studioPost.findFirst({
    where: { id: postId, userId: auth.user.id },
  });
  if (!post) return { ok: false, status: 404, error: "Post not found" };

  if (post.locked && post.status === "published") {
    return {
      ok: false,
      status: 409,
      error: "Post is locked. Rewrite first to change the image.",
    };
  }

  if (action === "clear") {
    const updated = await prisma.studioPost.update({
      where: { id: post.id },
      data: { imageUrl: null, imageStatus: null },
    });
    return { ok: true, post: serializePost(updated), imageSource: null };
  }

  const decision = await selectBestStudioProviders({
    websiteUrl: post.websiteOrigin || post.sourceUrl,
    location: post.location,
    masterIntent: post.heading,
    dominantIntent: "Awareness",
    pageSample: [{ url: post.sourceUrl, keywords: { primary: post.primaryKeyword } }],
    includeImages: true,
    forceImageSource: imageSource === "auto" ? undefined : imageSource,
  });
  const resolvedSource =
    imageSource === "auto" ? decision.image.source : imageSource;

  const result = await generateStudioImage({
    keyword: post.primaryKeyword,
    location: post.location,
    platform: post.platform,
    heading: post.heading,
    imageSource: resolvedSource,
    preferredModel: decision.image.model || undefined,
  });
  const url = typeof result === "string" ? result : result?.url;
  if (!url) {
    // Durable failure state so the UI can offer a per-post retry after refresh.
    await prisma.studioPost.update({
      where: { id: post.id },
      data: { imageStatus: "failed" },
    });
    return {
      ok: false,
      status: 502,
      error: result?.error || "Could not generate image. Try Free source.",
    };
  }

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: { imageUrl: url, imageStatus: "ready" },
  });

  return {
    ok: true,
    post: serializePost(updated),
    imageMeta: typeof result === "object" ? result : { url, source: resolvedSource },
    providerDecision: decision,
  };
}

/**
 * Part 3 — Batch attach images to draft posts missing images (or force all drafts).
 */
export async function attachImagesToStudioPosts({
  email,
  workspaceId,
  imageSource = "auto",
  onlyMissing = true,
  postIds,
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const where = {
    userId: auth.user.id,
    status: { in: ["draft", "scheduled"] },
    locked: false,
  };
  if (workspaceId) where.workspaceId = workspaceId;
  if (Array.isArray(postIds) && postIds.length) {
    where.id = { in: postIds };
  } else if (onlyMissing) {
    where.OR = [{ imageUrl: null }, { imageUrl: "" }];
  }

  const rows = await prisma.studioPost.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 60,
  });

  const decision = await selectBestStudioProviders({
    websiteUrl: rows[0]?.websiteOrigin || rows[0]?.sourceUrl,
    location: rows[0]?.location,
    masterIntent: rows[0]?.heading,
    includeImages: true,
    forceImageSource: imageSource === "auto" ? undefined : imageSource,
    pageSample: rows.slice(0, 5).map((p) => ({
      url: p.sourceUrl,
      keywords: { primary: p.primaryKeyword },
    })),
  });
  const resolvedSource =
    imageSource === "auto" ? decision.image.source : imageSource;

  const posts = [];
  let attached = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const post = rows[i];
    try {
      const result = await generateStudioImage({
        keyword: post.primaryKeyword,
        location: post.location,
        platform: post.platform,
        heading: post.heading,
        imageSource: resolvedSource,
        preferredModel: decision.image.model || undefined,
      });
      const url = typeof result === "string" ? result : result?.url;
      if (!url) {
        const u = await prisma.studioPost.update({
          where: { id: post.id },
          data: { imageStatus: "failed" },
        });
        posts.push(serializePost(u));
        failed += 1;
        continue;
      }
      const updated = await prisma.studioPost.update({
        where: { id: post.id },
        data: { imageUrl: url, imageStatus: "ready" },
      });
      posts.push(serializePost(updated));
      attached += 1;
      // Free Pollinations rate limits — pause between gens
      if (resolvedSource === "free" && i < rows.length - 1) {
        await freeImageRateLimitPause();
      }
    } catch (err) {
      console.error("[attachImages]", post.id, err.message);
      try {
        const u = await prisma.studioPost.update({
          where: { id: post.id },
          data: { imageStatus: "failed" },
        });
        posts.push(serializePost(u));
      } catch { /* ignore */ }
      failed += 1;
    }
  }

  return {
    ok: true,
    attached,
    failed,
    imageSource: resolvedSource,
    providerDecision: decision,
    posts,
  };
}

/* ── Batch 5: durable image generation job ──────────────────────────────────
 * Handler for the "image.generate" job type. Idempotent: it never creates a
 * second image for a post that already has one, and it keeps the post's
 * imageStatus in sync with the job lifecycle (pending while retrying, failed
 * only once the job is terminally out of attempts). Throwing re-queues with
 * backoff. Scoped by userId so a job can only touch its owner's post. */
export async function runImageGenerationJob(payload, job) {
  const { postId, userId = null, imageSource = "auto" } = payload || {};
  if (!postId) throw new Error("image.generate: missing postId");

  const post = await prisma.studioPost.findFirst({
    where: { id: postId, ...(userId ? { userId } : {}) },
  });
  // Post gone (deleted) → nothing to do; treat as success so it leaves the queue.
  if (!post) return { skipped: "post-not-found" };
  // Idempotency: already has an image → do not regenerate (retry / overlap-safe).
  if (post.imageUrl && post.imageStatus === "ready") return { skipped: "already-has-image" };
  // Never touch a locked, published post.
  if (post.locked && post.status === "published") return { skipped: "locked-published" };

  try {
    const decision = await selectBestStudioProviders({
      websiteUrl: post.websiteOrigin || post.sourceUrl,
      location: post.location,
      masterIntent: post.heading,
      dominantIntent: "Awareness",
      pageSample: [{ url: post.sourceUrl, keywords: { primary: post.primaryKeyword } }],
      includeImages: true,
      forceImageSource: imageSource === "auto" ? undefined : imageSource,
    });
    const resolvedSource = imageSource === "auto" ? decision.image.source : imageSource;

    const result = await generateStudioImage({
      keyword: post.primaryKeyword,
      location: post.location,
      platform: post.platform,
      heading: post.heading,
      imageSource: resolvedSource,
      preferredModel: decision.image.model || undefined,
    });
    const url = typeof result === "string" ? result : result?.url;
    if (!url) throw new Error(result?.error || "image provider returned no url");

    await prisma.studioPost.update({
      where: { id: post.id },
      data: { imageUrl: url, imageStatus: "ready" },
    });
    return { ok: true, source: resolvedSource };
  } catch (err) {
    // Keep the card "pending" while the job still has retries left; mark
    // "failed" only when this was the final attempt (job.attempts is the count
    // already made, incremented at claim time).
    const willRetry = !!job && job.attempts < job.maxAttempts;
    await prisma.studioPost
      .update({ where: { id: post.id }, data: { imageStatus: willRetry ? "pending" : "failed" } })
      .catch(() => {});
    throw err;
  }
}

/** Register auto-poster job handlers with the durable queue (called at boot). */
export function registerAutoPosterJobs() {
  registerJobHandler("image.generate", runImageGenerationJob);
}

/** List this user's background jobs (scoped) with safe, non-sensitive fields. */
export async function listUserJobs({ email, status, workspaceId }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;
  const where = { userId: auth.user.id };
  if (status) where.status = status;
  if (workspaceId) where.workspaceId = workspaceId;
  const rows = await prisma.backgroundJob.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return {
    ok: true,
    jobs: rows.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      resourceId: j.resourceId,
      attempts: j.attempts,
      maxAttempts: j.maxAttempts,
      lastError: j.lastError || null,
      runAfter: j.runAfter ? j.runAfter.toISOString() : null,
      startedAt: j.startedAt ? j.startedAt.toISOString() : null,
      finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt ? j.updatedAt.toISOString() : null,
    })),
  };
}

/** Retry image generation for one post by re-arming its durable job (scoped). */
export async function retryImageJob({ email, postId }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;
  const post = await prisma.studioPost.findFirst({
    where: { id: postId, userId: auth.user.id },
  });
  if (!post) return { ok: false, status: 404, error: "Post not found" };
  if (post.locked && post.status === "published") {
    return { ok: false, status: 409, error: "Post is locked. Rewrite first to change the image." };
  }
  await prisma.studioPost.update({ where: { id: post.id }, data: { imageStatus: "pending" } });
  await enqueueImageJob({
    postId: post.id,
    userId: auth.user.id,
    workspaceId: post.workspaceId || null,
    websiteOrigin: post.websiteOrigin || null,
    imageSource: "auto",
  });
  return { ok: true, post: serializePost({ ...post, imageStatus: "pending" }) };
}

/** Build the structured, validated CTA for a stored post (for publishing). */
export function buildPostCta(post) {
  const packed = unpackKeywordPack(post.generalKeywords);
  const gmbCategory =
    packed.meta?.gmbCategory ||
    (post.platform === "GMB" && isGmbCategoryId(post.tone) ? post.tone : null);
  return buildCta({
    platform: post.platform,
    gmbLabel: post.platform === "GMB" ? resolveGmbCta(gmbCategory, {}) : undefined,
    destinationUrl: post.sourceUrl,
    businessOrigin: post.websiteOrigin || websiteOriginFromUrl(post.sourceUrl),
  });
}

/** Enqueue a durable image-generation job for one post (idempotent per post). */
export async function enqueueImageJob({ postId, userId, workspaceId, websiteOrigin, imageSource }) {
  return enqueueJob({
    type: "image.generate",
    dedupeKey: `image:${postId}`,
    payload: { postId, userId, imageSource: imageSource || "auto" },
    userId: userId || null,
    workspaceId: workspaceId || null,
    websiteOrigin: websiteOrigin || null,
    resourceId: postId,
  });
}

/**
 * Due scheduled posts → publish + lock (called by scheduler)
 */
/**
 * How long a post may sit in the transient "publishing" state before a crash
 * is assumed and it is returned to the scheduled queue. Must comfortably exceed
 * a real publish round-trip (image upload + provider API).
 */
const STALE_PUBLISHING_MS =
  Number(process.env.AUTOPOSTER_STALE_PUBLISHING_MS) || 5 * 60 * 1000;

export async function processDueScheduledPosts() {
  // Crash recovery: a post stuck mid-publish (worker died between claim and the
  // terminal write) is returned to the queue after a safety lease so it is not
  // orphaned. updatedAt is bumped by the claim, so only genuinely stale rows
  // revert — a post actively publishing right now is left alone.
  await prisma.studioPost
    .updateMany({
      where: {
        status: "publishing",
        updatedAt: { lt: new Date(Date.now() - STALE_PUBLISHING_MS) },
      },
      data: { status: "scheduled" },
    })
    .catch(() => {});

  const due = await prisma.studioPost.findMany({
    where: {
      status: "scheduled",
      scheduledAt: { lte: new Date() },
      locked: false,
      archived: false,
    },
    take: 50,
    select: { id: true },
  });

  let n = 0;
  for (const { id } of due) {
    // Atomic claim — only one worker can flip scheduled → publishing. A post
    // that was canceled, deleted, or rescheduled in the meantime no longer
    // matches this guard, so it can NEVER be claimed and therefore never
    // published. This also prevents two concurrent workers double-publishing.
    const claim = await prisma.studioPost.updateMany({
      where: {
        id,
        status: "scheduled",
        scheduledAt: { lte: new Date() },
        locked: false,
        archived: false,
      },
      data: { status: "publishing" },
    });
    if (claim.count !== 1) continue; // lost the race (canceled / deleted / claimed)

    // Re-read the freshly-claimed row — never trust the stale batch copy.
    const post = await prisma.studioPost.findUnique({ where: { id } });
    if (!post) continue; // deleted after claim (atomic guard makes this unlikely)

    // On any non-terminal failure, return the post to the queue so the existing
    // retry-on-next-tick behavior is preserved exactly. Guarded on "publishing"
    // so a concurrent cancel is never clobbered.
    const revertToScheduled = () =>
      prisma.studioPost
        .updateMany({ where: { id, status: "publishing" }, data: { status: "scheduled" } })
        .catch(() => {});

    const dup = await prisma.studioPost.findFirst({
      where: {
        userId: post.userId,
        fingerprint: post.fingerprint,
        locked: true,
        status: "published",
        NOT: { id: post.id },
      },
    });
    if (dup) {
      await prisma.studioPost
        .updateMany({ where: { id, status: "publishing" }, data: { status: "draft", scheduledAt: null } })
        .catch(() => {});
      continue;
    }

    const user = await prisma.user.findUnique({ where: { id: post.userId } });
    if (!user?.email) {
      await revertToScheduled();
      continue;
    }

    const provider = PLATFORM_CONFIG[post.platform]?.key;
    if (!provider) {
      await revertToScheduled();
      continue;
    }

    let live;
    try {
      live = await publishContent({
        email: user.email,
        content: post.content,
        action: provider === "google_business" ? "gbp_post" : "social_suite",
        providers: [provider],
        contentByProvider: { [provider]: post.content },
        imageUrl: post.imageUrl || undefined,
        workspaceId: post.workspaceId || undefined,
        cta: provider === "google_business" ? { google_business: buildPostCta(post) } : undefined,
      });
    } catch (err) {
      console.error(`[autoPoster] scheduled live publish failed ${post.id}`, err.message);
      await revertToScheduled();
      continue;
    }

    if (!live?.ok) {
      console.error(
        `[autoPoster] scheduled live publish blocked ${post.id}:`,
        live?.error || live?.message
      );
      await revertToScheduled();
      continue;
    }

    // Terminal success — guarded on "publishing" (no-throw updateMany) so the
    // row that we atomically own is the one we mark published.
    await prisma.studioPost
      .updateMany({
        where: { id, status: "publishing" },
        data: {
          status: "published",
          locked: true,
          publishedAt: new Date(),
          scheduledAt: null,
        },
      })
      .catch(() => {});

    await stampPostActivity(user.id, post.platform).catch(() => {});
    n += 1;
  }

  if (n) console.log(`[autoPoster] auto-published ${n} scheduled post(s)`);
  return n;
}
