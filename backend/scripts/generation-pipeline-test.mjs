/**
 * Batch 4 — text/image generation performance & correctness test.
 *
 * Verifies, with NO live AI / Google calls, the isolatable guarantees added in
 * Batch 4 for decoupling image generation from text generation:
 *
 *   1. Duplicate-generation guard — a concurrent run with the same request
 *      shape is rejected (so a double-click never creates two draft sets),
 *      the lock releases, and it expires after its TTL.
 *   2. Request-key identity — same inputs → same key; different platforms /
 *      pages / website → different key (no cross-request collisions).
 *   3. serializePost image state — pending/ready/failed/legacy are surfaced
 *      correctly to the client (imageStatus + imagePending).
 *   4. Real DB round-trip — the new nullable imageStatus column persists and
 *      updates through Prisma against test.db (proves the schema change is
 *      live, not just in the .prisma file).
 *
 * Run: DATABASE_URL="file:./test.db" npm run test:generation
 */
process.env.STUDIO_GENERATE_LOCK_TTL_MS = "80"; // tiny TTL so we can test expiry
process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./test.db";

const {
  buildGenerateKey,
  acquireGenerateLock,
  releaseGenerateLock,
  serializePost,
} = await import("../src/services/autoPosterService.js");

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

let passed = 0, failed = 0;
function assert(cond, label, detail = "") {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Build a row-like object serializePost accepts. */
function fakeRow(over = {}) {
  return {
    id: "row1",
    sourceUrl: "https://example.com/a",
    platform: "Facebook",
    tone: "Professional",
    location: "Dhaka",
    primaryKeyword: "web design",
    secondaryKeyword: "agency",
    generalKeywords: JSON.stringify(["agency", "studio"]),
    heading: "Heading",
    content: "Some content here with several words included.",
    contentHtml: "<p>Some content</p>",
    imageUrl: null,
    imageStatus: null,
    status: "draft",
    locked: false,
    archived: false,
    archivedAt: null,
    scheduledAt: null,
    publishedAt: null,
    fingerprint: "fp",
    websiteOrigin: "https://example.com",
    createdAt: new Date(),
    updatedAt: new Date(),
    workspaceId: null,
    ...over,
  };
}

async function main() {
  /* 1. duplicate-generation guard */
  console.log("Duplicate-generation guard:");
  const base = { userId: "u1", wid: "w1", genOrigin: "https://example.com", platforms: ["Facebook", "GMB"], prePages: [{ url: "https://example.com/a" }] };
  const key = buildGenerateKey(base);

  assert(acquireGenerateLock(key) === true, "first acquire succeeds");
  assert(acquireGenerateLock(key) === false, "concurrent duplicate is REJECTED");
  releaseGenerateLock(key);
  assert(acquireGenerateLock(key) === true, "re-acquire after release succeeds");
  // TTL expiry: hold without releasing, wait > TTL, then a stale lock is reclaimable.
  await sleep(100);
  assert(acquireGenerateLock(key) === true, "stale lock expires after TTL");
  releaseGenerateLock(key);

  /* 2. request-key identity */
  console.log("\nRequest-key identity:");
  assert(buildGenerateKey(base) === buildGenerateKey({ ...base }), "same inputs → same key");
  assert(
    buildGenerateKey(base) !== buildGenerateKey({ ...base, platforms: ["Facebook"] }),
    "different platforms → different key"
  );
  assert(
    buildGenerateKey(base) !== buildGenerateKey({ ...base, genOrigin: "https://other.com" }),
    "different website → different key"
  );
  assert(
    buildGenerateKey(base) !== buildGenerateKey({ ...base, prePages: [{ url: "https://example.com/b" }] }),
    "different pages → different key"
  );
  assert(
    buildGenerateKey(base) === buildGenerateKey({ ...base, platforms: ["GMB", "Facebook"] }),
    "platform order does not matter"
  );

  /* 3. serializePost image state */
  console.log("\nserializePost image state:");
  const pending = serializePost(fakeRow({ imageStatus: "pending" }));
  assert(pending.imageStatus === "pending" && pending.imagePending === true, "pending → imagePending true");
  const ready = serializePost(fakeRow({ imageUrl: "https://cdn/x.jpg", imageStatus: "ready" }));
  assert(ready.imageStatus === "ready" && ready.imagePending === false, "ready → imagePending false");
  const failedS = serializePost(fakeRow({ imageStatus: "failed" }));
  assert(failedS.imageStatus === "failed" && failedS.imagePending === false, "failed → not pending");
  const legacy = serializePost(fakeRow({ imageUrl: "https://cdn/legacy.jpg", imageStatus: null }));
  assert(legacy.imageStatus === "ready", "legacy post with image but no status → ready");
  const none = serializePost(fakeRow({ imageUrl: null, imageStatus: null }));
  assert(none.imageStatus === null && none.imagePending === false, "no image + no status → null");

  /* 4. real DB round-trip of the new column */
  console.log("\nDB round-trip (imageStatus column):");
  const uniq = `b4-${Date.now()}`;
  const created = await prisma.studioPost.create({
    data: {
      userId: uniq,
      workspaceId: "w1",
      fingerprint: `${uniq}|Facebook|k`,
      websiteOrigin: "https://example.com",
      sourceUrl: "https://example.com/a",
      platform: "Facebook",
      tone: "Professional",
      location: "Dhaka",
      primaryKeyword: "web design",
      secondaryKeyword: "agency",
      generalKeywords: JSON.stringify(["agency"]),
      heading: "H",
      content: "Body content words here.",
      imageUrl: null,
      imageStatus: "pending",
      status: "draft",
    },
  });
  const read = await prisma.studioPost.findUnique({ where: { id: created.id } });
  assert(read.imageStatus === "pending", "pending persisted to DB");
  const updated = await prisma.studioPost.update({
    where: { id: created.id },
    data: { imageUrl: "https://cdn/final.jpg", imageStatus: "ready" },
  });
  assert(updated.imageStatus === "ready" && updated.imageUrl === "https://cdn/final.jpg", "status transitions to ready");
  await prisma.studioPost.delete({ where: { id: created.id } });
  const gone = await prisma.studioPost.findUnique({ where: { id: created.id } });
  assert(gone === null, "cleanup removed the test row");

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
