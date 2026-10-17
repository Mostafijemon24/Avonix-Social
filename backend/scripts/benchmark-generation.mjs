/**
 * P3 — generation benchmark (actual measurements, mock provider).
 *
 * Reports ACTUAL measured latency (never estimates) for:
 *   • Baseline core text generation (generatePostContent — pre-existing path)
 *   • Full content-quality pipeline (generatePostContentWithAi: brand-voice
 *     prompt + natural-writing + identity-isolation polish)
 *   • P1/P2 module micro-costs (voice derive, naturalness score, similarity,
 *     policy char count)
 *
 * The "before vs after" comparison is baseline-core vs full-pipeline on
 * EQUIVALENT inputs, so the printed delta is the real overhead the content
 * quality layer adds per post.
 *
 * Run: npm run bench:generation
 */
delete process.env.OPENROUTER_API_KEY; // measure deterministic template/mock path

const aps = await import("../src/services/autoPosterService.js");
const bv = await import("../src/services/brandVoice.js");
const nw = await import("../src/content/naturalWriting.js");
const sim = await import("../src/services/similarityService.js");
const pp = await import("../src/content/platformPolicy.js");

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
function bench(label, iters, fn) {
  // warmup
  for (let i = 0; i < Math.min(5, iters); i++) fn(i);
  const t0 = now();
  for (let i = 0; i < iters; i++) fn(i);
  const total = now() - t0;
  return { label, iters, totalMs: round(total), avgMs: round(total / iters) };
}
function round(n) { return Math.round(n * 1000) / 1000; }

const PLATFORMS = ["Facebook", "Instagram", "LinkedIn", "X", "Pinterest", "GMB"];
const keywords = {
  primary: "roof repair",
  secondaryKeywords: ["roof replacement", "storm damage", "gutter repair", "shingle repair"],
};
const LOCATION = "Denver, CO";
const URL = "https://roofpro.example/roof-repair";
const voice = bv.deriveBrandVoice({ origin: "https://roofpro.example", keywords, location: LOCATION, pages: [] });
const ITERS = Number(process.env.BENCH_ITERS || 200);

const rows = [];

// 1) Baseline core (pre-existing template generation, no new quality layer)
for (const platform of PLATFORMS) {
  rows.push(
    bench(`baseline core      ${platform}`, ITERS, () =>
      aps.generatePostContent(platform, keywords, LOCATION, URL, platform === "GMB" ? "INTENT_PROXIMITY" : "Professional", {
        writingIntent: "Awareness",
        gmbCategory: "INTENT_PROXIMITY",
        business: {},
      })
    )
  );
}

// 2) Full content-quality pipeline (voice prompt + natural-writing + identity polish)
for (const platform of PLATFORMS) {
  rows.push(
    await benchAsync(`full pipeline      ${platform}`, ITERS, () =>
      aps.generatePostContentWithAi(platform, keywords, LOCATION, URL, platform === "GMB" ? "INTENT_PROXIMITY" : "Professional", {
        writingIntent: "Awareness",
        gmbCategory: "INTENT_PROXIMITY",
        business: {},
        voice,
        ownerName: "Tester Account",
        websiteOrigin: "https://roofpro.example",
        foreignNames: ["Zephyr Dental Group"],
      })
    )
  );
}

// 3) Module micro-costs
const corpus = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, content: `roof repair job ${i} in denver with honest quotes and fast turnaround` }));
const sampleText = aps.generatePostContent("Facebook", keywords, LOCATION, URL, "Professional", { writingIntent: "Awareness" }).content;
rows.push(bench("module deriveBrandVoice", ITERS, () => bv.deriveBrandVoice({ origin: "https://x.example", keywords, location: LOCATION, pages: [] })));
rows.push(bench("module scoreNaturalness", ITERS, () => nw.scoreNaturalness(sampleText, { keywords })));
rows.push(bench("module similarity(x12) ", ITERS, () => sim.findMostSimilar(sampleText, corpus)));
rows.push(bench("module policy countText", ITERS, () => pp.countText("X", sampleText)));

async function benchAsync(label, iters, fn) {
  for (let i = 0; i < Math.min(5, iters); i++) await fn(i);
  const t0 = now();
  for (let i = 0; i < iters; i++) await fn(i);
  const total = now() - t0;
  return { label, iters, totalMs: round(total), avgMs: round(total / iters) };
}

// ── Report ──────────────────────────────────────────────────────────────
console.log(`\nGeneration benchmark — ${ITERS} iterations/case, mock provider (no network)\n`);
console.log("case                          iters     total(ms)    avg(ms)");
console.log("-".repeat(64));
for (const r of rows) {
  console.log(
    `${r.label.padEnd(30)}${String(r.iters).padStart(5)}${String(r.totalMs).padStart(12)}${String(r.avgMs).padStart(11)}`
  );
}

// Before vs after delta per platform
console.log("\nBefore→after overhead (full pipeline − baseline core), per post:");
for (const platform of PLATFORMS) {
  const base = rows.find((r) => r.label === `baseline core      ${platform}`);
  const full = rows.find((r) => r.label === `full pipeline      ${platform}`);
  if (base && full) {
    const delta = round(full.avgMs - base.avgMs);
    console.log(`  ${platform.padEnd(10)} baseline ${String(base.avgMs).padStart(7)}ms → full ${String(full.avgMs).padStart(7)}ms  (+${delta}ms)`);
  }
}
console.log("");
process.exit(0);
