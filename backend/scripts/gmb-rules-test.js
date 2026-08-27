/**
 * GMB master-rule unit tests (no network, no ENV).
 */
import {
  GMB_CATEGORY_IDS,
  GMB_CATEGORY_LIST,
  GMB_CHAR,
  detectVerifiedOffer,
  firstNChars,
  getGmbCategory,
  isGmbCategoryId,
  pickRelevantSourcePage,
  recommendGmbCategory,
  resolveGmbCta,
  uiCatalog,
} from "../src/content/gmbContentRules.js";
import { validateGmbPost } from "../src/content/gmbValidator.js";

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

assert(GMB_CATEGORY_LIST.length === 4, "exactly four GMB categories");
assert(
  Object.values(GMB_CATEGORY_IDS).every(isGmbCategoryId),
  "all category IDs resolve"
);
assert(
  new Set(GMB_CATEGORY_LIST.map((c) => c.id)).size === 4,
  "category IDs are unique"
);
assert(GMB_CHAR.min === 1000 && GMB_CHAR.max === 1100, "hard character range");
assert(GMB_CHAR.targetMin === 1020 && GMB_CHAR.targetMax === 1050, "target range");
assert(GMB_CHAR.frontLoad === 150, "front-load window is 150");

const catalog = uiCatalog();
assert(catalog.categories.every((c) => c.structure.length >= 5), "each category has structure");
assert(!JSON.stringify(catalog).includes("Act as an expert"), "UI catalog does not leak prompts");

assert(resolveGmbCta(GMB_CATEGORY_IDS.INTENT_PROXIMITY) === "CALL NOW", "intent CTA");
assert(resolveGmbCta(GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT) === "SIGN UP", "offer CTA");
assert(resolveGmbCta(GMB_CATEGORY_IDS.AUTHORITY_TRUST_PROOF) === "BOOK", "authority CTA");
assert(resolveGmbCta(GMB_CATEGORY_IDS.FAQ_EDUCATIONAL) === "LEARN MORE", "faq CTA");

const pages = [
  { url: "https://ex.com/", title: "Home", keywords: { primary: "home" } },
  {
    url: "https://ex.com/emergency-care",
    title: "Emergency Care Plano",
    keywords: { primary: "emergency room" },
  },
];
const picked = pickRelevantSourcePage(pages, GMB_CATEGORY_IDS.INTENT_PROXIMITY, "Plano, TX");
assert(picked?.url.includes("emergency-care"), "does not default to homepage");

const stringSecondaryPages = [
  { url: "https://ex.com/", title: "Home", keywords: { primary: "home", secondary: "generic" } },
  {
    url: "https://ex.com/website-repair-houston",
    title: "Website Repair Houston",
    keywords: { primary: "website repair", secondary: "houston recovery" },
  },
];
const pickedStringKw = pickRelevantSourcePage(
  stringSecondaryPages,
  GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  "Houston, TX"
);
assert(
  pickedStringKw?.url.includes("website-repair"),
  "string secondary keywords do not crash picker"
);

const offer = detectVerifiedOffer([
  { title: "Spring discount on exams", url: "https://ex.com/offer", keywords: { primary: "exam" } },
]);
assert(offer.found, "detects verified offer language");
assert(!detectVerifiedOffer(pages).found, "no false offer on generic pages");

const rec = recommendGmbCategory(pages, "Plano");
assert(rec.id === GMB_CATEGORY_IDS.INTENT_PROXIMITY, "recommends intent for local service pages");

const cat = getGmbCategory(GMB_CATEGORY_IDS.INTENT_PROXIMITY);
assert(cat.systemPrompt.includes("1,000") && cat.systemPrompt.includes("first 150"), "master prompt encodes length + front-load");

const offerCat = validateGmbPost({
  content: "We might have a deal sometime. Call maybe.\n#One",
  heading: "Maybe a deal",
  categoryId: GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT,
  location: "",
  keywords: { primary: "exam" },
  verifiedOffer: false,
});
assert(offerCat.status === "NEEDS_REVISION", "offer without verified offer fails");

const noHash = validateGmbPost({
  content: `${"Need an emergency room near you in Plano? Our clinic is open. ".repeat(18)}\nMedco ER\n3960 Legacy Dr, Plano, TX\n(469) 392-4000\nClick "Call Now" to speak with our team.`,
  heading: "Looking for an ER near you in Plano?",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Plano, TX",
  keywords: { primary: "emergency room" },
});
assert(noHash.status === "NEEDS_REVISION", "missing hashtags fails safely");

const tooLong = validateGmbPost({
  content: `${"Need an emergency room near you in Plano? ".repeat(40)}\nClick Call Now\n#PlanoER #EmergencyRoomPlano #24HourER #PlanoTX #ERNearMe`,
  heading: "Looking for an ER near you in Plano?",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Plano, TX",
  keywords: { primary: "emergency room" },
});
assert(tooLong.status === "NEEDS_REVISION", "over-max GMB fails");
assert(tooLong.charCount > 1100, "too-long count is above max");

const short = validateGmbPost({
  content: "Hello Plano",
  heading: "Hi",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Plano, TX",
  keywords: { primary: "emergency room" },
});
assert(short.status === "NEEDS_REVISION", "short post is NEEDS REVISION");
assert(short.issues.some((i) => i.toLowerCase().includes("character")), "reports character issue");

const front = firstNChars("Looking for an ER near you in Plano? Medco is open.", 150);
assert(/plano/i.test(front) && /near/i.test(front), "front-load helper keeps first 150 chars");

const longPad = "Need an emergency room near you in Plano? Our clinic on Legacy Drive is open for walk-ins. ".repeat(20);
const fakeReady = validateGmbPost({
  content: `${longPad}\n\nCore services:\n• Chest pain\n• Breathing problems\n• Abdominal pain\n• Pediatric care\nWhy choose us: experienced local team with on-site diagnostics.\nMedco ER\n3960 Legacy Dr, Plano, TX\n(469) 392-4000\nOpen 24/7\nClick "Call Now" to speak with our team.\n#PlanoER #EmergencyRoomPlano #24HourER #PlanoTX #ERNearMe`,
  heading: "Looking for an ER near you in Plano?",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Plano, TX",
  keywords: { primary: "emergency room" },
});
assert(typeof fakeReady.charCount === "number", "validator computes character count");
assert(fakeReady.charCount === fakeReady.contentLength || fakeReady.charCount > 0, "char count is programmatic");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
