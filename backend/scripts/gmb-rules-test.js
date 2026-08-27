/**
 * GMB master-rule unit tests (no network, no ENV).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  GMB_CATEGORY_IDS,
  GMB_CATEGORY_LIST,
  GMB_CHAR,
  detectVerifiedOffer,
  ensureGmbHashtags,
  extractHashtags,
  extractVerifiedServices,
  firstNChars,
  getGmbCategory,
  isFabricatedServiceName,
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

assert(resolveGmbCta(GMB_CATEGORY_IDS.INTENT_PROXIMITY, { phone: "(469) 392-4000" }) === "CALL NOW", "intent CTA uses Call Now only when phone is verified");
assert(resolveGmbCta(GMB_CATEGORY_IDS.INTENT_PROXIMITY, {}) === "LEARN MORE", "intent CTA omits Call Now when phone is missing");
assert(resolveGmbCta(GMB_CATEGORY_IDS.OFFER_PROMOTION_EVENT) === "SIGN UP", "offer CTA");
assert(resolveGmbCta(GMB_CATEGORY_IDS.AUTHORITY_TRUST_PROOF, { phone: "4693924000" }) === "BOOK", "authority CTA uses Book when phone exists");
assert(resolveGmbCta(GMB_CATEGORY_IDS.AUTHORITY_TRUST_PROOF, {}) === "LEARN MORE", "authority CTA does not require a phone when none is verified");
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

assert(isFabricatedServiceName("Website Repair Tip 2"), "tip 2 is a fabricated service name");
assert(isFabricatedServiceName("Website Repair related 3"), "related N is a fabricated service name");
assert(!isFabricatedServiceName("Website Repair"), "primary offering is not fabricated");

const extracted = extractVerifiedServices({
  keywords: {
    primary: "website repair",
    secondaryKeywords: ["Website Repair Tip 2", "Website Repair Tip 3", "SSL certificate"],
  },
  sourcePage: { title: "A step-by-step guide to e-commerce setup", keywords: { primary: "website repair" } },
});
assert(
  extracted.every((s) => !/tip\s+\d/i.test(s)),
  "service extraction drops educational tip fillers"
);
assert(
  extracted.some((s) => /website repair/i.test(s)),
  "service extraction keeps the real primary service"
);
assert(
  !extracted.some((s) => /e-commerce setup/i.test(s) && /guide/i.test(s)),
  "educational page titles are not converted into services"
);

const phonePlaceholder = stripUnverifiedNap(
  "Mostafij Emon Houston TX. Phone not provided. Address not provided.",
  { name: "Mostafij Emon" }
);
assert(!/phone not provided/i.test(phonePlaceholder), "strip removes Phone not provided");
assert(!/address not provided/i.test(phonePlaceholder), "strip removes Address not provided");

const decade = validateGmbPost({
  content: `${"Looking for website repair near you in Houston? Local help for nearby businesses. ".repeat(10)}\nCore services:\n• Website repair\nWhy choose us: over a decade of trusted work.\nClick "Learn More" to read the details on this page.\n#Houston #WebsiteRepair #HoustonNearMe #LocalBusiness`,
  heading: "Looking for website repair near you in Houston?",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Houston, TX",
  keywords: { primary: "website repair" },
  business: {},
});
assert(
  decade.issues.some((i) => /unverified experience/i.test(i)),
  "unverified over-a-decade claim fails"
);

const fakeTips = validateGmbPost({
  content: `${"Looking for website repair near you in Houston? Local help for nearby businesses. ".repeat(8)}\nCore services:\n• Website Repair Tip 2\n• Website Repair Tip 3\n• Website Repair Tip 4\nWhy choose us: local team.\nClick "Learn More" to read the details on this page.\n#Houston #WebsiteRepair #HoustonNearMe #LocalBusiness`,
  heading: "Looking for website repair near you in Houston?",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Houston, TX",
  keywords: { primary: "website repair" },
  business: {},
});
assert(
  fakeTips.status === "NEEDS_REVISION" && fakeTips.issues.some((i) => /fabricated service/i.test(i)),
  "fabricated Tip 2/3/4 core services fail"
);

const oneRealService = validateGmbPost({
  content: `${"Looking for website repair near you in Houston? Mostafij Emon helps nearby customers today. ".repeat(7)}\nCore services:\n• Website Repair\nWhy choose us: our Houston team focuses on reliable website repair with straightforward guidance.\nClick "Learn More" to read the details on this page.\n#Houston #WebsiteRepair #HoustonNearMe #LocalBusiness`,
  heading: "Looking for website repair near you in Houston?",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Houston, TX",
  keywords: { primary: "website repair" },
  business: { name: "Mostafij Emon" },
});
assert(
  !oneRealService.issues.some((i) => /Core Services/i.test(i)),
  "a single verified core service is enough"
);

const faqNoQ = validateGmbPost({
  content: `${"If your website shows a Not Secure warning it is crucial to address it immediately in Houston. ".repeat(9)}\nHelpful tips:\n• Check SSL\n• Renew the certificate\nOur Houston team can help.\nClick \"Learn More\" to read the details on this page.\n#Houston #WebsiteRepair #HoustonWebsiteRepair #LocalTips`,
  heading: "When should I fix my Not Secure website?",
  categoryId: GMB_CATEGORY_IDS.FAQ_EDUCATIONAL,
  location: "Houston, TX",
  keywords: { primary: "website repair" },
  sourceTitle: "How to fix not secure website when SSL certificate expires",
});
assert(
  faqNoQ.status === "NEEDS_REVISION" && faqNoQ.issues.some((i) => /question/i.test(i)),
  "FAQ without a question mark in first 150 fails"
);

const faqOk = validateGmbPost({
  content: `${"Need help with a Not Secure website warning in Houston? Renew or install an SSL certificate so visitors stay protected. ".repeat(6)}\nHelpful tips:\n• Check SSL status\n• Renew if expired\nOur Houston team can help with website repair.\nClick \"Learn More\" to read the details on this page.\n#Houston #WebsiteRepair #HoustonWebsiteRepair #LocalTips`,
  heading: "Need help with a Not Secure website?",
  categoryId: GMB_CATEGORY_IDS.FAQ_EDUCATIONAL,
  location: "Houston, TX",
  keywords: { primary: "website repair" },
  sourceTitle: "How to fix not secure website when SSL certificate expires",
});
assert(/\?/.test(faqOk.frontLoad), "FAQ front-load keeps the question mark");
assert(
  !faqOk.issues.some((i) => /question/i.test(i)),
  "FAQ with a source-supported question in first 150 passes the hook"
);

const placeholderFail = validateGmbPost({
  content: `${"Looking for website repair near you in Houston? Local help for nearby businesses. ".repeat(8)}\nCore services:\n• Website Repair\nMostafij Emon Houston TX. Phone not provided.\nClick \"Learn More\" to read the details on this page.\n#Houston #WebsiteRepair #HoustonNearMe #LocalBusiness`,
  heading: "Looking for website repair near you in Houston?",
  categoryId: GMB_CATEGORY_IDS.INTENT_PROXIMITY,
  location: "Houston, TX",
  keywords: { primary: "website repair" },
  business: { name: "Mostafij Emon" },
});
assert(
  placeholderFail.status === "NEEDS_REVISION" &&
    placeholderFail.issues.some((i) => /Phone not provided/i.test(i)),
  "Phone not provided is a hard validation failure"
);

const here = path.dirname(fileURLToPath(import.meta.url));
const suiteSrc = fs.readFileSync(path.join(here, "../src/services/autoPosterService.js"), "utf8");
const genStart = suiteSrc.indexOf("export async function generateAutoPosterSuite");
const genEnd = suiteSrc.indexOf("function liveGmbValidation");
const genFn = suiteSrc.slice(genStart, genEnd);
assert(/archivedCount = 0/.test(genFn), "generate suite hard-codes archivedCount 0");
assert(!/updateMany/.test(genFn), "generate suite does not mass-update unrelated posts");
assert(!/tip \$\{secondaryKeywords\.length/.test(genFn), "generate suite does not pad Tip N keywords");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

