/**
 * 30-Day Automated Post Generation & Scheduling — orchestrator.
 *
 * This module is split into two independent phases so the user stays in control:
 *
 *   PHASE 1 — SYNC (syncSheetOnly):
 *     Read the plan from Google Sheets and store a lightweight "skeleton" post
 *     per (row × selected platform). No AI is called yet — the user can preview
 *     the whole calendar in the table first. Skeletons are status "draft" with
 *     meta.generated = false.
 *
 *   PHASE 2 — GENERATE (generateSheetPosts):
 *     On demand (per-row "Generate" or a bulk "Generate Posts" button), run the
 *     existing OpenRouter pipeline to produce an SEO title + body for that post,
 *     optionally an image (ONLY when Generate_Image = Yes), and arm the schedule.
 *     Content is written PER PLATFORM, so Facebook/LinkedIn/X each read
 *     distinctly for the same topic (see PLATFORM_STYLE in autoPosterService).
 *
 * Rows with a future Schedule_Time become status "scheduled" + scheduledAt once
 * generated, so the existing cron (processDueScheduledPosts, run on an interval
 * from reminderService) publishes them live via connected OAuth accounts.
 *
 * IDENTITY / IDEMPOTENCY:
 *   - Preferred identity is an immutable Row_ID column in the sheet. With it,
 *     editing a topic UPDATES the same post (no duplicate) and reordering /
 *     inserting rows is safe.
 *   - Without Row_ID we fall back to a content-based fingerprint (topic); this
 *     cannot distinguish an edit from a new topic, so a warning is returned.
 *   - Re-syncs refresh skeletons/metadata in place and NEVER wipe already
 *     generated content (unless the topic itself changed). Already-published
 *     (locked) posts are NEVER rewritten, and removed sheet rows NEVER delete
 *     existing posts.
 *   - Concurrent syncs/generations for the same user are rejected (in-memory
 *     lock) so two parallel requests cannot create duplicates.
 *
 * BILLING NOTE: this mirrors the existing bulk generator (generateAutoPosterSuite),
 * which does not deduct credits at generation time. We intentionally do NOT invent
 * new billing semantics here. See the audit report / README for the open decision.
 */
import crypto from "crypto";
import prisma from "../db.js";
import { fetchSheetRows, isSheetsConfigured } from "./googleSheetsService.js";
import {
  PLATFORM_CONFIG,
  TONE_PRESETS,
  generatePostContentWithAi,
  generateStudioImage,
  serializePost,
} from "./autoPosterService.js";
import { selectBestStudioProviders } from "./studioProviderRouter.js";

const SHEET_ORIGIN_PREFIX = "sheet:";

/** In-memory per-user lock — prevents concurrent sync/generate creating dupes. */
const activeSyncs = new Set();

async function resolveUser(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return { ok: false, status: 400, error: "Email is required" };
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return { ok: false, status: 404, error: "User not found" };
  return { ok: true, user, email: normalized };
}

/**
 * Stable identity for a sheet row.
 * - With an immutable Row_ID → survives topic edits and row reordering.
 * - Without it → content-based (topic); edits look like new rows.
 */
function sheetFingerprint(spreadsheetId, platform, row) {
  const key = row.rowId
    ? `${SHEET_ORIGIN_PREFIX}${spreadsheetId}|${platform}|row:${row.rowId}`
    : `${SHEET_ORIGIN_PREFIX}${spreadsheetId}|${platform}|${String(row.topic || "")
        .toLowerCase()
        .trim()}`;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

/**
 * Normalize the requested platforms into a de-duplicated list of valid ones.
 * Accepts an array (`platforms`) and/or a single `platform` for back-compat.
 * Each sheet row fans out to one post per selected platform.
 */
function pickPlatforms(platforms, platform) {
  let list = Array.isArray(platforms) ? platforms : [];
  if (!list.length && platform) list = [platform];
  list = [...new Set(list.map((p) => String(p || "").trim()).filter((p) => PLATFORM_CONFIG[p]))];
  return list.length ? list : ["Facebook"];
}

function pickTone(tone) {
  const t = String(tone || "").trim();
  return TONE_PRESETS.includes(t) ? t : TONE_PRESETS[0];
}

/** Keep returned errors short + non-sensitive. */
function safeError(message) {
  return String(message || "Unknown error").slice(0, 200);
}

const norm = (s) => String(s || "").toLowerCase().trim();

/** Merge a patch into a post's generalKeywords JSON meta, preserving keywords. */
function packMeta(existingRaw, patch) {
  let base = {};
  try {
    const v = JSON.parse(existingRaw || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) base = v;
  } catch {
    /* ignore malformed meta */
  }
  return JSON.stringify({ ...base, ...patch });
}

/** Read the meta object back out of a post's generalKeywords JSON. */
function readMeta(post) {
  try {
    const v = JSON.parse(post.generalKeywords || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {
    /* ignore */
  }
  return {};
}

/** Ask the provider router for the best writing/image models for this batch. */
async function pickProviderModels({ sheetId, location, includeImages, imageSource }) {
  const decision = await selectBestStudioProviders({
    websiteUrl: `https://docs.google.com/spreadsheets/d/${sheetId}`,
    location,
    masterIntent: "30-day content calendar",
    dominantIntent: "Awareness",
    includeImages,
    forceImageSource: imageSource,
  });
  return {
    decision,
    writingModel: decision?.writing?.model,
    imageModel: decision?.image?.model,
  };
}

/* ────────────────────────────── PHASE 1: SYNC ────────────────────────────── */

/**
 * Sync the Google Sheet and store/refresh a skeleton post per (row × platform).
 * NO AI is called here — content is generated later via generateSheetPosts.
 */
export async function syncSheetOnly({
  email,
  workspaceId,
  sheetId,
  range,
  platform,
  platforms,
  tone,
  location,
  autoSchedule = true,
  tzOffsetMinutes = null,
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  if (!isSheetsConfigured()) {
    return {
      ok: false,
      status: 400,
      configured: false,
      error:
        "Google Sheets is not configured on the server. Add GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY (or GOOGLE_SA_KEY_FILE) to backend/.env and share the sheet with the service-account email.",
    };
  }

  if (activeSyncs.has(auth.user.id)) {
    return {
      ok: false,
      status: 409,
      configured: true,
      error: "A sync or generation is already running for this account. Please wait for it to finish.",
    };
  }
  activeSyncs.add(auth.user.id);

  try {
    const chosenPlatforms = pickPlatforms(platforms, platform);
    const chosenTone = pickTone(tone);
    const place = String(location || "").trim().slice(0, 120);

    let sheet;
    try {
      sheet = await fetchSheetRows({ sheetId, range, tzOffsetMinutes });
    } catch (err) {
      return { ok: false, status: 502, configured: true, error: safeError(err.message) };
    }

    const warnings = [];
    if (!sheet.hasRowId) {
      warnings.push(
        "No Row_ID column found. Add an immutable Row_ID column so editing a topic updates the same post instead of creating a duplicate."
      );
    }
    if (sheet.truncated) {
      warnings.push(
        `Sheet has ${sheet.totalDataRows} rows; only the first ${sheet.maxRows} were processed (SHEET_MAX_ROWS). Raise the limit or split the sheet.`
      );
    }

    if (!sheet.rows.length) {
      return {
        ok: true,
        configured: true,
        sheetId: sheet.sheetId,
        hasRowId: sheet.hasRowId,
        platforms: chosenPlatforms,
        tone: chosenTone,
        created: 0,
        updated: 0,
        skipped: 0,
        scheduled: 0,
        drafts: 0,
        failed: 0,
        pending: 0,
        warnings,
        outcomes: [],
        posts: [],
        message: "No usable rows found in the sheet (need a header row + at least one topic).",
      };
    }

    const websiteOrigin = `${SHEET_ORIGIN_PREFIX}${sheet.sheetId}`;
    const sourceUrl = `https://docs.google.com/spreadsheets/d/${sheet.sheetId}`;

    const results = { created: 0, updated: 0, skipped: 0, pending: 0 };
    const outcomes = [];
    const savedRows = [];

    // Each sheet row fans out to one skeleton post per selected platform.
    for (const row of sheet.rows) {
      for (const chosenPlatform of chosenPlatforms) {
        const fingerprint = sheetFingerprint(sheet.sheetId, chosenPlatform, row);
        const existing = await prisma.studioPost.findFirst({
          where: { userId: auth.user.id, fingerprint },
        });

        // Never clobber a post that already went live.
        if (existing && existing.locked && existing.status === "published") {
          results.skipped += 1;
          outcomes.push({ rowNumber: row.rowNumber, rowId: row.rowId, topic: row.topic, platform: chosenPlatform, outcome: "skipped_published" });
          continue;
        }

        const existingMeta = existing ? readMeta(existing) : {};
        const wasGenerated = existingMeta.generated === true;
        const topicChanged = existing ? norm(existing.primaryKeyword) !== norm(row.topic) : false;
        const preserveGenerated = wasGenerated && !topicChanged;

        // Planned schedule (for display + later arming). Note vs real instant.
        let scheduleNote = null;
        if (autoSchedule && row.hasScheduleText && !row.scheduledAt) scheduleNote = "schedule_unparseable";
        else if (autoSchedule && row.scheduledAt && row.scheduledAt.getTime() <= Date.now()) scheduleNote = "schedule_in_past";
        const plannedScheduleAt = row.scheduledAt ? row.scheduledAt.toISOString() : null;

        const base = baseData({ row, chosenPlatform, chosenTone, place, websiteOrigin, sourceUrl, sheet });
        const sharedMeta = {
          generateImage: !!row.generateImage,
          plannedScheduleAt,
          autoSchedule: !!autoSchedule,
          scheduleNote,
        };

        let saved;
        if (preserveGenerated) {
          // Keep generated content/image/status — just refresh metadata.
          saved = await upsertPost({
            existing,
            userId: auth.user.id,
            base,
            overrides: {
              status: existing.status,
              scheduledAt: existing.scheduledAt,
              heading: existing.heading,
              content: existing.content,
              contentHtml: existing.contentHtml,
              imageUrl: existing.imageUrl,
              extraMeta: { ...sharedMeta, generated: true },
            },
          });
          results.updated += 1;
          outcomes.push({ rowNumber: row.rowNumber, rowId: row.rowId, topic: row.topic, platform: chosenPlatform, outcome: "synced_kept_generated" });
        } else {
          // New row, previously-ungenerated skeleton, or topic edited → (re)seed skeleton.
          saved = await upsertPost({
            existing,
            userId: auth.user.id,
            base,
            overrides: {
              status: "draft",
              scheduledAt: row.scheduledAt || null,
              heading: row.topic,
              content: "",
              contentHtml: "",
              imageUrl: topicChanged ? null : existing?.imageUrl ?? null,
              extraMeta: { ...sharedMeta, generated: false },
            },
          });
          if (existing) results.updated += 1;
          else results.created += 1;
          results.pending += 1;
          outcomes.push({
            rowNumber: row.rowNumber,
            rowId: row.rowId,
            topic: row.topic,
            platform: chosenPlatform,
            outcome: existing ? (topicChanged ? "synced_topic_changed" : "synced") : "synced_new",
            ...(scheduleNote ? { note: scheduleNote } : {}),
          });
        }
        savedRows.push(saved);
      }
    }

    return {
      ok: true,
      configured: true,
      sheetId: sheet.sheetId,
      hasRowId: sheet.hasRowId,
      platforms: chosenPlatforms,
      tone: chosenTone,
      ...results,
      scheduled: 0,
      drafts: results.pending,
      failed: 0,
      warnings,
      outcomes,
      posts: savedRows.map(serializePost),
      message: `Synced ${savedRows.length} row(s). Click "Generate" on a row (or "Generate Posts" for all) to create the content.`,
    };
  } finally {
    activeSyncs.delete(auth.user.id);
  }
}

/* ──────────────────────────── PHASE 2: GENERATE ──────────────────────────── */

/**
 * Core generation for a single already-synced post record.
 * Produces platform-specific content, an optional image, arms the schedule,
 * and flips meta.generated = true. Preserves the fingerprint (idempotent).
 */
async function generateForPostRecord(post, { imageSource = "ai" } = {}) {
  const meta = readMeta(post);
  const platform = PLATFORM_CONFIG[post.platform] ? post.platform : "Facebook";
  const tone = pickTone(post.tone);
  const place = String(post.location || "").trim().slice(0, 120);
  const topic = post.primaryKeyword || meta.sourceTitle || post.heading || "";

  const { writingModel, imageModel } = await pickProviderModels({
    sheetId: (post.websiteOrigin || "").replace(SHEET_ORIGIN_PREFIX, ""),
    location: place,
    includeImages: !!meta.generateImage,
    imageSource,
  });

  // 1) Platform-specific SEO title + body.
  let gen;
  try {
    gen = await generatePostContentWithAi(
      platform,
      { primary: topic, secondary: "", general: [] },
      place,
      "",
      tone,
      { writingModel, sourceTitle: topic, writingIntent: "Awareness" }
    );
  } catch (err) {
    const updated = await prisma.studioPost.update({
      where: { id: post.id },
      data: {
        status: "failed",
        generalKeywords: packMeta(post.generalKeywords, {
          generated: false,
          lastError: safeError(err.message),
          failedStage: "content",
        }),
      },
    });
    return { post: serializePost(updated), outcome: { postId: post.id, platform, topic, outcome: "generation_failed", error: safeError(err.message) } };
  }

  // 2) Conditional image generation (ONLY when Generate_Image = Yes).
  let imageUrl = post.imageUrl || null;
  let imageError = null;
  if (meta.generateImage) {
    try {
      const img = await generateStudioImage({
        keyword: topic,
        location: place,
        platform,
        heading: gen.heading,
        imageSource,
        preferredModel: imageModel,
      });
      if (img?.url) imageUrl = img.url;
      else imageError = img?.error || "Image generation returned no URL";
    } catch (imgErr) {
      imageError = safeError(imgErr.message);
    }
  }

  // 3) Arm the schedule (future + autoSchedule → scheduled; else draft).
  const autoSchedule = meta.autoSchedule !== false;
  const planned = meta.plannedScheduleAt ? new Date(meta.plannedScheduleAt) : null;
  const hasPlanned = planned && !Number.isNaN(planned.getTime());
  let status = "draft";
  let scheduledAt = hasPlanned ? planned : null; // keep for display even if draft
  let scheduleNote = meta.scheduleNote || null;
  if (autoSchedule && hasPlanned) {
    if (planned.getTime() > Date.now()) {
      status = "scheduled";
      scheduleNote = null;
    } else {
      scheduleNote = "schedule_in_past"; // left as draft, never auto-published
    }
  }

  const updated = await prisma.studioPost.update({
    where: { id: post.id },
    data: {
      heading: gen.heading || topic,
      content: gen.content || "",
      contentHtml: gen.contentHtml || gen.content || "",
      imageUrl,
      status,
      scheduledAt,
      locked: false,
      archived: false,
      generalKeywords: packMeta(post.generalKeywords, {
        generated: true,
        imageError: imageError || null,
        scheduleNote,
        lastError: null,
        failedStage: null,
      }),
    },
  });

  return {
    post: serializePost(updated),
    outcome: {
      postId: post.id,
      platform,
      topic,
      outcome: status === "scheduled" ? "scheduled" : "generated",
      ...(imageError ? { imageError } : {}),
      ...(scheduleNote ? { note: scheduleNote } : {}),
    },
  };
}

/**
 * Generate content for one post (`postId`), a set (`postIds`), or every
 * still-pending sheet post for the user (no ids → bulk). Published/locked
 * posts are always skipped.
 */
export async function generateSheetPosts({
  email,
  workspaceId,
  sheetId,
  postId,
  postIds,
  imageSource = "ai",
  onlyPending = true,
}) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  if (activeSyncs.has(auth.user.id)) {
    return {
      ok: false,
      status: 409,
      error: "A sync or generation is already running for this account. Please wait for it to finish.",
    };
  }
  activeSyncs.add(auth.user.id);

  try {
    // Resolve the target set.
    let targets = [];
    const explicitIds = postId ? [postId] : Array.isArray(postIds) ? postIds : [];

    if (explicitIds.length) {
      targets = await prisma.studioPost.findMany({
        where: {
          id: { in: explicitIds },
          userId: auth.user.id,
          websiteOrigin: { startsWith: SHEET_ORIGIN_PREFIX },
        },
      });
    } else {
      const where = {
        userId: auth.user.id,
        websiteOrigin: sheetId ? `${SHEET_ORIGIN_PREFIX}${sheetId}` : { startsWith: SHEET_ORIGIN_PREFIX },
        archived: false,
        NOT: { status: "published" },
      };
      if (workspaceId) where.workspaceId = workspaceId;
      const all = await prisma.studioPost.findMany({ where, orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }], take: 200 });
      // onlyPending → not-yet-generated skeletons + previously failed rows.
      targets = onlyPending
        ? all.filter((p) => readMeta(p).generated !== true || p.status === "failed")
        : all;
    }

    const results = { generated: 0, scheduled: 0, drafts: 0, failed: 0, skipped: 0 };
    const outcomes = [];
    const savedRows = [];

    for (const post of targets) {
      if (post.locked && post.status === "published") {
        results.skipped += 1;
        outcomes.push({ postId: post.id, platform: post.platform, outcome: "skipped_published" });
        continue;
      }
      const { post: saved, outcome } = await generateForPostRecord(post, { imageSource });
      savedRows.push(saved);
      outcomes.push(outcome);
      if (outcome.outcome === "generation_failed") results.failed += 1;
      else {
        results.generated += 1;
        if (outcome.outcome === "scheduled") results.scheduled += 1;
        else results.drafts += 1;
      }
    }

    return {
      ok: true,
      ...results,
      requested: targets.length,
      outcomes,
      posts: savedRows,
      message:
        targets.length === 0
          ? "Nothing to generate — all selected rows are already generated."
          : `Generated ${results.generated} post(s)${results.failed ? `, ${results.failed} failed` : ""}.`,
    };
  } finally {
    activeSyncs.delete(auth.user.id);
  }
}

/**
 * Convenience: sync the sheet AND immediately generate every pending row.
 * Kept for back-compat / "do it all at once" callers.
 */
export async function syncSheetAndGenerate(params) {
  const sync = await syncSheetOnly(params);
  if (!sync.ok) return sync;
  const gen = await generateSheetPosts({
    email: params.email,
    workspaceId: params.workspaceId,
    sheetId: sync.sheetId,
    imageSource: params.imageSource || "ai",
    onlyPending: true,
  });
  if (!gen.ok) return { ...sync, generateError: gen.error };
  // Return a merged, generation-shaped summary.
  return {
    ...sync,
    created: sync.created,
    updated: sync.updated,
    skipped: sync.skipped + (gen.skipped || 0),
    scheduled: gen.scheduled || 0,
    drafts: gen.drafts || 0,
    failed: gen.failed || 0,
    outcomes: gen.outcomes,
    posts: gen.posts,
  };
}

/* ─────────────────────────────── SHARED HELPERS ──────────────────────────── */

/** Build the immutable-ish base fields for a StudioPost row from a sheet row. */
function baseData({ row, chosenPlatform, chosenTone, place, websiteOrigin, sourceUrl, sheet }) {
  return {
    fingerprint: sheetFingerprint(sheet.sheetId, chosenPlatform, row),
    websiteOrigin,
    sourceUrl,
    platform: chosenPlatform,
    tone: chosenTone,
    location: place,
    primaryKeyword: row.topic,
    secondaryKeyword: "",
    _meta: {
      source: "google-sheet",
      sheetId: sheet.sheetId,
      rowId: row.rowId || null,
      rowNumber: row.rowNumber,
      sheetDate: row.date || null,
      scheduleTime: row.scheduleTime || null,
    },
  };
}

/** Create or update a StudioPost, preserving locked/published invariants. */
async function upsertPost({ existing, userId, base, overrides }) {
  const { _meta, ...fields } = base;
  const generalKeywords = JSON.stringify({
    keywords: [],
    sourceTitle: fields.primaryKeyword,
    ..._meta,
    ...(overrides.extraMeta || {}),
  });

  const data = {
    workspaceId: existing?.workspaceId ?? null,
    ...fields,
    generalKeywords,
    heading: overrides.heading,
    content: overrides.content,
    contentHtml: overrides.contentHtml ?? overrides.content ?? "",
    // Honor an explicit imageUrl override (including null to clear it).
    imageUrl: "imageUrl" in overrides ? overrides.imageUrl : existing?.imageUrl ?? null,
    status: overrides.status,
    scheduledAt: overrides.scheduledAt ?? null,
    locked: false,
    archived: false,
  };

  if (existing) {
    return prisma.studioPost.update({ where: { id: existing.id }, data });
  }
  return prisma.studioPost.create({ data: { ...data, userId } });
}

/** List all posts that originated from a Google Sheet for this user. */
export async function listSheetPosts({ email, workspaceId, sheetId }) {
  const auth = await resolveUser(email);
  if (!auth.ok) return auth;

  const where = {
    userId: auth.user.id,
    websiteOrigin: sheetId
      ? `${SHEET_ORIGIN_PREFIX}${sheetId}`
      : { startsWith: SHEET_ORIGIN_PREFIX },
  };
  if (workspaceId) where.workspaceId = workspaceId;

  const posts = await prisma.studioPost.findMany({
    where,
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: 200,
  });

  return { ok: true, posts: posts.map(serializePost) };
}

/** Lightweight status for the UI (is the server configured for Sheets?). */
export function sheetAutomationStatus() {
  return {
    ok: true,
    configured: isSheetsConfigured(),
    defaultSheetId: process.env.CONTENT_SHEET_ID || null,
    defaultRange: process.env.CONTENT_SHEET_RANGE || "Sheet1!A:E",
    maxRows: Number(process.env.SHEET_MAX_ROWS || 60),
  };
}
