/**
 * GMB master-rule unit tests (no network, no ENV).
 */
import {
  GMB_CATEGORY_IDS,
  GMB_CATEGORY_LIST,
  GMB_CHAR,
  detectVerifiedOffer,
  ensureGmbHashtags,
  extractHashtags,
  firstNChars,
  getGmbCategory,
  isGmbCategoryId,
  pickRelevantSourcePage,
  recommendGmbCategory,
  resolveGmbCta,
  stripUnverifiedNap,
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
assert(fakeReady.status === "NEEDS_REVISION", "unverified street address and phone fail");

const invented = validateGmbPost({
  content: `${"Looking for website repair near you in Houston? Our team helps local businesses recover hacked sites and WordPress issues. ".repeat(8)}\n123 Main St\n(123) 456-7890\nClick "Call Now" to speak with our team.\n#Houston #WebsiteRepair #HoustonNearMe #LocalBusiness`,
  heading: "Looking for website repair near you in Houston?",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Houston, TX",
  keywords: { primary: "website repair" },
  business: { name: "Mostafij Emon" },
});
assert(
  invented.issues.some((i) => /phone|address|placeholder/i.test(i)),
  "invented NAP without verified data fails"
);

const stripped = stripUnverifiedNap(
  "Call us at (123) 456-7890 on 123 Main St. Open 24/7. Houston website repair.",
  {}
);
assert(!/\(123\)/.test(stripped) && !/123 Main/i.test(stripped), "strip removes unverified phone and street");
assert(!/24\s*\/\s*7/i.test(stripped), "strip removes unverified hours");

const tagged = ensureGmbHashtags(
  "Looking for website repair near you in Houston? Click Call Now.",
  { location: "Houston, TX", primary: "website repair", categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY }
);
assert(extractHashtags(tagged).length >= 4, "ensureGmbHashtags adds at least 4 tags");

const verifiedPhoneOk = validateGmbPost({
  content: `${"Looking for website repair near you in Houston? Local WordPress and malware help for nearby businesses. ".repeat(8)}\nCore services:\n• Website repair\n• Malware removal\n• WordPress recovery\nWhy choose us: local team focused on verified website repair.\nClick "Call Now" to speak with our team.\n#Houston #WebsiteRepair #HoustonNearMe #LocalBusiness`,
  heading: "Looking for website repair near you in Houston?",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Houston, TX",
  keywords: { primary: "website repair" },
  business: {},
});
assert(!verifiedPhoneOk.issues.some((i) => /phone number/i.test(i)), "no phone is valid when phone is unverified");

const fakeYears = validateGmbPost({
  content: `${"Looking for website repair near you in Houston? Local help for nearby businesses. ".repeat(10)}\nCore services:\n• Repair\n• Malware\n• WordPress\nWhy choose us: 15 years of experience.\nClick "Call Now" to speak with our team.\n#Houston #WebsiteRepair #HoustonNearMe #LocalBusiness`,
  heading: "Looking for website repair near you in Houston?",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Houston, TX",
  keywords: { primary: "website repair" },
  business: {},
});
assert(
  fakeYears.issues.some((i) => /unverified experience/i.test(i)),
  "unverified years of experience fails"
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
