/**
 * P2 — Versioned platform-policy registry.
 *
 * A single, versioned source of truth for each platform's PUBLISHED limits
 * (caption length, hashtag rules, character-counting method), each entry
 * carrying its documentation source + the date the value was last transcribed
 * from that source.
 *
 * HONESTY CONTRACT (per the continuation directive):
 *   • These values are transcribed MANUALLY from each platform's public
 *     developer/help documentation. They are NOT fetched live at runtime.
 *     `verificationMethod: "manual-reference"` and `documentedAt` make that
 *     explicit so nothing here can be mistaken for a live policy check.
 *   • When a platform does NOT officially document a limit, the value is `null`
 *     and `supported`/`documented` flags say so — callers must treat that as
 *     "unverified", never as a pass or a fabricated number.
 *   • Google Business Profile has NO official hashtag limit (hashtags are not an
 *     official GBP Posts feature), so we explicitly DO NOT assume the old
 *     "5 hashtags" rule. See google_business.hashtags below.
 *
 * Freshness: `policyFreshness()` / `isPolicyStale()` report how old a transcribed
 * value is so stale policy can be surfaced instead of silently trusted.
 */

export const POLICY_REGISTRY_VERSION = "platform-policy-2025-06";

/** Days after which a transcribed policy value is considered stale. */
const STALENESS_DAYS = Number(process.env.PLATFORM_POLICY_STALENESS_DAYS || 180);

/**
 * Per-platform policy. Keyed by Avonix display name. `providerKey` links to the
 * publishing/provider layer. `documentedAt` = ISO date the value was last
 * transcribed from `source.url`.
 */
export const PLATFORM_POLICIES = Object.freeze({
  Facebook: {
    providerKey: "facebook",
    policyVersion: "fb-2025-06",
    documentedAt: "2025-06-01",
    verificationMethod: "manual-reference",
    source: {
      name: "Meta — Facebook posts / Graph API",
      url: "https://developers.facebook.com/docs/graph-api/reference/page/feed/",
    },
    text: {
      // Facebook post body hard limit (widely documented).
      maxChars: 63206,
      recommendedChars: 500,
      countMethod: "codepoints",
    },
    hashtags: {
      supported: true,
      clickable: true,
      // Facebook does not document a hashtag count limit.
      max: null,
      min: 0,
      recommended: 3,
      placements: ["body"],
      publishingMethods: ["api", "native"],
      note: "No official hashtag-count limit; hashtags are clickable. Few, relevant tags recommended.",
    },
  },

  Instagram: {
    providerKey: "instagram",
    policyVersion: "ig-2025-06",
    documentedAt: "2025-06-01",
    verificationMethod: "manual-reference",
    source: {
      name: "Instagram Help / Graph API (IG media)",
      url: "https://developers.facebook.com/docs/instagram-api/reference/ig-user/media",
    },
    text: {
      maxChars: 2200, // caption hard limit (official)
      recommendedChars: 150,
      countMethod: "codepoints",
    },
    hashtags: {
      supported: true,
      clickable: true,
      max: 30, // official hard limit per post (and per comment)
      min: 0,
      recommended: 5,
      placements: ["caption", "first_comment"],
      publishingMethods: ["api", "native"],
      note: "Hard limit of 30 hashtags per post (caption or first comment). Captions themselves are not clickable links.",
    },
  },

  LinkedIn: {
    providerKey: "linkedin",
    policyVersion: "li-2025-06",
    documentedAt: "2025-06-01",
    verificationMethod: "manual-reference",
    source: {
      name: "LinkedIn Marketing / UGC Posts API",
      url: "https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api",
    },
    text: {
      maxChars: 3000, // post commentary limit (widely documented)
      recommendedChars: 700,
      countMethod: "codepoints",
    },
    hashtags: {
      supported: true,
      clickable: true,
      max: null, // no documented hard count limit
      min: 0,
      recommended: 3,
      placements: ["body"],
      publishingMethods: ["api", "native"],
      note: "No official hashtag-count limit; 3–5 relevant tags is the common recommendation.",
    },
  },

  X: {
    providerKey: "x",
    policyVersion: "x-2025-06",
    documentedAt: "2025-06-01",
    verificationMethod: "manual-reference",
    source: {
      name: "X (Twitter) API v2 — counting characters",
      url: "https://developer.twitter.com/en/docs/counting-characters",
    },
    text: {
      maxChars: 280, // standard (non-premium) accounts
      recommendedChars: 240,
      // X uses weighted counting: URLs are always 23 (t.co), many CJK chars = 2.
      countMethod: "x-weighted",
      urlWeight: 23,
    },
    hashtags: {
      supported: true,
      clickable: true,
      max: null, // no explicit hashtag-count limit; bounded by the 280-char cap
      min: 0,
      recommended: 2,
      placements: ["body"],
      publishingMethods: ["api", "native"],
      note: "No explicit hashtag count limit; everything counts toward the 280-character cap. 1–2 tags recommended.",
    },
  },

  Pinterest: {
    providerKey: "pinterest",
    policyVersion: "pin-2025-06",
    documentedAt: "2025-06-01",
    verificationMethod: "manual-reference",
    source: {
      name: "Pinterest Developers — create Pin",
      url: "https://developers.pinterest.com/docs/api/v5/pins-create/",
    },
    text: {
      maxChars: 500, // pin description limit (official)
      titleMaxChars: 100, // pin title limit (official)
      recommendedChars: 200,
      countMethod: "codepoints",
    },
    hashtags: {
      supported: true,
      clickable: true,
      max: 20, // historically documented description hashtag cap
      min: 0,
      recommended: 5,
      placements: ["description"],
      publishingMethods: ["api", "native"],
      note: "Up to ~20 hashtags in the description; Pinterest has de-emphasized hashtags, so relevance beats volume.",
    },
  },

  GMB: {
    providerKey: "google_business",
    policyVersion: "gbp-2025-06",
    documentedAt: "2025-06-01",
    verificationMethod: "manual-reference",
    source: {
      name: "Google Business Profile — localPosts API",
      url: "https://developers.google.com/my-business/content/posts-data",
    },
    text: {
      maxChars: 1500, // localPost.summary hard limit (official API)
      recommendedChars: 1050,
      countMethod: "codepoints",
    },
    hashtags: {
      // IMPORTANT: Hashtags are NOT an official Google Business Profile Posts
      // feature. They render as plain text, are not clickable, and Google
      // documents no hashtag count. We therefore DO NOT assume a "5 hashtag"
      // rule. Any hashtag use is an Avonix content convention, not a GBP policy.
      supported: false,
      clickable: false,
      max: null,
      min: 0,
      recommended: null,
      placements: ["body_plain_text"],
      publishingMethods: ["api"],
      note: "Google Business Profile does not officially support post hashtags; they appear as plain, non-clickable text with no documented count. The Avonix GMB ruleset's hashtag convention is an internal SEO preference, not a Google policy.",
    },
    cta: {
      // Mirrors ctaEngine.GBP_ACTION_TYPES — the only valid localPost actions.
      supported: true,
      actionTypes: ["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"],
      note: "localPost.callToAction accepts only these actionType values; GET_DIRECTIONS/CONTACT_US/VISIT_WEBSITE are not valid localPost actions.",
    },
  },
});

const KEY_BY_PROVIDER = Object.freeze(
  Object.entries(PLATFORM_POLICIES).reduce((acc, [name, p]) => {
    acc[p.providerKey] = name;
    return acc;
  }, {})
);

/** Resolve a registry entry from a display name or provider key. */
export function getPolicy(platform) {
  if (!platform) return null;
  if (PLATFORM_POLICIES[platform]) return PLATFORM_POLICIES[platform];
  const name = KEY_BY_PROVIDER[platform];
  return name ? PLATFORM_POLICIES[name] : null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Character counting
 * ────────────────────────────────────────────────────────────────────────── */

const URL_RE = /\bhttps?:\/\/[^\s]+/gi;

/** Count Unicode code points (handles emoji/surrogate pairs correctly). */
export function countCodepoints(text) {
  return [...String(text || "")].length;
}

/**
 * X/Twitter weighted character count: each URL counts as a fixed `urlWeight`
 * (t.co length) regardless of its real length; everything else counts as code
 * points. (CJK double-weighting is intentionally omitted here — we only ever
 * generate Latin copy, and over-counting CJK would mis-measure, not help.)
 */
export function countXWeighted(text, urlWeight = 23) {
  const str = String(text || "");
  const urls = str.match(URL_RE) || [];
  let count = countCodepoints(str.replace(URL_RE, ""));
  count += urls.length * urlWeight;
  return count;
}

/**
 * Accurate, policy-aware character count for a platform.
 * @returns {{count:number, limit:number|null, method:string, overLimit:boolean, remaining:number|null}}
 */
export function countText(platform, text) {
  const policy = getPolicy(platform);
  const method = policy?.text?.countMethod || "codepoints";
  const limit = policy?.text?.maxChars ?? null;
  let count;
  if (method === "x-weighted") {
    count = countXWeighted(text, policy?.text?.urlWeight || 23);
  } else {
    count = countCodepoints(text);
  }
  return {
    count,
    limit,
    method,
    overLimit: limit != null && count > limit,
    remaining: limit != null ? limit - count : null,
  };
}

/**
 * Enforce a platform's character limit by trimming at a word boundary. Returns
 * the possibly-trimmed text and whether a trim happened. Never pads.
 */
export function enforceLength(platform, text) {
  const { count, limit } = countText(platform, text);
  const str = String(text || "");
  if (limit == null || count <= limit) return { text: str, truncated: false, count, limit };

  // Code-point-safe slice toward the limit, then back off to a word boundary.
  const chars = [...str];
  let out = chars.slice(0, limit).join("");
  const cut = out.lastIndexOf(" ");
  if (cut > limit * 0.6) out = out.slice(0, cut);
  out = out.trim();
  return { text: out, truncated: true, count: countText(platform, out).count, limit };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Hashtag validation (policy-, placement-, and method-aware)
 * ────────────────────────────────────────────────────────────────────────── */

export function extractHashtags(text) {
  return String(text || "").match(/#[\p{L}\p{N}_]+/gu) || [];
}

/**
 * Validate hashtags against the documented platform policy for a given
 * placement + publishing method. Never assumes an undocumented limit.
 *
 * @param {object} opts
 * @param {string} opts.platform
 * @param {string[]} [opts.hashtags]  explicit list (else derived from text)
 * @param {string} [opts.text]        post text to extract hashtags from
 * @param {string} [opts.placement]   e.g. "caption" | "first_comment" | "body"
 * @param {string} [opts.publishingMethod] e.g. "api" | "native"
 * @returns {{ok, supported, count, max, min, recommended, overLimit, placementValid, methodValid, issues, advisories, source, documented}}
 */
export function validateHashtags({
  platform,
  hashtags,
  text,
  placement,
  publishingMethod,
} = {}) {
  const policy = getPolicy(platform);
  const tags = hashtags || extractHashtags(text);
  const count = tags.length;

  if (!policy) {
    return {
      ok: false,
      supported: false,
      count,
      issues: [`No policy registered for platform "${platform}".`],
      advisories: [],
      documented: false,
    };
  }

  const h = policy.hashtags || {};
  const issues = [];
  const advisories = [];

  // Platform doesn't officially support hashtags (e.g. GBP): using them is not
  // a policy violation, but we honestly report there is NO documented rule.
  if (!h.supported) {
    if (count > 0) {
      advisories.push(
        `${platform} has no official hashtag support/limit; the ${count} hashtag(s) will render as plain text. ${h.note || ""}`.trim()
      );
    }
    return {
      ok: true,
      supported: false,
      count,
      max: null,
      min: 0,
      recommended: null,
      overLimit: false,
      placementValid: true,
      methodValid: true,
      issues,
      advisories,
      source: policy.source,
      documented: false,
    };
  }

  const max = h.max; // may be null (undocumented count limit)
  const overLimit = max != null && count > max;
  if (overLimit) {
    issues.push(`${count} hashtags exceed the documented ${platform} limit of ${max}.`);
  }
  if (max == null && count > 0) {
    advisories.push(
      `${platform} documents no hard hashtag-count limit${
        h.recommended ? ` (recommended ~${h.recommended})` : ""
      }.`
    );
  }
  if (h.recommended != null && count > h.recommended && !overLimit) {
    advisories.push(`${count} hashtags is above the recommended ~${h.recommended} for ${platform}.`);
  }

  let placementValid = true;
  if (placement && Array.isArray(h.placements) && h.placements.length) {
    placementValid = h.placements.includes(placement);
    if (!placementValid) {
      issues.push(
        `Placement "${placement}" is not valid for ${platform} hashtags (allowed: ${h.placements.join(", ")}).`
      );
    }
  }

  let methodValid = true;
  if (publishingMethod && Array.isArray(h.publishingMethods) && h.publishingMethods.length) {
    methodValid = h.publishingMethods.includes(publishingMethod);
    if (!methodValid) {
      issues.push(
        `Publishing method "${publishingMethod}" is not supported for ${platform} hashtags (allowed: ${h.publishingMethods.join(", ")}).`
      );
    }
  }

  return {
    ok: issues.length === 0,
    supported: true,
    count,
    max: max ?? null,
    min: h.min ?? 0,
    recommended: h.recommended ?? null,
    overLimit,
    placementValid,
    methodValid,
    issues,
    advisories,
    source: policy.source,
    documented: true,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Freshness
 * ────────────────────────────────────────────────────────────────────────── */

function daysBetween(a, b) {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/** Freshness of a single platform's transcribed policy. */
export function policyFreshness(platform, asOf = new Date()) {
  const policy = getPolicy(platform);
  if (!policy) return null;
  const documentedAt = new Date(policy.documentedAt);
  const ageDays = daysBetween(asOf, documentedAt);
  return {
    platform,
    policyVersion: policy.policyVersion,
    documentedAt: policy.documentedAt,
    verificationMethod: policy.verificationMethod,
    source: policy.source,
    ageDays,
    stale: ageDays > STALENESS_DAYS,
    stalenessThresholdDays: STALENESS_DAYS,
  };
}

export function isPolicyStale(platform, asOf = new Date()) {
  const f = policyFreshness(platform, asOf);
  return f ? f.stale : true;
}

/** Freshness snapshot across all platforms (for a health/status endpoint). */
export function policyFreshnessReport(asOf = new Date()) {
  return {
    registryVersion: POLICY_REGISTRY_VERSION,
    verificationMethod: "manual-reference",
    note: "Values are transcribed from official docs, not fetched live at runtime.",
    platforms: Object.keys(PLATFORM_POLICIES).map((p) => policyFreshness(p, asOf)),
  };
}
