/**
 * 30-Day Automated Post Generation & Scheduling — orchestrator.
 *
 * Flow (all server-side; no API keys ever reach the browser):
 *   1. Read the plan from Google Sheets (googleSheetsService).
 *   2. For each topic, generate an SEO title + body via the existing
 *      OpenRouter pipeline (generatePostContentWithAi).
 *   3. If Generate_Image = Yes, create an image via generateStudioImage
 *      (OpenRouter gpt-image-1); otherwise skip entirely.
 *   4. Persist each item as a StudioPost. Rows with a future Schedule_Time
 *      become status "scheduled" + scheduledAt, so the existing cron
 *      (processDueScheduledPosts, run on an interval from reminderService)
 *      publishes them live via connected OAuth accounts at the right time.
 *
 * IDENTITY / IDEMPOTENCY:
 *   - Preferred identity is an immutable Row_ID column in the sheet. With it,
 *     editing a topic UPDATES the same post (no duplicate) and reordering /
 *     inserting rows is safe.
 *   - Without Row_ID we fall back to a content-based fingerprint (topic); this
 *     cannot distinguish an edit from a new topic, so a warning is returned.
 *   - Re-syncs update existing draft/scheduled posts in place. Already-published
 *     (locked) posts are NEVER rewritten, and removed sheet rows NEVER delete
 *     existing posts.
 *   - Concurrent syncs for the same user are rejected (in-memory lock) so two
 *     parallel requests cannot create duplicates.
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

/** In-memory per-user sync lock — prevents concurrent syncs creating duplicates. */
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

function pickPlatform(platform) {
  const p = String(platform || "").trim();
  return PLATFORM_CONFIG[p] ? p : "Facebook";
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

/**
 * Sync the Google Sheet, generate content (+ optional images), and store posts.
 */
export async function syncSheetAndGenerate({
  email,
  workspaceId,
  sheetId,
  range,
  platform,
  platforms,
  tone,
  location,
  imageSource = "ai",
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

  // Concurrency guard: one sync per user at a time.
  if (activeSyncs.has(auth.user.id)) {
    return {
      ok: false,
      status: 409,
      configured: true,
      error: "A sync is already running for this account. Please wait for it to finish.",
    };
  }
  activeSyncs.add(auth.user.id);

  try {
    const chosenPlatforms = pickPlatforms(platforms, platform);
    const chosenTone = pickTone(tone);
    const place = String(location || "").trim().slice(0, 120);

    // 1) Read the plan.
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
        created: 0,
        updated: 0,
        skipped: 0,
        scheduled: 0,
        drafts: 0,
        failed: 0,
        warnings,
        outcomes: [],
        posts: [],
        message: "No usable rows found in the sheet (need a header row + at least one topic).",
      };
    }

    // 2) Let the router pick the best writing + image model once for the batch.
    const includeImages = sheet.rows.some((r) => r.generateImage);
    const providerDecision = await selectBestStudioProviders({
      websiteUrl: `https://docs.google.com/spreadsheets/d/${sheet.sheetId}`,
      location: place,
      masterIntent: "30-day content calendar",
      dominantIntent: "Awareness",
      includeImages,
      forceImageSource: imageSource,
    });
    const writingModel = providerDecision?.writing?.model;
    const imageModel = providerDecision?.image?.model;

    const websiteOrigin = `${SHEET_ORIGIN_PREFIX}${sheet.sheetId}`;
    const sourceUrl = `https://docs.google.com/spreadsheets/d/${sheet.sheetId}`;

    const results = { created: 0, updated: 0, skipped: 0, scheduled: 0, drafts: 0, failed: 0 };
    const outcomes = [];
    const savedRows = [];

    // Each sheet row fans out to one post per selected platform.
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

        // 3) Generate SEO title + body through the existing OpenRouter pipeline.
        let gen;
        try {
          gen = await generatePostContentWithAi(
            chosenPlatform,
            { primary: row.topic, secondary: "", general: [] },
            place,
            "",
            chosenTone,
            { writingModel, sourceTitle: row.topic, writingIntent: "Awareness" }
          );
        } catch (err) {
          results.failed += 1;
          const saved = await upsertPost({
            existing,
            userId: auth.user.id,
            base: baseData({ row, chosenPlatform, chosenTone, place, websiteOrigin, sourceUrl, sheet }),
            overrides: {
              status: "failed",
              scheduledAt: null,
              heading: row.topic,
              content: existing?.content || "",
              contentHtml: existing?.contentHtml || "",
              extraMeta: { lastError: safeError(err.message), failedStage: "content" },
            },
          });
          savedRows.push(saved);
          outcomes.push({ rowNumber: row.rowNumber, rowId: row.rowId, topic: row.topic, platform: chosenPlatform, outcome: "generation_failed", error: safeError(err.message) });
          continue;
        }

        // 4) Conditional image generation (ONLY when Generate_Image = Yes).
        let imageUrl = existing?.imageUrl || null;
        let imageError = null;
        if (row.generateImage) {
          try {
            const img = await generateStudioImage({
              keyword: row.topic,
              location: place,
              platform: chosenPlatform,
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

        // 5) Decide schedule vs draft (with explicit past/invalid handling).
        let status = "draft";
        let scheduledAt = null;
        let scheduleNote = null;
        if (autoSchedule && row.scheduledAt) {
          if (row.scheduledAt.getTime() > Date.now()) {
            status = "scheduled";
            scheduledAt = row.scheduledAt;
          } else {
            scheduleNote = "schedule_in_past"; // left as draft, not auto-published
          }
        } else if (autoSchedule && row.hasScheduleText && !row.scheduledAt) {
          scheduleNote = "schedule_unparseable"; // left as draft
        }

        const saved = await upsertPost({
          existing,
          userId: auth.user.id,
          base: baseData({ row, chosenPlatform, chosenTone, place, websiteOrigin, sourceUrl, sheet }),
          overrides: {
            status,
            scheduledAt,
            heading: gen.heading || row.topic,
            content: gen.content || "",
            contentHtml: gen.contentHtml || gen.content || "",
            imageUrl,
            extraMeta: { imageError: imageError || null, scheduleNote },
          },
        });

        if (existing) results.updated += 1;
        else results.created += 1;
        if (status === "scheduled") results.scheduled += 1;
        else results.drafts += 1;

        savedRows.push(saved);
        outcomes.push({
          rowNumber: row.rowNumber,
          rowId: row.rowId,
          topic: row.topic,
          platform: chosenPlatform,
          outcome: existing ? "updated" : status === "scheduled" ? "scheduled" : "draft_created",
          ...(imageError ? { imageError } : {}),
          ...(scheduleNote ? { note: scheduleNote } : {}),
        });
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
      providerDecision,
      warnings,
      outcomes,
      posts: savedRows.map(serializePost),
    };
  } finally {
    activeSyncs.delete(auth.user.id);
  }
}

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
    imageUrl: overrides.imageUrl ?? existing?.imageUrl ?? null,
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
