/**
 * Google Sheets service — reads the "30-Day Content Plan" sheet.
 *
 * Auth: Google Service Account (server-side, read-only). Share the target
 * sheet with the service-account email (…@…iam.gserviceaccount.com) as Viewer.
 *
 * Credentials are read from backend/.env (never exposed to the frontend):
 *   GOOGLE_SA_CLIENT_EMAIL   – service account email
 *   GOOGLE_SA_PRIVATE_KEY    – private key (literal \n newlines are supported)
 *   GOOGLE_SA_KEY_FILE       – OR absolute path to the downloaded JSON key file
 *   CONTENT_SHEET_ID         – default spreadsheet ID
 *   CONTENT_SHEET_RANGE      – default A1 range (e.g. "Sheet1!A:D")
 *
 * Expected columns (header row, case/spacing-insensitive):
 *   [Row_ID] | Date | Topic / Title | Generate_Image (Yes/No) | Schedule_Time
 *
 * Row_ID is OPTIONAL but STRONGLY recommended: it is an immutable per-row
 * identity that lets a user EDIT a topic without creating a duplicate post,
 * and lets us reorder/insert rows safely. Without it we fall back to a
 * content-based identity (topic), which cannot distinguish an edit from a
 * brand-new topic.
 *
 * SECURITY: every cell is untrusted input. We sanitize (strip control chars,
 * cap length) before it ever reaches an AI prompt or the database.
 *
 * TRANSPORT: we talk to the Google Sheets REST API directly with native fetch
 * and mint the OAuth token by signing a JWT with Node's crypto (RS256). This
 * avoids pulling in the heavy googleapis/gaxios SDK (and a gaxios "Premature
 * close" failure mode seen on some Node/network stacks).
 */
import fs from "fs";
import crypto from "crypto";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const DEFAULT_RANGE = process.env.CONTENT_SHEET_RANGE || "Sheet1!A:E";
const MAX_ROWS = Number(process.env.SHEET_MAX_ROWS || 60);
const MAX_TOPIC_LEN = 300;
const MAX_CELL_LEN = 200;

/** Strip control characters and cap length — spreadsheet cells are untrusted. */
function sanitizeCell(value, maxLen = MAX_CELL_LEN) {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/** True when service-account credentials are present in the environment. */
export function isSheetsConfigured() {
  if (process.env.GOOGLE_SA_KEY_FILE) return true;
  return !!(process.env.GOOGLE_SA_CLIENT_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY);
}

/** Load { client_email, private_key } from a key file or inline env vars. */
function loadServiceAccount() {
  if (!isSheetsConfigured()) {
    throw new Error(
      "Google Sheets is not configured. Set GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY (or GOOGLE_SA_KEY_FILE) in backend/.env and share the sheet with the service-account email."
    );
  }
  if (process.env.GOOGLE_SA_KEY_FILE) {
    const json = JSON.parse(fs.readFileSync(process.env.GOOGLE_SA_KEY_FILE, "utf8"));
    if (!json.client_email || !json.private_key) {
      throw new Error("GOOGLE_SA_KEY_FILE is missing client_email or private_key.");
    }
    return { clientEmail: json.client_email, privateKey: json.private_key };
  }
  return {
    clientEmail: process.env.GOOGLE_SA_CLIENT_EMAIL,
    // Private keys stored in .env keep literal "\n"; convert back to real newlines.
    privateKey: String(process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  };
}

// Simple in-process access-token cache (tokens are valid ~1h).
let tokenCache = { token: null, exp: 0 };

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

/** Mint (and cache) an OAuth access token via a signed service-account JWT. */
async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60_000) {
    return tokenCache.token;
  }
  const { clientEmail, privateKey } = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const signingInput =
    b64url({ alg: "RS256", typ: "JWT" }) +
    "." +
    b64url({ iss: clientEmail, scope: SHEETS_SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 });
  let signature;
  try {
    signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey).toString("base64url");
  } catch {
    throw new Error("Failed to sign JWT — the service-account private key is invalid or malformed.");
  }
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google token request failed (${res.status}): ${String(data.error_description || data.error || "unknown")}`
    );
  }
  tokenCache = {
    token: data.access_token,
    exp: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

/** Normalize a header cell → canonical key for flexible column matching. */
function headerKey(cell) {
  return String(cell || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // drop "(Yes/No)" hints
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Map a header row to column indexes for the fields we care about. */
function mapHeaders(headerRow) {
  const idx = { rowId: -1, date: -1, topic: -1, generateImage: -1, scheduleTime: -1 };
  headerRow.forEach((cell, i) => {
    const key = headerKey(cell);
    if (
      idx.rowId === -1 &&
      (key === "id" || key === "row id" || key === "rowid" || key === "uid" || key === "uuid")
    )
      idx.rowId = i;
    else if (idx.date === -1 && key === "date") idx.date = i;
    else if (
      idx.topic === -1 &&
      (key.includes("topic") || key.includes("title") || key.includes("subject"))
    )
      idx.topic = i;
    else if (
      idx.generateImage === -1 &&
      (key.includes("generate image") || key.includes("image") || key.includes("generate img"))
    )
      idx.generateImage = i;
    else if (
      idx.scheduleTime === -1 &&
      (key.includes("schedule") || key.includes("time") || key.includes("publish"))
    )
      idx.scheduleTime = i;
  });
  return idx;
}

/** "Yes" / "true" / "1" / "y" → true; everything else → false. */
export function parseYesNo(value) {
  const v = String(value || "").trim().toLowerCase();
  return ["yes", "y", "true", "1", "✓", "x"].includes(v);
}

/**
 * Combine a Date cell and a Schedule_Time cell into a single JS Date.
 * Accepts common spreadsheet formats:
 *   Date: 2026-10-20 | 10/20/2026 | 20-10-2026 | Oct 20, 2026
 *   Time: 14:30 | 2:30 PM | 09:00
 *
 * Timezone: by default the date/time is interpreted in the SERVER's local
 * timezone. Pass `tzOffsetMinutes` (minutes EAST of UTC, i.e.
 * `-new Date().getTimezoneOffset()` on the client) to interpret the sheet's
 * wall-clock time in a specific zone instead — this makes "14:30" mean 14:30
 * for the user regardless of where the VPS runs.
 *
 * Returns null when nothing parseable is found.
 */
export function combineDateTime(dateStr, timeStr, tzOffsetMinutes = null) {
  const rawDate = String(dateStr || "").trim();
  const rawTime = String(timeStr || "").trim();
  if (!rawDate && !rawTime) return null;

  // 1) Parse the date part (manual parser first for deterministic day/month).
  const base = parseDatePart(rawDate);
  if (!base) {
    // Fall back to native parsing of "<date> <time>" (handles pure ISO strings).
    const native = new Date([rawDate, rawTime].filter(Boolean).join(" "));
    return Number.isNaN(native.getTime()) ? null : native;
  }

  const time = parseTimePart(rawTime);
  const hours = time ? time.hours : 0;
  const minutes = time ? time.minutes : 0;

  if (tzOffsetMinutes === null || tzOffsetMinutes === undefined || Number.isNaN(Number(tzOffsetMinutes))) {
    // Server-local interpretation.
    base.setHours(hours, minutes, 0, 0);
    return Number.isNaN(base.getTime()) ? null : base;
  }

  // Interpret the wall-clock time in the requested zone → convert to a real UTC instant.
  const utcMs = Date.UTC(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    hours,
    minutes,
    0,
    0
  );
  const instant = new Date(utcMs - Number(tzOffsetMinutes) * 60 * 1000);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function parseDatePart(raw) {
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  // dd/mm/yyyy or mm/dd/yyyy or yyyy-mm-dd with - . /
  const m = raw.match(/(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})/);
  if (!m) return null;
  let [, a, b, c] = m.map(Number);
  let year, month, day;
  if (a > 31) {
    // yyyy-mm-dd
    year = a;
    month = b;
    day = c;
  } else {
    // dd/mm/yyyy — assume day-first; swap if clearly month-first (a>12)
    year = c < 100 ? 2000 + c : c;
    if (a > 12) {
      day = a;
      month = b;
    } else {
      // ambiguous → honor US mm/dd when b looks like a day
      day = b;
      month = a;
    }
  }
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseTimePart(raw) {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const mer = (m[3] || "").toLowerCase();
  if (mer === "pm" && hours < 12) hours += 12;
  if (mer === "am" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/**
 * Fetch and parse rows from the content plan sheet.
 * @returns {Promise<{ ok, sheetId, range, headers, rows: Array }>}
 *   each row: { rowNumber, date, topic, generateImage, scheduleTime, scheduledAt }
 */
export async function fetchSheetRows({ sheetId, range, tzOffsetMinutes = null } = {}) {
  const spreadsheetId = sheetId || process.env.CONTENT_SHEET_ID;
  const a1Range = range || DEFAULT_RANGE;
  if (!spreadsheetId) {
    throw new Error("No sheetId provided and CONTENT_SHEET_ID is not set in backend/.env.");
  }
  // Basic shape validation — reject obviously malformed spreadsheet IDs.
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(spreadsheetId)) {
    throw new Error("Invalid spreadsheet ID format.");
  }

  const token = await getAccessToken();
  const url =
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(a1Range)}` +
    `?valueRenderOption=FORMATTED_VALUE`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = payload?.error?.message || `HTTP ${res.status}`;
    if (res.status === 403) {
      throw new Error(
        `Sheet access denied (403). Share the sheet with the service-account email as Viewer. (${msg})`
      );
    }
    if (res.status === 404) {
      throw new Error(`Spreadsheet or range not found (404). Check CONTENT_SHEET_ID and range. (${msg})`);
    }
    throw new Error(`Google Sheets read failed: ${msg}`);
  }

  const values = payload.values || [];
  if (values.length < 2) {
    return {
      ok: true,
      sheetId: spreadsheetId,
      range: a1Range,
      headers: values[0] || [],
      rows: [],
      hasRowId: false,
      truncated: false,
      totalDataRows: Math.max(0, values.length - 1),
    };
  }

  const [headerRow, ...dataRows] = values;
  const idx = mapHeaders(headerRow);
  if (idx.date === -1 && idx.topic === -1) {
    throw new Error(
      'Could not find expected columns. Ensure the first row has headers like "Row_ID", "Date", "Topic / Title", "Generate_Image (Yes/No)", "Schedule_Time".'
    );
  }

  const rows = [];
  const seenRowIds = new Set();
  dataRows.forEach((cells, i) => {
    const topic = idx.topic >= 0 ? sanitizeCell(cells[idx.topic], MAX_TOPIC_LEN) : "";
    // Skip visually-empty rows (no topic to generate from).
    if (!topic) return;

    const date = idx.date >= 0 ? sanitizeCell(cells[idx.date], 40) : "";
    const scheduleTime = idx.scheduleTime >= 0 ? sanitizeCell(cells[idx.scheduleTime], 40) : "";
    const generateImage = idx.generateImage >= 0 ? parseYesNo(cells[idx.generateImage]) : false;

    let rowId = idx.rowId >= 0 ? sanitizeCell(cells[idx.rowId], 64) : "";
    // Guard against duplicate Row_IDs in the sheet (user error) → treat as empty.
    if (rowId && seenRowIds.has(rowId)) rowId = "";
    if (rowId) seenRowIds.add(rowId);

    rows.push({
      rowNumber: i + 2, // +2: 1-based sheet rows, +1 for the header
      rowId: rowId || null,
      date,
      topic,
      generateImage,
      scheduleTime,
      scheduledAt: combineDateTime(date, scheduleTime, tzOffsetMinutes),
      hasScheduleText: !!(date || scheduleTime),
    });
  });

  const truncated = rows.length > MAX_ROWS;
  return {
    ok: true,
    sheetId: spreadsheetId,
    range: a1Range,
    headers: headerRow,
    rows: truncated ? rows.slice(0, MAX_ROWS) : rows,
    hasRowId: idx.rowId >= 0,
    truncated,
    totalDataRows: rows.length,
    maxRows: MAX_ROWS,
  };
}
