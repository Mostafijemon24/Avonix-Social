/**
 * Google Business Profile (GBP) discovery + publish-location resolution.
 *
 * Pulled out of connectionsService / publishService so the account/location
 * enumeration logic is:
 *   • paginated   — follows nextPageToken for accounts AND locations, so users
 *                   with many accounts / locations see every one of them;
 *   • honest      — classifies auth / permission / quota / empty states instead
 *                   of silently returning a misleading stub;
 *   • safe        — the publish resolver NEVER guesses a location when several
 *                   exist and the user has not chosen one.
 *
 * `fetchImpl` is injectable so this is unit-testable against a local server
 * without live Google credentials. Defaults to global fetch.
 */

const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const BIZINFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const LOCATION_READ_MASK =
  "name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,metadata,storeCode";

// Hard safety ceilings so a pathological account set can't loop forever.
const MAX_ACCOUNTS = Number(process.env.GBP_MAX_ACCOUNTS || 100);
const MAX_LOCATIONS = Number(process.env.GBP_MAX_LOCATIONS || 500);
const MAX_PAGES = Number(process.env.GBP_MAX_PAGES || 50);

/**
 * Server-side guard: is this eligible item a real, publishable GBP location?
 * Used to reject account-only / stub items at connect time so a non-publishable
 * connection can never later drive a wrong-location publish (defense-in-depth
 * independent of the client UI).
 */
export function isPublishableGbpItem(item) {
  const meta = item?.metadata || {};
  return meta.publishable === true && !!meta.locationName;
}

/** Map an HTTP status from a Google API into an actionable reason code. */
export function classifyGoogleError(status) {
  if (status === 401) return "expired"; // token invalid/expired → reconnect
  if (status === 403) return "permission"; // scope / API not enabled / no access
  if (status === 429) return "quota"; // rate / quota exceeded
  if (status >= 500) return "google-down";
  return "error";
}

function authError(reason) {
  const messages = {
    expired: "Google authorization expired or was revoked — reconnect Google Business Profile.",
    permission:
      "Google denied access to Business Profile. Ensure the Business Profile API is enabled and the account has manage permission.",
    quota: "Google Business Profile API quota exceeded — try again shortly.",
    "google-down": "Google Business Profile API is temporarily unavailable — try again shortly.",
    error: "Could not read Google Business Profile accounts.",
  };
  const err = new Error(messages[reason] || messages.error);
  err.reason = reason;
  return err;
}

/** Paginate GET requests that return { <key>: [...], nextPageToken }. */
async function fetchAllPages(baseUrl, accessToken, listKey, fetchImpl, cap) {
  const items = [];
  let pageToken = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = pageToken
      ? `${baseUrl}${sep}pageToken=${encodeURIComponent(pageToken)}`
      : baseUrl;
    const res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      return { ok: false, status: res.status, reason: classifyGoogleError(res.status), items };
    }
    const data = await res.json();
    const batch = Array.isArray(data[listKey]) ? data[listKey] : [];
    for (const it of batch) {
      items.push(it);
      if (items.length >= cap) return { ok: true, items };
    }
    pageToken = data.nextPageToken || null;
    if (!pageToken) break;
  }
  return { ok: true, items };
}

export async function fetchAllAccounts(accessToken, fetchImpl = fetch) {
  return fetchAllPages(ACCOUNTS_URL, accessToken, "accounts", fetchImpl, MAX_ACCOUNTS);
}

export async function fetchAllLocations(accountName, accessToken, fetchImpl = fetch) {
  const base = `${BIZINFO_BASE}/${accountName}/locations?readMask=${encodeURIComponent(
    LOCATION_READ_MASK
  )}`;
  return fetchAllPages(base, accessToken, "locations", fetchImpl, MAX_LOCATIONS);
}

function formatAddress(storefrontAddress) {
  if (!storefrontAddress) return "";
  return [
    storefrontAddress.addressLines?.[0],
    storefrontAddress.locality,
    storefrontAddress.administrativeArea,
    storefrontAddress.postalCode,
  ]
    .filter(Boolean)
    .join(", ");
}

function locationEligible(acc, loc, accessToken, refreshToken, tokenExpiresAt) {
  const addr = formatAddress(loc.storefrontAddress);
  const phone = loc.phoneNumbers?.primaryPhone || loc.phoneNumbers?.primary || "";
  return {
    // accountId is the stable, unique location resource name.
    accountId: loc.name || `${acc.name}/${loc.title}`,
    accountName: loc.title || loc.name || "GBP location",
    accountUrl: loc.websiteUri || "https://business.google.com/",
    accessToken,
    refreshToken,
    tokenExpiresAt,
    metadata: {
      type: "location",
      publishable: true,
      googleAccount: acc.name,
      googleAccountName: acc.accountName || acc.name,
      locationName: loc.name, // "locations/XXXX" — the publish target
      locationId: loc.name,
      locationTitle: loc.title || "",
      storeCode: loc.storeCode || null,
      address: addr,
      phone,
      hours: loc.regularHours ? JSON.stringify(loc.regularHours) : null,
    },
  };
}

/**
 * Build the eligible list for the selection UI. Returns:
 *   { eligible: [...], warnings: [{ account, reason }] }
 * Throws (with .reason) only when the ACCOUNTS call itself fails auth — i.e.
 * we cannot proceed at all. Per-account location failures become warnings so
 * one bad account never hides the others.
 */
export async function buildGbpEligible(accessToken, { refreshToken = null, tokenExpiresAt = null, fetchImpl = fetch } = {}) {
  const accountsResult = await fetchAllAccounts(accessToken, fetchImpl);
  if (!accountsResult.ok) {
    throw authError(accountsResult.reason);
  }
  const accounts = accountsResult.items;
  const eligible = [];
  const warnings = [];

  if (!accounts.length) {
    return {
      eligible: [
        {
          accountId: "google-user",
          accountName: "Google Business (no accounts found)",
          accountUrl: "https://business.google.com/",
          accessToken,
          refreshToken,
          tokenExpiresAt,
          metadata: {
            type: "none",
            publishable: false,
            note: "No Business Profile accounts returned for this Google identity.",
          },
        },
      ],
      warnings,
    };
  }

  for (const acc of accounts) {
    const accountName = acc.name || acc.accountName || "accounts/unknown";
    const locResult = await fetchAllLocations(accountName, accessToken, fetchImpl);
    if (!locResult.ok) {
      // One account's locations failed — record it, keep going.
      warnings.push({ account: accountName, reason: locResult.reason });
      eligible.push({
        accountId: accountName,
        accountName: acc.accountName || accountName,
        accountUrl: "https://business.google.com/",
        accessToken,
        refreshToken,
        tokenExpiresAt,
        metadata: {
          type: "account",
          publishable: false,
          googleAccount: accountName,
          note: `Locations could not be read (${locResult.reason}).`,
        },
      });
      continue;
    }

    if (!locResult.items.length) {
      eligible.push({
        accountId: accountName,
        accountName: acc.accountName || accountName,
        accountUrl: "https://business.google.com/",
        accessToken,
        refreshToken,
        tokenExpiresAt,
        metadata: {
          type: "account",
          publishable: false,
          googleAccount: accountName,
          note: "No locations under this account yet.",
        },
      });
      continue;
    }

    for (const loc of locResult.items) {
      eligible.push(locationEligible(acc, loc, accessToken, refreshToken, tokenExpiresAt));
    }
  }

  return { eligible, warnings };
}

/**
 * Resolve the GBP location to publish to for a connected account.
 *
 * Rules (prevents ever silently publishing to the wrong location):
 *   1. If the connection stored a selected `locationName` → use it. (fast path)
 *   2. Else enumerate the account's locations:
 *        • exactly one  → unambiguous; use it (and the caller persists it).
 *        • more than one → THROW: the user must pick a location.
 *        • zero         → THROW: add a location in Google Business.
 *
 * @returns {Promise<{ locationName, googleAccount, locationTitle, resolvedByFallback }>}
 */
export async function resolvePublishableLocation(meta, accessToken, fetchImpl = fetch) {
  if (meta?.locationName) {
    return {
      locationName: meta.locationName,
      googleAccount: meta.googleAccount || null,
      locationTitle: meta.locationTitle || null,
      resolvedByFallback: false,
    };
  }

  let accountName = meta?.googleAccount || null;
  if (!accountName || accountName === "google-user") {
    const accountsResult = await fetchAllAccounts(accessToken, fetchImpl);
    if (!accountsResult.ok) throw authError(accountsResult.reason);
    const accounts = accountsResult.items;
    if (!accounts[0]?.name) {
      throw new Error("No Google Business account found — reconnect GBP.");
    }
    // Never guess the business when several Google accounts are reachable and
    // the connection did not pin one — require an explicit reconnect+selection.
    if (accounts.length > 1) {
      const err = new Error(
        "This Google connection has multiple Business Profile accounts and none was selected. Reconnect and choose the specific location to publish to."
      );
      err.reason = "ambiguous-account";
      throw err;
    }
    accountName = accounts[0].name;
  }

  const locResult = await fetchAllLocations(accountName, accessToken, fetchImpl);
  if (!locResult.ok) throw authError(locResult.reason);
  const locations = locResult.items;

  if (!locations.length) {
    throw new Error(
      "No GBP location found under this account. Add a location in Google Business, then reconnect."
    );
  }
  if (locations.length > 1) {
    const err = new Error(
      "This Google Business connection has multiple locations and none was selected. Reconnect and choose the specific location to publish to."
    );
    err.reason = "ambiguous-location";
    throw err;
  }

  const only = locations[0];
  return {
    locationName: only.name,
    googleAccount: accountName,
    locationTitle: only.title || null,
    resolvedByFallback: true,
  };
}
