/**
 * Batch 5 — durable background job queue.
 *
 * The database IS the queue. This is the smallest production-safe design that
 * fits the existing stack (SQLite + Prisma + a single PM2-managed Node process)
 * without introducing Redis/BullMQ or other infrastructure.
 *
 * Guarantees:
 *   • Persistent storage   — a job is committed to BackgroundJob (status=queued)
 *                            before enqueueJob() resolves. Nothing is "queued"
 *                            in memory only.
 *   • Restart recovery     — on boot, running jobs whose lease has expired
 *                            (worker crashed/killed mid-run) are requeued.
 *                            queued jobs are simply picked up again.
 *   • Idempotency          — enqueue is upsert-by-dedupeKey, so a retry or a
 *                            double request can never create a second job for
 *                            the same logical unit of work.
 *   • Atomic claim         — a job is claimed with a guarded updateMany
 *                            (status=queued → running). SQLite serialises
 *                            writes, so two concurrent workers can never both
 *                            win the same job.
 *   • Bounded retries      — exponential backoff up to maxAttempts, then a
 *                            terminal "failed" state with the last error.
 *   • Graceful shutdown    — once shutdown is requested, no new jobs are
 *                            claimed; in-flight jobs are awaited.
 *
 * Handlers are registered externally (registerJobHandler) so this module never
 * imports feature services — avoiding import cycles. A handler receives the
 * parsed payload + the job row and either resolves (success) or throws
 * (retryable failure). It must NEVER log tokens/credentials.
 */
import defaultPrisma from "../db.js";

const BASE_BACKOFF_MS = Number(process.env.JOB_BACKOFF_BASE_MS || 2000);
const MAX_BACKOFF_MS = Number(process.env.JOB_BACKOFF_MAX_MS || 5 * 60 * 1000);
const LEASE_MS = Number(process.env.JOB_LEASE_MS || 2 * 60 * 1000);
const DEFAULT_MAX_ATTEMPTS = Number(process.env.JOB_MAX_ATTEMPTS || 5);
const POLL_INTERVAL_MS = Number(process.env.JOB_POLL_INTERVAL_MS || 5000);
const BATCH_PER_TICK = Number(process.env.JOB_BATCH_PER_TICK || 5);

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

const handlers = new Map(); // type -> async (payload, job) => result

let shuttingDown = false;
let inFlight = 0;
let pollTimer = null;

/** Register a handler for a job type. Throwing from a handler triggers retry. */
export function registerJobHandler(type, fn) {
  handlers.set(type, fn);
}

export function hasJobHandler(type) {
  return handlers.has(type);
}

/** Exponential backoff with a hard cap. attempts is the number already made. */
export function backoffMs(attempts) {
  const n = Math.max(1, attempts);
  return Math.min(BASE_BACKOFF_MS * 2 ** (n - 1), MAX_BACKOFF_MS);
}

/**
 * Produce a bounded, redacted error string safe to persist in lastError and to
 * return to the owner. Strips credentials/tokens and URL query strings (signed
 * URLs often carry secrets) while keeping enough signal for operators.
 */
export function safeError(err) {
  let msg = (err && err.message ? err.message : String(err)) || "unknown error";
  // Strip URL query strings (signed URLs / tokens live there).
  msg = msg.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/gi, "$1?[redacted]");
  // Redact common secret-bearing patterns: Bearer tokens, key/token/secret params,
  // and Authorization headers. Case-insensitive; keep the field name for context.
  msg = msg.replace(/\bBearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]");
  msg = msg.replace(
    /\b(access_token|refresh_token|id_token|api[_-]?key|client_secret|authorization|token|secret|password|key)\b(\s*[:=]\s*)("?)[^\s"&,}]+/gi,
    "$1$2[redacted]"
  );
  // Long opaque blobs (e.g. JWTs) → redact.
  msg = msg.replace(/\b[A-Za-z0-9_\-]{40,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, "[redacted-token]");
  return msg.slice(0, 500);
}

/**
 * Idempotent enqueue. If a job with this dedupeKey already exists:
 *   • queued/running  → leave it (another identical request is already handled)
 *   • terminal        → re-arm it back to queued (a deliberate retry / re-run)
 * The row is always committed before this resolves.
 */
export async function enqueueJob(
  {
    type,
    dedupeKey,
    payload = {},
    userId = null,
    workspaceId = null,
    websiteOrigin = null,
    resourceId = null,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    priority = 0,
    runAfter = null,
  },
  prisma = defaultPrisma
) {
  if (!type) throw new Error("enqueueJob: type is required");
  if (!dedupeKey) throw new Error("enqueueJob: dedupeKey is required");

  const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload || {});
  const when = runAfter ? new Date(runAfter) : new Date();

  const existing = await prisma.backgroundJob.findUnique({ where: { dedupeKey } });
  if (existing) {
    if (!TERMINAL.has(existing.status)) {
      return { job: existing, created: false, rearmed: false };
    }
    // Re-arm a finished job for a fresh attempt.
    const job = await prisma.backgroundJob.update({
      where: { dedupeKey },
      data: {
        type,
        status: "queued",
        payload: payloadStr,
        attempts: 0,
        maxAttempts,
        priority,
        runAfter: when,
        lockedBy: null,
        leaseExpiresAt: null,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        result: null,
        userId,
        workspaceId,
        websiteOrigin,
        resourceId,
      },
    });
    return { job, created: false, rearmed: true };
  }

  let job;
  try {
    job = await prisma.backgroundJob.create({
    data: {
      type,
      dedupeKey,
      status: "queued",
      payload: payloadStr,
      maxAttempts,
      priority,
      runAfter: when,
      userId,
      workspaceId,
      websiteOrigin,
      resourceId,
    },
    });
    return { job, created: true, rearmed: false };
  } catch (err) {
    // Concurrent enqueue of the same dedupeKey → unique violation. Coalesce to
    // the row the other caller created instead of throwing (idempotent enqueue).
    if (err && err.code === "P2002") {
      const existingNow = await prisma.backgroundJob.findUnique({ where: { dedupeKey } });
      if (existingNow) return { job: existingNow, created: false, rearmed: false };
    }
    throw err;
  }
}

/**
 * Atomically claim the next runnable job for `workerId`. Returns the claimed
 * job row or null. The guarded updateMany (status=queued → running) is what
 * makes concurrent claims safe: only the worker whose update affects the row
 * wins; the loser simply tries the next candidate.
 */
export async function claimNextJob(workerId, prisma = defaultPrisma) {
  if (shuttingDown) return null;
  const now = new Date();

  const candidates = await prisma.backgroundJob.findMany({
    where: { status: "queued", runAfter: { lte: now } },
    orderBy: [{ priority: "desc" }, { runAfter: "asc" }],
    take: 10,
  });

  for (const candidate of candidates) {
    const lease = new Date(Date.now() + LEASE_MS);
    let claim;
    try {
      claim = await prisma.backgroundJob.updateMany({
        where: { id: candidate.id, status: "queued" },
        data: {
          status: "running",
          lockedBy: workerId,
          leaseExpiresAt: lease,
          startedAt: now,
          attempts: { increment: 1 },
        },
      });
    } catch {
      // SQLITE_BUSY or a race — treat as "didn't claim", try the next one.
      continue;
    }
    if (claim.count === 1) {
      return prisma.backgroundJob.findUnique({ where: { id: candidate.id } });
    }
  }
  return null;
}

/**
 * Conditional completion write. Only applies if THIS worker still owns the job
 * (lockedBy unchanged) AND it is still "running". If the lease expired and a
 * newer worker reclaimed the job, count === 0 and we refuse to overwrite — a
 * stale worker can never clobber a newer worker's state. Returns true if
 * applied, false if the claim was lost.
 */
async function finalizeClaimed(job, data, prisma) {
  try {
    const res = await prisma.backgroundJob.updateMany({
      where: { id: job.id, lockedBy: job.lockedBy, status: "running" },
      data,
    });
    return res.count === 1;
  } catch (err) {
    console.error("[jobs] finalize error:", safeError(err));
    return false;
  }
}

/**
 * Run a single already-claimed (status=running) job to completion:
 * success → succeeded; throw → requeue with backoff, or terminal "failed" once
 * attempts reach maxAttempts. All completion writes are guarded by
 * finalizeClaimed so an expired-lease worker cannot overwrite a reclaim.
 */
export async function runClaimedJob(job, prisma = defaultPrisma) {
  const handler = handlers.get(job.type);
  if (!handler) {
    // No handler registered — park as failed so it never spins forever.
    const applied = await finalizeClaimed(
      job,
      {
        status: "failed",
        lastError: `No handler for job type "${job.type}"`,
        finishedAt: new Date(),
        lockedBy: null,
        leaseExpiresAt: null,
      },
      prisma
    );
    return { applied, status: "failed" };
  }

  let payload = {};
  try {
    payload = JSON.parse(job.payload || "{}");
  } catch {
    payload = {};
  }

  try {
    const result = await handler(payload, job);
    const applied = await finalizeClaimed(
      job,
      {
        status: "succeeded",
        result: result === undefined ? null : JSON.stringify(result).slice(0, 2000),
        lastError: null,
        finishedAt: new Date(),
        lockedBy: null,
        leaseExpiresAt: null,
      },
      prisma
    );
    // If the claim was lost mid-run, we deliberately do NOT re-write state; the
    // reclaiming worker owns it now. (Side effects are idempotent per handler.)
    return { applied, status: "succeeded" };
  } catch (err) {
    const attempts = job.attempts; // already incremented at claim time
    const terminal = attempts >= job.maxAttempts;
    const applied = await finalizeClaimed(
      job,
      terminal
        ? {
            status: "failed",
            lastError: safeError(err),
            finishedAt: new Date(),
            lockedBy: null,
            leaseExpiresAt: null,
          }
        : {
            status: "queued",
            lastError: safeError(err),
            runAfter: new Date(Date.now() + backoffMs(attempts)),
            lockedBy: null,
            leaseExpiresAt: null,
            startedAt: null,
          },
      prisma
    );
    return { applied, status: terminal ? "failed" : "queued" };
  }
}

/** Claim + run up to `max` jobs. Returns how many were processed this tick. */
export async function processAvailableJobs(workerId, max = BATCH_PER_TICK, prisma = defaultPrisma) {
  let processed = 0;
  for (let i = 0; i < max; i++) {
    if (shuttingDown) break;
    const job = await claimNextJob(workerId, prisma);
    if (!job) break;
    inFlight += 1;
    try {
      await runClaimedJob(job, prisma);
      processed += 1;
    } finally {
      inFlight -= 1;
    }
  }
  return processed;
}

/**
 * Restart recovery: any job left "running" whose lease has expired belongs to a
 * worker that died mid-run. Requeue it. attempts was already incremented at the
 * original claim, so a job that keeps crashing still terminates after
 * maxAttempts (poison-job protection).
 */
export async function recoverStuckJobs(prisma = defaultPrisma) {
  const now = new Date();
  const stuck = await prisma.backgroundJob.findMany({
    where: { status: "running", leaseExpiresAt: { lt: now } },
    select: { id: true, attempts: true, maxAttempts: true },
  });
  let requeued = 0;
  let failed = 0;
  for (const j of stuck) {
    if (j.attempts >= j.maxAttempts) {
      await prisma.backgroundJob.update({
        where: { id: j.id },
        data: {
          status: "failed",
          lastError: "Exceeded max attempts after worker crash/recovery",
          finishedAt: now,
          lockedBy: null,
          leaseExpiresAt: null,
        },
      });
      failed += 1;
    } else {
      await prisma.backgroundJob.update({
        where: { id: j.id },
        data: {
          status: "queued",
          runAfter: now,
          lockedBy: null,
          leaseExpiresAt: null,
          startedAt: null,
        },
      });
      requeued += 1;
    }
  }
  return { requeued, failed };
}

/** Shutdown gate — used by the worker loop and by claimNextJob. */
export function requestShutdown() {
  shuttingDown = true;
}
export function isShuttingDown() {
  return shuttingDown;
}
export function inFlightCount() {
  return inFlight;
}

/** For tests only: reset the shutdown flag between scenarios. */
export function __resetShutdownForTests() {
  shuttingDown = false;
}

/**
 * Start the in-process worker: recover stuck jobs once, then poll on an
 * interval. Returns a stop() handle. Safe to call once at server bootstrap.
 */
export function startJobWorker({ workerId = `w-${process.pid}`, prisma = defaultPrisma } = {}) {
  recoverStuckJobs(prisma)
    .then((r) => {
      if (r.requeued || r.failed) {
        console.log(`[jobs] recovery: requeued ${r.requeued}, failed ${r.failed}`);
      }
    })
    .catch((err) => console.error("[jobs] recovery error:", err.message));

  const tick = () => {
    if (shuttingDown) return;
    processAvailableJobs(workerId, BATCH_PER_TICK, prisma).catch((err) =>
      console.error("[jobs] tick error:", err.message)
    );
  };

  pollTimer = setInterval(tick, POLL_INTERVAL_MS);
  if (pollTimer.unref) pollTimer.unref();
  console.log(`[jobs] worker ${workerId} started (poll ${POLL_INTERVAL_MS}ms, lease ${LEASE_MS}ms)`);

  return {
    stop: () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    },
    workerId,
  };
}

/**
 * Drain for graceful shutdown: stop claiming new work, then wait (bounded) for
 * any in-flight jobs to finish. Jobs still queued simply resume after restart.
 */
export async function drainForShutdown({ timeoutMs = 15000 } = {}) {
  requestShutdown();
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  const deadline = Date.now() + timeoutMs;
  while (inFlight > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return { inFlight };
}
