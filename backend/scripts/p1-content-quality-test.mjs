/**
 * P1 — Content Quality unit tests (no live providers).
 *
 * Covers the four requirements that must NOT be mere prompt wording:
 *   • Website-specific brand voice profiles (distinct per site, cached, isolated)
 *   • Natural human writing (no generic openings / clichés / robotic transitions
 *     / keyword stuffing) with factual content preserved
 *   • Recent-post similarity detection (shingle + Jaccard)
 *   • Identity isolation (no foreign URL / domain / business name leakage)
 *
 * Run: npm run test:p1
 */
const nw = await import("../src/content/naturalWriting.js");
const idn = await import("../src/content/identityIsolation.js");
const bv = await import("../src/services/brandVoice.js");
const sim = await import("../src/services/similarityService.js");

let passed = 0, failed = 0;
function assert(cond, label, detail = "") {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); }
}

/* ── Natural writing ───────────────────────────────────────────────────── */
console.log("Natural writing — detection:");
assert(nw.detectGenericOpening("Here is a clear update from our team. We fix roofs.") !== null, "generic template opening detected");
assert(nw.detectGenericOpening("Leaky roof in Dhaka? We can help today.") === null, "specific opening is NOT flagged");
assert(nw.detectCliches("We offer world-class, cutting-edge, seamless service.").length >= 3, "multiple clichés detected");
assert(nw.detectRoboticTransitions("We help. Furthermore, we deliver. Moreover, we care.").length >= 2, "robotic transitions detected");
const stuff = nw.analyzeKeywordStuffing("roof repair roof repair roof repair roof repair roof repair done", "roof repair");
assert(stuff.stuffed && stuff.occurrences >= 5, "keyword stuffing detected");

console.log("\nNatural writing — scoring:");
const bad = nw.scoreNaturalness(
  "Here is a clear update from our team. We provide world-class service. Furthermore, roof repair roof repair roof repair roof repair roof repair.",
  { keywords: { primary: "roof repair" } }
);
assert(bad.score < 60 && bad.issues.length >= 3, "robotic draft scores low with multiple issues");
const good = nw.scoreNaturalness(
  "Leaky roof after last week's storm? Our Dhaka crew handles repairs fast, with honest quotes and no surprises.",
  { keywords: { primary: "roof repair" } }
);
assert(good.score >= 70 && good.natural, "human draft scores high");

console.log("\nNatural writing — cleanup preserves facts:");
const cleaned = nw.humanizeDraft(
  "Here is a clear update from our team. We offer cutting-edge roof repair in Dhaka for 500 taka. Furthermore, we are licensed.",
  { primary: "roof repair", seed: "p1" }
);
assert(nw.detectGenericOpening(cleaned) === null, "generic opening removed after humanize");
assert(!/cutting-edge/i.test(cleaned), "cliché removed after humanize");
assert(!/\bFurthermore\b/.test(cleaned), "robotic transition removed after humanize");
assert(/500 taka/.test(cleaned) && /Dhaka/.test(cleaned) && /licensed/.test(cleaned), "factual details (price, city, license) preserved");

/* ── Brand voice ───────────────────────────────────────────────────────── */
console.log("\nBrand voice — distinct per website:");
const vClinic = bv.deriveBrandVoice({
  origin: "https://careprime.example",
  pages: [{ title: "Dermatology Clinic", keywords: { primary: "dermatology care" } }],
  keywords: { primary: "dermatology care", secondaryKeywords: ["skin treatment", "acne clinic"] },
  location: "Dhaka",
});
const vRoof = bv.deriveBrandVoice({
  origin: "https://roofpro.example",
  pages: [{ title: "Roof Repair Experts", keywords: { primary: "roof repair" } }],
  keywords: { primary: "roof repair", secondaryKeywords: ["roof replacement", "gutter"] },
  location: "Denver, CO",
});
assert(vClinic.industryId === "medical", "clinic site → medical industry");
assert(vRoof.industryId === "home_services", "roofing site → home/trade industry");
assert(vClinic.voiceId !== vRoof.voiceId, "two websites → two distinct voiceIds");
assert(JSON.stringify(vClinic.tones) !== JSON.stringify(vRoof.tones), "distinct tone sets");
assert(bv.deriveBrandVoice({ origin: "https://careprime.example", pages: vClinic ? [{ title: "Dermatology Clinic", keywords: { primary: "dermatology care" } }] : [], keywords: { primary: "dermatology care", secondaryKeywords: ["skin treatment", "acne clinic"] }, location: "Dhaka" }).voiceId === vClinic.voiceId, "same site → stable voiceId");

console.log("\nBrand voice — prompt block + isolation:");
const block = bv.buildVoicePromptBlock(vClinic, "Instagram");
assert(/BRAND VOICE/.test(block) && /healthcare/i.test(block), "prompt block describes THIS site's voice");
assert(!/roof/i.test(block), "clinic voice block contains no other industry's terms");

console.log("\nBrand voice — cached resolver (performance):");
const first = await bv.getBrandVoice({ userId: "u1", workspaceId: "w1", websiteOrigin: "https://cache.example", keywords: { primary: "pet grooming" }, pages: [] });
const second = await bv.getBrandVoice({ userId: "u1", workspaceId: "w1", websiteOrigin: "https://cache.example", keywords: { primary: "pet grooming" }, pages: [] });
assert(first.cached === false && second.cached === true, "second resolve is served from cache (no recompute)");

/* ── Similarity ────────────────────────────────────────────────────────── */
console.log("\nSimilarity detection:");
assert(sim.similarityScore("the quick brown fox jumps over", "the quick brown fox jumps over") === 1, "identical text → 1.0");
assert(sim.similarityScore("roof repair in denver today", "dermatology clinic in dhaka") < 0.2, "unrelated text → low");
const dupCheck = sim.findMostSimilar("we fix leaky roofs fast in denver with honest quotes", [
  { id: "a", content: "we fix leaky roofs fast in denver with honest quotes" },
  { id: "b", content: "best pizza in town, order now" },
]);
assert(dupCheck.duplicate && dupCheck.mostSimilar.id === "a", "duplicate flagged against the matching prior post");
assert(!sim.findMostSimilar("completely different topic about taxes", [{ id: "a", content: "we fix leaky roofs" }]).duplicate, "non-duplicate not flagged");
assert(sim.normalizeForCompare("Visit https://x.com #tag, NOW!").replace(/\s+/g, " ") === "visit now", "urls/hashtags/punct stripped before compare");

/* ── Identity isolation ────────────────────────────────────────────────── */
console.log("\nIdentity isolation:");
const det = idn.detectForeignIdentity("See https://competitor.com/book and our site https://mine.com/services. Ask for Acme Corp.", {
  ownOrigin: "https://mine.com",
  foreignNames: ["Acme Corp"],
});
assert(det.foreignUrls.includes("https://competitor.com/book"), "foreign URL detected");
assert(det.foreignNames.includes("Acme Corp"), "foreign business name detected");
assert(!det.clean, "leakage marked not clean");
const detClean = idn.detectForeignIdentity("Visit https://mine.com/services for details.", { ownOrigin: "https://mine.com" });
assert(detClean.clean, "own-site URL is NOT flagged");
const scrubbed = idn.scrubForeignIdentity("Book at https://competitor.com now, or call Acme Corp today.", {
  ownOrigin: "https://mine.com",
  foreignNames: ["Acme Corp"],
});
assert(!/competitor\.com/.test(scrubbed) && !/Acme Corp/.test(scrubbed), "foreign URL + name scrubbed");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
