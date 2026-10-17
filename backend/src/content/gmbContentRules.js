/**
 * MASTER GMB CONTENT GENERATION RULES
 * Single source of truth for Google Business Profile posts.
 *
 * Consumed by: generation, validation, rewrite, regenerate, preview, UI catalog.
 * Do not duplicate these rules in frontend prompts or ad-hoc system messages.
 *
 * Authoritative sources:
 * - post command.docx / post command and type.docx
 * - AVONIX-SOCIAL-REDESIGN-SPEC.md §6–10
 */

export const GMB_RULESET_VERSION = "gmb-master-v2";

/**
 * GBP length model (master-prompt v2): concise + complete, NOT a forced long
 * SEO wall. `max` is Google's real localPost summary limit (1,500 chars). There
 * is NO mandatory minimum padding target — short, useful posts are valid. The
 * soft `targetMin/targetMax` are advisory only (never padded to, never a
 * hard-fail). `hashtagMin/Max = 0`: GBP posts default to ZERO hashtags.
 */
export const GMB_CHAR = Object.freeze({
  min: 80, // minimal complete post (guards against empty output, NOT a padding target)
  max: 1500, // Google localPost summary hard limit
  targetMin: 250, // advisory lower comfort bound (not enforced)
  targetMax: 900, // advisory upper comfort bound (not enforced)
  frontLoad: 150,
  hashtagMin: 0, // GBP: default no hashtags
  hashtagMax: 0,
});

export const GMB_CATEGORY_IDS = Object.freeze({
  INTENT_PROXIMITY: "INTENT_PROXIMITY",
  OFFER_PROMOTION_EVENT: "OFFER_PROMOTION_EVENT",
  AUTHORITY_TRUST_PROOF: "AUTHORITY_TRUST_PROOF",
  FAQ_EDUCATIONAL: "FAQ_EDUCATIONAL",
});

const CTA = Object.freeze({
  CALL_NOW: "CALL NOW",
  BOOK: "BOOK",
  SIGN_UP: "SIGN UP",
  LEARN_MORE: "LEARN MORE",
  GET_DIRECTIONS: "GET DIRECTIONS",
  CONTACT_US: "CONTACT US",
  VISIT_WEBSITE: "VISIT WEBSITE",
});

/**
 * Authoritative category definitions.
 * `systemPrompt` is injected into the generation engine — never copied into the UI.
 */
export const GMB_CATEGORIES = Object.freeze({
  INTENT_PROXIMITY: {
    id: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
    label: "Intent & Proximity",
    short: "Local service + location, near-me searches",
    recommendedUse: "High-intent mobile, Maps, voice, and AI local searches.",
    searchIntent: "high-intent local",
    accent: "#ff7a1a",
    defaultCta: CTA.CALL_NOW,
    tone: [
      "Professional",
      "Local",
      "Trustworthy",
      "Welcoming",
      "Conversion-focused",
      "Natural",
    ],
    hookName: "Local Search Hook",
    frontLoad: {
      require: ["service", "city", "localIntent"],
      description:
        "Primary service + city + relevant near-me language must appear naturally within the first 150 characters. Do not keyword-stuff.",
    },
    structure: [
      { key: "hook", label: "Local Search Hook" },
      { key: "proximity", label: "Proximity & Availability" },
      { key: "services", label: "Core Services" },
      { key: "why", label: "Why Choose Us" },
      { key: "napCta", label: "NAP (optional)" },
    ],
    servicesCount: { min: 1, max: 7 },
    objective:
      "Capture high-intent mobile, Google Maps, voice and AI-driven local searches.",
    systemPrompt: `You are an expert Local SEO and Google Business Profile (GBP) strategist.

GOAL
Capture high-intent mobile, Google Maps, voice, and AI-driven local searches. Increase calls and map visits. Strengthen local relevance.

LENGTH
Write concise, complete, professional copy appropriate to the topic. Do NOT pad to a length target. Hard limit: at most 1,500 characters including spaces. There is no minimum. Never produce robotic SEO copy.

MANDATORY FRONT-LOADING
Within the first 150 characters, naturally include:
- the primary service
- the city
- relevant "near me" language
Do not keyword-stuff. Use natural language useful to real customers.

MANDATORY STRUCTURE (do not omit, merge away, or rearrange)
1. Local Search Hook — headline targeting primary service + city with near-me intent.
2. Proximity & Availability — city, street or neighborhood, service area, hours, convenience (only if factually true: walk-ins, 24/7, same-day, fast response, no appointment, book today).
3. Core Services — list ONLY verified actual services from the selected source, website analysis, or workspace data. One real service is enough. Never invent extra services, never turn keywords into "Tip 2/3/4", and never pad with educational tips labeled as services.
4. Why Choose Us — verified differentiators only. NEVER invent #1, best, or top-rated unless factually supported in the source data.
5. NAP (optional) — Business Name, Exact Address, Phone, Hours ONLY when provided; otherwise omit. Do NOT write a CTA instruction in the body (the native button is attached separately). Do NOT add hashtags.

COMMUNICATE NATURALLY
What the business does, where it is located, who it serves, availability when verified, key services, why customers should choose it, and what to do next.

TONE
Professional, local, trustworthy, welcoming, conversion-focused, and natural.
Never write robotic SEO copy.

FACTUALITY
Use ONLY verified information from selected crawled pages, workspace/business data, location, and connected business information.
NEVER invent services, addresses, phone numbers, hours, ratings, awards, credentials, discounts, events, prices, statistics, equipment, certifications, or guarantees.
If a fact is unavailable, omit it. Do not fabricate.`,
  },

  OFFER_PROMOTION_EVENT: {
    id: GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT,
    label: "Offer / Promotion / Event",
    short: "Verified offers, promotions, events, registrations",
    recommendedUse: "Only when a real offer, promotion, or event is verified.",
    searchIntent: "deal / event intent",
    accent: "#f5a524",
    defaultCta: CTA.SIGN_UP,
    tone: ["Energetic", "Professional", "Trustworthy", "Clear", "Locally relevant", "Action-oriented"],
    hookName: "Promotional Hook",
    frontLoad: {
      require: ["offer"],
      description:
        "Main offer, event, discount, or benefit must appear within the first 150 characters.",
    },
    structure: [
      { key: "hook", label: "Promotional Hook" },
      { key: "value", label: "Value Proposition" },
      { key: "redeem", label: "How to Redeem" },
      { key: "local", label: "Local Connection" },
      { key: "napCta", label: "NAP (optional)" },
    ],
    requiresVerifiedOffer: true,
    objective:
      "Create a compelling reason to call, visit, register, or redeem — using only verified promotional facts.",
    systemPrompt: `You are an expert Local SEO, Google Business Profile, and conversion-rate optimization specialist.

GOAL
Create urgency around a VERIFIED offer, promotion, or event. Encourage calls, visits, bookings, registrations, or redemptions. Never invent the offer.

LENGTH
Write concise, complete, professional copy appropriate to the topic. Do NOT pad to a length target. Hard limit: at most 1,500 characters including spaces. There is no minimum.

MANDATORY FRONT-LOADING
Put the main offer, event, discount, or benefit within the first 150 characters.

MANDATORY STRUCTURE (do not omit)
1. Promotional Hook — offer, event, discount, or major benefit.
2. Value Proposition — what the customer receives, who qualifies, why it is valuable, relevant dates/availability, limitations.
3. How to Redeem — simple instructions (call, mention this Google post, register, visit, book).
4. Local Connection — city, neighborhood/street, service area, event location.
5. NAP (optional) — Business Name, Exact Address, Phone, Hours/Event Time ONLY when provided; otherwise omit. Do NOT write a CTA instruction in the body. Do NOT add hashtags.

CRITICAL FACTUALITY
NEVER invent discounts, expiration dates, scarcity, availability, quantities, eligibility, promotions, or events.
If verified offer/event information is missing from the provided data, you MUST refuse to fabricate and return JSON { "error": "NO_VERIFIED_OFFER" }.

TONE
Energetic, professional, trustworthy, clear, locally relevant, action-oriented.
Avoid fake urgency, spam capitalization, and keyword stuffing.

Possible legitimate subjects only when present in source data: discount, seasonal promotion, limited-time offer, free consultation, special package, free screening, community event, training event, open house, registration, new service launch.`,
  },

  AUTHORITY_TRUST_PROOF: {
    id: GMB_CATEGORY_IDS.AUTHORITY_TRUST_PROOF,
    label: "Authority / Trust / Proof",
    short: "Expertise, credentials, technology, verified proof",
    recommendedUse: "Consideration / trust — only verified credibility signals.",
    searchIntent: "consideration / trust",
    accent: "#2dd4bf",
    defaultCta: CTA.BOOK,
    tone: [
      "Professional",
      "Authoritative",
      "Reassuring",
      "Local",
      "Evidence-based",
      "Conversion-focused",
    ],
    hookName: "Authority Hook",
    frontLoad: {
      require: ["authority"],
      description:
        "Primary trust/authority message must appear within the first 150 characters.",
    },
    structure: [
      { key: "hook", label: "Authority Hook" },
      { key: "proof", label: "Proof & Differentiation" },
      { key: "benefit", label: "Customer Benefit" },
      { key: "local", label: "Local Reassurance" },
      { key: "napCta", label: "NAP (optional)" },
    ],
    objective:
      "Build instant credibility for map searchers using only verified proof.",
    systemPrompt: `You are an expert Local SEO, Google Business Profile, brand reputation, and entity optimization specialist.

GOAL
Build immediate credibility with people who found the business on Google Search or Maps. Use ONLY verified credibility signals.

LENGTH
Write concise, complete, professional copy appropriate to the topic. Do NOT pad to a length target. Hard limit: at most 1,500 characters including spaces. There is no minimum.

MANDATORY FRONT-LOADING
Place the primary trust/authority message within the first 150 characters.

MANDATORY STRUCTURE (do not omit)
1. Authority Hook — why choosing the right local provider matters; position the business as a credible specialist.
2. Proof & Differentiation — 2–4 verified trust signals only.
3. Customer Benefit — how capabilities help (faster service, convenience, accurate evaluation, higher quality, easier process, better access, reduced delays, personalized service). Avoid unsupported guarantees.
4. Local Reassurance — connect expertise to the city and surrounding communities.
5. NAP (optional) — Business Name, Exact Address, Phone, Hours ONLY when provided; otherwise omit. Do NOT write a CTA instruction in the body. Do NOT add hashtags.

VERIFIED SIGNALS ONLY (use only if present in source data)
Years of experience, professional credentials, specialized training, advanced technology, certifications, experienced team, on-site capabilities, customer service process, verified review themes, unique business advantages.

NEVER INVENT
ratings, review counts, certifications, years of experience, awards, equipment, credentials, statistics.

TONE
Professional, authoritative, reassuring, local, evidence-based, conversion-focused.`,
  },

  FAQ_EDUCATIONAL: {
    id: GMB_CATEGORY_IDS.FAQ_EDUCATIONAL,
    label: "FAQ & Educational",
    short: "Customer questions, long-tail, voice & AI search",
    recommendedUse: "Answer one specific customer problem; informational / conversational.",
    searchIntent: "informational / conversational",
    accent: "#56b6f2",
    defaultCta: CTA.LEARN_MORE,
    tone: ["Helpful", "Informative", "Authoritative", "Approachable", "Easy to understand"],
    hookName: "Question Hook",
    frontLoad: {
      require: ["question"],
      description:
        "A source-supported customer question ending with a question mark must appear within the first 150 characters. Answer immediately.",
    },
    structure: [
      { key: "hook", label: "Question Hook" },
      { key: "answer", label: "Direct Answer" },
      { key: "tips", label: "Actionable Tips" },
      { key: "local", label: "Local Connection" },
      { key: "napCta", label: "NAP (optional)" },
    ],
    tipsCount: { min: 2, max: 4 },
    objective:
      "Solve ONE specific customer problem and capture long-tail / voice / AI search intent.",
    systemPrompt: `You are an expert Local SEO, Google Business Profile, AI Search Optimization, and content strategist.

GOAL
Directly answer one common customer question. Capture long-tail, conversational, voice, and AI-driven search intent. Demonstrate local expertise. Encourage contact when professional help is needed.

LENGTH
Write concise, complete, professional copy appropriate to the topic. Do NOT pad to a length target. Hard limit: at most 1,500 characters including spaces. There is no minimum.

MANDATORY FRONT-LOADING
The first 150 characters MUST contain a natural question that ends with a question mark, based on the selected source (for example "Need help with…?", "Wondering how to…?", "How do you…?"). Do not use a generic unrelated question.
Answer the question immediately — do not add a long introduction.

MANDATORY STRUCTURE (do not omit)
1. Question Hook — the exact type of question a customer may search (When should I…? Do I need…? How do I know if…? What happens when…? How much…? How long…? When should I call a professional?).
2. Direct Answer — concise expert answer. The first 2–3 sentences should stand alone as a useful answer.
3. Actionable Tips — 2–4 concise bullet points, warning signs, steps, or considerations.
4. Local Connection — tie the answer back to this local business and city.
5. NAP (optional) — Business Name, Exact Address, Phone, Hours ONLY when provided; otherwise omit. Do NOT write a CTA instruction in the body. Do NOT add hashtags.

Solve ONE specific customer problem. Do not cover many unrelated topics.
Do not make unsupported medical, legal, financial, technical, or safety claims.

TONE
Helpful, informative, authoritative, approachable, easy to understand.`,
  },
});

export const GMB_CATEGORY_LIST = Object.freeze(
  Object.values(GMB_CATEGORIES).map((c) => ({
    id: c.id,
    label: c.label,
    short: c.short,
    recommendedUse: c.recommendedUse,
    searchIntent: c.searchIntent,
    accent: c.accent,
    defaultCta: c.defaultCta,
    tone: c.tone,
    hookName: c.hookName,
    frontLoad: c.frontLoad,
    structure: c.structure,
    requiresVerifiedOffer: !!c.requiresVerifiedOffer,
    objective: c.objective,
  }))
);

export function isGmbCategoryId(id) {
  return Boolean(id && GMB_CATEGORIES[id]);
}

export function getGmbCategory(id) {
  if (isGmbCategoryId(id)) return GMB_CATEGORIES[id];
  return GMB_CATEGORIES.INTENT_PROXIMITY;
}

export function resolveGmbCta(categoryId, business = {}) {
  const cat = getGmbCategory(categoryId);
  if (categoryId === GMB_CATEGORY_IDS.INTENT_PROXIMITY) {
    return business.phone ? CTA.CALL_NOW : CTA.LEARN_MORE;
  }
  if (categoryId === GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT) {
    if (/event|register|registration|open house/i.test(String(business.offerSummary || ""))) {
      return CTA.SIGN_UP;
    }
    return CTA.SIGN_UP;
  }
  if (categoryId === GMB_CATEGORY_IDS.AUTHORITY_TRUST_PROOF) {
    return business.phone ? CTA.BOOK : CTA.LEARN_MORE;
  }
  return cat.defaultCta || CTA.LEARN_MORE;
}

export function gmbCtaInstruction(cta) {
  if (cta === CTA.CALL_NOW) return `Click "Call Now" to speak with our team.`;
  if (cta === CTA.BOOK) return `Click "Book" to schedule with our team.`;
  if (cta === CTA.SIGN_UP) return `Click "Sign Up" to take the next step.`;
  if (cta === CTA.GET_DIRECTIONS) return `Click "Get Directions" for our location.`;
  if (cta === CTA.CONTACT_US) return `Click "Contact Us" to reach our team.`;
  if (cta === CTA.VISIT_WEBSITE) return `Click "Visit Website" to read the details on this page.`;
  return `Click "Learn More" to read the details on this page.`;
}

const OFFER_SIGNAL =
  /\b(offer|promo|promotion|discount|% off|percent off|coupon|deal|event|open house|free consultation|free screening|register|registration|limited[- ]time|special package|new service launch)\b/i;

export function detectVerifiedOffer(pages = [], extraText = "") {
  const blobs = [
    extraText,
    ...pages.map((p) =>
      [p.title, p.url, p.masterIntent, p.writingIntent, p.keywords?.primary]
        .concat(p.keywords?.secondary || [])
        .concat(p.keywords?.secondaryKeywords || [])
        .filter(Boolean)
        .join(" ")
    ),
  ]
    .filter(Boolean)
    .join(" \n ");
  if (!blobs.trim()) return { found: false, summary: "" };
  const found = OFFER_SIGNAL.test(blobs);
  let summary = "";
  if (found) {
    const m = blobs.match(
      /([^.!\n]{0,80}(offer|promo|discount|event|consultation|screening|open house|register)[^.!\n]{0,80})/i
    );
    summary = m ? m[1].replace(/\s+/g, " ").trim() : "Verified promotional language found in selected pages.";
  }
  return { found, summary };
}

export function recommendGmbCategory(pages = [], location = "", verifiedOffer) {
  const offer = verifiedOffer || detectVerifiedOffer(pages);
  if (offer.found) {
    return {
      id: GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT,
      reason: "Selected pages include verified offer, promotion, or event language.",
    };
  }
  const blob = pages
    .map((p) => `${p.title || ""} ${p.url || ""} ${p.writingIntent || ""}`)
    .join(" ")
    .toLowerCase();
  if (/\b(faq|how to|what is|when should|do i need|guide|tips?)\b/.test(blob)) {
    return {
      id: GMB_CATEGORY_IDS.FAQ_EDUCATIONAL,
      reason: "Selected pages match educational / question-style search intent.",
    };
  }
  if (/\b(about|team|certified|credential|experience|award|technology)\b/.test(blob)) {
    return {
      id: GMB_CATEGORY_IDS.AUTHORITY_TRUST_PROOF,
      reason: "Selected pages emphasize expertise, credentials, or proof.",
    };
  }
  const loc = String(location || "").trim();
  return {
    id: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
    reason: loc
      ? `Your selected pages strongly match local service search intent in ${loc}.`
      : "Your selected pages strongly match local service search intent.",
  };
}

export function inferPageType(url = "", title = "") {
  const s = `${url} ${title}`.toLowerCase();
  try {
    const u = new URL(url);
    if (u.pathname === "/" || u.pathname === "") return "Home";
  } catch {
    /* ignore */
  }
  if (/\b(offer|promo|discount|deal|event|coupon)\b/.test(s)) return "Offers";
  if (/\b(blog|news|article|insight|post)\b/.test(s)) return "Blog";
  if (/\b(about|team|story|history|our-story)\b/.test(s)) return "About";
  if (/\b(service|services|treatment|product|repair|care|solution)\b/.test(s)) return "Services";
  return "Other";
}

export function isHomepageUrl(url = "") {
  try {
    const u = new URL(url);
    return u.pathname === "/" || u.pathname === "";
  } catch {
    return false;
  }
}

/**
 * Most relevant selected landing page — never default to homepage
 * when a matching service/topic page exists in the selected set.
 */
export function pickRelevantSourcePage(pages = [], categoryId, location = "") {
  const list = (pages || []).filter((p) => p && p.url);
  if (!list.length) return null;
  const locTokens = String(location || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  const cat = getGmbCategory(categoryId);

  const keywordText = (value) =>
    Array.isArray(value) ? value.filter(Boolean).join(" ") : value ? String(value) : "";

  const scored = list.map((p) => {
    let score = 0;
    const hay = `${p.title || ""} ${p.url || ""} ${p.keywords?.primary || ""} ${keywordText(
      p.keywords?.secondaryKeywords || p.keywords?.general || p.keywords?.secondary
    )}`.toLowerCase();
    if (isHomepageUrl(p.url)) score -= 8;
    if (inferPageType(p.url, p.title) === "Services") score += 6;
    if (p.keywords?.primary) score += 3;
    locTokens.forEach((t) => {
      if (hay.includes(t)) score += 2;
    });
    if (cat.id === GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT && OFFER_SIGNAL.test(hay)) score += 10;
    if (cat.id === GMB_CATEGORY_IDS.FAQ_EDUCATIONAL && /\b(faq|how|when|what|guide)\b/.test(hay)) {
      score += 6;
    }
    if (cat.id === GMB_CATEGORY_IDS.AUTHORITY_TRUST_PROOF && /\b(about|team|certif|experience)\b/.test(hay)) {
      score += 6;
    }
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].p;
}

export function countChars(text) {
  return String(text || "").length;
}

export function countWords(text) {
  const plain = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

export function extractHashtags(text) {
  const matches = String(text || "").match(/#[A-Za-z0-9_]+/g) || [];
  return [...new Set(matches)];
}

export function firstNChars(text, n = GMB_CHAR.frontLoad) {
  return String(text || "").slice(0, n);
}

export function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
const STREET_RE =
  /\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+)?\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|hwy|highway|pkwy|parkway)\.?\b/gi;
const FABRICATED_NAP_RE =
  /\b123\s+main\s+st\.?\b|\(123\)\s*456-7890|\b555-0(?:1\d{2}|00)\b/gi;
const HOURS_CLAIM_RE =
  /\bopen\s+24\s*\/\s*7\b|\b24\s*\/\s*7\b|\bhours?:\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)(?:\s*[-–]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm))?/gi;

export function extractPhoneNumbers(text) {
  return String(text || "").match(PHONE_RE) || [];
}

export function extractStreetAddresses(text) {
  return String(text || "").match(STREET_RE) || [];
}

const FABRICATED_SERVICE_RE = /\b(?:tip|related)\s+\d+\b/i;
const EDUCATIONAL_LABEL_RE =
  /\b(tips?|guide|how to|what is|faq|blog|step[- ]by[- ]step|tutorial)\b/i;
const SERVICE_SIGNAL_RE =
  /\b(repair|service|services|design|hosting|seo|ssl|wordpress|malware|recovery|setup|development|marketing|fix|security|optimization)\b/i;
const MISSING_FIELD_RE =
  /\b(?:phone|address|hours|email)(?:\s+(?:is|are|number|info|information))?\s*(?::\s*)?(?:not provided|unavailable|n\/a|unknown|none)\b/gi;
const PHONE_PLACEHOLDER_RE =
  /\bphone not provided\b|\bno phone\b|\bn\/a phone\b|\bphone unavailable\b|\bphone:\s*(?:n\/a|none|not provided|unavailable|-)\b/gi;
const UNVERIFIED_EXPERIENCE_RE =
  /\b(?:with\s+)?(?:over\s+|more than\s+)?\d+\+?\s+years?(?:\s+of)?(?:\s+experience)?\b|\byears of experience\b|\bover a decade\b|\bmore than a decade\b|\bdecades of experience\b|\bdecade of experience\b/gi;

export function isFabricatedServiceName(name) {
  const s = String(name || "").trim();
  if (!s) return true;
  if (FABRICATED_SERVICE_RE.test(s)) return true;
  if (/^local service$/i.test(s)) return true;
  return false;
}

export function looksLikeEducationalLabel(name) {
  return EDUCATIONAL_LABEL_RE.test(String(name || ""));
}

function keywordList(keywords = {}) {
  const raw =
    keywords.secondaryKeywords || keywords.general || keywords.secondary || [];
  return (Array.isArray(raw) ? raw : [raw]).map(String).map((s) => s.trim()).filter(Boolean);
}

/**
 * Actual business services only. Keywords and educational tips are not services.
 */
export function extractVerifiedServices({
  keywords = {},
  sourcePage = {},
  selectedPages = [],
  business = {},
} = {}) {
  const out = [];
  const seen = new Set();
  const push = (raw, { allowEducational = false } = {}) => {
    const s = String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!s || s.length < 3 || s.length > 80) return;
    if (isFabricatedServiceName(s)) return;
    if (!allowEducational && looksLikeEducationalLabel(s) && !SERVICE_SIGNAL_RE.test(s)) return;
    const key = s.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  push(keywords.primary);
  keywordList(keywords).forEach((s) => push(s));
  push(sourcePage?.keywords?.primary);
  keywordList(sourcePage?.keywords || {}).forEach((s) => push(s));
  if (sourcePage?.title && !looksLikeEducationalLabel(sourcePage.title)) {
    push(sourcePage.title);
  }
  for (const page of selectedPages) {
    push(page?.keywords?.primary);
    keywordList(page?.keywords || {}).forEach((s) => push(s));
  }
  const listed = business.services;
  if (Array.isArray(listed)) listed.forEach((s) => push(s, { allowEducational: false }));
  else if (listed) String(listed).split(/[,;]/).forEach((s) => push(s));

  return out.slice(0, 7);
}

/**
 * FAQ posts must open with a source-supported question in the first 150 characters.
 * Uses the heading or source title when they already contain a question; otherwise a
 * Need-help question built from the page primary keyword — never a generic unrelated Q.
 */
export function ensureFaqQuestionHook(content, { heading, sourceTitle, keywords } = {}) {
  const body = String(content || "").trim();
  if (body.slice(0, GMB_CHAR.frontLoad).includes("?")) return body;
  let question = "";
  if (String(heading || "").includes("?")) question = String(heading).trim();
  else if (String(sourceTitle || "").includes("?")) question = String(sourceTitle).trim();
  else {
    const topic = String(keywords?.primary || sourceTitle || "").trim();
    if (!topic) return body;
    question = `Need help with ${topic}?`;
  }
  if (!question.endsWith("?")) question = `${question}?`;
  return `${question} ${body}`.trim();
}

export function stripFabricatedServiceLines(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => {
      const bullet = line.match(/^\s*(?:[•\-\*]|\d+[.)])\s*(.+)$/);
      if (!bullet) return true;
      return !isFabricatedServiceName(bullet[1]);
    })
    .join("\n");
}

/**
 * Remove NAP claims that are not present in verified business data.
 * City/location strings are left intact. Never leave "not provided" placeholders.
 */
export function stripUnverifiedNap(text, business = {}) {
  let body = String(text || "");
  const verifiedPhone = digitsOnly(business.phone);
  body = body.replace(PHONE_RE, (m) => {
    if (verifiedPhone && digitsOnly(m) === verifiedPhone) return m;
    return "";
  });
  if (!String(business.address || "").trim()) {
    body = body.replace(STREET_RE, "");
  }
  if (!String(business.hours || "").trim()) {
    body = body.replace(HOURS_CLAIM_RE, "");
  }
  body = body.replace(FABRICATED_NAP_RE, "");
  body = body.replace(PHONE_PLACEHOLDER_RE, "");
  body = body.replace(MISSING_FIELD_RE, "");
  if (!String(business.differentiators || "").trim()) {
    body = body.replace(UNVERIFIED_EXPERIENCE_RE, "");
    body = body.replace(/\baward-?winning\b/gi, "");
  }
  body = stripFabricatedServiceLines(body);
  return body
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ ,]{2,}/g, " ")
    .replace(/\.\s*\./g, ".")
    .trim();
}

/**
 * GBP default (master-prompt v2): ZERO hashtags. Remove any trailing hashtag
 * block and stray inline hashtags the model may have added. Keeps the body
 * professional and avoids malformed keyword-concatenated tags
 * (e.g. "#HoustonHoustonDentalSEO"). Hashtags are never auto-generated for GBP.
 */
export function stripGmbHashtags(text) {
  let body = String(text || "");
  // Drop a trailing hashtag-only line/paragraph.
  body = body.replace(/(?:\n+\s*#[A-Za-z0-9_]+(?:\s+#[A-Za-z0-9_]+)*\s*)+$/g, "");
  // Drop any remaining standalone hashtag tokens anywhere in the body.
  body = body.replace(/(^|\s)#[A-Za-z0-9_]+/g, "$1");
  return body
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** @deprecated gmb-master-v1 forced-hashtag path. Retained for compatibility; not used by the v2 pipeline. */
export function ensureGmbHashtags(text, { location, primary, categoryId } = {}) {
  const raw = String(text || "").trim();
  const tail = raw.match(/(\n+(?:#[A-Za-z0-9_]+(?:\s+#[A-Za-z0-9_]+)+)\s*)$/);
  const body = tail ? raw.slice(0, -tail[1].length).trim() : raw.replace(/\s*#[A-Za-z0-9_]+/g, "").trim();
  let hashes = extractHashtags(raw).slice(0, GMB_CHAR.hashtagMax);
  if (hashes.length < GMB_CHAR.hashtagMin) {
    for (const tag of buildHashtagLine({ location, primary, categoryId }).split(/\s+/)) {
      if (!hashes.includes(tag)) hashes.push(tag);
      if (hashes.length >= GMB_CHAR.hashtagMin) break;
    }
  }
  hashes = hashes.slice(0, GMB_CHAR.hashtagMax);
  while (hashes.length < GMB_CHAR.hashtagMin) hashes.push("#LocalBusiness");
  return `${body}\n\n${hashes.join(" ")}`.trim();
}

function buildHashtagLine({ location, primary, categoryId }) {
  const cat = getGmbCategory(categoryId);
  const city = String(location || "")
    .split(",")[0]
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "");
  const service = String(primary || "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, "");
  const extras = {
    INTENT_PROXIMITY: ["NearMe", "LocalBusiness"],
    OFFER_PROMOTION_EVENT: ["LocalOffer", "ThisWeek"],
    AUTHORITY_TRUST_PROOF: ["TrustedLocal", "LocalExperts"],
    FAQ_EDUCATIONAL: ["LocalTips", "AskAPro"],
  };
  const tags = [`#${city || "Local"}`, `#${service || "Services"}`, `#${city}${service}`.replace(/##/, "#")];
  (extras[cat.id] || []).forEach((t) => tags.push(`#${t}`));
  const unique = [];
  for (const t of tags) {
    if (t.length < 3) continue;
    if (!unique.includes(t)) unique.push(t);
    if (unique.length >= 5) break;
  }
  while (unique.length < 4) unique.push("#LocalBusiness");
  return unique.slice(0, 5).join(" ");
}

export function formatNapBlock(business = {}) {
  const lines = [];
  if (business.name) lines.push(business.name);
  if (business.address) lines.push(business.address);
  if (business.phone) lines.push(business.phone);
  if (business.hours) lines.push(business.hours);
  return lines.join("\n");
}

function buildUserContext({
  categoryId,
  business = {},
  location,
  keywords = {},
  sourcePage,
  selectedPages = [],
  verifiedOffer,
}) {
  const cat = getGmbCategory(categoryId);
  const cta = resolveGmbCta(categoryId, { ...business, offerSummary: verifiedOffer?.summary });
  const primary = keywords.primary || sourcePage?.keywords?.primary || "";
  const secondary = (
    keywords.secondaryKeywords ||
    keywords.general ||
    keywords.secondary ||
    sourcePage?.keywords?.secondary ||
    []
  );
  const secondaryList = Array.isArray(secondary) ? secondary : [secondary].filter(Boolean);
  const verifiedServices = extractVerifiedServices({
    keywords,
    sourcePage,
    selectedPages,
    business,
  });

  const pageLines = selectedPages
    .map((p) => {
      const kw = p.keywords?.primary ? ` | keyword: ${p.keywords.primary}` : "";
      return `- ${p.title || "Untitled"} | ${p.url}${kw}`;
    })
    .join("\n");

  const omit = "OMIT — do not mention this field at all. Never write 'not provided'.";
  const facts = [
    `Business name: ${business.name || omit}`,
    `Location / city: ${location || business.city || omit}`,
    `Exact address: ${business.address || omit}`,
    `Phone: ${business.phone || omit}`,
    `Hours: ${business.hours || omit}`,
    `Verified differentiators: ${business.differentiators || omit}`,
    `Verified offer/event: ${
      verifiedOffer?.found ? verifiedOffer.summary : "(none — do not invent an offer)"
    }`,
    `Verified actual services (Core Services may use ONLY these; never invent Tip 2/3/4): ${
      verifiedServices.length ? verifiedServices.join("; ") : "(none — do not invent service names)"
    }`,
  ].join("\n");

  return `CATEGORY: ${cat.label} (${cat.id})
HOOK TYPE: ${cat.hookName}
TONE: ${cat.tone.join(", ")}
RECOMMENDED CTA BUTTON: ${cta}
SOURCE PAGE TITLE: ${sourcePage?.title || "(unknown)"}
SOURCE URL (retain exactly; most relevant selected landing page): ${sourcePage?.url || ""}
PRIMARY KEYWORD: ${primary}
SECONDARY KEYWORDS: ${secondaryList.filter(Boolean).join(", ") || "(none)"}

VERIFIED BUSINESS FACTS (use only these; never invent missing fields):
${facts}

SELECTED CONTENT SOURCES (only these pages may influence the post):
${pageLines || "- (none)"}

RECOMMENDED NATIVE BUTTON (handled by the publishing layer, NOT written in the body): ${cta}

Return ONLY JSON:
{"heading":"string","content":"string"}
content is the post body only. Write concise, complete, professional copy — long enough to be useful, no longer than it needs to be. Do NOT pad to a character target.
Do NOT write any call-to-action instruction such as 'Click "Learn More"', 'Visit this page', or 'Click the link' — the CTA is a separate native button.
Do NOT add hashtags (Google Business Profile posts do not use hashtags).
Include NAP only when the exact values are provided above; otherwise omit it entirely.
Do not include markdown, HTML, or emojis.
Hard limit: content must be at most ${GMB_CHAR.max} characters including spaces. There is no minimum padding requirement.`;
}

export function buildGmbSystemPrompt(categoryId) {
  const cat = getGmbCategory(categoryId);
  return `${cat.systemPrompt}

OUTPUT RULES (master-prompt v2)
- English only.
- No markdown headings.
- No inline hyperlinks in the body (the source URL is stored separately and attached as a native button).
- Do NOT add hashtags. Google Business Profile posts default to zero hashtags.
- Do NOT write a call-to-action instruction in the body (no 'Click "Learn More"', 'Visit this page', 'Click the link'). The CTA is a separate native button.
- The heading/hook is mandatory and category-specific (${cat.hookName}).
- Prefer concise, complete copy. Do NOT pad to a length target. Hard limit: at most ${GMB_CHAR.max} characters including spaces. There is no minimum padding requirement.
- Do not repeat a sentence or restate the same conclusion twice.
- Do not insert generic self-promotion ("our agency", "we are proud to", "your trusted partner") unless the verified brand voice supports it.
- NAP HARD RULE: if Exact address, Phone, or Hours are marked OMIT, do not write any street address, phone number, opening-hours claim, or phrases such as "Phone not provided". City from verified location may be used. Never use placeholders such as 123 Main St or (123) 456-7890.
- Never invent NAP, ratings, credentials, offers, services, or statistics.
- Keywords are wording hints only. They are not extra services. Never write "Tip 2", "Tip 3", or "related 4" as services.`
}

export function buildGmbUserPrompt(ctx) {
  return buildUserContext(ctx);
}

export function buildGmbRefinePrompt({
  categoryId,
  content,
  issues,
  verifiedServices = [],
  sourceTitle = "",
}) {
  const cat = getGmbCategory(categoryId);
  const issueList = issues || [];
  const targeted = [];
  for (const issue of issueList) {
    if (/Core Services/i.test(issue) || /fabricated service/i.test(issue)) {
      targeted.push(
        `Rewrite only the Core Services portion using ONLY these verified actual services: ${
          verifiedServices.length
            ? verifiedServices.join("; ")
            : "(none — omit extra service names; describe the primary offering without inventing Tip 2/3/4)"
        }. Do not label educational tips as services.`
      );
    } else if (/question/i.test(issue) || /Question Hook/i.test(issue) || /First 150/.test(issue) && cat.id === GMB_CATEGORY_IDS.FAQ_EDUCATIONAL) {
      targeted.push(
        `Rewrite the OPENING so a source-supported question ending with "?" appears within the first 150 characters. Base the question on "${sourceTitle || "the selected page topic"}". Keep the rest of the post. Do not use a generic unrelated question.`
      );
    } else if (/hashtag/i.test(issue)) {
      targeted.push("Remove ALL hashtags — Google Business Profile posts do not use hashtags.");
    } else if (/button-instruction|CTA instruction|read the details|Click/i.test(issue)) {
      targeted.push('Remove any CTA instruction text (e.g. \'Click "Learn More" to read the details on this page\'). The CTA is a separate native button.');
    } else if (/repeated sentence|duplicate/i.test(issue)) {
      targeted.push("Remove duplicate sentences and any repeated conclusion. Say each point once.");
    } else if (/above the|over the|hard limit/i.test(issue)) {
      targeted.push("Compress to under the character limit without removing required factual elements. Do not pad.");
    } else if (/unverified|fabricated placeholder|not in verified/i.test(issue)) {
      targeted.push("Remove the unverified claim entirely. Do not replace it with another invented credential, phone, address, or statistic.");
    } else if (/Phone not provided|not provided/i.test(issue)) {
      targeted.push("Delete any 'not provided' / missing-field language. If a NAP field is unknown, omit it.");
    } else if (/Missing a direct CTA/i.test(issue)) {
      targeted.push("Add the recommended CTA instruction. Do not invent a phone number inside the CTA.");
    } else if (/First 150/i.test(issue)) {
      targeted.push(`Fix the first 150 characters only: ${cat.frontLoad.description}`);
    }
  }
  if (!targeted.length) {
    targeted.push("Meet the character target using verified source facts only.");
  }

  return `Revise the following Google Business Profile post with TARGETED fixes. Do not regenerate unrelated sections.

Current issues:
${issueList.map((i) => `- ${i}`).join("\n") || "- meet character target"}

TARGETED REFINEMENT
${targeted.map((t, i) => `${i + 1}. ${t}`).join("\n")}

HARD RULES
- Concise and complete; at most ${GMB_CHAR.max} characters including spaces. Do NOT pad to a length target.
- Do not invent facts, services, NAP, credentials, or offers.
- Do NOT add hashtags. Do NOT write a CTA instruction in the body (the CTA is a native button).
- Do not repeat a sentence or restate the same conclusion.
- Keep the same category, tone, hook type (${cat.hookName}), and source relationship.
- Front-load requirement: ${cat.frontLoad.description}
- Never write "Phone not provided", "N/A", or similar placeholders.

Current post:
${content}

Return ONLY JSON: {"heading":"string","content":"string"}`;
}

export function uiCatalog() {
  return {
    version: GMB_RULESET_VERSION,
    char: GMB_CHAR,
    categories: GMB_CATEGORY_LIST,
    ctaVocabulary: Object.values(CTA),
  };
}

export {
  CTA as GMB_CTA,
  buildHashtagLine,
  PHONE_RE,
  STREET_RE,
  FABRICATED_NAP_RE,
  UNVERIFIED_EXPERIENCE_RE,
};
