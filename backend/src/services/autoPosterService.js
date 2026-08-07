/**
 * Avonix Social:
 * - Scan up to 15 page URLs in parallel
 * - Extract 1 primary + 1 secondary + 4 general keywords per page
 * - Generate FB / IG / LinkedIn / GMB posts by platform rules + tone
 * - Platform-sized realistic images
 * - Publish lock, schedule, rewrite
 */
import crypto from "crypto";
import { callOpenRouter, generateImage, sanitizeEnglishPost } from "../openrouter.js";
import { resolveActiveWorkspace } from "./workspaceService.js";
import { publishContent } from "./publishService.js";
import {
  normalizeDomain,
  discoverSitemapUrls,
  urlPriority,
} from "./siteAnalyzer.js";
import { selectBestStudioProviders } from "./studioProviderRouter.js";
import {
  resolveFreeImage,
  freeImageRateLimitPause,
  buildRelevantImagePrompt,
} from "./freeImageService.js";
import prisma from "../db.js";

async function stampPostActivity(userId, platform) {
  const data =
    platform === "GMB"
      ? { lastGbpPostAt: new Date() }
      : { lastSocialPostAt: new Date() };
  await prisma.user.update({ where: { id: userId }, data });
}

const FETCH_TIMEOUT_MS = Number(process.env.SITE_FETCH_TIMEOUT_MS || 10000);
const MAX_URLS = 15;
const USER_AGENT =
  "Mozilla/5.0 (compatible; AvonixSocialBot/1.0; +https://social.avonixai.com)";

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
    maxWords: 130,
    allowLinks: false,
    allowHashtags: false,
    // Google Business Profile post — HD 16:9
    image: { width: 1200, height: 900, aspect: "4:3" },
  },
};

/** Part 2 target platforms — 15 URLs × 3 = 45 posts */
export const STUDIO_POST_PLATFORMS = ["Facebook", "LinkedIn", "GMB"];

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

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
  return `<a href="${url}" class="text-[#ff6600] underline font-medium" target="_blank" rel="noopener noreferrer">${keyword}</a>`;
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

export function countWords(text) {
  const plain = stripTags(text);
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
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
  while (secondaryList.length < 4) {
    secondaryList.push(polishKeyword(`${primary} related ${secondaryList.length + 1}`, place));
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

Explore how ${provider} support can move your project forward, then take the next step with a clear call to action.

Learn more: ${primary}
${url}

${hashtagify(place, primary)}`;
    html = `${opener}

${intentLead}

Looking for ${secondary}? Our team in ${place} delivers ${offering} with care, clarity, and a process built for local search visibility. Customers choose us when they need dependable ${proof} without guesswork.

We help people comparing ${promo} understand scope, timeline, and expected outcomes up front. That transparency builds trust and supports stronger rankings for ${primary} queries across ${place}.

Explore how ${provider} support can move your project forward, then take the next step with a clear call to action.

Learn more: ${keywordLinkHtml(url, primary)}

${hashtagify(place, primary)}`;
  } else if (platform === "Instagram") {
    heading = `${primary} — crafted with care`;
    plain = `${opener}

${intentLead}

${secondary} for businesses and homeowners in ${place}.

We focus on ${offering} and ${proof}, so every detail supports both real-world results and search-friendly messaging around ${primary}. Ready for ${promo}?

Save this post, share it with someone who needs ${provider} help, and check the link in bio for the full story.

${hashtagify(primary, secondary, place, "LocalBusiness", "SEO")}`;
    html = plain;
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

Leaders evaluating ${promo} should prioritize process transparency, measurable milestones, and content that reinforces topical authority. That combination improves both customer trust and organic discoverability.

Discover ${promo}:
${url}

${hashtagify("BusinessGrowth", primary, "Leadership", place)}`;
    html = `${opener} ${bridge}

${intentLead}

We support organizations with ${offering}, backed by ${proof}. Our specialists help clients move from idea to polished identity through ${provider}, while aligning messaging to high-intent searches for ${primary} and ${secondary} in ${place}.

Leaders evaluating ${promo} should prioritize process transparency, measurable milestones, and content that reinforces topical authority. That combination improves both customer trust and organic discoverability.

Discover ${promo}: ${keywordLinkHtml(url, primary)}

${hashtagify("BusinessGrowth", primary, "Leadership", place)}`;
  } else {
    // GMB / Google Business Profile
    heading = phraseHasLocation(primary, place)
      ? `${primary} — open and ready to help`
      : `${primary} in ${place} — open and ready to help`;
    plain = `${opener} ${intentLead}

Looking for ${secondary}? We provide ${offering} for local customers across ${place}, with clear communication from first message to finished work.

Ask us about ${promo} and how ${proof} can support your next project. Consistent service pages and updates about ${primary} help nearby customers find the right provider faster.

Visit or message us to learn more about ${primary} and schedule a conversation with our team.`;
    html = plain;
  }

  const applyRange = (body) => {
    let next = padToMinWords(body, cfg.minWords, padCtx);
    if (countWords(next) > cfg.maxWords) {
      const clipped = enforceMaxWords(next, cfg.maxWords);
      // SEO floor wins: never clip below minWords (slight overshoot OK)
      next = countWords(clipped) >= cfg.minWords ? clipped : next;
    }
    if (countWords(next) < cfg.minWords) {
      next = padToMinWords(next, cfg.minWords, padCtx);
    }
    return next;
  };

  plain = applyRange(plain);
  html = applyRange(html);

  return {
    heading,
    content: plain,
    contentHtml: html || plain,
    wordCount: countWords(plain),
    minWords: cfg.minWords,
    maxWords: cfg.maxWords,
    writingIntent,
    masterIntent,
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
  if (!model || !process.env.OPENROUTER_API_KEY) {
    return { ...template, writingProvider: "template" };
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
          content: `You write SEO-led social posts for ${platform}. Return ONLY JSON: {heading:string, content:string}. English only, no emojis, no markdown fences. Word count between ${cfg.minWords} and ${cfg.maxWords}. Tone: ${tone}.`,
        },
        {
          role: "user",
          content: `Platform: ${platform}
Location: ${place}
Primary keyword: ${primary}
Secondary keywords: ${secondaryList.join(", ")}
Page URL (may include once if platform allows links): ${url}
Writing intent: ${options.writingIntent || "Awareness"}
Master intent: ${options.masterIntent || "n/a"}
Allow links: ${cfg.allowLinks}
Allow hashtags: ${cfg.allowHashtags}

Write one complete post body that naturally uses the primary keyword and at least two secondary keywords. Follow the master intent.`,
        },
      ],
    });

    const raw = data?.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { ...template, writingProvider: "template-fallback" };
    const parsed = JSON.parse(m[0]);
    let content = sanitizeEnglishPost(String(parsed.content || "").trim());
    let heading = sanitizeEnglishPost(String(parsed.heading || template.heading).trim());
    if (!content || countWords(content) < Math.min(40, cfg.minWords)) {
      return { ...template, writingProvider: "template-fallback" };
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
    content = padToMinWords(content, cfg.minWords, padCtx);
    if (countWords(content) > cfg.maxWords) {
      const clipped = enforceMaxWords(content, cfg.maxWords);
      content = countWords(clipped) >= cfg.minWords ? clipped : content;
    }

    let contentHtml = content;
    if (cfg.allowLinks && url && primary) {
      contentHtml = content.replace(
        new RegExp(primary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
        keywordLinkHtml(url, primary)
      );
    }

    return {
      heading: heading || template.heading,
      content,
      contentHtml,
      wordCount: countWords(content),
      minWords: cfg.minWords,
      maxWords: cfg.maxWords,
      writingIntent: options.writingIntent || template.writingIntent,
      masterIntent: options.masterIntent || template.masterIntent,
      writingProvider: model,
    };
  } catch (err) {
    console.error("[generatePostContentWithAi]", err.message);
    return { ...template, writingProvider: "template-fallback" };
  }
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

  const secondaryKeywords = [...secondary].slice(0, 4);
  while (secondaryKeywords.length < 4) {
    secondaryKeywords.push(
      polishKeyword(`${keywords.primary} related ${secondaryKeywords.length + 1}`, location)
    );
  }

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

  const html = await fetchText(url);
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
    title: page.title,
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
  maxPages = MAX_URLS,
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

  const discovered = await discoverSitemapUrls(origin);
  const homepage = `${origin}/`;
  const prioritized = [
    homepage,
    ...discovered
      .filter((u) => {
        try {
          return normalizeUrl(u) !== normalizeUrl(homepage);
        } catch {
          return true;
        }
      })
      .sort((a, b) => urlPriority(b) - urlPriority(a)),
  ];

  // Dedupe by normalized URL
  const seen = new Set();
  const uniqueUrls = [];
  for (const u of prioritized) {
    const n = normalizeUrl(u) || u;
    if (seen.has(n)) continue;
    seen.add(n);
    uniqueUrls.push(n);
  }

  const pageLimit = Math.min(Math.max(Number(maxPages) || MAX_URLS, 1), MAX_URLS);
  const selectedUrls = uniqueUrls.slice(0, pageLimit);

  if (!selectedUrls.length) {
    return {
      ok: false,
      status: 400,
      error: "No pages discovered on this website. Check the URL is public.",
    };
  }

  const analyzed = [];
  for (let i = 0; i < selectedUrls.length; i += 5) {
    const batch = selectedUrls.slice(i, i + 5);
    const results = await Promise.all(batch.map((u) => scanOneUrl(u, loc || "Local")));
    for (const r of results) if (r) analyzed.push(r);
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
    areaCoverage: row.areaCoverage,
    writingIntent: row.writingIntent,
    masterIntent: row.masterIntent,
    keywords: {
      primary: row.keywords.primary,
      secondary: row.keywords.secondaryKeywords || row.keywords.general || [],
    },
  }));

  return {
    ok: true,
    workspaceId: wid,
    websiteUrl: origin,
    location: loc,
    needsLocation: !loc,
    discoveredCount: uniqueUrls.length,
    pageCount: pages.length,
    areaCoverage: {
      summary: [...areaPool].slice(0, 6).join(" · ") || loc || "Set target location",
      areas: [...areaPool].slice(0, 12),
    },
    masterIntent,
    dominantIntent,
    pages,
  };
}

/**
 * Part 2 — Full pipeline: keywords → Facebook / LinkedIn / GMB posts (≤45)
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
      const secondaryKeywords = secondary.map(String).filter(Boolean).slice(0, 4);
      while (secondaryKeywords.length < 4) {
        secondaryKeywords.push(`${p.keywords?.primary || "local service"} tip ${secondaryKeywords.length + 1}`);
      }
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

  const origin =
    websiteOriginFromUrl(websiteUrl) ||
    websiteOriginFromUrl(analyzed[0]?.url) ||
    null;

  // —— Part 5: archive previous batch when website changes (or same-site drafts) ——
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

  let archivedCount = 0;
  if (switchingWebsite) {
    // New website → move ALL previous active posts to Archive
    const moved = await prisma.studioPost.updateMany({
      where: {
        userId: user.id,
        ...(wid ? { workspaceId: wid } : {}),
        archived: false,
      },
      data: { archived: true, archivedAt: new Date() },
    });
    archivedCount = moved.count;
  } else {
    // Same website regenerate → archive prior drafts/scheduled (keep published locked active)
    const moved = await prisma.studioPost.updateMany({
      where: {
        userId: user.id,
        ...(wid ? { workspaceId: wid } : {}),
        archived: false,
        status: { in: ["draft", "scheduled"] },
        ...(origin ? { OR: [{ websiteOrigin: origin }, { websiteOrigin: null }] } : {}),
      },
      data: { archived: true, archivedAt: new Date() },
    });
    archivedCount = moved.count;
  }

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

  const posts = [];
  const skippedLocked = [];
  const expectedTotal = analyzed.length * platforms.length;

  for (const item of analyzed) {
    for (const platform of platforms) {
      const fp = fingerprintOf(item.url, platform, item.keywords.primary);
      if (lockedSet.has(fp)) {
        skippedLocked.push({ url: item.url, platform, reason: "Already published & locked" });
        continue;
      }

      const postData = await generatePostContentWithAi(
        platform,
        item.keywords,
        loc,
        item.url,
        selectedTone,
        {
          writingIntent: item.writingIntent,
          masterIntent: item.masterIntent || siteMasterIntent,
          writingModel,
        }
      );

      let imageUrl = null;
      if (includeImages) {
        imageUrl = await resolveImageUrl({
          keyword: item.keywords.primary,
          location: loc,
          platform,
          heading: postData.heading,
          imageSource: resolvedImageSource,
          preferredModel: preferredImageModel,
        });
        if (resolvedImageSource === "free") {
          await freeImageRateLimitPause();
        }
      }

      const secondaryPack =
        item.keywords.secondaryKeywords || item.keywords.general || [item.keywords.secondary];

      const row = await prisma.studioPost.create({
        data: {
          userId: user.id,
          workspaceId: wid,
          fingerprint: fp,
          websiteOrigin: origin || websiteOriginFromUrl(item.url),
          sourceUrl: item.url,
          platform,
          tone: selectedTone,
          location: loc,
          primaryKeyword: polishKeyword(item.keywords.primary, loc),
          secondaryKeyword: polishKeyword(secondaryPack[0] || item.keywords.secondary, loc),
          generalKeywords: JSON.stringify(
            secondaryPack.map((k) => polishKeyword(k, loc)).slice(0, 4)
          ),
          heading: postData.heading,
          content: postData.content,
          contentHtml: postData.contentHtml,
          imageUrl,
          status: "draft",
          locked: false,
          archived: false,
        },
      });

      posts.push(serializePost(row));
    }
  }

  return {
    ok: true,
    workspaceId: wid,
    location: loc,
    tone: selectedTone,
    platforms,
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
    providerDecision,
    tones: TONE_PRESETS,
  };
}

function serializePost(row) {
  let general = [];
  try {
    general = JSON.parse(row.generalKeywords || "[]");
  } catch {
    general = [];
  }
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
    image: row.imageUrl,
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
    /** Part 4 — true when publish is blocked until regenerate */
    publishLocked: !!(row.locked && row.status === "published"),
  };
}

export async function listStudioPosts({ email, workspaceId, status, archived = false }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const where = {
    userId: auth.user.id,
    archived: archived === true || archived === "true",
  };
  if (workspaceId) where.workspaceId = workspaceId;
  if (status) where.status = status;

  const rows = await prisma.studioPost.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });

  return { ok: true, posts: rows.map(serializePost), archived: where.archived };
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
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const post = await prisma.studioPost.findFirst({
    where: { id: postId, userId: auth.user.id },
  });
  if (!post) return { ok: false, status: 404, error: "Post not found" };

  const selectedTone = TONE_PRESETS.includes(tone) ? tone : post.tone;
  let general = [];
  try {
    general = JSON.parse(post.generalKeywords || "[]");
  } catch {
    general = [];
  }

  const keywords = {
    primary: post.primaryKeyword,
    secondary: post.secondaryKeyword,
    secondaryKeywords: general.length ? general : [post.secondaryKeyword],
    general: general.length ? general : [post.secondaryKeyword],
  };

  // Recover intent line from prior draft when present
  const intentMatch = String(post.content || "").match(
    /Intent focus \(([^)]+)\):\s*(.+?)(?:\n|$)/
  );
  const writingIntent = intentMatch?.[1] || "Awareness";
  const masterIntent =
    intentMatch?.[2]?.trim() ||
    `Rewrite for ${post.platform} using ${post.primaryKeyword} in ${post.location}`;

  const providerDecision = await selectBestStudioProviders({
    websiteUrl: post.websiteOrigin || post.sourceUrl,
    location: post.location,
    masterIntent,
    dominantIntent: writingIntent,
    pageSample: [{ url: post.sourceUrl, writingIntent, keywords: { primary: post.primaryKeyword } }],
    includeImages: !!includeImages,
    forceImageSource: imageSource === "auto" ? undefined : imageSource,
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
    }
  );

  // New fingerprint → unlocks reuse / re-publish of this page+platform combo
  const newFingerprint = fingerprintOf(
    post.sourceUrl,
    post.platform,
    `${keywords.primary}|regen-${Date.now()}`
  );

  let imageUrl = post.imageUrl;
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
  }

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: {
      fingerprint: newFingerprint,
      tone: selectedTone,
      heading: rewritten.heading,
      content: rewritten.content,
      contentHtml: rewritten.contentHtml,
      imageUrl,
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
      data: { imageUrl: null },
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
    return {
      ok: false,
      status: 502,
      error: result?.error || "Could not generate image. Try Free source.",
    };
  }

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: { imageUrl: url },
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
        failed += 1;
        continue;
      }
      const updated = await prisma.studioPost.update({
        where: { id: post.id },
        data: { imageUrl: url },
      });
      posts.push(serializePost(updated));
      attached += 1;
      // Free Pollinations rate limits — pause between gens
      if (resolvedSource === "free" && i < rows.length - 1) {
        await freeImageRateLimitPause();
      }
    } catch (err) {
      console.error("[attachImages]", post.id, err.message);
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

/**
 * Due scheduled posts → publish + lock (called by scheduler)
 */
export async function processDueScheduledPosts() {
  const due = await prisma.studioPost.findMany({
    where: {
      status: "scheduled",
      scheduledAt: { lte: new Date() },
      locked: false,
      archived: false,
    },
    take: 50,
  });

  let n = 0;
  for (const post of due) {
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
      await prisma.studioPost.update({
        where: { id: post.id },
        data: { status: "draft", scheduledAt: null },
      });
      continue;
    }

    const user = await prisma.user.findUnique({ where: { id: post.userId } });
    if (!user?.email) continue;

    const provider = PLATFORM_CONFIG[post.platform]?.key;
    if (!provider) continue;

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
      });
    } catch (err) {
      console.error(`[autoPoster] scheduled live publish failed ${post.id}`, err.message);
      continue;
    }

    if (!live?.ok) {
      console.error(
        `[autoPoster] scheduled live publish blocked ${post.id}:`,
        live?.error || live?.message
      );
      continue;
    }

    await prisma.studioPost.update({
      where: { id: post.id },
      data: {
        status: "published",
        locked: true,
        publishedAt: new Date(),
        scheduledAt: null,
      },
    });

    await stampPostActivity(user.id, post.platform).catch(() => {});
    n += 1;
  }

  if (n) console.log(`[autoPoster] auto-published ${n} scheduled post(s)`);
  return n;
}
