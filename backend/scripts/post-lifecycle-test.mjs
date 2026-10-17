/**
 * Post lifecycle test — Edit (persist), Delete (status-aware + authz), and
 * Scheduled cancellation safety (atomic claim, no publish-after-cancel, crash
 * recovery).
 *
 * Runs the REAL services against the REAL SQLite test.db. No live publishing is
 * exercised: scheduled posts have no OAuth connection, so publishContent returns
 * ok:false locally (no network) and the scheduler reverts the post — proving the
 * atomic-claim/revert path without any external provider.
 *
 * Run: DATABASE_URL="file:./test.db" npm run test:lifecycle
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./test.db";
process.env.AUTOPOSTER_STALE_PUBLISHING_MS = "10"; // tiny lease so recovery is testable

const svc = await import("../src/services/autoPosterService.js");
const { updateStudioPostContent, deleteStudioPost, processDueScheduledPosts } = svc;
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

let passed = 0, failed = 0;
function assert(cond, label, detail = "") {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RUN = `lifecycle-${Date.now()}`;
const emA = `${RUN}-a@test.local`;
const emB = `${RUN}-b@test.local`;

let pkg, uA, uB;

function postData(over = {}) {
  return {
    userId: uA.id,
    workspaceId: "w1",
    fingerprint: `${RUN}|${Math.random().toString(36).slice(2)}`,
    websiteOrigin: "https://ex.com",
    sourceUrl: "https://ex.com/a",
    platform: "Facebook",
    tone: "Professional",
    location: "Dhaka",
    primaryKeyword: "k",
    secondaryKeyword: "s",
    generalKeywords: "[]",
    heading: "Original heading",
    content: "Original body content for the post.",
    status: "draft",
    ...over,
  };
}

async function setup() {
  pkg = await prisma.package.create({ data: { slug: `${RUN}-pkg`, name: "Test", monthlyCredits: 0 } });
  uA = await prisma.user.create({ data: { email: emA, name: "A", packageId: pkg.id } });
  uB = await prisma.user.create({ data: { email: emB, name: "B", packageId: pkg.id } });
}

async function teardown() {
  await prisma.studioPost.deleteMany({ where: { userId: { in: [uA.id, uB.id] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [uA.id, uB.id] } } }).catch(() => {});
  await prisma.package.delete({ where: { id: pkg.id } }).catch(() => {});
}

async function main() {
  await setup();

  /* ───────── Feature A — edit persists ───────── */
  console.log("Feature A — post editing:");
  const draft = await prisma.studioPost.create({ data: postData() });
  const edit1 = await updateStudioPostContent({
    email: emA, postId: draft.id, content: "Edited body v1.", heading: "Edited heading v1",
  });
  assert(edit1.ok && edit1.post.content === "Edited body v1.", "edit saves new content");
  const reload = await prisma.studioPost.findUnique({ where: { id: draft.id } });
  assert(reload.content === "Edited body v1." && reload.heading === "Edited heading v1", "edit persists in DB (survives reload)");
  const edit2 = await updateStudioPostContent({ email: emA, postId: draft.id, content: "Edited body v2." });
  assert(edit2.ok && edit2.post.content === "Edited body v2." && edit2.post.heading === "Edited heading v1", "re-edit updates content, keeps untouched heading");
  // cross-user cannot edit
  const crossEdit = await updateStudioPostContent({ email: emB, postId: draft.id, content: "hacked" });
  assert(crossEdit.ok === false && crossEdit.status === 404, "cross-user edit rejected (404, scoped)");
  // locked published cannot be edited
  const pub = await prisma.studioPost.create({ data: postData({ status: "published", locked: true, publishedAt: new Date() }) });
  const lockedEdit = await updateStudioPostContent({ email: emA, postId: pub.id, content: "x" });
  assert(lockedEdit.ok === false && lockedEdit.status === 409, "locked published post rejects edit (409)");

  /* ───────── Feature B — delete ───────── */
  console.log("\nFeature B — delete:");
  const d1 = await prisma.studioPost.create({ data: postData({ status: "draft" }) });
  const delCross = await deleteStudioPost({ email: emB, postId: d1.id });
  assert(delCross.ok === false && delCross.status === 404, "cross-user delete rejected (404)");
  const del1 = await deleteStudioPost({ email: emA, postId: d1.id });
  assert(del1.ok === true && del1.deleted, "draft deleted");
  const gone = await prisma.studioPost.findUnique({ where: { id: d1.id } });
  assert(gone === null, "deleted draft is removed from DB (not in any list)");
  const del1Again = await deleteStudioPost({ email: emA, postId: d1.id });
  assert(del1Again.ok === false && del1Again.status === 404, "re-deleting a gone post → 404");
  // published → local-only removal, honest remote note
  const pub2 = await prisma.studioPost.create({ data: postData({ status: "published", locked: true, publishedAt: new Date() }) });
  const delPub = await deleteStudioPost({ email: emA, postId: pub2.id });
  assert(delPub.ok === true && delPub.wasPublished === true && /library only/i.test(delPub.remoteNote || ""), "published delete removes local record + honest remote note");
  assert((await prisma.studioPost.findUnique({ where: { id: pub2.id } })) === null, "published local record removed");

  /* ───────── Feature C — scheduled cancellation + scheduler safety ───────── */
  console.log("\nFeature C — scheduled cancellation safety:");

  // (1) Delete a scheduled post → canceled & gone; scheduler must NOT publish it.
  const sched = await prisma.studioPost.create({ data: postData({ status: "scheduled", scheduledAt: new Date(Date.now() - 1000) }) });
  const delSched = await deleteStudioPost({ email: emA, postId: sched.id });
  assert(delSched.ok === true && delSched.wasScheduled === true, "scheduled post canceled+deleted");
  assert((await prisma.studioPost.findUnique({ where: { id: sched.id } })) === null, "canceled scheduled post removed from DB");
  const published1 = await processDueScheduledPosts();
  const schedStillGone = await prisma.studioPost.findUnique({ where: { id: sched.id } });
  assert(schedStillGone === null, "scheduler does not resurrect a deleted scheduled post");

  // (2) A due scheduled post with no OAuth connection: scheduler claims, publish
  //     is blocked locally, and the post is reverted to scheduled (never falsely
  //     published, never stuck in the transient publishing state).
  const due = await prisma.studioPost.create({ data: postData({ status: "scheduled", scheduledAt: new Date(Date.now() - 1000) }) });
  await processDueScheduledPosts();
  const dueAfter = await prisma.studioPost.findUnique({ where: { id: due.id } });
  assert(dueAfter.status === "scheduled", "unpublishable due post reverts to scheduled (not published, not stuck)");
  assert(dueAfter.publishedAt === null && dueAfter.locked === false, "unpublishable post is NOT marked published");

  // (3) Atomic claim: a post already in the transient 'publishing' state is not
  //     double-claimed, and the user cannot cancel it mid-publish.
  const claiming = await prisma.studioPost.create({ data: postData({ status: "publishing", scheduledAt: new Date(Date.now() - 1000) }) });
  const delMid = await deleteStudioPost({ email: emA, postId: claiming.id });
  assert(delMid.ok === false && delMid.status === 409, "cannot delete a post that is actively publishing (409)");

  // (4) Crash recovery: a stale 'publishing' row (lease expired) is returned to
  //     the queue so it is never orphaned.
  await sleep(30); // exceed the 10ms test lease
  await processDueScheduledPosts(); // recovery runs at the start of the tick
  const recovered = await prisma.studioPost.findUnique({ where: { id: claiming.id } });
  assert(["scheduled", "published", "draft"].includes(recovered.status) && recovered.status !== "publishing", "stale 'publishing' row recovered out of the transient state");

  await teardown();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try { await teardown(); await prisma.$disconnect(); } catch {}
  process.exit(1);
});
