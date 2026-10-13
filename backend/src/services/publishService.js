/**
 * Publish generated content to connected social / GBP accounts.
 */
import prisma from "../db.js";
import { isFullyVerified } from "./verifyService.js";
import { stampActivity } from "./reminderService.js";
import { resolveActiveWorkspace } from "./workspaceService.js";

const SOCIAL_PROVIDERS = ["facebook", "instagram", "linkedin", "x", "pinterest"];
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

async function publishFacebook(account, message, imageUrl) {
  const pageId = parseMeta(account).pageId || account.accountId;
  if (!pageId || !account.accessToken) {
    throw new Error("Facebook Page token missing — reconnect in Connections");
  }

  // Photo post (caption + image) — preferred when we have creative
  if (imageUrl) {
    const photoRes = await fetch(`https://graph.facebook.com/v21.0/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: imageUrl,
        message,
        access_token: account.accessToken,
      }),
    });
    const photoData = await photoRes.json();
    if (photoRes.ok && photoData.id && !photoData.error) {
      return {
        provider: "facebook",
        externalId: photoData.id,
        url: photoData.post_id
          ? `https://www.facebook.com/${photoData.post_id}`
          : account.accountUrl,
        withImage: true,
      };
    }
    // Fall through to text-only if photo upload fails (e.g. URL not reachable)
    console.warn("[publishFacebook photo]", photoData.error?.message || "photo upload failed");
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
    withImage: false,
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

/**
 * Best-effort OAuth2 refresh for X / Pinterest (both use Basic-auth refresh_token grant).
 * Returns a valid access token, refreshing + persisting only when near expiry.
 */
async function refreshOAuth2Token(account, { tokenUrl, clientId, clientSecret }) {
  if (!account.refreshToken || !clientId || !clientSecret) return account.accessToken;
  const expired =
    account.tokenExpiresAt && new Date(account.tokenExpiresAt).getTime() < Date.now() + 60_000;
  if (!expired) return account.accessToken;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      client_id: clientId,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return account.accessToken; // fall back; publish may still fail clearly

  const tokenExpiresAt = data.expires_in
    ? new Date(Date.now() + data.expires_in * 1000)
    : null;
  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || account.refreshToken,
      tokenExpiresAt,
      status: "connected",
    },
  });
  return data.access_token;
}

/**
 * Upload an image to X and return its media_id.
 * Uses the chunked-friendly v1.1 simple-upload endpoint, which accepts the
 * OAuth 2.0 user-context bearer token when the app has the media.write scope.
 * Throws on failure — callers treat image attachment as best-effort.
 */
async function uploadXMedia(accessToken, imageUrl) {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`image fetch failed (${imgRes.status})`);
  const contentType = imgRes.headers.get("content-type") || "image/jpeg";
  const bytes = Buffer.from(await imgRes.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error("image larger than X's 5MB simple-upload limit");
  }

  const form = new FormData();
  form.append("media", new Blob([bytes], { type: contentType }), "image");

  const upRes = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  const upData = await upRes.json().catch(() => ({}));
  const mediaId = upData.media_id_string || (upData.media_id && String(upData.media_id));
  if (!upRes.ok || !mediaId) {
    throw new Error(
      upData.errors?.[0]?.message || upData.error || `X media upload failed (${upRes.status})`
    );
  }
  return mediaId;
}

async function publishX(account, message, imageUrl) {
  const accessToken = await refreshOAuth2Token(account, {
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    clientId: process.env.X_CLIENT_ID,
    clientSecret: process.env.X_CLIENT_SECRET,
  });
  if (!accessToken) throw new Error("X token missing — reconnect in Connections");

  // Enforce the 280-char limit defensively (generation already caps, but edits may not).
  const text = String(message || "").slice(0, 280);

  // Attach an image when present — best-effort so a media hiccup never blocks the tweet.
  let mediaIds = null;
  if (imageUrl) {
    try {
      mediaIds = [await uploadXMedia(accessToken, imageUrl)];
    } catch (err) {
      console.warn(`[publishX] media upload skipped (posting text-only): ${err.message}`);
    }
  }

  const body = mediaIds ? { text, media: { media_ids: mediaIds } } : { text };
  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.data?.id) {
    throw new Error(
      data.detail || data.title || data.errors?.[0]?.message || `X publish failed (${res.status})`
    );
  }
  const meta = parseMeta(account);
  return {
    provider: "x",
    externalId: data.data.id,
    withImage: !!mediaIds,
    url: meta.username
      ? `https://x.com/${meta.username}/status/${data.data.id}`
      : `https://x.com/i/web/status/${data.data.id}`,
  };
}

async function publishPinterest(account, message, imageUrl) {
  if (!imageUrl) {
    throw new Error("Pinterest requires an image. Attach an image to this post, then publish.");
  }
  const accessToken = await refreshOAuth2Token(account, {
    tokenUrl: "https://api.pinterest.com/v5/oauth/token",
    clientId: process.env.PINTEREST_CLIENT_ID,
    clientSecret: process.env.PINTEREST_CLIENT_SECRET,
  });
  if (!accessToken) throw new Error("Pinterest token missing — reconnect in Connections");

  const meta = parseMeta(account);
  const boardId = meta.boardId || account.accountId;
  if (!boardId) throw new Error("No Pinterest board selected — reconnect and pick a board");

  const text = String(message || "");
  const title = text.split("\n")[0].slice(0, 100) || "New pin";
  const res = await fetch("https://api.pinterest.com/v5/pins", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      board_id: boardId,
      title,
      description: text.slice(0, 500),
      media_source: { source_type: "image_url", url: imageUrl },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) {
    throw new Error(data.message || `Pinterest publish failed (${res.status})`);
  }
  return {
    provider: "pinterest",
    externalId: data.id,
    url: `https://www.pinterest.com/pin/${data.id}/`,
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
 * @param {{ email: string, content: string, action: string, providers?: string[], imageUrl?: string, reviewName?: string, connectionIds?: string[], workspaceId?: string, contentByProvider?: Record<string, string> }} opts
 */
export async function publishContent(opts) {
  const { email, content, action, imageUrl, reviewName, connectionIds, workspaceId, contentByProvider } =
    opts;
  const fallbackMessage = String(content || "").trim();
  if (!fallbackMessage && !(contentByProvider && Object.keys(contentByProvider).length)) {
    return { ok: false, status: 400, error: "Content is required" };
  }

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
  } else if (action === "social_suite") {
    allowedProviders = [...SOCIAL_PROVIDERS, ...GBP_PROVIDERS];
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
      const message = String(
        contentByProvider?.[account.provider] || fallbackMessage || ""
      ).trim();
      if (!message) {
        throw new Error("No content generated for this platform");
      }

      let result;
      const publishAction =
        account.provider === "google_business"
          ? action === "review_reply"
            ? "review_reply"
            : "gbp_post"
          : "social_post";

      if (account.provider === "facebook") {
        result = await publishFacebook(account, message, imageUrl);
      } else if (account.provider === "instagram") {
        result = await publishInstagram(account, message, imageUrl);
      } else if (account.provider === "linkedin") {
        result = await publishLinkedIn(account, message);
      } else if (account.provider === "x") {
        result = await publishX(account, message, imageUrl);
      } else if (account.provider === "pinterest") {
        result = await publishPinterest(account, message, imageUrl);
      } else if (account.provider === "google_business") {
        if (publishAction === "review_reply") {
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
