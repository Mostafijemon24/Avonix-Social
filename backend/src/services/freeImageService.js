/**
 * Fully free image stack for Content Studio.
 *
 * Relevance-first:
 *  1. Pollinations Flux (AI) — HD, topic-specific prompt, mirrored locally
 *  2. Pexels / Unsplash — scored by keyword overlap (not random)
 *
 * Platform width/height come from PLATFORM_CONFIG (FB/LI/GMB differ).
 */

import { persistRemoteImage } from "../openrouter.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clampSize(n, fallback, max = 1920) {
  const v = Number(n) || fallback;
  return Math.min(max, Math.max(512, Math.round(v)));
}

function tokensFrom(...parts) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "your",
    "our",
    "best",
    "top",
    "near",
    "me",
    "in",
    "of",
    "a",
    "an",
    "to",
    "services",
    "service",
    "company",
    "agency",
  ]);
  return String(parts.filter(Boolean).join(" "))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
}

/**
 * Turn SEO keyword → concrete photographic subject (higher relevance).
 */
export function visualSubjectFromKeyword(keyword, location) {
  const raw = String(keyword || "").trim();
  const lower = raw.toLowerCase();
  const place = String(location || "").split(",")[0]?.trim() || "";

  const rules = [
    [/logo|brand(ing)?|identity|corporate identity/, "brand strategist reviewing a printed logo mood board with color swatches, typography samples, and mockups on a desk — no readable text"],
    [/graphic design|designer/, "graphic designer refining a brand layout on a calibrated monitor with pantone swatches and print proofs — no readable text"],
    [/web design|website|ui\/ux|ux|ui /, "web designer reviewing a website mockup on a laptop and tablet"],
    [/seo|search engine/, "digital marketer analyzing SEO charts and keyword reports on a computer screen"],
    [/social media/, "social media manager planning posts on a laptop with a smartphone nearby"],
    [/photograph|photo studio/, "professional photographer shooting a product in a lit studio"],
    [/video|film/, "videographer filming with a cinema camera on a tripod on location"],
    [/plumb/, "licensed plumber repairing pipes under a sink with tools"],
    [/hvac|air condition|heating/, "HVAC technician servicing an outdoor AC unit"],
    [/electr/, "electrician installing a circuit breaker panel"],
    [/roof/, "roofer inspecting residential shingles on a sunny day"],
    [/landscap|garden|lawn/, "landscaper maintaining a manicured garden and lawn"],
    [/clean(ing)?|janitor/, "professional cleaner polishing a modern office lobby"],
    [/dental|dentist|teeth/, "dentist examining a patient in a modern dental clinic"],
    [/clinic|medical|doctor|health/, "doctor consulting a patient in a bright modern clinic"],
    [/law|attorney|legal/, "attorney reviewing case documents in a professional law office"],
    [/real estate|realtor|property/, "real estate agent showing a modern home interior to clients"],
    [/restaur|cafe|food|cater/, "chef plating a dish in a professional restaurant kitchen"],
    [/fitness|gym|yoga/, "personal trainer coaching a client in a modern gym"],
    [/salon|hair|beauty|spa/, "stylist working with a client in a premium salon"],
    [/auto|car repair|mechanic/, "auto mechanic working under a car hood in a clean garage"],
    [/print(ing)?/, "print shop technician checking color prints on a commercial press"],
    [/packag/, "packaging designer reviewing product boxes on a studio table"],
    [/market(ing)?|advertis/, "marketing team reviewing a campaign board in a glass office"],
  ];

  for (const [re, scene] of rules) {
    if (re.test(lower)) {
      return place ? `${scene}, ${place} area` : scene;
    }
  }

  const core = raw
    .replace(/\b(inc|llc|ltd|co)\b/gi, "")
    .replace(/\b[A-Z]{2}\b/g, "")
    .trim()
    .slice(0, 90);
  return place
    ? `professional scene of ${core || "local business service"} in ${place}, real workplace`
    : `professional scene of ${core || "local business service"}, real workplace`;
}

/** Tight stock search query (keyword-heavy, less heading noise) */
export function buildStockSearchQuery({ keyword, location }) {
  const kw = String(keyword || "")
    .replace(/\b(near me|best|top|affordable|cheap)\b/gi, "")
    .trim();
  const city = String(location || "").split(",")[0]?.trim() || "";
  // Stock search works better without city names sometimes; keep service words
  const q = [kw, "professional", "workplace"].filter(Boolean).join(" ");
  return q.replace(/\s+/g, " ").slice(0, 100) || "professional business workplace";
}

/**
 * HD photoreal prompt for Pollinations (server-side fetch — can be longer).
 */
export function buildRelevantImagePrompt({ keyword, location, heading, platform }) {
  const subject = visualSubjectFromKeyword(keyword, location);
  const place = String(location || "").trim();
  const platformHint =
    platform === "GMB"
      ? "Google Business style local service photo"
      : platform === "LinkedIn"
        ? "professional LinkedIn feed photo"
        : platform === "Instagram"
          ? "square Instagram feed photo"
          : "Facebook link-preview landscape photo";

  return [
    `Ultra HD photorealistic ${platformHint}: ${subject}.`,
    place ? `Setting clearly suggests ${place}.` : "",
    heading ? `Context: ${String(heading).slice(0, 90)}.` : "",
    "Shot on full-frame camera, 85mm, f/1.8, natural window light, sharp focus, rich detail, 8K quality.",
    "No text, no letters, no logos, no watermarks, no UI, no cartoon, no 3D render.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 900);
}

/**
 * Pollinations GET image URL (Flux). Optional POLLINATIONS_API_KEY.
 */
export function buildPollinationsUrl({ prompt, width, height, seed }) {
  const w = clampSize(width, 1200);
  const h = clampSize(height, 630);
  const s = seed || Math.floor(Math.random() * 1e9);
  // Server mirrors the image — allow a longer prompt than browser-safe URLs
  const encoded = encodeURIComponent(String(prompt || "").slice(0, 850));
  const key = (process.env.POLLINATIONS_API_KEY || "").trim();
  const model = process.env.POLLINATIONS_MODEL || "flux";
  const params = new URLSearchParams({
    width: String(w),
    height: String(h),
    nologo: "true",
    enhance: "true",
    model,
    seed: String(s),
  });
  if (key) params.set("key", key);
  return `https://image.pollinations.ai/prompt/${encoded}?${params.toString()}`;
}

function scoreStockHit(text, keyword, location) {
  const hay = String(text || "").toLowerCase();
  const toks = tokensFrom(keyword, location);
  if (!toks.length) return 0;
  let score = 0;
  for (const t of toks) {
    if (hay.includes(t)) score += t.length >= 5 ? 3 : 2;
  }
  // Penalize generic office stock when keyword is specific
  if (/office|handshake|laptop only|business meeting/.test(hay) && score < 4) {
    score -= 2;
  }
  return score;
}

async function pexelsImageUrl({ keyword, location, width, height }) {
  const key = (process.env.PEXELS_API_KEY || "").trim();
  if (!key) return null;

  const q = buildStockSearchQuery({ keyword, location });
  const orient =
    width >= height * 1.15 ? "landscape" : height >= width * 1.15 ? "portrait" : "square";
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", q);
  url.searchParams.set("per_page", "15");
  url.searchParams.set("orientation", orient);

  const res = await fetch(url, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.error("[freeImage Pexels]", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  const photos = Array.isArray(data?.photos) ? data.photos : [];
  if (!photos.length) return null;

  const ranked = photos
    .map((p) => {
      const blob = `${p.alt || ""} ${p.url || ""} ${p.photographer || ""}`;
      return { photo: p, score: scoreStockHit(blob, keyword, location) };
    })
    .sort((a, b) => b.score - a.score);

  // Require some keyword overlap when possible; else take best available
  const best =
    ranked.find((r) => r.score >= 4)?.photo ||
    ranked.find((r) => r.score >= 2)?.photo ||
    ranked[0]?.photo;
  if (!best) return null;

  // Prefer original / large2x for HD
  const src =
    best?.src?.original ||
    best?.src?.large2x ||
    best?.src?.large ||
    best?.src?.landscape ||
    null;
  return src
    ? {
        url: src,
        source: "free",
        provider: "pexels",
        relevanceScore: ranked.find((r) => r.photo === best)?.score ?? 0,
        attribution: best?.photographer ? `Photo by ${best.photographer} on Pexels` : "Pexels",
      }
    : null;
}

async function unsplashImageUrl({ keyword, location, width, height }) {
  const key = (process.env.UNSPLASH_ACCESS_KEY || "").trim();
  if (!key) return null;

  const q = buildStockSearchQuery({ keyword, location });
  const orient =
    width >= height * 1.15 ? "landscape" : height >= width * 1.15 ? "portrait" : "squarish";
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", q);
  url.searchParams.set("per_page", "15");
  url.searchParams.set("orientation", orient === "squarish" ? "squarish" : orient);
  url.searchParams.set("content_filter", "high");

  const res = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${key}`,
      "Accept-Version": "v1",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.error("[freeImage Unsplash]", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) return null;

  const ranked = results
    .map((p) => {
      const blob = `${p.description || ""} ${p.alt_description || ""} ${(p.tags || [])
        .map((t) => t?.title || "")
        .join(" ")}`;
      return { photo: p, score: scoreStockHit(blob, keyword, location) };
    })
    .sort((a, b) => b.score - a.score);

  const best =
    ranked.find((r) => r.score >= 4)?.photo ||
    ranked.find((r) => r.score >= 2)?.photo ||
    ranked[0]?.photo;
  if (!best) return null;

  const w = clampSize(width, 1600);
  const src =
    best?.urls?.raw
      ? `${best.urls.raw}&w=${w}&q=90&fm=jpg`
      : best?.urls?.full || best?.urls?.regular;
  if (!src) return null;
  const name = best?.user?.name;
  return {
    url: src,
    source: "free",
    provider: "unsplash",
    relevanceScore: ranked.find((r) => r.photo === best)?.score ?? 0,
    attribution: name ? `Photo by ${name} on Unsplash` : "Unsplash",
  };
}

async function mirrorLocal(hit) {
  if (!hit?.url) return null;
  try {
    const local = await persistRemoteImage(hit.url, { timeoutMs: 120000 });
    return {
      ...hit,
      url: local || hit.url,
      mirrored: !!(local && local !== hit.url),
    };
  } catch (err) {
    console.error(`[freeImage mirror ${hit.provider}]`, err.message);
    return null;
  }
}

/**
 * Resolve one free HD image. Prefer AI (Pollinations) for topic match; stock as scored fallback.
 */
export async function resolveFreeImage({
  prompt,
  keyword,
  location,
  heading,
  width,
  height,
  platform,
  preferStock = false,
}) {
  const relevantPrompt =
    buildRelevantImagePrompt({ keyword, location, heading, platform }) ||
    String(prompt || "").slice(0, 900);

  // AI first for relevance unless explicitly preferStock
  const order = preferStock
    ? ["pexels", "unsplash", "pollinations"]
    : ["pollinations", "pexels", "unsplash"];

  for (const provider of order) {
    try {
      let hit = null;
      if (provider === "pollinations") {
        hit = {
          url: buildPollinationsUrl({
            prompt: relevantPrompt,
            width,
            height,
          }),
          source: "free",
          provider: "pollinations",
          width,
          height,
        };
      } else if (provider === "pexels") {
        hit = await pexelsImageUrl({ keyword, location, width, height });
      } else if (provider === "unsplash") {
        hit = await unsplashImageUrl({ keyword, location, width, height });
      }
      if (!hit?.url) continue;

      // Skip weak stock matches when AI is available next
      if (
        (provider === "pexels" || provider === "unsplash") &&
        (hit.relevanceScore ?? 0) < 2 &&
        order.includes("pollinations") &&
        provider !== order[order.length - 1]
      ) {
        continue;
      }

      const mirrored = await mirrorLocal(hit);
      if (mirrored?.url) {
        return {
          ...mirrored,
          prompt: relevantPrompt.slice(0, 200),
          width,
          height,
        };
      }

      if (provider === "pollinations") {
        return { ...hit, prompt: relevantPrompt.slice(0, 200) };
      }
    } catch (err) {
      console.error(`[freeImage ${provider}]`, err.message);
    }
  }

  const fallback = {
    url: buildPollinationsUrl({ prompt: relevantPrompt, width, height }),
    source: "free",
    provider: "pollinations",
    width,
    height,
  };
  const mirrored = await mirrorLocal(fallback);
  return mirrored || fallback;
}

export async function freeImageRateLimitPause() {
  const hasKey = !!(process.env.POLLINATIONS_API_KEY || "").trim();
  const ms = Number(process.env.FREE_IMAGE_DELAY_MS || (hasKey ? 5000 : 14000));
  if (ms > 0) await sleep(ms);
}

export function freeImageStackStatus() {
  return {
    pollinations: true,
    pollinationsKey: !!(process.env.POLLINATIONS_API_KEY || "").trim(),
    pexels: !!(process.env.PEXELS_API_KEY || "").trim(),
    unsplash: !!(process.env.UNSPLASH_ACCESS_KEY || "").trim(),
    preferFree:
      String(process.env.STUDIO_IMAGE_DEFAULT || "free").toLowerCase() === "free" ||
      process.env.STUDIO_FREE_IMAGES_ONLY === "1",
  };
}
