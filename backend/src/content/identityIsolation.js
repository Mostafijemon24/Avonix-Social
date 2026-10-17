/**
 * P1 — Business-identity isolation.
 *
 * Guarantees a generated post NEVER leaks another website's identity into the
 * current business's copy: foreign URLs, foreign domains, or the names of other
 * businesses the same agency manages (sibling workspaces). This complements the
 * CTA engine's cross-domain destination check (ctaEngine.validateDestinationUrl)
 * and the owner-name guard (stripOwnerNameFromContent) in autoPosterService.
 *
 * Pure + dependency-free so it is fully unit-testable with no DB / network.
 */

const URL_RE = /\bhttps?:\/\/[^\s<>"')]+/gi;
const BARE_DOMAIN_RE =
  /\b(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.(?:com|net|org|io|co|dev|ai|app|biz|info|us|uk|ca|au|de|in|shop|store|clinic|health|law|care)\b/gi;

export function normalizeHost(input) {
  if (!input) return null;
  let raw = String(input).trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    return new URL(raw).host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

/** All absolute URLs found in the text. */
export function extractUrls(text) {
  const out = String(text || "").match(URL_RE) || [];
  return out.map((u) => u.replace(/[).,;:]+$/, ""));
}

/** All bare domains (no scheme) found in the text. */
export function extractBareDomains(text) {
  const out = String(text || "").match(BARE_DOMAIN_RE) || [];
  return [...new Set(out.map((d) => d.replace(/^www\./i, "").toLowerCase()))];
}

/**
 * Detect identity leakage.
 * @param {string} text
 * @param {{ownOrigin?:string, foreignNames?:string[]}} opts
 * @returns {{clean:boolean, foreignUrls:string[], foreignDomains:string[], foreignNames:string[], issues:string[]}}
 */
export function detectForeignIdentity(text, { ownOrigin = null, foreignNames = [] } = {}) {
  const body = String(text || "");
  const ownHost = normalizeHost(ownOrigin);
  const issues = [];

  const sameSite = (host) => {
    if (!ownHost || !host) return false;
    return host === ownHost || host.endsWith(`.${ownHost}`) || ownHost.endsWith(`.${host}`);
  };

  const foreignUrls = [];
  for (const u of extractUrls(body)) {
    const host = normalizeHost(u);
    if (host && !sameSite(host)) foreignUrls.push(u);
  }

  const foreignDomains = [];
  for (const d of extractBareDomains(body)) {
    // Skip domains that are part of an already-flagged full URL.
    if (foreignUrls.some((u) => u.toLowerCase().includes(d))) continue;
    if (!sameSite(d)) foreignDomains.push(d);
  }

  const leakedNames = [];
  for (const raw of foreignNames) {
    const name = String(raw || "").trim();
    if (name.length < 3) continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(body)) leakedNames.push(name);
  }

  if (ownHost && foreignUrls.length) {
    issues.push(`Contains ${foreignUrls.length} URL(s) pointing to a different website: ${foreignUrls.join(", ")}.`);
  }
  if (ownHost && foreignDomains.length) {
    issues.push(`Mentions foreign domain(s): ${foreignDomains.join(", ")}.`);
  }
  if (leakedNames.length) {
    issues.push(`Leaks another managed business name: ${leakedNames.join(", ")}.`);
  }

  return {
    clean: issues.length === 0,
    foreignUrls,
    foreignDomains,
    foreignNames: leakedNames,
    issues,
  };
}

function tidy(text) {
  return String(text || "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Remove any foreign identity (URLs, domains, sibling business names) from the
 * text. The own-site URL is preserved. Never alters verified facts.
 */
export function scrubForeignIdentity(text, { ownOrigin = null, foreignNames = [] } = {}) {
  let out = String(text || "");
  const det = detectForeignIdentity(out, { ownOrigin, foreignNames });

  for (const u of det.foreignUrls) {
    out = out.replace(new RegExp(u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "");
  }
  for (const d of det.foreignDomains) {
    out = out.replace(new RegExp(`\\b(?:www\\.)?${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "");
  }
  for (const name of det.foreignNames) {
    out = out.replace(
      new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'?s?\\b[,:;\\-]?\\s*`, "gi"),
      ""
    );
  }
  return tidy(out);
}
