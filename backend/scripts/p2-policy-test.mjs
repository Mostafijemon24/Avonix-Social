/**
 * P2 — Policy compliance & performance unit tests (no live providers, no live
 * policy fetch).
 *
 * Covers:
 *   • Versioned platform-policy registry with documented sources
 *   • NO hardcoded "5 hashtags for Google" assumption — GBP hashtags are
 *     honestly reported as an unsupported/advisory platform feature
 *   • Platform-, placement-, and method-specific hashtag validation
 *   • Accurate character counting (X weighted / code points) + length enforcement
 *   • Policy freshness tracking + honest "manual-reference" (not live) labeling
 *   • Per-stage latency metrics
 *
 * Run: npm run test:p2
 */
const pp = await import("../src/content/platformPolicy.js");
const m = await import("../src/services/metrics.js");

let passed = 0, failed = 0;
function assert(cond, label, detail = "") {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); }
}

/* ── Registry + honesty ────────────────────────────────────────────────── */
console.log("Registry + sourcing honesty:");
for (const name of ["Facebook", "Instagram", "LinkedIn", "X", "Pinterest", "GMB"]) {
  const p = pp.getPolicy(name);
  assert(!!p && !!p.source?.url && !!p.documentedAt, `${name} has a documented source + date`);
}
assert(pp.getPolicy("x") === pp.getPolicy("X"), "provider key resolves to same entry as display name");
assert(
  Object.values(pp.PLATFORM_POLICIES).every((p) => p.verificationMethod === "manual-reference"),
  "every policy is labeled manual-reference (never claims a live check)"
);

/* ── No hardcoded Google 5-hashtag rule ────────────────────────────────── */
console.log("\nGoogle Business Profile hashtags (the key P2 requirement):");
const gbpH = pp.validateHashtags({ platform: "GMB", text: "a #one #two #three #four #five" });
assert(gbpH.supported === false, "GBP hashtags are NOT an officially supported feature");
assert(gbpH.max === null, "GBP has NO assumed hashtag maximum (not 5)");
assert(gbpH.ok === true && gbpH.overLimit === false, "GBP hashtags are not treated as a hard violation");
assert(gbpH.advisories.some((a) => /no official hashtag/i.test(a)), "honest advisory that GBP has no official hashtag rule");

/* ── Platform-specific hashtag limits ──────────────────────────────────── */
console.log("\nPlatform-specific hashtag validation:");
assert(pp.validateHashtags({ platform: "Instagram", hashtags: Array(31).fill("#x") }).overLimit, "Instagram > 30 hashtags → over limit");
assert(!pp.validateHashtags({ platform: "Instagram", hashtags: Array(30).fill("#x") }).overLimit, "Instagram = 30 hashtags → allowed");
assert(pp.validateHashtags({ platform: "Instagram", hashtags: ["#a"], placement: "stories" }).issues.some((i) => /placement/i.test(i)), "invalid IG placement flagged");
assert(!pp.validateHashtags({ platform: "Instagram", hashtags: ["#a"], placement: "first_comment" }).issues.length, "valid IG placement (first_comment) accepted");
const liH = pp.validateHashtags({ platform: "LinkedIn", hashtags: Array(10).fill("#x") });
assert(liH.max === null && !liH.overLimit, "LinkedIn has no documented hard count limit");
assert(liH.advisories.some((a) => /no.*hard hashtag-count limit/i.test(a)), "LinkedIn advisory honest about undocumented limit");

/* ── Character counting + enforcement ──────────────────────────────────── */
console.log("\nCharacter counting + length enforcement:");
assert(pp.countText("X", "hi https://example.com/a/very/long/path?x=1").count === 3 + 23, "X counts a URL as 23 (t.co weighting)");
assert(pp.countText("Facebook", "hello 😀").count === 7, "code-point count handles emoji as one");
const xLong = "word ".repeat(100);
const enfX = pp.enforceLength("X", xLong);
assert(enfX.truncated && pp.countText("X", enfX.text).count <= 280, "X text enforced to <= 280");
const enfG = pp.enforceLength("GMB", "x".repeat(2000));
assert(enfG.truncated && enfG.text.length <= 1500, "GMB summary enforced to <= 1500");
assert(!pp.enforceLength("Facebook", "short post").truncated, "within-limit text is not truncated");

/* ── Freshness tracking ────────────────────────────────────────────────── */
console.log("\nPolicy freshness:");
const freshNow = pp.policyFreshness("Instagram", new Date("2025-06-15"));
assert(freshNow && freshNow.ageDays >= 0 && freshNow.stale === false, "recently documented policy is fresh");
assert(pp.isPolicyStale("Instagram", new Date("2030-01-01")) === true, "far-future date → policy flagged stale");
const report = pp.policyFreshnessReport(new Date("2025-06-15"));
assert(report.platforms.length === 6 && /not fetched live/i.test(report.note), "freshness report lists all platforms + honest note");

/* ── Metrics ───────────────────────────────────────────────────────────── */
console.log("\nLatency metrics:");
const t = m.createTimer("gen");
t.mark("voice");
t.mark("text");
const sum = t.end("persist");
assert(sum.stages.length === 3 && typeof sum.totalMs === "number", "timer records per-stage + total ms");
assert(sum.stages.every((s) => typeof s.ms === "number" && s.ms >= 0), "every stage has a measured (non-negative) ms");
const agg = m.aggregateSummaries([sum, sum]);
assert(agg.count === 2 && agg.byStage.voice.count === 2, "summaries aggregate per stage across posts");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
