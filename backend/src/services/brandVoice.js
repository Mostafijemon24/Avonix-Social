/**
 * P1 — Website-specific brand voice profiles.
 *
 * Builds a DISTINCT voice profile per website from that site's VERIFIED
 * intelligence (crawled page keywords/titles, inferred industry, audience, and
 * location). Two different websites therefore get two different profiles — the
 * profile is derived from the site's own content, never a shared global prompt.
 *
 * Design:
 *   • deriveBrandVoice() is PURE + deterministic → fully testable offline and
 *     guarantees the same site always yields the same stable voiceId.
 *   • getBrandVoice() wraps it with a TTL cache keyed by origin+workspace so
 *     valid website intelligence is REUSED (no repeat AI calls) — the P1
 *     performance requirement. Optional AI enrichment runs at most once per
 *     site per TTL and is cached alongside the heuristic base.
 *   • buildVoicePromptBlock() renders the profile into a prompt fragment that is
 *     injected into generation so each platform/site reads distinctly.
 *
 * Isolation: the profile only ever contains THIS site's own data. It is never
 * populated from another website, preventing cross-identity leakage upstream.
 */
import crypto from "crypto";
import { callOpenRouter } from "../openrouter.js";
import { cacheGet, cacheSet } from "./crawlUtils.js";

const VOICE_CACHE_TTL_MS = Number(process.env.BRAND_VOICE_CACHE_TTL_MS || 30 * 60 * 1000);

const STOP = new Set(
  `a an the and or but if in on at to for of from by with as is are was were be been being this that these those it its you your we our they their he she his her them not no yes do does did have has had will would can could should may might must about into over under again then once here there when where why how all each more most other some such only own same so than too very just also new home page click learn read contact privacy terms services service company business near me local best top get started today free online website`.split(
    /\s+/
  )
);

/**
 * Industry signal buckets. First bucket whose regex matches the combined
 * keyword/title blob wins. Each carries default voice characteristics tuned to
 * how that industry actually communicates.
 */
const INDUSTRY_PROFILES = [
  {
    id: "medical",
    label: "healthcare / medical",
    re: /\b(clinic|dermatolog|dental|dentist|doctor|physician|medical|health|wellness|therapy|chiropract|orthodont|pediatric|cardio|urgent care|hospital|surgery|patient)\b/i,
    formality: "professional-reassuring",
    tones: ["reassuring", "professional", "caring", "clear"],
    audience: "patients and local families",
    avoid: ["hype", "exaggerated claims", "fear-mongering"],
  },
  {
    id: "legal",
    label: "legal / law",
    re: /\b(law|lawyer|attorney|legal|litigation|counsel|firm|defense|injury|estate|divorce|criminal|paralegal)\b/i,
    formality: "formal-authoritative",
    tones: ["authoritative", "precise", "trustworthy", "measured"],
    audience: "clients facing a legal decision",
    avoid: ["casual slang", "guarantees of outcomes"],
  },
  {
    id: "finance",
    label: "finance / accounting",
    re: /\b(accounting|accountant|tax|bookkeep|financ|insurance|mortgage|loan|invest|wealth|cpa|audit|payroll)\b/i,
    formality: "formal-trustworthy",
    tones: ["trustworthy", "precise", "clear", "professional"],
    audience: "clients managing money or risk",
    avoid: ["hype", "unrealistic promises"],
  },
  {
    id: "home_services",
    label: "home / trade services",
    re: /\b(plumb|hvac|roof|electric|contractor|remodel|renovation|landscap|lawn|pest|clean|handyman|garage|fencing|concrete|painting|flooring|restoration)\b/i,
    formality: "practical-friendly",
    tones: ["practical", "dependable", "friendly", "straightforward"],
    audience: "local homeowners",
    avoid: ["jargon", "corporate buzzwords"],
  },
  {
    id: "beauty",
    label: "beauty / salon / spa",
    re: /\b(salon|spa|beauty|hair|nails|lash|skincare|facial|massage|barber|makeup|aesthet|waxing|brows)\b/i,
    formality: "warm-inviting",
    tones: ["warm", "inviting", "stylish", "upbeat"],
    audience: "local beauty and self-care clients",
    avoid: ["clinical coldness", "pushy sales"],
  },
  {
    id: "food",
    label: "restaurant / food",
    re: /\b(restaurant|cafe|coffee|bakery|catering|menu|cuisine|dining|food|pizza|grill|kitchen|brewery|bar)\b/i,
    formality: "warm-casual",
    tones: ["warm", "appetizing", "casual", "inviting"],
    audience: "local diners and food lovers",
    avoid: ["corporate tone", "stiff phrasing"],
  },
  {
    id: "realestate",
    label: "real estate / property",
    re: /\b(real estate|realtor|property|homes for sale|listing|mortgage broker|apartment|rental|leasing|realty)\b/i,
    formality: "professional-warm",
    tones: ["knowledgeable", "warm", "trustworthy", "local"],
    audience: "buyers, sellers, and renters",
    avoid: ["pushy sales", "inflated claims"],
  },
  {
    id: "automotive",
    label: "automotive",
    re: /\b(auto|car|vehicle|mechanic|tire|brake|transmission|detailing|collision|dealership|body shop|repair)\b/i,
    formality: "practical-friendly",
    tones: ["practical", "honest", "dependable", "clear"],
    audience: "local drivers and vehicle owners",
    avoid: ["jargon", "upsell pressure"],
  },
  {
    id: "fitness",
    label: "fitness / gym",
    re: /\b(gym|fitness|training|workout|yoga|pilates|crossfit|coach|nutrition|wellness|personal trainer)\b/i,
    formality: "energetic-supportive",
    tones: ["motivating", "supportive", "energetic", "positive"],
    audience: "people pursuing health and fitness goals",
    avoid: ["shaming", "unrealistic promises"],
  },
  {
    id: "education",
    label: "education / training",
    re: /\b(school|academy|tutor|education|course|training|learning|classes|students|curriculum|university|college)\b/i,
    formality: "supportive-professional",
    tones: ["encouraging", "clear", "knowledgeable", "supportive"],
    audience: "learners and parents",
    avoid: ["hype", "jargon"],
  },
  {
    id: "technology",
    label: "technology / software",
    re: /\b(software|app|saas|platform|cloud|data|ai|automation|development|developer|it services|cyber|hosting|web design|digital)\b/i,
    formality: "professional-insightful",
    tones: ["insightful", "clear", "confident", "modern"],
    audience: "businesses and decision-makers",
    avoid: ["empty buzzwords", "hype"],
  },
  {
    id: "marketing",
    label: "marketing / agency",
    re: /\b(marketing|seo|advertis|branding|agency|social media|content|campaign|lead generation|ppc|growth)\b/i,
    formality: "confident-insightful",
    tones: ["confident", "insightful", "results-oriented", "clear"],
    audience: "business owners and marketers",
    avoid: ["vague promises", "jargon soup"],
  },
  {
    id: "retail",
    label: "retail / ecommerce",
    re: /\b(shop|store|boutique|retail|ecommerce|products|collection|apparel|jewelry|furniture|gifts)\b/i,
    formality: "friendly-upbeat",
    tones: ["upbeat", "friendly", "descriptive", "inviting"],
    audience: "shoppers and local customers",
    avoid: ["pushy sales", "exaggeration"],
  },
];

const DEFAULT_PROFILE = {
  id: "general_local",
  label: "local business",
  formality: "professional-friendly",
  tones: ["professional", "friendly", "clear", "local"],
  audience: "local customers",
  avoid: ["hype", "generic marketing clichés"],
};

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

function pickIndustry(blob) {
  for (const p of INDUSTRY_PROFILES) {
    if (p.re.test(blob)) return p;
  }
  return DEFAULT_PROFILE;
}

function inferAudience(blob, industry) {
  if (/\b(b2b|enterprise|businesses|companies|agencies|teams|organizations|clients|professionals)\b/i.test(blob)) {
    return "businesses and professionals";
  }
  if (/\b(homeowner|family|families|residents|neighbors|community)\b/i.test(blob)) {
    return "local homeowners and families";
  }
  return industry.audience;
}

function distinctVocabulary(pages, keywords, locationTokens) {
  const freq = new Map();
  const add = (text, weight = 1) => {
    for (const t of tokenize(text)) {
      if (locationTokens.has(t)) continue;
      freq.set(t, (freq.get(t) || 0) + weight);
    }
  };
  add(keywords.primary, 4);
  (keywords.secondaryKeywords || keywords.general || []).forEach((k) => add(k, 3));
  for (const p of pages || []) {
    add(p.title, 2);
    add(p.keywords?.primary, 2);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w);
}

/**
 * Derive a deterministic brand-voice profile for ONE website.
 * @param {{origin?:string, pages?:Array, keywords?:object, location?:string, business?:object}} input
 */
export function deriveBrandVoice({ origin = "", pages = [], keywords = {}, location = "", business = {} } = {}) {
  const kw = {
    primary: keywords.primary || "",
    secondaryKeywords:
      keywords.secondaryKeywords || keywords.general || (keywords.secondary ? [keywords.secondary] : []),
  };
  const blob = [
    kw.primary,
    ...(kw.secondaryKeywords || []),
    ...(pages || []).map((p) => `${p.title || ""} ${p.keywords?.primary || ""}`),
    business.name || "",
    business.differentiators || "",
  ]
    .filter(Boolean)
    .join(" ");

  const industry = pickIndustry(blob);
  const locTokens = new Set(
    String(location || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3)
  );
  const audience = inferAudience(blob, industry);
  const vocabulary = distinctVocabulary(pages, kw, locTokens);
  const city = String(location || "").split(",")[0].trim();

  const voiceId = crypto
    .createHash("sha256")
    .update(`${origin}|${industry.id}|${audience}|${vocabulary.slice(0, 5).join(",")}`)
    .digest("hex")
    .slice(0, 16);

  const summary =
    `A ${industry.formality} voice for a ${industry.label}${city ? ` serving ${city}` : ""}, ` +
    `speaking to ${audience}. Tone: ${industry.tones.join(", ")}.`;

  return {
    voiceId,
    origin: origin || null,
    industryId: industry.id,
    industry: industry.label,
    audience,
    formality: industry.formality,
    tones: industry.tones,
    vocabulary,
    avoid: industry.avoid,
    city: city || "",
    summary,
    source: "heuristic",
    aiEnriched: false,
  };
}

/** Render a profile into a prompt fragment injected into generation. */
export function buildVoicePromptBlock(voice, platform = "") {
  if (!voice) return "";
  const vocab = (voice.vocabulary || []).slice(0, 8).join(", ");
  return [
    `BRAND VOICE (specific to THIS website — do not borrow another brand's style):`,
    `- Industry: ${voice.industry}`,
    `- Audience: ${voice.audience}`,
    `- Desired tone: ${(voice.tones || []).join(", ")} (${voice.formality})`,
    vocab ? `- Natural vocabulary this brand actually uses: ${vocab}` : "",
    voice.avoid?.length ? `- Avoid: ${voice.avoid.join(", ")}` : "",
    voice.summary ? `- Voice summary: ${voice.summary}` : "",
    platform ? `- Keep this voice while respecting ${platform} platform conventions.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function cacheKey({ userId, workspaceId, websiteOrigin }) {
  return `brandvoice::${userId || ""}::${workspaceId || ""}::${websiteOrigin || ""}`;
}

/**
 * Optional one-shot AI enrichment of the heuristic profile. Falls back silently
 * to the heuristic profile on any error or when no provider is configured.
 */
async function enrichWithAi(base, { pages, model }) {
  if (!model || !process.env.OPENROUTER_API_KEY) return base;
  try {
    const samples = (pages || [])
      .slice(0, 6)
      .map((p) => `- ${p.title || ""} (${p.keywords?.primary || ""})`)
      .join("\n");
    const data = await callOpenRouter({
      model,
      maxTokens: 300,
      messages: [
        {
          role: "system",
          content:
            "You analyze a single website's content and describe its brand voice. Return ONLY JSON: {tones:string[3-5], audience:string, summary:string}. Base it strictly on the provided data for THIS site; never invent another business.",
        },
        {
          role: "user",
          content: `Website: ${base.origin || ""}\nIndustry (detected): ${base.industry}\nKeyword vocabulary: ${(base.vocabulary || []).join(", ")}\nPage samples:\n${samples}\n\nDescribe this site's distinct brand voice.`,
        },
      ],
    });
    const raw = data?.choices?.[0]?.message?.content || "";
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return base;
    const parsed = JSON.parse(m[0]);
    return {
      ...base,
      tones: Array.isArray(parsed.tones) && parsed.tones.length ? parsed.tones.slice(0, 5).map(String) : base.tones,
      audience: parsed.audience ? String(parsed.audience) : base.audience,
      summary: parsed.summary ? String(parsed.summary) : base.summary,
      source: data._mock ? "heuristic+ai-mock" : "heuristic+ai",
      aiEnriched: !data._mock,
    };
  } catch {
    return base;
  }
}

/**
 * Cached brand-voice resolver. Reuses a valid cached profile (performance) and
 * only derives/enriches when the cache is cold or forced.
 */
export async function getBrandVoice({
  userId,
  workspaceId,
  websiteOrigin,
  pages = [],
  keywords = {},
  location = "",
  business = {},
  model,
  enrich = false,
  force = false,
} = {}) {
  const key = cacheKey({ userId, workspaceId, websiteOrigin });
  if (!force) {
    const hit = cacheGet(key);
    if (hit) return { ...hit, cached: true };
  }
  const base = deriveBrandVoice({ origin: websiteOrigin, pages, keywords, location, business });
  const profile = enrich ? await enrichWithAi(base, { pages, model }) : base;
  cacheSet(key, profile, VOICE_CACHE_TTL_MS);
  return { ...profile, cached: false };
}
