/**
 * Shared crawl infrastructure used by the website-intelligence pipeline.
 *
 * Three concerns live here so the analyzers stay focused on extraction:
 *   1. SSRF-safe fetching  — resolve the host, reject private / loopback /
 *      link-local targets, cap redirects, body size and processing time.
 *   2. Bounded concurrency — a reusable worker pool so hundreds of pages are
 *      fetched in parallel without unbounded Promise.all() or one slow page
 *      stalling an entire fixed batch.
 *   3. TTL cache           — a tiny in-process cache so a repeat analysis can
 *      reuse valid results instead of re-crawling everything.
 *
 * No new dependencies: only Node built-ins (dns/promises, net).
 */
import dns from "dns/promises";
import net from "net";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (compatible; AvonixSocialBot/1.0; +https://social.avonixai.com)";

const FETCH_TIMEOUT_MS = Number(process.env.SITE_FETCH_TIMEOUT_MS || 10000);
const MAX_REDIRECTS = Number(process.env.SITE_MAX_REDIRECTS || 5);
const MAX_RESPONSE_BYTES = Number(process.env.SITE_MAX_RESPONSE_BYTES || 3_000_000);
// Allow disabling the SSRF guard for trusted local test servers only.
const SSRF_GUARD_DISABLED = process.env.SITE_SSRF_GUARD_DISABLED === "1";

/* ────────────────────────────────────────────────────────────────────────
 * 1. SSRF protection
 * ──────────────────────────────────────────────────────────────────────── */

/** True when an IP literal points at a private / loopback / link-local range. */
export function isPrivateIp(ip) {
  if (!ip) return true;
  const type = net.isIP(ip);
  if (type === 4) {
    const p = ip.split(".").map(Number);
    if (p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = p;
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 0) return true; // "this" network
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (type === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    if (lower.startsWith("ff")) return true; // multicast
    // IPv4-mapped (::ffff:a.b.c.d) — unwrap and re-check
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // not a valid IP literal → treat as unsafe
}

/**
 * Validate a URL for crawling: https/http only, resolvable public host.
 * Returns { ok, reason, ip } so callers can record *why* a URL was excluded.
 */
export async function assertSafeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "unsupported-protocol" };
  }
  if (SSRF_GUARD_DISABLED) return { ok: true };

  const host = u.hostname;
  // Reject obvious internal names and bare IP literals in private ranges.
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return { ok: false, reason: "internal-host" };
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) return { ok: false, reason: "private-ip" };
    return { ok: true, ip: host };
  }
  // Resolve DNS and ensure *every* resolved address is public (defeats
  // DNS-rebinding where one record is public and another is private).
  let addresses = [];
  try {
    const results = await dns.lookup(host, { all: true });
    addresses = results.map((r) => r.address);
  } catch {
    return { ok: false, reason: "dns-failed" };
  }
  if (!addresses.length) return { ok: false, reason: "dns-empty" };
  if (addresses.some((ip) => isPrivateIp(ip))) {
    return { ok: false, reason: "private-ip" };
  }
  return { ok: true, ip: addresses[0] };
}

/**
 * SSRF-safe text fetch with manual redirect handling, body-size cap and
 * per-request timeout. Returns { ok, status, text, finalUrl, reason }.
 */
export async function safeFetchText(rawUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxBytes || MAX_RESPONSE_BYTES;
  const accept = opts.accept || "text/html,application/xml,*/*";

  let currentUrl = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safe = await assertSafeUrl(currentUrl);
    if (!safe.ok) return { ok: false, reason: safe.reason, status: 0 };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": DEFAULT_USER_AGENT, Accept: accept },
      });

      // Follow redirects ourselves so each hop is re-validated against SSRF.
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, reason: "redirect-no-location", status: res.status };
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }

      if (!res.ok) {
        return { ok: false, reason: `http-${res.status}`, status: res.status };
      }

      // Enforce body-size cap while streaming.
      const text = await readCapped(res, maxBytes);
      return { ok: true, status: res.status, text, finalUrl: currentUrl };
    } catch (err) {
      const reason = err?.name === "AbortError" ? "timeout" : "fetch-error";
      return { ok: false, reason, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, reason: "too-many-redirects", status: 0 };
}

async function readCapped(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== "function") {
    // Environments without a streaming body — fall back and truncate.
    const t = await res.text();
    return t.length > maxBytes ? t.slice(0, maxBytes) : t;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let received = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (received >= maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
  }
  out += decoder.decode();
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
 * 2. Bounded-concurrency worker pool
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Run `worker(item, index)` across `items` with at most `limit` in flight.
 * Results preserve input order. A rejected worker yields `undefined` for that
 * slot instead of aborting the whole run (so one failed page never kills the
 * job). `onProgress({ done, total })` fires after each settled item.
 */
export async function mapWithConcurrency(items, limit, worker, onProgress) {
  const list = Array.isArray(items) ? items : [...items];
  const total = list.length;
  const results = new Array(total);
  const concurrency = Math.max(1, Math.min(limit || 1, total || 1));
  let next = 0;
  let done = 0;

  async function runner() {
    while (next < total) {
      const idx = next++;
      try {
        results[idx] = await worker(list[idx], idx);
      } catch {
        results[idx] = undefined;
      } finally {
        done++;
        if (onProgress) {
          try { onProgress({ done, total }); } catch { /* ignore */ }
        }
      }
    }
  }

  const runners = Array.from({ length: concurrency }, () => runner());
  await Promise.all(runners);
  return results;
}

/* ────────────────────────────────────────────────────────────────────────
 * 3. Tiny TTL cache
 * ──────────────────────────────────────────────────────────────────────── */

const _cacheStore = new Map();
let _cacheHits = 0;
let _cacheMisses = 0;

/** Read a cached value by key; returns undefined when missing or expired. */
export function cacheGet(key) {
  const entry = _cacheStore.get(key);
  if (!entry) { _cacheMisses++; return undefined; }
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    _cacheStore.delete(key);
    _cacheMisses++;
    return undefined;
  }
  _cacheHits++;
  return entry.value;
}

/** Store a value with a TTL (ms). ttl <= 0 disables caching for that write. */
export function cacheSet(key, value, ttlMs) {
  const ttl = ttlMs == null ? Number(process.env.SITE_CACHE_TTL_MS || 15 * 60 * 1000) : ttlMs;
  if (ttl <= 0) return value;
  _cacheStore.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

/** Invalidate a single key or, with no argument, the whole cache. */
export function cacheInvalidate(key) {
  if (key === undefined) _cacheStore.clear();
  else _cacheStore.delete(key);
}

export function cacheStats() {
  const total = _cacheHits + _cacheMisses;
  return {
    size: _cacheStore.size,
    hits: _cacheHits,
    misses: _cacheMisses,
    hitRate: total ? _cacheHits / total : 0,
  };
}

export const CRAWL_DEFAULT_USER_AGENT = DEFAULT_USER_AGENT;
