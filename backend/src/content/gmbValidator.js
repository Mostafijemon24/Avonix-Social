/**
 * Programmatic GMB validation — never trust AI self-reported counts.
 * Consumes the same GMB_CATEGORIES / GMB_CHAR definitions as generation.
 */
import {
  GMB_CHAR,
  GMB_CATEGORY_IDS,
  countChars,
  countWords,
  extractHashtags,
  extractPhoneNumbers,
  extractStreetAddresses,
  firstNChars,
  getGmbCategory,
  isFabricatedServiceName,
  isGmbCategoryId,
  digitsOnly,
} from "./gmbContentRules.js";

export const VALIDATION_STATUS = Object.freeze({
  READY: "READY",
  NEEDS_REVISION: "NEEDS_REVISION",
});

function hasLocalIntent(text) {
  return /\b(near me|nearby|near you|in [A-Z][a-z]+|local|around (here|town)|close by)\b/i.test(
    text
  );
}

function looksLikeQuestion(text) {
  return /(\?|when should|do i need|how (do|can|long|much)|what happens|how to know|should i|why do)/i.test(
    text
  );
}

function hasQuestionMark(text) {
  return String(text || "").includes("?");
}

function questionRelevantToSource(front, keywords = {}, sourceTitle = "") {
  if (!hasQuestionMark(front)) return false;
  const hay = String(front || "").toLowerCase();
  const tokens = `${keywords.primary || ""} ${sourceTitle || ""}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  if (!tokens.length) return true;
  return tokens.some((t) => hay.includes(t));
}

function extractBulletItems(text) {
  return String(text || "")
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s*(?:[•\-\*]|\d+[.)])\s*(.+)$/);
      return m ? m[1].trim() : "";
    })
    .filter(Boolean);
}

function looksLikeOffer(text) {
  return /\b(offer|discount|%|percent|promo|promotion|event|free |save |special |limited[- ]time|register|open house|package)\b/i.test(
    text
  );
}

function looksLikeAuthority(text) {
  return /\b(trust|trusted|experience|experienced|certified|credential|expert|expertise|professional|proven|technology|team|quality|specialist)\b/i.test(
    text
  );
}

function hasServiceAndCity(head, keywords = {}, location = "") {
  const hay = head.toLowerCase();
  const primary = String(keywords.primary || "").toLowerCase();
  const city = String(location || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const serviceHit =
    !primary ||
    primary.split(/\s+/).filter((w) => w.length >= 4).some((w) => hay.includes(w)) ||
    /\b(service|care|repair|clinic|er|dentist|plumb|hvac|legal|salon)\b/i.test(head);
  const cityHit = !city || city.length < 3 || hay.includes(city);
  return { serviceHit, cityHit };
}

function structureHits(categoryId, content) {
  const text = String(content || "");
  const lower = text.toLowerCase();
  const bullets = (text.match(/(^|\n)\s*(?:[•\-\*]|\d+[.)])/gm) || []).length;
  const hashtagCount = extractHashtags(text).length;
  const hasNapish =
    /\b(\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|open |hours|am\b|pm\b|monday|24\/7)\b/i.test(text) ||
    /\b(call now|book|sign up|learn more|visit|contact)\b/i.test(text);
  const hasCta = /\b(call now|click ['"]?call|book|sign up|learn more|visit us|contact us|get directions)\b/i.test(
    text
  );

  const common = {
    napCta: hasNapish || hasCta,
    hashtags: hashtagCount >= GMB_CHAR.hashtagMin && hashtagCount <= GMB_CHAR.hashtagMax + 1,
    cta: hasCta,
  };

  if (categoryId === GMB_CATEGORY_IDS.INTENT_PROXIMITY) {
    const items = extractBulletItems(text);
    const realBullets = items.filter((b) => !isFabricatedServiceName(b));
    const mentionsServices =
      /core services/i.test(text) ||
      /\bwe (offer|provide|specialize|fix|repair|help with)\b/i.test(text);
    return {
      hook: hasLocalIntent(firstNChars(text)) || hasLocalIntent(text.slice(0, 220)),
      proximity: /\b(located|in |near |open |hours|walk-in|same-day|neighborhood|street|around )\b/i.test(text),
      services: realBullets.length >= 1 || (mentionsServices && items.length === 0),
      why: /\b(why |choose |team |because |trusted|professional|straightforward|local team)\b/i.test(text),
      ...common,
    };
  }
  if (categoryId === GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT) {
    return {
      hook: looksLikeOffer(firstNChars(text)),
      value: /\b(get |receive |save |include|qualif|available|through |until |offer)\b/i.test(text),
      redeem: /\b(call|visit|mention|register|book|claim|sign up|redeem)\b/i.test(text),
      local: /\b(in |located|near |city|community|neighborhood)\b/i.test(lower),
      ...common,
    };
  }
  if (categoryId === GMB_CATEGORY_IDS.AUTHORITY_TRUST_PROOF) {
    return {
      hook: looksLikeAuthority(firstNChars(text)),
      proof: /\b(experience|certified|team|technology|trained|credential|process|on-site)\b/i.test(text),
      benefit: /\b(faster|convenient|accurate|quality|easier|access|delay|personal)\b/i.test(text),
      local: /\b(in |local|community|near |city|neighbors)\b/i.test(lower),
      ...common,
    };
  }
  return {
    hook: hasQuestionMark(firstNChars(text)) && looksLikeQuestion(firstNChars(text)),
    answer: text.trim().length > 80,
    tips: bullets >= 2,
    local: /\b(in |local|our team|community|near |city)\b/i.test(lower),
    ...common,
  };
}

function unsupportedSuperatives(text) {
  return /\b(#1|number one|world'?s best|top-rated|guaranteed results|5-star|five star)\b/i.test(
    text
  );
}

export function findUnverifiedNapIssues(content, business = {}) {
  const issues = [];
  const body = String(content || "");
  const verifiedPhone = digitsOnly(business.phone);
  const phones = extractPhoneNumbers(body);
  for (const phone of phones) {
    if (!verifiedPhone || digitsOnly(phone) !== verifiedPhone) {
      issues.push("Contains a phone number that is not in verified business data.");
      break;
    }
  }
  const streets = extractStreetAddresses(body);
  const verifiedAddress = String(business.address || "").trim().toLowerCase();
  if (streets.length && !verifiedAddress) {
    issues.push("Contains a street address that is not in verified business data.");
  } else if (streets.length && verifiedAddress) {
    const unmatched = streets.some((s) => {
      const streetDigits = digitsOnly(s).slice(0, 6);
      return streetDigits && !verifiedAddress.includes(streetDigits);
    });
    if (unmatched) {
      issues.push("Contains a street address that is not in verified business data.");
    }
  }
  if (
    !String(business.hours || "").trim() &&
    /\b(open\s+24\s*\/\s*7|24\s*\/\s*7|hours?:\s*\d{1,2})/i.test(body)
  ) {
    issues.push("Contains hours that are not in verified business data.");
  }
  if (/\b123\s+main\s+st\b|\(123\)\s*456-7890/i.test(body)) {
    issues.push("Contains fabricated placeholder NAP (123 Main St / sample phone).");
  }
  if (
    !String(business.differentiators || "").trim() &&
    /\b(\d+\+?\s+years?(\s+of)?(\s+experience)?|years of experience|over a decade|more than a decade|decades of experience|decade of experience|award-?winning|certified|board-certified|accredited)\b/i.test(
      body
    )
  ) {
    issues.push("Contains unverified experience, certification, or award language.");
  }
  if (
    /\bphone not provided\b|\bno phone\b|\bn\/a phone\b|\bphone unavailable\b|\b(?:phone|address|hours)(?:\s+(?:is|are))?\s+not provided\b/i.test(
      body
    )
  ) {
    issues.push("Contains a missing-field placeholder such as 'Phone not provided'.");
  }
  return issues;
}

/**
 * @returns {{
 *   status: 'READY'|'NEEDS_REVISION',
 *   ready: boolean,
 *   issues: string[],
 *   charCount: number,
 *   wordCount: number,
 *   hashtags: string[],
 *   frontLoad: string,
 *   structure: Record<string, boolean>,
 *   categoryId: string,
 * }}
 */
export function validateGmbPost({
  content,
  heading,
  categoryId,
  location,
  keywords = {},
  business = {},
  sourceTitle = "",
}) {
  const issues = [];
  const cat = isGmbCategoryId(categoryId)
    ? getGmbCategory(categoryId)
    : getGmbCategory(GMB_CATEGORY_IDS.INTENT_PROXIMITY);
  const body = String(content || "").trim();
  const charCount = countChars(body);
  const wordCount = countWords(body);
  const hashtags = extractHashtags(body);
  const front = firstNChars(body, GMB_CHAR.frontLoad);
  const combinedHead = `${heading || ""}\n${body}`;

  if (charCount < GMB_CHAR.min) {
    issues.push(
      `Character count is ${charCount} (below the ${GMB_CHAR.min}–${GMB_CHAR.max} required range; target ${GMB_CHAR.targetMin}–${GMB_CHAR.targetMax}).`
    );
  } else if (charCount > GMB_CHAR.max) {
    issues.push(
      `Character count is ${charCount} (above the ${GMB_CHAR.max} hard limit). Rewrite to fit — do not truncate.`
    );
  } else if (charCount < GMB_CHAR.targetMin || charCount > GMB_CHAR.targetMax) {
    issues.push(
      `Character count is ${charCount} (inside the hard limit, but outside the ${GMB_CHAR.targetMin}–${GMB_CHAR.targetMax} target). Refine toward the target.`
    );
  }

  if (cat.id === GMB_CATEGORY_IDS.INTENT_PROXIMITY) {
    const { serviceHit, cityHit } = hasServiceAndCity(front, keywords, location);
    if (!serviceHit) issues.push("First 150 characters are missing the primary service.");
    if (!cityHit) issues.push("First 150 characters are missing the city / location.");
    if (!hasLocalIntent(front) && !hasLocalIntent(combinedHead.slice(0, 180))) {
      issues.push('First 150 characters are missing relevant local / "near me" intent.');
    }
  } else if (cat.id === GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT) {
    if (!looksLikeOffer(front)) {
      issues.push("First 150 characters are missing the offer, event, discount, or major benefit.");
    }
  } else if (cat.id === GMB_CATEGORY_IDS.AUTHORITY_TRUST_PROOF) {
    if (!looksLikeAuthority(front)) {
      issues.push("First 150 characters are missing the primary trust / authority message.");
    }
  } else if (cat.id === GMB_CATEGORY_IDS.FAQ_EDUCATIONAL) {
    if (!hasQuestionMark(front)) {
      issues.push("First 150 characters are missing the customer question / topic.");
    } else if (!questionRelevantToSource(front, keywords, sourceTitle)) {
      issues.push("First 150 characters contain a question that is not relevant to the selected source.");
    }
  }

  const fabricatedServices = extractBulletItems(body).filter((b) => isFabricatedServiceName(b));
  if (fabricatedServices.length) {
    issues.push("Contains fabricated service names (educational tips labeled as Core Services).");
  }

  const hits = structureHits(cat.id, body);
  for (const section of cat.structure) {
    const ok =
      section.key === "hashtags"
        ? hits.hashtags
        : section.key === "napCta"
          ? hits.napCta
          : hits[section.key];
    if (!ok) {
      issues.push(`Required section missing or too weak: ${section.label}.`);
    }
  }

  if (hashtags.length < GMB_CHAR.hashtagMin) {
    issues.push(`Need ${GMB_CHAR.hashtagMin}–${GMB_CHAR.hashtagMax} hashtags (found ${hashtags.length}).`);
  } else if (hashtags.length > GMB_CHAR.hashtagMax) {
    issues.push(`Too many hashtags (${hashtags.length}); keep ${GMB_CHAR.hashtagMin}–${GMB_CHAR.hashtagMax}.`);
  }

  if (!hits.cta) {
    issues.push("Missing a direct CTA instruction (Call Now / Book / Sign Up / Learn More).");
  }

  if (unsupportedSuperatives(body) && !/\bverified\b/i.test(String(business.differentiators || ""))) {
    issues.push("Contains unsupported superlative or ranking language (#1 / best / top-rated).");
  }

  issues.push(...findUnverifiedNapIssues(body, business));

  const hardFail = issues.some(
    (i) =>
      i.includes("below the") ||
      i.includes("above the") ||
      i.includes("First 150") ||
      i.includes("Required section") ||
      i.includes("Need 4") ||
      i.includes("Missing a direct CTA") ||
      i.includes("NO_VERIFIED") ||
      i.includes("not in verified business data") ||
      i.includes("fabricated placeholder") ||
      i.includes("unverified experience") ||
      i.includes("missing-field placeholder") ||
      i.includes("fabricated service") ||
      i.includes("not relevant to the selected source")
  );

  const targetOnly = issues.length > 0 && issues.every((i) => i.includes("outside the"));

  const status =
    issues.length === 0 || (targetOnly && charCount >= GMB_CHAR.min && charCount <= GMB_CHAR.max)
      ? VALIDATION_STATUS.READY
      : VALIDATION_STATUS.NEEDS_REVISION;

  return {
    status: hardFail ? VALIDATION_STATUS.NEEDS_REVISION : status,
    ready: (hardFail ? VALIDATION_STATUS.NEEDS_REVISION : status) === VALIDATION_STATUS.READY,
    issues,
    charCount,
    wordCount,
    hashtags,
    frontLoad: front,
    structure: hits,
    categoryId: cat.id,
    categoryLabel: cat.label,
  };
}

export function validateSocialPost({ content, platform, minWords, maxWords }) {
  const issues = [];
  const wordCount = countWords(content);
  const charCount = countChars(content);
  if (typeof minWords === "number" && wordCount < minWords) {
    issues.push(`Word count is ${wordCount} (below the ${minWords}+ target for ${platform}).`);
  }
  if (typeof maxWords === "number" && wordCount > maxWords + 40) {
    issues.push(`Word count is ${wordCount} (well above the ${platform} range).`);
  }
  return {
    status: issues.length ? VALIDATION_STATUS.NEEDS_REVISION : VALIDATION_STATUS.READY,
    ready: issues.length === 0,
    issues,
    wordCount,
    charCount,
    platform,
  };
}
