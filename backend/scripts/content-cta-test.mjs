/**
 * P0 correctness test — functional CTA engine + business-identity guard.
 *
 * No live providers. Verifies the two headline defects from the Careprime
 * report are fixed at the code level:
 *   • CTA text is separated from CTA functionality, mapped to the REAL
 *     platform mechanism (GBP native button w/ valid actionType+URL; Instagram
 *     caption is NOT a clickable link; Facebook/LinkedIn body link; cross-site
 *     destinations rejected; unsupported actions dropped).
 *   • The authenticated account owner's name is never inserted into business
 *     copy (stripOwnerNameFromContent) by default.
 *
 * Run: npm run test:content
 */
const {
  buildCta,
  buildGbpCallToAction,
  validateDestinationUrl,
  mapGmbLabelToActionType,
  GBP_ACTION_TYPES,
} = await import("../src/services/ctaEngine.js");
const { stripOwnerNameFromContent } = await import("../src/services/autoPosterService.js");

let passed = 0, failed = 0;
function assert(cond, label, detail = "") {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); }
}

const ORIGIN = "https://careprime.example";

/* 1. URL validation + cross-site isolation */
console.log("Destination URL validation:");
assert(validateDestinationUrl(`${ORIGIN}/services/dermatology`, ORIGIN).valid, "same-site https URL is valid");
assert(!validateDestinationUrl("ftp://x/y", ORIGIN).valid, "non-http protocol rejected");
assert(!validateDestinationUrl("not a url", ORIGIN).valid, "malformed URL rejected");
assert(
  validateDestinationUrl("https://another-business.com/book", ORIGIN).reason === "cross-domain",
  "cross-site destination rejected (no cross-website leakage)"
);

/* 2. GMB label → valid Google actionType only */
console.log("\nGMB action mapping:");
assert(mapGmbLabelToActionType("LEARN MORE") === "LEARN_MORE", "LEARN MORE → LEARN_MORE");
assert(mapGmbLabelToActionType("CALL NOW") === "CALL", "CALL NOW → CALL");
assert(mapGmbLabelToActionType("SIGN UP") === "SIGN_UP", "SIGN UP → SIGN_UP");
assert(mapGmbLabelToActionType("VISIT WEBSITE") === "LEARN_MORE", "VISIT WEBSITE → LEARN_MORE (no native VISIT action)");
assert(mapGmbLabelToActionType("GET DIRECTIONS") === null, "GET DIRECTIONS has no valid localPost action");
assert(GBP_ACTION_TYPES.every((a) => typeof a === "string"), "action enum defined");

/* 3. GBP native button payload */
console.log("\nGBP native button:");
const gbp = buildCta({ platform: "GMB", gmbLabel: "LEARN MORE", destinationUrl: `${ORIGIN}/services`, businessOrigin: ORIGIN });
assert(gbp.linkCapability === "native_button" && gbp.validationStatus === "valid", "valid GBP CTA is a native button");
const cta1 = buildGbpCallToAction(gbp);
assert(cta1 && cta1.actionType === "LEARN_MORE" && cta1.url === `${ORIGIN}/services`, "publish payload has actionType + url");

const gbpCall = buildCta({ platform: "GMB", gmbLabel: "CALL NOW", businessOrigin: ORIGIN, hasPhone: true });
const cta2 = buildGbpCallToAction(gbpCall);
assert(cta2 && cta2.actionType === "CALL" && !cta2.url, "CALL button carries actionType and NO url");

const gbpNoDest = buildCta({ platform: "GMB", gmbLabel: "LEARN MORE", destinationUrl: null, businessOrigin: ORIGIN });
assert(gbpNoDest.validationStatus === "missing_destination", "GBP w/o destination is marked missing");
assert(buildGbpCallToAction(gbpNoDest) === null, "no fabricated button when destination missing");

const gbpCross = buildCta({ platform: "GMB", gmbLabel: "BOOK", destinationUrl: "https://evil.com/book", businessOrigin: ORIGIN });
assert(buildGbpCallToAction(gbpCross) === null, "cross-site GBP destination produces NO button");

/* 4. Instagram caption is not a clickable link */
console.log("\nInstagram CTA honesty:");
const ig = buildCta({ platform: "Instagram", destinationUrl: `${ORIGIN}/services`, businessOrigin: ORIGIN });
assert(ig.linkCapability === "profile_link", "Instagram CTA is a profile link, not a body link");
assert(buildGbpCallToAction(ig) === null, "Instagram never yields a GBP button");
assert(/profile/i.test(ig.ctaText) || ig.warnings.some((w) => /not clickable/i.test(w)), "Instagram CTA honestly describes the limitation");

/* 5. Facebook/LinkedIn body link */
console.log("\nBody-link platforms:");
const fb = buildCta({ platform: "Facebook", destinationUrl: `${ORIGIN}/contact`, businessOrigin: ORIGIN });
assert(fb.linkCapability === "body_link" && fb.validationStatus === "valid", "Facebook uses a clickable body link");
const fbCross = buildCta({ platform: "Facebook", destinationUrl: "https://other.com/x", businessOrigin: ORIGIN });
assert(fbCross.validationStatus === "missing_destination", "Facebook cross-site link rejected");

/* 6. Owner-name guard */
console.log("\nOwner-name guard:");
assert(
  !/Mostafij Emon/.test(stripOwnerNameFromContent("At Careprime, Mostafij Emon leads our dermatology team.", "Mostafij Emon")),
  "owner full name removed from copy"
);
assert(
  !/Mostafij/.test(stripOwnerNameFromContent("Mostafij's clinic offers screenings.", "Mostafij Emon")),
  "owner possessive/first-name removed"
);
const kept = stripOwnerNameFromContent("Dr. Sarah Chen leads our dermatology team in Dhaka.", "Mostafij Emon");
assert(/Dr\. Sarah Chen/.test(kept), "a real (non-owner) provider name is preserved");
assert(stripOwnerNameFromContent("", "Mostafij Emon") === "", "empty content safe");
assert(stripOwnerNameFromContent("Quality dermatology care.", "") === "Quality dermatology care.", "no owner name → unchanged");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
