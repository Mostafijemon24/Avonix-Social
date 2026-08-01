/**
 * Avonix Social:
 * - Scan up to 15 page URLs in parallel
 * - Extract 1 primary + 1 secondary + 4 general keywords per page
 * - Generate FB / IG / LinkedIn / GMB posts by platform rules + tone
 * - Platform-sized realistic images
 * - Publish lock, schedule, rewrite
 */
import crypto from "crypto";
import { callOpenRouter, generateImage } from "../openrouter.js";
import { resolveActiveWorkspace } from "./workspaceService.js";
import { publishContent } from "./publishService.js";
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
    image: { width: 1200, height: 630, aspect: "16:9" },
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
    image: { width: 1200, height: 627, aspect: "16:9" },
  },
  GMB: {
    key: "google_business",
    minWords: 90,
    maxWords: 130,
    allowLinks: false,
    allowHashtags: false,
    image: { width: 1024, height: 576, aspect: "16:9" },
  },
};

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

  return {
    primary: polishKeyword(primary, location),
    secondary: polishKeyword(rest[0] || `custom ${primary}`, location),
    general: [
      polishKeyword(rest[1] || `${primary} experts`, location),
      polishKeyword(rest[2] || "affordable packages", location),
      polishKeyword(rest[3] || "local branding services", location),
      polishKeyword(rest[4] || "creative solutions", location),
    ].slice(0, 4),
  };
}

async function refineKeywordsWithAi(page, location, heuristic) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  try {
    const data = await callOpenRouter({
      model: process.env.KEYWORD_MODEL || "openai/gpt-4o-mini",
      maxTokens: 280,
      messages: [
        {
          role: "system",
          content:
            "You are an SEO + generative-AI keyword analyst. Return ONLY JSON: {primary, secondary, general:[4 strings]}. Prefer commercial Google search intent. No markdown.",
        },
        {
          role: "user",
          content: `URL: ${page.url}
Location: ${location || "n/a"}
Title: ${page.title}
H1: ${page.h1}
Description: ${page.description}
Body sample: ${page.bodyText.slice(0, 1800)}
Heuristic guess: ${JSON.stringify(heuristic)}

Pick 1 primary, 1 secondary, and exactly 4 general keywords best for Google + AI Overviews.`,
        },
      ],
    });

    const content = data?.choices?.[0]?.message?.content || "";
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    const general = (parsed.general || []).map((k) => pretty(String(k).trim())).filter(Boolean);
    if (!parsed.primary || !parsed.secondary || general.length < 4) return null;
    return {
      primary: polishKeyword(parsed.primary, location),
      secondary: polishKeyword(parsed.secondary, location),
      general: general.slice(0, 4).map((k) => polishKeyword(k, location)),
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
 */
export function generatePostContent(platform, keywords, location, url, tone) {
  const place = normalizeLocation(location) || "your area";
  const primary = polishKeyword(keywords.primary, place);
  const secondary = polishKeyword(keywords.secondary, place);
  const g = (keywords.general || []).map((x) => polishKeyword(x, place));
  while (g.length < 4) g.push("trusted local support");

  const cfg = PLATFORM_CONFIG[platform];
  const opener = TONE_OPENER[tone] || TONE_OPENER.Professional;
  const primaryLocal = withLocation(primary, place);
  const provider = asProvider(g[0]);
  const offering = asOffering(g[1]);
  const proof = asOffering(g[2]);
  const promo = asOffering(g[3]);
  const padCtx = { primary, secondary, offering, proof, promo, place, provider };

  let heading = "";
  let plain = "";
  let html = "";

  if (platform === "Facebook") {
    heading = `Discover ${primaryLocal}`;
    plain = `${opener}

Looking for ${secondary}? Our team in ${place} delivers ${offering} with care, clarity, and a process built for local search visibility. Customers choose us when they need dependable ${proof} without guesswork.

We help people comparing ${promo} understand scope, timeline, and expected outcomes up front. That transparency builds trust and supports stronger rankings for ${primary} queries across ${place}.

Explore how ${provider} support can move your project forward, then take the next step with a clear call to action.

Learn more: ${primary}
${url}

${hashtagify(place, primary)}`;
    html = `${opener}

Looking for ${secondary}? Our team in ${place} delivers ${offering} with care, clarity, and a process built for local search visibility. Customers choose us when they need dependable ${proof} without guesswork.

We help people comparing ${promo} understand scope, timeline, and expected outcomes up front. That transparency builds trust and supports stronger rankings for ${primary} queries across ${place}.

Explore how ${provider} support can move your project forward, then take the next step with a clear call to action.

Learn more: ${keywordLinkHtml(url, primary)}

${hashtagify(place, primary)}`;
  } else if (platform === "Instagram") {
    heading = `${primary} — crafted with care`;
    plain = `${opener}

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

We support organizations with ${offering}, backed by ${proof}. Our specialists help clients move from idea to polished identity through ${provider}, while aligning messaging to high-intent searches for ${primary} and ${secondary} in ${place}.

Leaders evaluating ${promo} should prioritize process transparency, measurable milestones, and content that reinforces topical authority. That combination improves both customer trust and organic discoverability.

Discover ${promo}:
${url}

${hashtagify("BusinessGrowth", primary, "Leadership", place)}`;
    html = `${opener} ${bridge}

We support organizations with ${offering}, backed by ${proof}. Our specialists help clients move from idea to polished identity through ${provider}, while aligning messaging to high-intent searches for ${primary} and ${secondary} in ${place}.

Leaders evaluating ${promo} should prioritize process transparency, measurable milestones, and content that reinforces topical authority. That combination improves both customer trust and organic discoverability.

Discover ${promo}: ${keywordLinkHtml(url, primary)}

${hashtagify("BusinessGrowth", primary, "Leadership", place)}`;
  } else {
    heading = phraseHasLocation(primary, place)
      ? `${primary} — open and ready to help`
      : `${primary} in ${place} — open and ready to help`;
    plain = `${opener} Looking for ${secondary}? We provide ${offering} for local customers across ${place}, with clear communication from first message to finished work.

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
  };
}

/** Scene-based photoreal prompt — never ask the model to render keyword text/logos */
function buildPhotorealImagePrompt(keyword, location, heading) {
  const place = normalizeLocation(location) || "a local business district";
  const topic = polishKeyword(keyword, place);
  return `Photorealistic natural photograph of a real-world professional scene related to "${topic}" in ${place}.
Show authentic people, hands at work, tools, materials, or a real studio/office environment that matches this service.
Natural window light or golden hour, shallow depth of field, sharp detail on textures and faces, documentary style, shot on a full-frame camera, 85mm lens, ISO 100, ultra detailed, 8K resolution.
Strictly forbidden: any text, letters, words, typography, watermarks, logos, brand marks, UI, posters with writing, 3D metallic emblems, sci-fi city logos, abstract chrome badges, fake signage.
No illustrations, no cartoon, no CGI logo mockups — only realistic natural photography.`;
}

/**
 * Photoreal natural images via ChatGPT (openai/gpt-image-1) through OpenRouter.
 * Falls back to Pollinations only if OpenRouter is unavailable.
 */
export async function generateStudioImage({ keyword, location, platform, heading }) {
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.Facebook;
  const { width, height } = cfg.image;
  const prompt = buildPhotorealImagePrompt(keyword, location, heading);
  const aspectRatio = platform === "Instagram" ? "1:1" : "16:9";

  if (process.env.OPENROUTER_API_KEY) {
    try {
      const img = await generateImage({ prompt, aspectRatio });
      if (img?.ok && img.url) return img.url;
    } catch (err) {
      console.error("[autoPoster ChatGPT image]", err.message);
    }
  }

  // Emergency fallback only
  const encoded = encodeURIComponent(prompt.slice(0, 1800));
  const seed = Math.floor(Math.random() * 1e9);
  return `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&nologo=true&enhance=true&model=flux&seed=${seed}`;
}

/** @deprecated use generateStudioImage */
export function getRealisticImageUrl(keyword, platform) {
  const cfg = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.Facebook;
  const { width, height } = cfg.image;
  const prompt = encodeURIComponent(
    buildPhotorealImagePrompt(keyword, "", keyword).slice(0, 1200)
  );
  return `https://image.pollinations.ai/prompt/${prompt}?width=${width}&height=${height}&nologo=true&enhance=true&seed=${Date.now()}`;
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
      .split(".")[0];
    const primary = polishKeyword(`${slug} services`, location);
    return {
      url,
      reachable: false,
      keywords: {
        primary,
        secondary: polishKeyword(`custom ${slug} design`, location),
        general: [
          polishKeyword(`${slug} experts`, location),
          "Affordable Packages",
          "Local Branding Services",
          "Creative Solutions",
        ],
      },
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
  return {
    url,
    reachable: true,
    title: page.title,
    keywords: ai || heuristic,
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
 * Full pipeline: scan → keywords → posts + images → persist drafts
 * Skips fingerprints already published+locked.
 */
export async function generateAutoPosterSuite({
  email,
  workspaceId,
  urls,
  location,
  tone = "Professional",
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

  const scan = await scanUrlsForKeywords(urls, loc);
  if (!scan.ok) return scan;

  // Locked fingerprints for this user (never regenerate / republish same combo)
  const locked = await prisma.studioPost.findMany({
    where: { userId: user.id, locked: true, status: "published" },
    select: { fingerprint: true },
  });
  const lockedSet = new Set(locked.map((l) => l.fingerprint));

  // Clear previous drafts for this workspace so regenerate is clean
  await prisma.studioPost.deleteMany({
    where: {
      userId: user.id,
      workspaceId: wid || undefined,
      status: "draft",
    },
  });

  const posts = [];
  const skippedLocked = [];
  const platforms = Object.keys(PLATFORM_CONFIG);

  for (const item of scan.analyzed) {
    for (const platform of platforms) {
      const fp = fingerprintOf(item.url, platform, item.keywords.primary);
      if (lockedSet.has(fp)) {
        skippedLocked.push({ url: item.url, platform, reason: "Already published & locked" });
        continue;
      }

      const postData = generatePostContent(
        platform,
        item.keywords,
        loc,
        item.url,
        selectedTone
      );
      const imageUrl = await generateStudioImage({
        keyword: item.keywords.primary,
        location: loc,
        platform,
        heading: postData.heading,
      });

      const row = await prisma.studioPost.create({
        data: {
          userId: user.id,
          workspaceId: wid,
          fingerprint: fp,
          sourceUrl: item.url,
          platform,
          tone: selectedTone,
          location: loc,
          primaryKeyword: polishKeyword(item.keywords.primary, loc),
          secondaryKeyword: polishKeyword(item.keywords.secondary, loc),
          generalKeywords: JSON.stringify(
            (item.keywords.general || []).map((k) => polishKeyword(k, loc))
          ),
          heading: postData.heading,
          content: postData.content,
          contentHtml: postData.contentHtml,
          imageUrl,
          status: "draft",
          locked: false,
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
    analyzed: scan.analyzed,
    posts,
    skippedLocked,
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
    createdAt: row.createdAt.toISOString(),
    workspaceId: row.workspaceId,
  };
}

export async function listStudioPosts({ email, workspaceId, status }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const where = { userId: auth.user.id };
  if (workspaceId) where.workspaceId = workspaceId;
  if (status) where.status = status;

  const rows = await prisma.studioPost.findMany({
    where,
    orderBy: { updatedAt: "desc" },
  });

  return { ok: true, posts: rows.map(serializePost) };
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
    return { ok: false, status: 409, error: "Published posts are locked. Rewrite first." };
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

export async function rewriteStudioPost({ email, postId, tone }) {
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
    general,
  };

  const postData = generatePostContent(
    post.platform,
    keywords,
    post.location,
    post.sourceUrl,
    selectedTone
  );
  const imageUrl = await generateStudioImage({
    keyword: keywords.primary,
    location: post.location,
    platform: post.platform,
    heading: postData.heading,
  });

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: {
      tone: selectedTone,
      heading: postData.heading,
      content: postData.content,
      contentHtml: postData.contentHtml,
      imageUrl,
      status: "draft",
      locked: false,
      scheduledAt: null,
      publishedAt: null,
      rewriteOfId: post.rewriteOfId || post.id,
    },
  });

  return { ok: true, post: serializePost(updated) };
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
