/**
 * Site analyzer: root domain → discover all sitemap/page/post URLs →
 * crawl content → Google-style phrase scoring → primary/secondary keywords.
 * Heavy work stays on the backend; client only receives keyword results.
 */
import { callOpenRouter } from "../openrouter.js";

const FETCH_TIMEOUT_MS = Number(process.env.SITE_FETCH_TIMEOUT_MS || 10000);
const MAX_SITEMAP_URLS = Number(process.env.SITE_MAX_SITEMAP_URLS || 400);
const MAX_PAGES_TO_FETCH = Number(process.env.SITE_MAX_PAGES || 40);
const MAX_CHILD_SITEMAPS = Number(process.env.SITE_MAX_CHILD_SITEMAPS || 20);
const USER_AGENT =
  "Mozilla/5.0 (compatible; AvonixSocialBot/1.0; +https://social.avonixai.com)";

const STOP_WORDS = new Set(
  `a an the and or but if in on at to for of from by with as is are was were be been being
  this that these those it its you your we our they their he she his her them
  not no yes do does did doing done have has had having will would can could should
  may might must shall about into over under again further then once here there when
  where why how all each few more most other some such only own same so than too very
  just also back new home page click learn read more contact us privacy terms
  cookie cookies login signup menu search copyright reserved rights website online
  get started today free best top services service company`.split(/\s+/)
);

const SKIP_EXT = /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|xml|css|js|json|mp4|mp3|woff2?|ico)$/i;

export function normalizeDomain(input) {
  let raw = String(input || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xml,*/*" },
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

function extractLocsFromXml(xml) {
  if (!xml) return [];
  const locs = [];
  const re = /<loc[^>]*>\s*([^<]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const loc = m[1].trim();
    if (loc) locs.push(loc);
  }
  return locs;
}

function isLikelyPageUrl(u) {
  try {
    const path = new URL(u).pathname.toLowerCase();
    if (SKIP_EXT.test(path)) return false;
    if (/sitemap.*\.xml$/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

function urlPriority(u) {
  try {
    const path = new URL(u).pathname.toLowerCase();
    if (path === "/" || path === "") return 100;
    if (/\/(about|services?|what-we-do|solutions?)/.test(path)) return 90;
    if (/\/(blog|post|news|article|insights?)/.test(path)) return 80;
    if (/\/(contact|location|areas?-we-serve)/.test(path)) return 70;
    if (path.split("/").filter(Boolean).length <= 2) return 60;
    return 40;
  } catch {
    return 10;
  }
}

async function discoverSitemapUrls(origin) {
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/wp-sitemap.xml`,
    `${origin}/sitemap/sitemap.xml`,
    `${origin}/post-sitemap.xml`,
    `${origin}/page-sitemap.xml`,
  ];

  const robots = await fetchText(`${origin}/robots.txt`);
  if (robots) {
    for (const line of robots.split("\n")) {
      const match = line.match(/sitemap:\s*(.+)/i);
      if (match?.[1]) candidates.unshift(match[1].trim());
    }
  }

  const pageUrls = new Set();
  const tried = new Set();

  for (const smUrl of candidates) {
    if (tried.has(smUrl)) continue;
    tried.add(smUrl);
    const xml = await fetchText(smUrl);
    if (!xml || !xml.includes("<loc")) continue;

    const locs = extractLocsFromXml(xml);
    const childSitemaps = locs.filter((u) => /sitemap/i.test(u) && /\.xml(\?|$)/i.test(u));
    const pages = locs.filter((u) => !childSitemaps.includes(u) && isLikelyPageUrl(u));

    for (const p of pages) pageUrls.add(p);

    for (const child of childSitemaps.slice(0, MAX_CHILD_SITEMAPS)) {
      if (tried.has(child)) continue;
      tried.add(child);
      const childXml = await fetchText(child);
      if (!childXml) continue;
      const childLocs = extractLocsFromXml(childXml);
      for (const p of childLocs) {
        if (isLikelyPageUrl(p)) pageUrls.add(p);
      }
    }

    if (pageUrls.size >= 20) break;
  }

  // Fallback: harvest internal links from homepage when sitemap is thin
  if (pageUrls.size < 8) {
    const homeHtml = await fetchText(`${origin}/`);
    if (homeHtml) {
      const hrefRe = /href=["']([^"']+)["']/gi;
      let m;
      while ((m = hrefRe.exec(homeHtml)) !== null) {
        try {
          const abs = new URL(m[1], origin).href;
          if (abs.startsWith(origin) && isLikelyPageUrl(abs)) pageUrls.add(abs.split("#")[0]);
        } catch {
          /* ignore */
        }
      }
    }
  }

  pageUrls.add(`${origin}/`);
  return [...pageUrls].slice(0, MAX_SITEMAP_URLS);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html, nameOrProp) {
  const re = new RegExp(
    `<meta[^>]*(?:name|property)=["']${nameOrProp}["'][^>]*content=["']([^"']+)["'][^>]*>|<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${nameOrProp}["'][^>]*>`,
    "i"
  );
  const m = html.match(re);
  return (m?.[1] || m?.[2] || "").trim();
}

function tagText(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(re);
  return m ? stripHtml(m[1]) : "";
}

function allTagTexts(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const t = stripHtml(m[1]);
    if (t) out.push(t);
  }
  return out;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-']/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

function ngrams(words, n) {
  const out = [];
  for (let i = 0; i <= words.length - n; i++) {
    out.push(words.slice(i, i + n).join(" "));
  }
  return out;
}

/**
 * Google-like ranking: title/H1 dominate, then H2/meta, then body TF.
 * Document frequency dampens site-wide boilerplate.
 */
function scorePhrases(pages) {
  const scores = new Map();
  const docFreq = new Map();

  const bump = (phrase, weight, pageSet) => {
    if (!phrase || phrase.length < 3) return;
    const key = phrase.toLowerCase().trim();
    if (STOP_WORDS.has(key)) return;
    if (key.split(/\s+/).every((w) => STOP_WORDS.has(w))) return;
    scores.set(key, (scores.get(key) || 0) + weight);
    if (pageSet) {
      if (!docFreq.has(key)) docFreq.set(key, new Set());
      docFreq.get(key).add(pageSet);
    }
  };

  for (const page of pages) {
    const pageId = page.url;
    bump(page.title, 12, pageId);
    bump(page.h1, 14, pageId);
    for (const h2 of page.h2s.slice(0, 10)) bump(h2, 5, pageId);
    if (page.description) {
      for (const g of ngrams(tokenize(page.description), 2)) bump(g, 4, pageId);
      for (const g of ngrams(tokenize(page.description), 3)) bump(g, 5, pageId);
    }
    const bodyWords = tokenize(page.bodyText.slice(0, 6000));
    for (const g of ngrams(bodyWords, 2)) bump(g, 1, pageId);
    for (const g of ngrams(bodyWords, 3)) bump(g, 1.6, pageId);
    for (const w of bodyWords) bump(w, 0.25, pageId);
  }

  const nDocs = Math.max(pages.length, 1);
  return [...scores.entries()]
    .map(([phrase, raw]) => {
      const df = docFreq.get(phrase)?.size || 1;
      // Prefer phrases that appear on multiple pages but not EVERY page (boilerplate)
      const idf = Math.log(1 + nDocs / df);
      const ubiquityPenalty = df / nDocs > 0.85 && phrase.split(/\s+/).length === 1 ? 0.4 : 1;
      return [phrase, raw * idf * ubiquityPenalty];
    })
    .filter(([phrase]) => {
      const parts = phrase.split(/\s+/).length;
      return parts >= 1 && parts <= 6;
    })
    .sort((a, b) => b[1] - a[1]);
}

function extractLocationHints(pages) {
  const text = pages
    .map((p) => `${p.title} ${p.h1} ${p.description} ${p.bodyText.slice(0, 1500)}`)
    .join(" ");
  const patterns = [
    /([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s*([A-Z]{2})\b/,
    /\b(serving|located in|based in|near)\s+([A-Z][a-zA-Z\s,]{3,40})/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return (m[2] ? `${m[1] || ""} ${m[2]}`.trim() : m[0]).slice(0, 80);
  }
  return "";
}

async function refineWithAi(origin, ranked, pageSummaries, locationHint) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const top = ranked.slice(0, 30).map(([p, s]) => `${p} (${s.toFixed(1)})`);
  const samples = pageSummaries
    .slice(0, 10)
    .map((p) => `- ${p.url}\n  title: ${p.title}\n  h1: ${p.h1}\n  desc: ${p.description}`)
    .join("\n");

  const locLine = locationHint
    ? `Target location (must influence keyword choice for local SEO): ${locationHint}`
    : "Infer the best service-area / city from page samples if present.";

  try {
    const data = await callOpenRouter({
      model: process.env.KEYWORD_MODEL || "openai/gpt-4o-mini",
      maxTokens: 500,
      messages: [
        {
          role: "system",
          content:
            "You are an SEO analyst. Mimic how Google ranks topical relevance: prefer commercial intent phrases users search, demote brand-only or boilerplate. Return ONLY valid JSON with keys primaryKeyword (string), secondaryKeywords (array of 4-8 strings), suggestedLocation (string, city/region or empty). No markdown.",
        },
        {
          role: "user",
          content: `Website: ${origin}\n${locLine}\n\nCandidate phrases (score):\n${top.join("\n")}\n\nPage samples:\n${samples}\n\nPick the best primary keyword and secondary keywords for ranking + content. Prefer location-qualified phrases when a location is known.`,
        },
      ],
    });

    const content = data?.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.primaryKeyword) return null;
    return {
      primaryKeyword: String(parsed.primaryKeyword).trim(),
      secondaryKeywords: (parsed.secondaryKeywords || [])
        .map((k) => String(k).trim())
        .filter(Boolean)
        .slice(0, 8),
      suggestedLocation: String(parsed.suggestedLocation || "").trim(),
      ai: true,
      mock: !!data._mock,
    };
  } catch (err) {
    console.error("[siteAnalyzer AI]", err.message);
    return null;
  }
}

/**
 * @param {string} domainInput
 * @param {{ location?: string }} [opts]
 */
export async function analyzeSite(domainInput, opts = {}) {
  const origin = normalizeDomain(domainInput);
  if (!origin) {
    return { ok: false, error: "Enter a valid root domain, e.g. example.com" };
  }

  const userLocation = String(opts.location || "").trim();

  const allUrls = await discoverSitemapUrls(origin);
  const homepage = `${origin}/`;
  const prioritized = [
    homepage,
    ...allUrls
      .filter((u) => u !== homepage && isLikelyPageUrl(u))
      .sort((a, b) => urlPriority(b) - urlPriority(a)),
  ].slice(0, MAX_PAGES_TO_FETCH);

  const pages = [];
  for (let i = 0; i < prioritized.length; i += 5) {
    const batch = prioritized.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (url) => {
        const html = await fetchText(url);
        if (!html) return null;
        return {
          url,
          title: tagText(html, "title"),
          h1: tagText(html, "h1"),
          h2s: allTagTexts(html, "h2"),
          description:
            metaContent(html, "description") || metaContent(html, "og:description"),
          bodyText: stripHtml(html).slice(0, 10000),
        };
      })
    );
    for (const p of results) if (p) pages.push(p);
  }

  if (pages.length === 0) {
    return {
      ok: false,
      error: "Could not fetch website pages. Check the domain is public and reachable.",
    };
  }

  const ranked = scorePhrases(pages);
  const scrapedLocation = extractLocationHints(pages);
  const locationHint = userLocation || scrapedLocation;
  const ai = await refineWithAi(origin, ranked, pages, locationHint);

  let primaryKeyword;
  let secondaryKeywords;
  let suggestedLocation = userLocation || scrapedLocation || "";

  if (ai) {
    primaryKeyword = ai.primaryKeyword;
    secondaryKeywords = ai.secondaryKeywords;
    if (!userLocation && ai.suggestedLocation) suggestedLocation = ai.suggestedLocation;
  } else {
    const multi = ranked.filter(([p]) => p.includes(" "));
    const pool = multi.length >= 3 ? multi : ranked;
    primaryKeyword =
      pool[0]?.[0] || pages[0].h1 || pages[0].title || origin.replace(/^https?:\/\//, "");
    secondaryKeywords = pool
      .slice(1, 9)
      .map(([p]) => p)
      .filter((p) => p !== primaryKeyword);
    if (userLocation && !String(primaryKeyword).toLowerCase().includes(userLocation.split(",")[0].toLowerCase().trim())) {
      primaryKeyword = `${primaryKeyword} ${userLocation.split(",")[0].trim()}`.trim();
    }
  }

  const pretty = (s) =>
    s
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\bSeo\b/g, "SEO")
      .replace(/\bGbp\b/g, "GBP");

  return {
    ok: true,
    domain: origin,
    urlCount: allUrls.length,
    pagesAnalyzed: pages.length,
    sampleUrls: prioritized.slice(0, 12),
    primaryKeyword: pretty(primaryKeyword),
    secondaryKeywords: secondaryKeywords.map(pretty),
    location: suggestedLocation,
    address: "",
    needsLocation: !suggestedLocation,
    method: ai ? (ai.mock ? "heuristic+ai-mock" : "full-crawl+ai") : "full-crawl+heuristic",
  };
}
