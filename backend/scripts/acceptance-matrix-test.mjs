/**
 * P3 — 30-case acceptance matrix (no live providers).
 *
 * Exercises the end-to-end generation pipeline against a real test DB with the
 * MOCK provider (no OPENROUTER_API_KEY), plus targeted module checks, covering
 * the master-prompt acceptance areas:
 *   A. Identity isolation (no foreign URL / domain / business-name leakage)
 *   B. Functional CTA payloads (real per-platform link capability)
 *   C. Natural writing (no templated openings / clichés / robotic / stuffing)
 *   D. Website-specific brand voice (distinct per site)
 *   E. Platform limits (char + hashtag policy, placement/method aware)
 *   F. Stale-policy handling (honest freshness, no live-check claim)
 *   G. Generation performance (measured per-stage latency, voice cache reuse)
 *
 * Run: DATABASE_URL="file:./test.db" npm run test:acceptance
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./test.db";
delete process.env.OPENROUTER_API_KEY; // force deterministic mock/template path

const {
  generateAutoPosterSuite,
  buildPostPolicy,
} = await import("../src/services/autoPosterService.js");
const nw = await import("../src/content/naturalWriting.js");
const bv = await import("../src/services/brandVoice.js");
const pp = await import("../src/content/platformPolicy.js");
const { buildCta, buildGbpCallToAction } = await import("../src/services/ctaEngine.js");
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

let n = 0, passed = 0, failed = 0;
function T(label, cond, detail = "") {
  n++;
  if (cond) { passed++; console.log(`  \u2713 [${String(n).padStart(2, "0")}] ${label}`); }
  else { failed++; console.error(`  \u2717 [${String(n).padStart(2, "0")}] ${label}${detail ? ` — ${detail}` : ""}`); }
}

const PLATFORMS = ["Facebook", "Instagram", "LinkedIn", "GMB", "X", "Pinterest"];
const uniq = `acc-${Date.now()}`;
const email = `${uniq}@example.test`;
const ROOF_ORIGIN = "https://roofpro.example";
const CLINIC_ORIGIN = "https://careprime.example";

async function seed() {
  const pkg = await prisma.package.upsert({
    where: { slug: "acc-free" },
    update: {},
    create: { slug: "acc-free", name: "Acc Free", monthlyCredits: 1000 },
  });
  const user = await prisma.user.create({
    data: {
      email,
      name: "Tester Account",
      packageId: pkg.id,
      emailVerified: true,
      phoneVerified: true,
      accountStatus: "active",
    },
  });
  const roof = await prisma.clientWorkspace.create({
    data: { userId: user.id, name: "RoofPro", websiteUrl: ROOF_ORIGIN, location: "Denver, CO" },
  });
  // A SECOND, foreign business owned by the same user — must never leak in.
  await prisma.clientWorkspace.create({
    data: { userId: user.id, name: "Zephyr Dental Group", websiteUrl: CLINIC_ORIGIN },
  });
  await prisma.user.update({ where: { id: user.id }, data: { activeWorkspaceId: roof.id } });
  return { user, roofWid: roof.id };
}

async function cleanup(userId) {
  await prisma.studioPost.deleteMany({ where: { userId } });
  await prisma.clientWorkspace.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

function roofPages() {
  return [
    {
      url: `${ROOF_ORIGIN}/roof-repair`,
      title: "Roof Repair Experts",
      writingIntent: "Awareness",
      keywords: { primary: "roof repair", secondaryKeywords: ["roof replacement", "storm damage", "gutter repair", "shingle repair"] },
    },
  ];
}

async function main() {
  const { user, roofWid } = await seed();
  try {
    /* ── Integration run #1 (roofing) ──────────────────────────────────── */
    console.log("Integration run #1 — roofing site, all platforms (mock provider):");
    const r1 = await generateAutoPosterSuite({
      email,
      workspaceId: roofWid,
      websiteUrl: ROOF_ORIGIN,
      location: "Denver, CO",
      pages: roofPages(),
      platforms: PLATFORMS,
      includeImages: false,
    });

    T("suite returns ok with posts", r1.ok && Array.isArray(r1.posts) && r1.posts.length > 0, JSON.stringify(r1.error || ""));
    const byPlatform = Object.fromEntries(r1.posts.map((p) => [p.platform, p]));

    // D. website-specific brand voice
    T("brand voice attached to suite result", !!r1.brandVoice?.voiceId);
    T("roofing site → home/trade industry voice", /home|trade/i.test(r1.brandVoice?.industry || ""), r1.brandVoice?.industry);

    // G. performance: measured metrics + per-stage
    T("suite reports measured total latency (ms)", typeof r1.metrics?.totalMs === "number" && r1.metrics.totalMs >= 0);
    T("suite reports brand_voice stage timing", (r1.metrics?.stages || []).some((s) => s.stage === "brand_voice"));
    T("per-post timings aggregated by stage (ai_text)", !!r1.metrics?.perPost?.byStage?.ai_text);

    // B. functional CTA payloads
    const gmb = byPlatform.GMB;
    T("GMB post present", !!gmb);
    if (gmb) {
      T("GMB CTA is a native button", gmb.ctaInfo?.linkCapability === "native_button");
      const payload = buildGbpCallToAction(gmb.ctaInfo);
      T("GMB CTA yields a valid localPost payload (actionType present)", !!payload && !!payload.actionType);
    }
    T("Instagram CTA is a profile link (caption not clickable)", byPlatform.Instagram?.ctaInfo?.linkCapability === "profile_link");
    T("Facebook CTA is a clickable body link", byPlatform.Facebook?.ctaInfo?.linkCapability === "body_link");

    // A. identity isolation — no foreign domain or sibling business name leaks
    let leaked = null;
    for (const p of r1.posts) {
      if (/zephyr/i.test(p.content)) leaked = `${p.platform}: sibling business name`;
      if (/careprime\.example/i.test(p.content)) leaked = `${p.platform}: foreign domain`;
    }
    T("no sibling business name / foreign domain leaks into any post", leaked === null, leaked || "");
    T("non-GMB posts never contain another site's URL", r1.posts.filter((p) => p.platform !== "GMB").every((p) => {
      const urls = (p.content.match(/https?:\/\/[^\s]+/g) || []);
      return urls.every((u) => u.includes("roofpro.example"));
    }));

    // C. natural writing — no templated opening on social bodies
    const socialPosts = r1.posts.filter((p) => !["GMB"].includes(p.platform));
    T("no social post opens with a generic template line", socialPosts.every((p) => nw.detectGenericOpening(p.content) === null));
    T("social posts carry a naturalness score", socialPosts.every((p) => typeof p.validation?.naturalness?.score === "number"));
    T("GMB post carries a naturalness score", typeof gmb?.validation?.naturalness?.score === "number");

    // E. platform limits — policy block + accurate counts
    T("every post has a policy block with char count + method", r1.posts.every((p) => p.policy && typeof p.policy.charCount === "number" && p.policy.countMethod));
    T("X post respects the 280-char policy limit", (() => {
      const x = byPlatform.X; if (!x) return false;
      return pp.countText("X", x.content).count <= 280;
    })());
    T("GMB policy honestly reports hashtags as unsupported (not a 5-tag rule)", gmb?.policy?.hashtags?.supported === false);
    T("Instagram policy enforces a documented 30-hashtag ceiling", byPlatform.Instagram?.policy?.hashtags && (byPlatform.Instagram.policy.hashtags.max === 30 || byPlatform.Instagram.policy.hashtags.overLimit === false));

    // first run: nothing to duplicate yet
    T("first-run social posts are NOT flagged as duplicates", socialPosts.every((p) => p.validation?.similarity ? p.validation.similarity.duplicate === false : true));

    /* ── Integration run #2 (same roofing inputs) — similarity should fire ─ */
    console.log("\nIntegration run #2 — identical inputs (recent-post similarity):");
    const r2 = await generateAutoPosterSuite({
      email,
      workspaceId: roofWid,
      websiteUrl: ROOF_ORIGIN,
      location: "Denver, CO",
      pages: roofPages(),
      platforms: PLATFORMS,
      includeImages: false,
    });
    T("second run ok", r2.ok && r2.posts.length > 0);
    const r2Social = r2.posts.filter((p) => !["GMB"].includes(p.platform));
    T("second-run posts detect meaningful duplication vs recent posts",
      r2Social.some((p) => p.validation?.similarity?.duplicate === true));
    T("similarity records a comparison score", r2Social.every((p) => typeof p.validation?.similarity?.maxScore === "number"));

    /* ── Integration run #3 (clinic) — distinct voice per website ───────── */
    console.log("\nIntegration run #3 — different website (distinct brand voice):");
    const r3 = await generateAutoPosterSuite({
      email,
      workspaceId: roofWid,
      websiteUrl: CLINIC_ORIGIN,
      location: "Dhaka",
      pages: [
        {
          url: `${CLINIC_ORIGIN}/dermatology`,
          title: "Dermatology Clinic",
          writingIntent: "Awareness",
          keywords: { primary: "dermatology care", secondaryKeywords: ["skin treatment", "acne clinic", "cosmetic dermatology", "eczema care"] },
        },
      ],
      platforms: ["Facebook", "GMB"],
      includeImages: false,
    });
    T("clinic run ok", r3.ok && r3.posts.length > 0);
    T("clinic site → medical-industry voice", /medical|health/i.test(r3.brandVoice?.industry || ""), r3.brandVoice?.industry);
    T("roofing vs clinic get DISTINCT voiceIds", r1.brandVoice?.voiceId !== r3.brandVoice?.voiceId);

    /* ── Module-level matrix (units) ───────────────────────────────────── */
    console.log("\nModule-level acceptance checks:");
    // F. stale policy handling — honest, never a live-check claim
    T("policy registry never claims a live check", Object.values(pp.PLATFORM_POLICIES).every((p) => p.verificationMethod === "manual-reference"));
    T("stale policy is flagged honestly (far-future clock)", pp.isPolicyStale("GMB", new Date("2099-01-01")) === true);
    T("fresh policy not flagged stale (at documentation date)", pp.policyFreshness("GMB", new Date("2025-06-02")).stale === false);
    T("freshness report carries honest 'not fetched live' note", /not fetched live/i.test(pp.policyFreshnessReport().note));

    // B. CTA cross-site safety (no fabricated/foreign button)
    const crossCta = buildCta({ platform: "GMB", gmbLabel: "BOOK", destinationUrl: "https://evil.com/book", businessOrigin: ROOF_ORIGIN });
    T("cross-site GMB destination yields NO native button", buildGbpCallToAction(crossCta) === null);

    // C. humanize preserves facts while removing robot tells
    const h = nw.humanizeDraft("Here is a clear update from our team. We offer world-class roof repair for 500 dollars. Furthermore, we are licensed.", { primary: "roof repair", seed: "m" });
    T("humanize preserves verified facts (price + license)", /500 dollars/.test(h) && /licensed/.test(h));
    T("humanize removes clichés + robotic transitions", !/world-class/i.test(h) && !/\bFurthermore\b/.test(h));

    // D. brand voice isolation — block for one site excludes another's terms
    const vb = bv.buildVoicePromptBlock(r1.brandVoice ? bv.deriveBrandVoice({ origin: ROOF_ORIGIN, keywords: { primary: "roof repair" }, pages: [] }) : null, "Facebook");
    T("brand-voice prompt block is site-specific (no dental terms in roof voice)", !/dental|dermatology/i.test(vb));

    // E. policy-aware counting via serialized helper
    const polX = buildPostPolicy("X", "check https://roofpro.example/a/very/long/path?x=1 now");
    T("buildPostPolicy uses X weighted counting for URLs", polX.countMethod === "x-weighted" && polX.charCount <= 280);

    console.log(`\n${passed}/${n} passed, ${failed} failed\n`);
  } finally {
    await cleanup(user.id);
    await prisma.$disconnect();
  }
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try { await cleanup((await prisma.user.findUnique({ where: { email } }))?.id); } catch {}
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
