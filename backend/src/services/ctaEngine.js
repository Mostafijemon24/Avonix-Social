/**
 * Functional CTA engine (P0 correctness).
 *
 * A CTA is NOT just a phrase in the post body. Each platform has a different,
 * real linking capability, and Google Business Profile has a dedicated native
 * button (`callToAction` with an `actionType` + `url`) that is completely
 * separate from the post text. This module turns an intended action into a
 * STRUCTURED, VALIDATED CTA so the publishing payload and the UI can represent
 * exactly what the platform actually supports — never a quoted phrase pretending
 * to be a clickable link.
 *
 * It is pure (no DB / network) so it is fully unit-testable.
 */

/**
 * Google Business Profile localPost `callToAction.actionType` enum — the ONLY
 * values the Posts API accepts. (GET_DIRECTIONS / CONTACT_US / VISIT_WEBSITE are
 * NOT valid localPost action types and must be mapped or dropped.)
 * See developers.google.com/my-business/content/posts-data.
 */
export const GBP_ACTION_TYPES = Object.freeze(["BOOK", "ORDER", "SHOP", "LEARN_MORE", "SIGN_UP", "CALL"]);

/**
 * Platform capability registry. Keyed by the provider key used elsewhere in the
 * app (PLATFORM_CONFIG[x].key). Describes the ACTUAL linking mechanism so we
 * never claim a body phrase is clickable when it is not.
 */
export const PLATFORM_CTA_CAPABILITY = Object.freeze({
  google_business: {
    nativeButton: true,
    bodyLinkClickable: false,
    mechanism: "native_button",
    actions: GBP_ACTION_TYPES,
  },
  // Instagram feed captions are plain text — URLs are NOT clickable.
  instagram: { nativeButton: false, bodyLinkClickable: false, mechanism: "profile_link", actions: [] },
  // Facebook / LinkedIn / X / Pinterest render a bare URL in the body as a link.
  facebook: { nativeButton: false, bodyLinkClickable: true, mechanism: "body_link", actions: [] },
  linkedin: { nativeButton: false, bodyLinkClickable: true, mechanism: "body_link", actions: [] },
  x: { nativeButton: false, bodyLinkClickable: true, mechanism: "body_link", actions: [] },
  pinterest: { nativeButton: false, bodyLinkClickable: true, mechanism: "body_link", actions: [] },
});

const DISPLAY_TO_KEY = {
  Facebook: "facebook",
  Instagram: "instagram",
  LinkedIn: "linkedin",
  GMB: "google_business",
  X: "x",
  Pinterest: "pinterest",
};

/** Resolve a provider key from either a display name ("GMB") or a key. */
export function providerKeyOf(platform) {
  if (!platform) return null;
  if (PLATFORM_CTA_CAPABILITY[platform]) return platform;
  return DISPLAY_TO_KEY[platform] || null;
}

/**
 * Map a human GMB CTA label (from resolveGmbCta, e.g. "LEARN MORE", "CALL NOW",
 * "VISIT WEBSITE") to a VALID Google actionType — or null if there is no valid
 * mapping (so we drop the button instead of sending an invalid payload).
 */
export function mapGmbLabelToActionType(label) {
  const l = String(label || "").trim().toUpperCase();
  switch (l) {
    case "CALL NOW":
    case "CALL":
      return "CALL";
    case "BOOK":
      return "BOOK";
    case "ORDER":
      return "ORDER";
    case "SHOP":
      return "SHOP";
    case "SIGN UP":
    case "SIGNUP":
      return "SIGN_UP";
    case "LEARN MORE":
    case "VISIT WEBSITE":
    case "CONTACT US": // no native CONTACT action — a Learn-more link to the contact page is the valid equivalent
      return "LEARN_MORE";
    // GET DIRECTIONS has no localPost actionType → caller drops the button.
    default:
      return null;
  }
}

/** Human-readable button text for an action type. */
function actionText(actionType) {
  switch (actionType) {
    case "CALL":
      return "Call now";
    case "BOOK":
      return "Book";
    case "ORDER":
      return "Order online";
    case "SHOP":
      return "Shop";
    case "SIGN_UP":
      return "Sign up";
    case "LEARN_MORE":
    default:
      return "Learn more";
  }
}

/** Best-effort destination classification from the URL path (for the UI). */
function classifyDestination(url) {
  const p = String(url || "").toLowerCase();
  if (/book|appointment|schedule|reserv/.test(p)) return "booking_page";
  if (/contact/.test(p)) return "contact_page";
  if (/service|treatment|solution/.test(p)) return "service_page";
  if (/product|shop|store/.test(p)) return "product_page";
  if (/location|directions|find-us|visit/.test(p)) return "location_page";
  return "website_page";
}

/**
 * Validate a destination URL. Requires http/https. When `businessOrigin` is
 * provided, the destination MUST belong to the same host (prevents a CTA from
 * silently pointing at another business / organization — cross-website safety).
 * Returns { valid, reason, host }.
 */
export function validateDestinationUrl(url, businessOrigin = null) {
  if (!url) return { valid: false, reason: "missing", host: null };
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return { valid: false, reason: "malformed", host: null };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { valid: false, reason: "bad-protocol", host: u.host || null };
  }
  if (businessOrigin) {
    let origin;
    try {
      origin = new URL(businessOrigin);
    } catch {
      origin = null;
    }
    if (origin && origin.host.replace(/^www\./, "") !== u.host.replace(/^www\./, "")) {
      return { valid: false, reason: "cross-domain", host: u.host };
    }
  }
  return { valid: true, reason: "ok", host: u.host };
}

/**
 * Build a structured, validated CTA for a platform.
 *
 * @param {object} opts
 * @param {string} opts.platform        display name or provider key
 * @param {string} [opts.gmbLabel]      resolveGmbCta() label for GMB posts
 * @param {string} [opts.destinationUrl] the intended destination (selected page)
 * @param {string} [opts.businessOrigin] the verified business website origin
 * @param {boolean} [opts.hasPhone]     whether a verified phone exists (for CALL)
 * @returns {{ctaText, ctaType, destinationUrl, destinationType, linkCapability, validationStatus, warnings}}
 */
export function buildCta({ platform, gmbLabel, destinationUrl = null, businessOrigin = null, hasPhone = false } = {}) {
  const key = providerKeyOf(platform);
  const warnings = [];
  if (!key || !PLATFORM_CTA_CAPABILITY[key]) {
    return {
      ctaText: null,
      ctaType: null,
      destinationUrl: null,
      destinationType: null,
      linkCapability: "none",
      validationStatus: "unsupported_platform",
      warnings: ["unknown platform"],
    };
  }
  const cap = PLATFORM_CTA_CAPABILITY[key];

  // ── Google Business Profile: native button ──────────────────────────────
  if (key === "google_business") {
    const actionType = mapGmbLabelToActionType(gmbLabel) || "LEARN_MORE";
    if (actionType === "CALL") {
      // CALL uses the location's verified phone, NOT a url.
      return {
        ctaText: actionText("CALL"),
        ctaType: "CALL",
        destinationUrl: null,
        destinationType: "phone",
        linkCapability: "native_button",
        validationStatus: hasPhone ? "valid" : "missing_destination",
        warnings: hasPhone ? [] : ["CALL action requires a verified business phone"],
      };
    }
    const v = validateDestinationUrl(destinationUrl, businessOrigin);
    return {
      ctaText: actionText(actionType),
      ctaType: actionType,
      destinationUrl: v.valid ? destinationUrl : null,
      destinationType: v.valid ? classifyDestination(destinationUrl) : null,
      linkCapability: "native_button",
      validationStatus: v.valid ? "valid" : "missing_destination",
      warnings: v.valid ? [] : [`GBP ${actionType} needs a valid same-site URL (${v.reason})`],
    };
  }

  // ── Instagram: no clickable link in the caption ─────────────────────────
  if (key === "instagram") {
    // destinationUrl is retained for reference (link-in-profile) but is NOT a
    // clickable caption link. ctaText must describe the real action.
    const v = destinationUrl ? validateDestinationUrl(destinationUrl, businessOrigin) : { valid: false };
    return {
      ctaText: "Link in profile",
      ctaType: "PROFILE_LINK",
      destinationUrl: v.valid ? destinationUrl : null,
      destinationType: v.valid ? classifyDestination(destinationUrl) : null,
      linkCapability: "profile_link",
      // Valid even without a body link — the caption honestly says "link in profile".
      validationStatus: "valid",
      warnings: ["Instagram captions are not clickable — direct users to the profile link"],
    };
  }

  // ── Facebook / LinkedIn / X / Pinterest: clickable body link ────────────
  const v = validateDestinationUrl(destinationUrl, businessOrigin);
  if (!v.valid) {
    return {
      ctaText: "Visit website",
      ctaType: "LINK",
      destinationUrl: null,
      destinationType: null,
      linkCapability: "body_link",
      validationStatus: "missing_destination",
      warnings: [`${key} link CTA needs a valid same-site URL (${v.reason})`],
    };
  }
  return {
    ctaText: "Visit website",
    ctaType: "LINK",
    destinationUrl,
    destinationType: classifyDestination(destinationUrl),
    linkCapability: "body_link",
    validationStatus: "valid",
    warnings,
  };
}

/**
 * Produce the GBP localPost `callToAction` object from a structured CTA, or null
 * when it must NOT be attached (invalid / unsupported). This is what guarantees
 * a GBP post gets a REAL button instead of a quoted phrase.
 */
export function buildGbpCallToAction(cta) {
  if (!cta || cta.linkCapability !== "native_button" || cta.validationStatus !== "valid") return null;
  if (!GBP_ACTION_TYPES.includes(cta.ctaType)) return null;
  if (cta.ctaType === "CALL") {
    // CALL buttons derive the number from the location; no url field.
    return { actionType: "CALL" };
  }
  if (!cta.destinationUrl) return null;
  return { actionType: cta.ctaType, url: cta.destinationUrl };
}
