/**
 * Batch 5 — durable background job queue test.
 *
 * Exercises the real queue (jobQueue.js) against the real SQLite test.db with
 * injected fake handlers — so every durability guarantee is verified WITHOUT
 * any live image/AI provider:
 *
 *   1. Persistent storage   — enqueue commits a row (status=queued) to the DB.
 *   2. Idempotency / dedupe — same dedupeKey never creates a second row.
 *   3. Atomic claim         — two concurrent claims never both win a job.
 *   4. Success path         — handler result + succeeded status persisted.
 *   5. Retry + backoff      — failures retry with backoff, then terminal fail.
 *   6. Transient recovery   — fail-once-then-succeed ends succeeded.
 *   7. Provider timeout     — a throwing (timed-out) handler is retried.
 *   8. Restart recovery     — crashed "running" jobs (expired lease) requeue.
 *   9. Graceful shutdown    — no new jobs are claimed once shutdown requested.
 *  10. Tenant isolation     — jobs are scoped by userId.
 *
 * Run: DATABASE_URL="file:./test.db" npm run test:jobs
 */
process.env.JOB_BACKOFF_BASE_MS = "5";
process.env.JOB_BACKOFF_MAX_MS = "40";
process.env.JOB_LEASE_MS = "60000";
process.env.DATABASE_URL = process.env.DATABASE_URL || "file:./test.db";

const q = await import("../src/services/jobQueue.js");
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

let passed = 0, failed = 0;
function assert(cond, label, detail = "") {
  if (cond) { passed++; console.log(`  \u2713 ${label}`); }
  else { failed++; console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RUN = `jqtest-${Date.now()}`;
const key = (s) => `${RUN}:${s}`;

async function cleanup() {
  await prisma.backgroundJob.deleteMany({ where: { dedupeKey: { startsWith: `${RUN}:` } } });
}

async function main() {
  await cleanup();

  /* 1. persistent storage */
  console.log("Persistent storage:");
  const { job: j1, created } = await q.enqueueJob({
    type: "noop", dedupeKey: key("a"), payload: { x: 1 }, userId: "userA", workspaceId: "w1",
  });
  assert(created === true, "enqueue reports created");
  const row1 = await prisma.backgroundJob.findUnique({ where: { id: j1.id } });
  assert(!!row1 && row1.status === "queued", "job committed to DB as queued");
  assert(row1.payload === JSON.stringify({ x: 1 }), "payload persisted");

  /* 2. idempotency / dedupe */
  console.log("\nIdempotency / dedupe:");
  const again = await q.enqueueJob({ type: "noop", dedupeKey: key("a"), payload: { x: 2 } });
  assert(again.created === false, "duplicate enqueue does NOT create a second row");
  const count = await prisma.backgroundJob.count({ where: { dedupeKey: key("a") } });
  assert(count === 1, "exactly one row for the dedupeKey");

  /* 3. atomic claim — two workers, one job */
  console.log("\nAtomic claim:");
  await cleanup();
  await q.enqueueJob({ type: "noop", dedupeKey: key("claim"), userId: "userA" });
  const [cA, cB] = await Promise.all([q.claimNextJob("A"), q.claimNextJob("B")]);
  const winners = [cA, cB].filter(Boolean);
  assert(winners.length === 1, "exactly one worker claims the job", `got ${winners.length}`);
  assert(winners[0].status === "running" && winners[0].attempts === 1, "claimed job is running, attempts=1");

  /* 4. success path */
  console.log("\nSuccess path:");
  let okCalls = 0;
  q.registerJobHandler("ok", async (payload) => { okCalls++; return { echoed: payload.v }; });
  await cleanup();
  await q.enqueueJob({ type: "ok", dedupeKey: key("ok"), payload: { v: 42 } });
  const didOk = await q.processAvailableJobs("w", 5);
  const okRow = await prisma.backgroundJob.findUnique({ where: { dedupeKey: key("ok") } });
  assert(didOk === 1 && okCalls === 1, "handler ran once");
  assert(okRow.status === "succeeded", "status succeeded");
  assert(JSON.parse(okRow.result).echoed === 42, "handler result persisted");
  assert(!!okRow.finishedAt, "finishedAt stamped");

  /* 5. retry + backoff → terminal failure */
  console.log("\nRetry + backoff → terminal:");
  q.registerJobHandler("boom", async () => { throw new Error("permanent provider failure"); });
  await cleanup();
  await q.enqueueJob({ type: "boom", dedupeKey: key("boom"), maxAttempts: 2 });
  await q.processAvailableJobs("w", 5); // attempt 1
  let boomRow = await prisma.backgroundJob.findUnique({ where: { dedupeKey: key("boom") } });
  assert(boomRow.status === "queued" && boomRow.attempts === 1, "after 1st fail: requeued, attempts=1");
  assert(new Date(boomRow.runAfter).getTime() > Date.now() - 1000, "backoff pushed runAfter forward");
  assert(/permanent provider failure/.test(boomRow.lastError || ""), "lastError recorded");
  await sleep(30); // wait out the tiny backoff
  await q.processAvailableJobs("w", 5); // attempt 2 → terminal
  boomRow = await prisma.backgroundJob.findUnique({ where: { dedupeKey: key("boom") } });
  assert(boomRow.status === "failed" && boomRow.attempts === 2, "after maxAttempts: terminal failed");

  /* 6. transient recovery — fail once then succeed */
  console.log("\nTransient recovery:");
  let flaky = 0;
  q.registerJobHandler("flaky", async () => { flaky++; if (flaky === 1) throw new Error("timeout"); return { ok: true }; });
  await cleanup();
  await q.enqueueJob({ type: "flaky", dedupeKey: key("flaky"), maxAttempts: 3 });
  await q.processAvailableJobs("w", 5); // fail
  await sleep(30);
  await q.processAvailableJobs("w", 5); // succeed
  const flakyRow = await prisma.backgroundJob.findUnique({ where: { dedupeKey: key("flaky") } });
  assert(flakyRow.status === "succeeded" && flakyRow.attempts === 2, "flaky job recovered after retry");

  /* 7. provider timeout counts as a retryable failure (covered by boom/flaky throws) */
  console.log("\nProvider timeout:");
  assert(flaky === 2, "timed-out (throwing) handler was retried, not dropped");

  /* 8. restart recovery — crashed running jobs with expired lease */
  console.log("\nRestart recovery:");
  await cleanup();
  const crashed = await prisma.backgroundJob.create({
    data: {
      type: "ok", dedupeKey: key("crashed"), status: "running",
      attempts: 1, maxAttempts: 5, lockedBy: "dead-worker",
      leaseExpiresAt: new Date(Date.now() - 10_000), startedAt: new Date(Date.now() - 20_000),
    },
  });
  const poison = await prisma.backgroundJob.create({
    data: {
      type: "boom", dedupeKey: key("poison"), status: "running",
      attempts: 5, maxAttempts: 5, lockedBy: "dead-worker",
      leaseExpiresAt: new Date(Date.now() - 10_000),
    },
  });
  const rec = await q.recoverStuckJobs();
  assert(rec.requeued === 1 && rec.failed === 1, "recovery requeued 1, failed 1 poison");
  const crashedRow = await prisma.backgroundJob.findUnique({ where: { id: crashed.id } });
  const poisonRow = await prisma.backgroundJob.findUnique({ where: { id: poison.id } });
  assert(crashedRow.status === "queued" && !crashedRow.lockedBy, "interrupted job requeued & lease cleared");
  assert(poisonRow.status === "failed", "crash-looping job terminated after maxAttempts");

  /* 9. graceful shutdown — no new claims */
  console.log("\nGraceful shutdown:");
  await cleanup();
  await q.enqueueJob({ type: "ok", dedupeKey: key("shut"), userId: "userA" });
  q.requestShutdown();
  const claimedWhileDown = await q.claimNextJob("w");
  assert(claimedWhileDown === null, "no job claimed while shutting down");
  assert(q.isShuttingDown() === true, "shutdown flag set");
  q.__resetShutdownForTests();
  assert(q.isShuttingDown() === false, "shutdown flag reset");

  /* 10. tenant isolation */
  console.log("\nTenant isolation:");
  await cleanup();
  await q.enqueueJob({ type: "noop", dedupeKey: key("ua"), userId: "userA" });
  await q.enqueueJob({ type: "noop", dedupeKey: key("ub"), userId: "userB" });
  const aOnly = await prisma.backgroundJob.findMany({ where: { userId: "userA", dedupeKey: { startsWith: `${RUN}:` } } });
  assert(aOnly.length === 1 && aOnly[0].userId === "userA", "query scoped to userId returns only that tenant");

  /* 11. stale-worker completion guard (F1) — a worker whose lease expired and
   *     whose job was reclaimed by another worker must NOT overwrite state. */
  console.log("\nStale-worker guard (F1):");
  await cleanup();
  let staleRan = 0;
  q.registerJobHandler("stale", async () => { staleRan++; return { ok: true }; });
  await q.enqueueJob({ type: "stale", dedupeKey: key("stale") });
  const claimedByA = await q.claimNextJob("workerA");
  assert(claimedByA && claimedByA.lockedBy === "workerA", "workerA claimed the job");
  // Simulate workerB reclaiming after A's lease expired.
  await prisma.backgroundJob.update({
    where: { id: claimedByA.id },
    data: { lockedBy: "workerB", attempts: 2, status: "running", leaseExpiresAt: new Date(Date.now() + 60000) },
  });
  const outcome = await q.runClaimedJob(claimedByA); // A finishes late
  const afterStale = await prisma.backgroundJob.findUnique({ where: { id: claimedByA.id } });
  assert(outcome.applied === false, "stale worker's completion is REFUSED (applied=false)");
  assert(afterStale.lockedBy === "workerB" && afterStale.status === "running", "newer worker's state preserved");

  /* 12. concurrent enqueue of the same dedupeKey (F2) — coalesces, no throw. */
  console.log("\nConcurrent enqueue (F2):");
  await cleanup();
  const [e1, e2] = await Promise.all([
    q.enqueueJob({ type: "noop", dedupeKey: key("race") }),
    q.enqueueJob({ type: "noop", dedupeKey: key("race") }),
  ]);
  const raceCount = await prisma.backgroundJob.count({ where: { dedupeKey: key("race") } });
  assert(raceCount === 1, "concurrent same-key enqueue creates exactly one row");
  assert(e1.job.id === e2.job.id, "both callers resolve to the same job");

  /* 13. error-message redaction (F3). */
  console.log("\nError redaction (F3):");
  const r1 = q.safeError(new Error("auth failed: Bearer ya29.AbCdEf12345tokenvalue"));
  assert(!/ya29\.AbCdEf12345tokenvalue/.test(r1) && /Bearer \[redacted\]/.test(r1), "bearer token redacted");
  const r2 = q.safeError(new Error("call https://cdn.example.com/img.png?token=SECRET123&sig=abc failed"));
  assert(!/SECRET123/.test(r2) && /\[redacted\]/.test(r2), "signed-URL query redacted");
  const r3 = q.safeError(new Error("response: access_token=sk-live-9999 denied"));
  assert(!/sk-live-9999/.test(r3), "access_token value redacted");

  /* 14. malformed payload must not crash the worker. */
  console.log("\nMalformed payload:");
  await cleanup();
  let seenPayload = null;
  q.registerJobHandler("badpayload", async (p) => { seenPayload = p; return { ok: true }; });
  await q.enqueueJob({ type: "badpayload", dedupeKey: key("bad"), payload: "{not valid json" });
  await q.processAvailableJobs("w", 5);
  const badRow = await prisma.backgroundJob.findUnique({ where: { dedupeKey: key("bad") } });
  assert(seenPayload && typeof seenPayload === "object", "handler received {} for malformed payload (no crash)");
  assert(badRow.status === "succeeded", "job with malformed payload completes");

  /* 15. cross-user authorization on the retry/list service surface (A2). */
  console.log("\nCross-user authorization (A2):");
  const { listUserJobs, retryImageJob } = await import("../src/services/autoPosterService.js");
  const emA = `jqa-${Date.now()}@t.local`;
  const emB = `jqb-${Date.now()}@t.local`;
  const pkg = await prisma.package.create({
    data: { slug: `${RUN}-pkg`, name: "Test", monthlyCredits: 0 },
  });
  const uA = await prisma.user.create({ data: { email: emA, name: "A", packageId: pkg.id } });
  const uB = await prisma.user.create({ data: { email: emB, name: "B", packageId: pkg.id } });
  const postA = await prisma.studioPost.create({
    data: {
      userId: uA.id, workspaceId: "w1", fingerprint: `${RUN}|fp`, websiteOrigin: "https://ex.com",
      sourceUrl: "https://ex.com/a", platform: "Facebook", tone: "Professional", location: "Dhaka",
      primaryKeyword: "k", secondaryKeyword: "s", generalKeywords: "[]", heading: "H", content: "body words",
      imageUrl: null, imageStatus: "failed", status: "draft",
    },
  });
  // userB cannot retry userA's post.
  const bRetry = await retryImageJob({ email: emB, postId: postA.id });
  assert(bRetry.ok === false && bRetry.status === 404, "cross-user retry rejected (404, scoped)");
  // userA can retry its own post → enqueues image:<postId>.
  const aRetry = await retryImageJob({ email: emA, postId: postA.id });
  assert(aRetry.ok === true, "owner retry succeeds");
  const jobForPost = await prisma.backgroundJob.findUnique({ where: { dedupeKey: `image:${postA.id}` } });
  assert(!!jobForPost && jobForPost.userId === uA.id, "retry enqueued a job owned by userA");
  // listUserJobs is scoped: userB sees none of userA's jobs.
  const bList = await listUserJobs({ email: emB });
  assert(bList.ok && bList.jobs.every((j) => j.resourceId !== postA.id), "userB job list excludes userA's job");
  const aList = await listUserJobs({ email: emA });
  assert(aList.ok && aList.jobs.some((j) => j.resourceId === postA.id), "userA job list includes own job");

  // cleanup A2 fixtures
  await prisma.backgroundJob.deleteMany({ where: { dedupeKey: `image:${postA.id}` } });
  await prisma.studioPost.delete({ where: { id: postA.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: uA.id } }).catch(() => {});
  await prisma.user.delete({ where: { id: uB.id } }).catch(() => {});
  await prisma.package.delete({ where: { id: pkg.id } }).catch(() => {});

  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  try { await cleanup(); await prisma.$disconnect(); } catch {}
  process.exit(1);
});
