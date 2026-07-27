/**
 * Site analyzer: root domain → discover sitemap → crawl pages → extract keywords
 * Location is NOT auto-finalized — frontend asks the user after keywords.
 */
import { callOpenRouter } from "../openrouter.js";

const FETCH_TIMEOUT_MS = 12000;
const MAX_SITEMAP_URLS = 80;
const MAX_PAGES_TO_FETCH = 12;
const USER_AGENT =
  "Mozilla/5.0 (compatible; AvonixSocialBot/1.0; +https://social.avonixai.com)";

const STOP_WORDS = new Set(
  `a an the and or but if in on at to for of from by with as is are was were be been being
  this that these those it its you your we our they their he she his her them
  not no yes do does did doing done have has had having will would can could should
  may might must shall about into over under again further then once here there when
  where why how all each few more most other some such only own same so than too very
  just also back new home page click learn read more contact us privacy terms
  cookie cookies login signup menu search copyright reserved rights`.split(/\s+/)
);

export function normalizeDomain(input) {
  let raw = String(input || "").trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    // Strip path — root domain only
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

async function discoverSitemapUrls(origin) {
  const candidates = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/wp-sitemap.xml`,
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
    // Sitemap index → fetch child sitemaps
    const childSitemaps = locs.filter((u) => /sitemap/i.test(u) && u.endsWith(".xml"));
    const pages = locs.filter((u) => !childSitemaps.includes(u));

    for (const p of pages) pageUrls.add(p);

    for (const child of childSitemaps.slice(0, 5)) {
      const childXml = await fetchText(child);
      const childLocs = extractLocsFromXml(childXml);
      for (const p of childLocs) {
        if (!/sitemap.*\.xml$/i.test(p)) pageUrls.add(p);
      }
    }

    if (pageUrls.size > 0) break;
  }

  // Always include homepage
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

function scorePhrases(pages) {
  const scores = new Map();

  const bump = (phrase, weight) => {
    if (!phrase || phrase.length < 3) return;
    const key = phrase.toLowerCase().trim();
    if (STOP_WORDS.has(key)) return;
    scores.set(key, (scores.get(key) || 0) + weight);
  };

  for (const page of pages) {
    bump(page.title, 8);
    bump(page.h1, 10);
    for (const h2 of page.h2s.slice(0, 8)) bump(h2, 4);
    if (page.description) {
      for (const g of ngrams(tokenize(page.description), 2)) bump(g, 3);
      for (const g of ngrams(tokenize(page.description), 3)) bump(g, 4);
    }
    const bodyWords = tokenize(page.bodyText.slice(0, 4000));
    for (const g of ngrams(bodyWords, 2)) bump(g, 1);
    for (const g of ngrams(bodyWords, 3)) bump(g, 1.5);
    for (const w of bodyWords) bump(w, 0.3);
  }

  return [...scores.entries()]
    .filter(([phrase]) => phrase.split(/\s+/).length >= 1 && phrase.split(/\s+/).length <= 5)
    .sort((a, b) => b[1] - a[1]);
}

async function refineWithAi(origin, ranked, pageSummaries) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const top = ranked.slice(0, 20).map(([p, s]) => `${p} (${s.toFixed(1)})`);
  const samples = pageSummaries
    .slice(0, 6)
    .map((p) => `- ${p.url}\n  title: ${p.title}\n  h1: ${p.h1}\n  desc: ${p.description}`)
    .join("\n");

  try {
    const data = await callOpenRouter({
      model: process.env.KEYWORD_MODEL || "openai/gpt-4o-mini",
      maxTokens: 400,
      messages: [
        {
          role: "system",
          content:
            "You extract SEO keywords for a business website. Return ONLY valid JSON with keys primaryKeyword (string) and secondaryKeywords (array of 3-6 strings). No markdown.",
        },
        {
          role: "user",
          content: `Website: ${origin}\n\nCandidate phrases (score):\n${top.join("\n")}\n\nPage samples:\n${samples}\n\nPick the best homepage/business focus primary keyword and secondary topical keywords.`,
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
        .slice(0, 6),
      ai: true,
      mock: !!data._mock,
    };
  } catch (err) {
    console.error("[siteAnalyzer AI]", err.message);
    return null;
  }
}

export async function analyzeSite(domainInput) {
  const origin = normalizeDomain(domainInput);
  if (!origin) {
    return { ok: false, error: "Enter a valid root domain, e.g. example.com" };
  }

  const allUrls = await discoverSitemapUrls(origin);
  const homepage = `${origin}/`;
  const prioritized = [
    homepage,
    ...allUrls.filter((u) => u !== homepage && !/\.(jpg|png|pdf|zip|xml)$/i.test(u)),
  ].slice(0, MAX_PAGES_TO_FETCH);

  const pages = [];
  for (const url of prioritized) {
    const html = await fetchText(url);
    if (!html) continue;
    const title = tagText(html, "title");
    const h1 = tagText(html, "h1");
    const h2s = allTagTexts(html, "h2");
    const description =
      metaContent(html, "description") || metaContent(html, "og:description");
    const bodyText = stripHtml(html).slice(0, 8000);
    pages.push({ url, title, h1, h2s, description, bodyText });
  }

  if (pages.length === 0) {
    return {
      ok: false,
      error: "Could not fetch website pages. Check the domain is public and reachable.",
    };
  }

  const ranked = scorePhrases(pages);
  const ai = await refineWithAi(origin, ranked, pages);

  let primaryKeyword;
  let secondaryKeywords;

  if (ai) {
    primaryKeyword = ai.primaryKeyword;
    secondaryKeywords = ai.secondaryKeywords;
  } else {
    // Prefer multi-word phrases
    const multi = ranked.filter(([p]) => p.includes(" "));
    const pool = multi.length >= 3 ? multi : ranked;
    primaryKeyword = pool[0]?.[0] || pages[0].h1 || pages[0].title || origin.replace(/^https?:\/\//, "");
    secondaryKeywords = pool
      .slice(1, 7)
      .map(([p]) => p)
      .filter((p) => p !== primaryKeyword);
  }

  // Title-case lightly
  const pretty = (s) =>
    s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bSeo\b/g, "SEO").replace(/\bGbp\b/g, "GBP");

  return {
    ok: true,
    domain: origin,
    urlCount: allUrls.length,
    pagesAnalyzed: pages.length,
    sampleUrls: prioritized.slice(0, 8),
    primaryKeyword: pretty(primaryKeyword),
    secondaryKeywords: secondaryKeywords.map(pretty),
    // Location intentionally empty — UI asks user next
    location: "",
    address: "",
    needsLocation: true,
    method: ai ? (ai.mock ? "heuristic+ai-mock" : "heuristic+ai") : "heuristic",
  };
}
