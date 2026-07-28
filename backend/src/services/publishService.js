/**
 * Publish generated content to connected social / GBP accounts.
 */
import prisma from "../db.js";
import { isFullyVerified } from "./verifyService.js";
import { stampActivity } from "./reminderService.js";
import { resolveActiveWorkspace } from "./workspaceService.js";

const SOCIAL_PROVIDERS = ["facebook", "instagram", "linkedin"];
const GBP_PROVIDERS = ["google_business"];

function parseMeta(row) {
  try {
    return row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    return {};
  }
}

async function requireVerifiedUser(email) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalized) return { ok: false, status: 400, error: "Email is required" };
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return { ok: false, status: 404, error: "User not found" };
  if (!isFullyVerified(user)) {
    return { ok: false, status: 403, error: "Verification required" };
  }
  return { ok: true, user };
}

async function refreshGoogleToken(account) {
  if (!account.refreshToken) return account.accessToken;
  const cfgOk = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET;
  if (!cfgOk) return account.accessToken;

  const expired =
    account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() < Date.now() + 60_000;
  if (!expired) return account.accessToken;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: account.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || "Google token refresh failed — reconnect GBP");
  }

  const tokenExpiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : null;

  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: { accessToken: data.access_token, tokenExpiresAt, status: "connected" },
  });

  return data.access_token;
}

async function publishFacebook(account, message) {
  const pageId = parseMeta(account).pageId || account.accountId;
  if (!pageId || !account.accessToken) {
    throw new Error("Facebook Page token missing — reconnect in Connections");
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: account.accessToken }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || "Facebook publish failed");
  }
  return {
    provider: "facebook",
    externalId: data.id,
    url: data.id ? `https://www.facebook.com/${data.id}` : account.accountUrl,
  };
}

async function publishInstagram(account, message, imageUrl) {
  const igUserId = parseMeta(account).igUserId || account.accountId;
  if (!igUserId || !account.accessToken) {
    throw new Error("Instagram account missing — reconnect in Connections");
  }
  if (!imageUrl) {
    throw new Error(
      "Instagram requires an image URL. Add imageUrl or publish to Facebook/LinkedIn instead."
    );
  }

  const createRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      caption: message,
      access_token: account.accessToken,
    }),
  });
  const created = await createRes.json();
  if (!createRes.ok || !created.id) {
    throw new Error(created.error?.message || "Instagram media create failed");
  }

  const pubRes = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creation_id: created.id,
      access_token: account.accessToken,
    }),
  });
  const published = await pubRes.json();
  if (!pubRes.ok || published.error) {
    throw new Error(published.error?.message || "Instagram publish failed");
  }
  return {
    provider: "instagram",
    externalId: published.id,
    url: account.accountUrl,
  };
}

async function publishLinkedIn(account, message) {
  if (!account.accessToken) {
    throw new Error("LinkedIn token missing — reconnect in Connections");
  }
  const meta = parseMeta(account);
  const orgId = String(account.accountId || "").replace("urn:li:organization:", "");
  const author =
    meta.organizationUrn ||
    (orgId && meta.type !== "member" ? `urn:li:organization:${orgId}` : null) ||
    (meta.type === "member" ? `urn:li:person:${account.accountId}` : null);

  if (!author) {
    throw new Error("LinkedIn author URN missing — reconnect Company Page");
  }

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: message },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error_description || `LinkedIn publish failed (${res.status})`);
  }
  return {
    provider: "linkedin",
    externalId: data.id || null,
    url: account.accountUrl,
  };
}

async function resolveGbpLocation(accessToken, account) {
  const meta = parseMeta(account);
  if (meta.locationName) return meta.locationName;

  const accountName = meta.googleAccount || account.accountId;
  if (!accountName || accountName === "google-user") {
    // List accounts then locations
    const accountsRes = await fetch(
      "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const accountsData = await accountsRes.json();
    const first = (accountsData.accounts || [])[0];
    if (!first?.name) {
      throw new Error("No Google Business account found — reconnect GBP");
    }
    return resolveLocationUnderAccount(accessToken, first.name, account.id);
  }

  return resolveLocationUnderAccount(accessToken, accountName, account.id);
}

async function resolveLocationUnderAccount(accessToken, accountName, connectedId) {
  const locRes = await fetch(
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const locData = await locRes.json();
  const location = (locData.locations || [])[0];
  if (!location?.name) {
    throw new Error(
      "No GBP location found under this account. Add a location in Google Business, then reconnect."
    );
  }

  // Persist for next publish
  const row = await prisma.connectedAccount.findUnique({ where: { id: connectedId } });
  const prev = parseMeta(row || {});
  await prisma.connectedAccount.update({
    where: { id: connectedId },
    data: {
      metadata: JSON.stringify({
        ...prev,
        googleAccount: accountName,
        locationName: location.name,
        locationTitle: location.title,
      }),
      accountName: location.title || row?.accountName,
    },
  });

  return location.name;
}

async function publishGbpPost(account, message) {
  const accessToken = await refreshGoogleToken(account);
  const locationName = await resolveGbpLocation(accessToken, account);
  // localPosts still on mybusiness v4 path using accounts/.../locations/...
  // location.name from Business Information API is "locations/XXXX" — need full parent
  let parent = locationName;
  const meta = parseMeta(
    (await prisma.connectedAccount.findUnique({ where: { id: account.id } })) || account
  );
  if (locationName.startsWith("locations/") && meta.googleAccount) {
    parent = `${meta.googleAccount}/${locationName}`;
  }

  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${parent}/localPosts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        languageCode: "en-US",
        summary: message.slice(0, 1500),
        topicType: "STANDARD",
      }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error?.message || data.message || `GBP post failed (${res.status})`
    );
  }
  return {
    provider: "google_business",
    externalId: data.name || null,
    url: "https://business.google.com/",
  };
}

async function publishGbpReviewReply(account, message, reviewName) {
  if (!reviewName) {
    throw new Error(
      "A Google review ID (reviewName) is required to publish a reply. Connect GBP and sync reviews first."
    );
  }
  const accessToken = await refreshGoogleToken(account);
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ comment: message.slice(0, 4096) }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error?.message || data.message || `GBP review reply failed (${res.status})`
    );
  }
  return {
    provider: "google_business",
    externalId: reviewName,
    url: "https://business.google.com/",
  };
}

/**
 * @param {{ email: string, content: string, action: string, providers?: string[], imageUrl?: string, reviewName?: string, connectionIds?: string[], workspaceId?: string }} opts
 */
export async function publishContent(opts) {
  const { email, content, action, imageUrl, reviewName, connectionIds, workspaceId } = opts;
  const message = String(content || "").trim();
  if (!message) return { ok: false, status: 400, error: "Content is required" };

  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const { activeId, workspace } = await resolveActiveWorkspace(gate.user);
  const wid = workspaceId || activeId || workspace?.id;
  if (!wid) {
    return { ok: false, status: 400, error: "No active client workspace" };
  }

  let allowedProviders;
  if (action === "gbp_post" || action === "review_reply") {
    allowedProviders = GBP_PROVIDERS;
  } else {
    allowedProviders = SOCIAL_PROVIDERS;
  }

  const requested = Array.isArray(opts.providers) && opts.providers.length
    ? opts.providers.filter((p) => allowedProviders.includes(p))
    : allowedProviders;

  if (!requested.length) {
    return { ok: false, status: 400, error: "No valid publish providers for this action" };
  }

  const where = {
    userId: gate.user.id,
    workspaceId: wid,
    provider: { in: requested },
    authType: "oauth",
    status: "connected",
    accessToken: { not: null },
  };
  if (Array.isArray(connectionIds) && connectionIds.length) {
    where.id = { in: connectionIds };
  }

  const accounts = await prisma.connectedAccount.findMany({ where });
  if (!accounts.length) {
    return {
      ok: false,
      status: 400,
      error:
        "No publish-ready connections for this client. Open Connections and complete OAuth.",
    };
  }

  const results = [];
  const errors = [];

  for (const account of accounts) {
    try {
      let result;
      if (account.provider === "facebook") {
        result = await publishFacebook(account, message);
      } else if (account.provider === "instagram") {
        result = await publishInstagram(account, message, imageUrl);
      } else if (account.provider === "linkedin") {
        result = await publishLinkedIn(account, message);
      } else if (account.provider === "google_business") {
        if (action === "review_reply") {
          result = await publishGbpReviewReply(account, message, reviewName);
        } else {
          result = await publishGbpPost(account, message);
        }
      } else {
        throw new Error(`Unsupported provider: ${account.provider}`);
      }
      results.push({
        ok: true,
        connectionId: account.id,
        accountName: account.accountName,
        ...result,
      });
    } catch (err) {
      errors.push({
        ok: false,
        connectionId: account.id,
        provider: account.provider,
        accountName: account.accountName,
        error: err.message || "Publish failed",
      });
    }
  }

  if (results.length) {
    await stampActivity(gate.user.id, action === "review_reply" ? "review_reply" : action);
  }

  const ok = results.length > 0;
  return {
    ok,
    status: ok ? 200 : 502,
    published: results,
    failed: errors,
    message: ok
      ? `Published to ${results.length} account(s)${errors.length ? `, ${errors.length} failed` : ""}`
      : errors[0]?.error || "Publish failed",
    error: ok ? undefined : errors[0]?.error || "Publish failed",
  };
}
