/**
 * Social profile connections — Meta (FB/IG), Google Business, LinkedIn
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import prisma from "../db.js";
import { isFullyVerified } from "./verifyService.js";
import { resolveActiveWorkspace } from "./workspaceService.js";
import { sanitizeEligibleForClient } from "./oauthPicker.js";
import { buildGbpEligible, isPublishableGbpItem } from "./gbpDiscovery.js";

const PROVIDERS = ["facebook", "instagram", "google_business", "linkedin", "x", "pinterest"];
const STATE_SECRET = () =>
  process.env.CONNECTIONS_STATE_SECRET ||
  process.env.ADMIN_JWT_SECRET ||
  "avonix-connections-dev-secret";

function apiBase() {
  const raw = process.env.API_PUBLIC_URL || process.env.APP_URL || "http://localhost:4000";
  // If APP_URL is the frontend, prefer explicit API_PUBLIC_URL; else assume /api on same host via proxy
  if (process.env.API_PUBLIC_URL) return process.env.API_PUBLIC_URL.replace(/\/$/, "");
  // Frontend APP_URL → API is typically same origin /api proxied; callbacks hit Express port in local
  if (process.env.PORT && !process.env.API_PUBLIC_URL) {
    const frontend = raw.replace(/\/$/, "");
    // Production: Apache proxies /api → :4000, so callbacks use APP_URL/api/...
    return frontend;
  }
  return raw.replace(/\/$/, "");
}

function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function callbackUrl(provider) {
  return `${apiBase()}/api/connections/oauth/${provider}/callback`;
}

function providerConfig(provider) {
  if (provider === "facebook" || provider === "instagram") {
    return {
      configured: !!(process.env.META_APP_ID && process.env.META_APP_SECRET),
      appId: process.env.META_APP_ID,
      appSecret: process.env.META_APP_SECRET,
      label: provider === "instagram" ? "Instagram" : "Facebook",
      setupHint:
        "Set META_APP_ID and META_APP_SECRET in backend/.env (Meta Developer App).",
    };
  }
  if (provider === "google_business") {
    return {
      configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      label: "Google Business",
      setupHint:
        "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Google Cloud OAuth + Business Profile API).",
    };
  }
  if (provider === "linkedin") {
    return {
      configured: !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
      clientId: process.env.LINKEDIN_CLIENT_ID,
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
      label: "LinkedIn",
      setupHint:
        "Set LINKEDIN_CLIENT_ID/SECRET. Enable Sign In (OpenID) + Share on LinkedIn. Scopes must match Auth tab (default: openid profile email w_member_social).",
    };
  }
  if (provider === "x") {
    return {
      configured: !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET),
      clientId: process.env.X_CLIENT_ID,
      clientSecret: process.env.X_CLIENT_SECRET,
      label: "X (Twitter)",
      setupHint:
        "Set X_CLIENT_ID and X_CLIENT_SECRET (X Developer Portal, OAuth 2.0 with PKCE; scopes tweet.read tweet.write users.read offline.access media.write).",
    };
  }
  if (provider === "pinterest") {
    return {
      configured: !!(process.env.PINTEREST_CLIENT_ID && process.env.PINTEREST_CLIENT_SECRET),
      clientId: process.env.PINTEREST_CLIENT_ID,
      clientSecret: process.env.PINTEREST_CLIENT_SECRET,
      label: "Pinterest",
      setupHint:
        "Set PINTEREST_CLIENT_ID and PINTEREST_CLIENT_SECRET (Pinterest Developer Portal; scopes boards:read pins:read pins:write user_accounts:read).",
    };
  }
  return { configured: false, label: provider, setupHint: "Unknown provider" };
}

export function getConnectionsSetupStatus() {
  return {
    facebook: providerConfig("facebook").configured,
    instagram: providerConfig("instagram").configured,
    google_business: providerConfig("google_business").configured,
    linkedin: providerConfig("linkedin").configured,
    x: providerConfig("x").configured,
    pinterest: providerConfig("pinterest").configured,
    linkedinMode: linkedinIsCommunityApp() ? "community" : "signin",
    linkedinScopes: linkedinOAuthScopes(),
    callbacks: {
      facebook: callbackUrl("facebook"),
      instagram: callbackUrl("instagram"),
      google_business: callbackUrl("google_business"),
      linkedin: callbackUrl("linkedin"),
      x: callbackUrl("x"),
      pinterest: callbackUrl("pinterest"),
    },
  };
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

const PENDING_STATUS = "pending_select";
const pendingAccountId = (provider) => `pending:${provider}`;

function stripSecretMeta(meta) {
  if (!meta || typeof meta !== "object") return meta;
  const out = { ...meta };
  delete out.accessToken;
  delete out.pageToken;
  delete out.refreshToken;
  delete out.userToken;
  delete out.eligible;
  return out;
}

function publicAccount(row) {
  let meta = null;
  try {
    meta = row.metadata ? JSON.parse(row.metadata) : null;
  } catch {
    meta = null;
  }
  const isDefault = !!(meta && meta.isDefault);
  const expired =
    row.tokenExpiresAt && new Date(row.tokenExpiresAt).getTime() < Date.now();
  const publishReady =
    row.authType === "oauth" && row.status === "connected" && !!row.accessToken && !expired;
  let healthStatus = "disconnected";
  if (publishReady) healthStatus = "publishing_ready";
  else if (row.status === "expired" || expired) healthStatus = "needs_reauthorization";
  else if (row.status === "error" || row.status === "linked" || row.authType === "manual") {
    healthStatus = "permission_issue";
  }
  return {
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    status: row.status,
    accountId: row.accountId,
    accountName: row.accountName,
    accountUrl: row.accountUrl,
    tokenExpiresAt: row.tokenExpiresAt,
    metadata: stripSecretMeta(meta),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isDefault,
    lastVerifiedAt: meta?.lastVerifiedAt || null,
    publishReady,
    healthStatus,
  };
}

export async function listConnections(email, workspaceId) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const { workspace, activeId } = await resolveActiveWorkspace(gate.user);
  const wid = workspaceId || activeId || workspace?.id;

  const rows = await prisma.connectedAccount.findMany({
    where: {
      userId: gate.user.id,
      workspaceId: wid,
      NOT: { status: PENDING_STATUS },
    },
    orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
  });

  const byProvider = Object.fromEntries(PROVIDERS.map((p) => [p, null]));
  const grouped = Object.fromEntries(PROVIDERS.map((p) => [p, []]));
  const accounts = rows.map(publicAccount);
  for (const a of accounts) {
    if (!byProvider[a.provider]) byProvider[a.provider] = a;
    if (grouped[a.provider]) grouped[a.provider].push(a);
  }

  return {
    ok: true,
    workspaceId: wid,
    accounts,
    byProvider,
    grouped,
    setup: getConnectionsSetupStatus(),
  };
}

export async function saveManualLink({ email, provider, accountUrl, accountName, workspaceId }) {
  if (!PROVIDERS.includes(provider)) {
    return { ok: false, status: 400, error: "Unsupported provider" };
  }
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const { activeId, workspace } = await resolveActiveWorkspace(gate.user);
  const wid = workspaceId || activeId || workspace?.id;
  if (!wid) return { ok: false, status: 400, error: "No active client workspace" };

  const url = String(accountUrl || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, status: 400, error: "A valid https profile/page URL is required" };
  }

  const name =
    String(accountName || "").trim() ||
    url.replace(/^https?:\/\//i, "").split("/")[0] ||
    provider;

  const existing = await prisma.connectedAccount.findFirst({
    where: { userId: gate.user.id, workspaceId: wid, provider, authType: "manual" },
  });

  const data = {
    authType: "manual",
    status: "linked",
    accountId: `manual:${crypto.createHash("sha1").update(url).digest("hex").slice(0, 12)}`,
    accountName: name,
    accountUrl: url,
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    metadata: JSON.stringify({ note: "Manual URL — OAuth required to publish" }),
    workspaceId: wid,
  };

  const row = existing
    ? await prisma.connectedAccount.update({ where: { id: existing.id }, data })
    : await prisma.connectedAccount.create({
        data: { userId: gate.user.id, provider, ...data },
      });

  return { ok: true, account: publicAccount(row), workspaceId: wid };
}

export async function disconnectAccount({ email, accountId }) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const row = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: gate.user.id },
  });
  if (!row) return { ok: false, status: 404, error: "Connection not found" };

  await prisma.connectedAccount.delete({ where: { id: row.id } });
  return { ok: true };
}

function signState(payload) {
  return jwt.sign(payload, STATE_SECRET(), { expiresIn: "15m" });
}

function verifyState(state) {
  try {
    return jwt.verify(state, STATE_SECRET());
  } catch {
    return null;
  }
}

/** PKCE pair for OAuth 2.0 providers that require it (X / Twitter). */
function makePkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function metaOAuthScopes(provider) {
  const fbDefault = "pages_show_list,pages_read_engagement,business_management";
  const igDefault =
    "pages_show_list,pages_read_engagement,instagram_basic,business_management";

  const raw =
    provider === "instagram"
      ? process.env.META_IG_OAUTH_SCOPES || process.env.META_OAUTH_SCOPES || igDefault
      : process.env.META_FB_OAUTH_SCOPES || process.env.META_OAUTH_SCOPES || fbDefault;

  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Full publish scopes — set META_*_OAUTH_SCOPES in .env after Meta use-case permissions are Ready for testing */
export function getMetaOAuthScopeHint(provider) {
  if (provider === "instagram") {
    return (
      process.env.META_IG_OAUTH_SCOPES ||
      "pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish,business_management (after Meta use case)"
    );
  }
  return (
    process.env.META_FB_OAUTH_SCOPES ||
    "pages_show_list,pages_read_engagement,pages_manage_posts,business_management (after Meta use case)"
  );
}

/**
 * LinkedIn OAuth scopes — pick ONE app type (LinkedIn forbids mixing on the same app):
 *   sign-in  → Sign In with LinkedIn (OpenID) ± Share on LinkedIn
 *   community → Community Management API only (Company Pages)
 */
const LINKEDIN_SIGNIN_BLOCKED_SCOPES = new Set([
  "r_organization_social",
  "w_organization_social",
  "rw_organization_admin",
  "r_basicprofile",
  "r_liteprofile",
  "r_emailaddress",
]);

function linkedinIsCommunityApp() {
  const v = String(process.env.LINKEDIN_COMMUNITY_MANAGEMENT || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function linkedinOAuthScopes() {
  if (linkedinIsCommunityApp()) {
    const raw =
      process.env.LINKEDIN_OAUTH_SCOPES ||
      "r_organization_social w_organization_social rw_organization_admin";
    return [...new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean))].join(" ");
  }

  const raw = process.env.LINKEDIN_OAUTH_SCOPES || "openid profile email";
  const allowShare =
    process.env.LINKEDIN_SHARE_ON_LINKEDIN === "1" ||
    process.env.LINKEDIN_SHARE_ON_LINKEDIN === "true";

  const scopes = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !LINKEDIN_SIGNIN_BLOCKED_SCOPES.has(s))
    .filter((s) => allowShare || s !== "w_member_social");

  if (!scopes.includes("openid")) scopes.unshift("openid");
  if (!scopes.includes("profile")) scopes.push("profile");
  if (!scopes.includes("email")) scopes.push("email");
  if (allowShare && !scopes.includes("w_member_social")) scopes.push("w_member_social");

  return [...new Set(scopes)].join(" ");
}

export async function startOAuth({ email, provider, workspaceId }) {
  if (!PROVIDERS.includes(provider)) {
    return { ok: false, status: 400, error: "Unsupported provider" };
  }
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const { activeId, workspace } = await resolveActiveWorkspace(gate.user);
  const wid = workspaceId || activeId || workspace?.id;
  if (!wid) return { ok: false, status: 400, error: "No active client workspace" };

  const cfg = providerConfig(provider);
  if (!cfg.configured) {
    return {
      ok: false,
      status: 503,
      error: `${cfg.label} OAuth is not configured on the server. ${cfg.setupHint}`,
      setup: getConnectionsSetupStatus(),
    };
  }

  const pkce = provider === "x" ? makePkce() : null;
  const state = signState({
    email: gate.user.email,
    provider,
    workspaceId: wid,
    n: crypto.randomBytes(8).toString("hex"),
    ...(pkce ? { cv: pkce.verifier } : {}),
  });
  const redirectUri = callbackUrl(provider);

  let authUrl;
  if (provider === "facebook" || provider === "instagram") {
    const scopes = metaOAuthScopes(provider);
    const params = new URLSearchParams({
      client_id: cfg.appId,
      redirect_uri: redirectUri,
      state,
      scope: scopes.join(","),
      response_type: "code",
    });
    authUrl = `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
  } else if (provider === "google_business") {
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/business.manage openid email",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  } else if (provider === "linkedin") {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      state,
    });
    // LinkedIn rejects "+" encoded scopes. Force a new consent screen.
    authUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}&scope=${encodeURIComponent(linkedinOAuthScopes())}&prompt=consent`;
    console.log(`[linkedin oauth] scopes="${linkedinOAuthScopes()}" redirect=${redirectUri}`);
  } else if (provider === "x") {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      scope:
        process.env.X_OAUTH_SCOPES ||
        "tweet.read tweet.write users.read offline.access media.write",
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
    });
    authUrl = `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  } else if (provider === "pinterest") {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      scope:
        process.env.PINTEREST_OAUTH_SCOPES ||
        "boards:read pins:read pins:write user_accounts:read",
      state,
    });
    authUrl = `https://www.pinterest.com/oauth/?${params.toString()}`;
  }

  return { ok: true, authUrl, redirectUri };
}

async function upsertOAuthAccount(userId, workspaceId, provider, fields) {
  const accountId = fields.accountId || `unknown-${provider}`;
  const existing = await prisma.connectedAccount.findFirst({
    where: { userId, workspaceId, provider, accountId },
  });
  let mergedMeta = fields.metadata && typeof fields.metadata === "object" ? { ...fields.metadata } : {};
  if (existing?.metadata) {
    try {
      const prev = JSON.parse(existing.metadata);
      mergedMeta = { ...prev, ...mergedMeta };
      if (prev.isDefault) mergedMeta.isDefault = true;
    } catch {
      /* keep mergedMeta */
    }
  }
  const data = {
    authType: "oauth",
    status: "connected",
    accountId,
    accountName: fields.accountName || provider,
    accountUrl: fields.accountUrl || null,
    accessToken: fields.accessToken || null,
    refreshToken: fields.refreshToken || existing?.refreshToken || null,
    tokenExpiresAt: fields.tokenExpiresAt || null,
    metadata: JSON.stringify(mergedMeta),
    workspaceId,
  };
  if (existing) {
    return prisma.connectedAccount.update({ where: { id: existing.id }, data });
  }
  return prisma.connectedAccount.create({ data: { userId, provider, ...data } });
}

async function handleMetaCallback({ code, provider, user, workspaceId }) {
  const cfg = providerConfig(provider);
  const redirectUri = callbackUrl(provider);

  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      redirect_uri: redirectUri,
      code,
    })}`
  );
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error?.message || "Meta token exchange failed");
  }

  const userToken = tokenData.access_token;
  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&access_token=${encodeURIComponent(userToken)}`
  );
  const pagesData = await pagesRes.json();
  if (pagesData.error) {
    throw new Error(
      pagesData.error.message ||
        "Could not load Facebook Pages (permission or API error)."
    );
  }
  const pages = Array.isArray(pagesData.data) ? pagesData.data : [];

  if (!pages.length) {
    // Help distinguish: no Page vs Page not selected in Meta consent UI
    let granted = [];
    try {
      const permRes = await fetch(
        `https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(userToken)}`
      );
      const permData = await permRes.json();
      granted = (permData.data || [])
        .filter((p) => p.status === "granted")
        .map((p) => p.permission);
    } catch {
      /* ignore */
    }
    const hasPagesScope = granted.includes("pages_show_list");
    throw new Error(
      hasPagesScope
        ? "No Facebook Pages found for this account. Either this Facebook login has no Page, or you did not select a Page in the Facebook permission screen. Create a Page (facebook.com/pages/create), then reconnect and choose that Page when Facebook asks."
        : "Facebook did not grant Page access (pages_show_list). Reconnect and allow Page permissions when Facebook asks — do not skip the Page selection step."
    );
  }

  const eligible = [];
  for (const page of pages) {
    if (provider === "facebook") {
      eligible.push({
        accountId: page.id,
        accountName: page.name || `Facebook Page ${page.id}`,
        accountUrl: `https://www.facebook.com/${page.id}`,
        accessToken: page.access_token || userToken,
        metadata: { pageId: page.id },
      });
    }
    if (provider === "instagram" && page.instagram_business_account?.id) {
      const ig = page.instagram_business_account;
      eligible.push({
        accountId: ig.id,
        accountName: ig.username || `IG ${ig.id}`,
        accountUrl: ig.username ? `https://www.instagram.com/${ig.username}/` : null,
        accessToken: page.access_token || userToken,
        metadata: { igUserId: ig.id, pageId: page.id },
      });
    }
  }

  if (provider === "instagram" && !eligible.length) {
    throw new Error(
      "No Instagram Business account linked to your Facebook Pages. Link IG in Meta Business Suite, then retry."
    );
  }

  if (provider === "facebook" && !eligible.length) {
    throw new Error("Could not load Facebook Pages to connect.");
  }

  return {
    eligible,
    accessToken: userToken,
    refreshToken: null,
    tokenExpiresAt: null,
  };
}

async function handleGoogleCallback({ code, user, workspaceId }) {
  const cfg = providerConfig("google_business");
  const redirectUri = callbackUrl("google_business");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "Google token failed");
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || null;
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  // Paginated, error-aware account + location discovery. Never silently
  // auto-assigns a location — the user picks on the selection screen.
  const { eligible, warnings } = await buildGbpEligible(accessToken, {
    refreshToken,
    tokenExpiresAt: expiresAt,
  });

  return { eligible, warnings, accessToken, refreshToken, tokenExpiresAt: expiresAt };
}

async function handleLinkedInCallback({ code, user, workspaceId }) {
  const cfg = providerConfig("linkedin");
  const redirectUri = callbackUrl("linkedin");

  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || "LinkedIn token failed");
  }

  const accessToken = tokenData.access_token;
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  if (linkedinIsCommunityApp()) {
    const orgRes = await fetch(
      "https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organizationalTarget~(id,localizedName)))",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    let orgData = {};
    try {
      orgData = await orgRes.json();
    } catch {
      orgData = {};
    }

    const orgs = orgData.elements || [];
    const eligible = [];
    for (const el of orgs.slice(0, 20)) {
      const target = el["organizationalTarget~"] || {};
      const id = String(target.id || el.organizationalTarget || "").replace(
        "urn:li:organization:",
        ""
      );
      if (!id) continue;
      eligible.push({
        accountId: id,
        accountName: target.localizedName || `LinkedIn Page ${id}`,
        accountUrl: `https://www.linkedin.com/company/${id}/`,
        accessToken,
        tokenExpiresAt: expiresAt,
        metadata: { organizationUrn: `urn:li:organization:${id}` },
      });
    }
    if (eligible.length) {
      return { eligible, accessToken, refreshToken: null, tokenExpiresAt: expiresAt };
    }
    throw new Error(
      "No LinkedIn Company Page found for this account. Community Management API connects Pages only — the person must be an admin of a Company Page."
    );
  }

  const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = await meRes.json().catch(() => ({}));
  return {
    eligible: [
      {
        accountId: me.sub || "linkedin-user",
        accountName: me.name || me.email || "LinkedIn Profile",
        accountUrl: "https://www.linkedin.com/",
        accessToken,
        tokenExpiresAt: expiresAt,
        metadata: { type: "member" },
      },
    ],
    accessToken,
    refreshToken: null,
    tokenExpiresAt: expiresAt,
  };
}

async function handleXCallback({ code, codeVerifier }) {
  const cfg = providerConfig("x");
  const redirectUri = callbackUrl("x");

  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      code_verifier: codeVerifier || "",
    }),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(
      tokenData.error_description || tokenData.error || "X token exchange failed"
    );
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || null;
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  const meRes = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = await meRes.json().catch(() => ({}));
  const u = me.data || {};
  if (!u.id) {
    throw new Error("Could not load your X account (users.read scope may be missing).");
  }

  return {
    eligible: [
      {
        accountId: u.id,
        accountName: u.username ? `@${u.username}` : u.name || `X ${u.id}`,
        accountUrl: u.username ? `https://x.com/${u.username}` : null,
        accessToken,
        refreshToken,
        tokenExpiresAt: expiresAt,
        metadata: { xUserId: u.id, username: u.username || null },
      },
    ],
    accessToken,
    refreshToken,
    tokenExpiresAt: expiresAt,
  };
}

async function handlePinterestCallback({ code }) {
  const cfg = providerConfig("pinterest");
  const redirectUri = callbackUrl("pinterest");

  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://api.pinterest.com/v5/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(
      tokenData.message || tokenData.error_description || tokenData.error || "Pinterest token exchange failed"
    );
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || null;
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  let username = "pinterest";
  try {
    const acctRes = await fetch("https://api.pinterest.com/v5/user_account", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const acct = await acctRes.json();
    if (acct?.username) username = acct.username;
  } catch {
    /* non-fatal */
  }

  const boardsRes = await fetch("https://api.pinterest.com/v5/boards?page_size=50", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const boardsData = await boardsRes.json().catch(() => ({}));
  const boards = Array.isArray(boardsData.items) ? boardsData.items : [];
  if (!boards.length) {
    throw new Error(
      "No Pinterest boards found. Create a board at pinterest.com, then reconnect — pins must be published to a board."
    );
  }

  const eligible = boards.slice(0, 50).map((b) => ({
    accountId: b.id,
    accountName: `${username} · ${b.name || `Board ${b.id}`}`,
    accountUrl: b.name
      ? `https://www.pinterest.com/${username}/${String(b.name).toLowerCase().replace(/\s+/g, "-")}/`
      : null,
    accessToken,
    refreshToken,
    tokenExpiresAt: expiresAt,
    metadata: { boardId: b.id, boardName: b.name || null, username },
  }));

  return { eligible, accessToken, refreshToken, tokenExpiresAt: expiresAt };
}

export async function handleOAuthCallback({ provider, code, state, error, errorDescription }) {
  const frontend = `${appUrl()}/dashboard/connections`;

  if (error) {
    return {
      redirect: `${frontend}?error=${encodeURIComponent(errorDescription || error)}`,
    };
  }

  const payload = verifyState(state);
  if (!payload?.email || payload.provider !== provider) {
    return { redirect: `${frontend}?error=${encodeURIComponent("Invalid or expired OAuth state")}` };
  }

  const gate = await requireVerifiedUser(payload.email);
  if (!gate.ok) {
    return { redirect: `${frontend}?error=${encodeURIComponent(gate.error)}` };
  }

  const { activeId, workspace } = await resolveActiveWorkspace(gate.user);
  const workspaceId = payload.workspaceId || activeId || workspace?.id;
  if (!workspaceId) {
    return { redirect: `${frontend}?error=${encodeURIComponent("No active client workspace")}` };
  }

  try {
    let bundle;
    if (provider === "facebook" || provider === "instagram") {
      bundle = await handleMetaCallback({ code, provider, user: gate.user, workspaceId });
    } else if (provider === "google_business") {
      bundle = await handleGoogleCallback({ code, user: gate.user, workspaceId });
    } else if (provider === "linkedin") {
      bundle = await handleLinkedInCallback({ code, user: gate.user, workspaceId });
    } else if (provider === "x") {
      bundle = await handleXCallback({ code, codeVerifier: payload.cv });
    } else if (provider === "pinterest") {
      bundle = await handlePinterestCallback({ code });
    } else {
      return { redirect: `${frontend}?error=${encodeURIComponent("Unknown provider")}` };
    }
    await savePendingSelection({
      userId: gate.user.id,
      workspaceId,
      provider,
      bundle,
    });
    return { redirect: `${frontend}?select=${encodeURIComponent(provider)}` };
  } catch (err) {
    console.error(`[connections/oauth/${provider}]`, err);
    return {
      redirect: `${frontend}?error=${encodeURIComponent(err.message || "OAuth failed")}`,
    };
  }
}

export { sanitizeEligibleForClient } from "./oauthPicker.js";

async function savePendingSelection({ userId, workspaceId, provider, bundle }) {
  const eligible = Array.isArray(bundle?.eligible) ? bundle.eligible : [];
  if (!eligible.length) {
    throw new Error(`No ${provider} accounts were returned to connect.`);
  }

  const existingRows = await prisma.connectedAccount.findMany({
    where: {
      userId,
      workspaceId,
      provider,
      NOT: { status: PENDING_STATUS },
    },
  });
  const connectedIds = new Set(existingRows.map((r) => String(r.accountId)));

  for (const item of eligible) {
    if (!connectedIds.has(String(item.accountId))) continue;
    await upsertOAuthAccount(userId, workspaceId, provider, {
      accountId: item.accountId,
      accountName: item.accountName,
      accountUrl: item.accountUrl,
      accessToken: item.accessToken || bundle.accessToken,
      refreshToken: item.refreshToken || bundle.refreshToken || null,
      tokenExpiresAt: item.tokenExpiresAt || bundle.tokenExpiresAt || null,
      metadata: item.metadata || {},
    });
  }

  const pendingData = {
    authType: "oauth",
    status: PENDING_STATUS,
    accountId: pendingAccountId(provider),
    accountName: `Pending ${provider} selection`,
    accountUrl: null,
    accessToken: bundle.accessToken || null,
    refreshToken: bundle.refreshToken || null,
    tokenExpiresAt: bundle.tokenExpiresAt || null,
    metadata: JSON.stringify({ eligible, warnings: bundle.warnings || [] }),
    workspaceId,
  };

  const existingPending = await prisma.connectedAccount.findFirst({
    where: {
      userId,
      workspaceId,
      provider,
      accountId: pendingAccountId(provider),
    },
  });

  if (existingPending) {
    await prisma.connectedAccount.update({
      where: { id: existingPending.id },
      data: pendingData,
    });
  } else {
    await prisma.connectedAccount.create({
      data: { userId, provider, ...pendingData },
    });
  }
}

export async function listPendingSelection({ email, provider, workspaceId }) {
  if (!PROVIDERS.includes(provider)) {
    return { ok: false, status: 400, error: "Unsupported provider" };
  }
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const { activeId, workspace } = await resolveActiveWorkspace(gate.user);
  const wid = workspaceId || activeId || workspace?.id;
  if (!wid) return { ok: false, status: 400, error: "No active client workspace" };

  const pending = await prisma.connectedAccount.findFirst({
    where: {
      userId: gate.user.id,
      workspaceId: wid,
      provider,
      status: PENDING_STATUS,
      accountId: pendingAccountId(provider),
    },
  });
  if (!pending) {
    return { ok: true, provider, items: [], pending: false };
  }

  let eligible = [];
  let warnings = [];
  try {
    const meta = pending.metadata ? JSON.parse(pending.metadata) : {};
    eligible = Array.isArray(meta.eligible) ? meta.eligible : [];
    warnings = Array.isArray(meta.warnings) ? meta.warnings : [];
  } catch {
    eligible = [];
  }

  const connected = await prisma.connectedAccount.findMany({
    where: {
      userId: gate.user.id,
      workspaceId: wid,
      provider,
      NOT: { status: PENDING_STATUS },
    },
    select: { accountId: true, accountName: true },
  });

  return {
    ok: true,
    pending: true,
    provider,
    warnings,
    items: sanitizeEligibleForClient(
      eligible,
      connected.map((c) => c.accountId)
    ),
  };
}

export async function connectSelectedAccounts({ email, provider, accountIds, workspaceId }) {
  if (!PROVIDERS.includes(provider)) {
    return { ok: false, status: 400, error: "Unsupported provider" };
  }
  const ids = Array.isArray(accountIds)
    ? [...new Set(accountIds.map((id) => String(id).trim()).filter(Boolean))]
    : [];
  if (!ids.length) {
    return { ok: false, status: 400, error: "Select at least one account to connect" };
  }

  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const { activeId, workspace } = await resolveActiveWorkspace(gate.user);
  const wid = workspaceId || activeId || workspace?.id;
  if (!wid) return { ok: false, status: 400, error: "No active client workspace" };

  const pending = await prisma.connectedAccount.findFirst({
    where: {
      userId: gate.user.id,
      workspaceId: wid,
      provider,
      status: PENDING_STATUS,
      accountId: pendingAccountId(provider),
    },
  });
  if (!pending) {
    return { ok: false, status: 404, error: "No pending account selection. Start Connect another again." };
  }

  let eligible = [];
  try {
    const meta = pending.metadata ? JSON.parse(pending.metadata) : {};
    eligible = Array.isArray(meta.eligible) ? meta.eligible : [];
  } catch {
    eligible = [];
  }

  const byId = new Map(eligible.map((item) => [String(item.accountId), item]));
  const connected = await prisma.connectedAccount.findMany({
    where: {
      userId: gate.user.id,
      workspaceId: wid,
      provider,
      NOT: { status: PENDING_STATUS },
    },
    select: { accountId: true },
  });
  const already = new Set(connected.map((c) => String(c.accountId)));

  const saved = [];
  const skipped = [];
  for (const id of ids) {
    if (already.has(id)) {
      skipped.push(id);
      continue;
    }
    const item = byId.get(id);
    if (!item) {
      return { ok: false, status: 400, error: `Account ${id} was not in the provider-returned list.` };
    }
    // GBP: only real, publishable locations may be connected. Account-only /
    // stub items (no selected location) are rejected server-side so they can
    // never later resolve to the wrong business at publish time.
    if (provider === "google_business" && !isPublishableGbpItem(item)) {
      return {
        ok: false,
        status: 400,
        error:
          "Select a specific Google Business location. Accounts without a chosen location cannot be connected for publishing.",
      };
    }
    saved.push(
      await upsertOAuthAccount(gate.user.id, wid, provider, {
        accountId: item.accountId,
        accountName: item.accountName,
        accountUrl: item.accountUrl,
        accessToken: item.accessToken || pending.accessToken,
        refreshToken: item.refreshToken || pending.refreshToken || null,
        tokenExpiresAt: item.tokenExpiresAt || pending.tokenExpiresAt || null,
        metadata: item.metadata || {},
      })
    );
  }

  await prisma.connectedAccount.delete({ where: { id: pending.id } });

  return {
    ok: true,
    provider,
    connected: saved.map(publicAccount),
    skippedAlreadyConnected: skipped,
    workspaceId: wid,
  };
}

export async function discardPendingSelection({ email, provider, workspaceId }) {
  if (!PROVIDERS.includes(provider)) {
    return { ok: false, status: 400, error: "Unsupported provider" };
  }
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const { activeId, workspace } = await resolveActiveWorkspace(gate.user);
  const wid = workspaceId || activeId || workspace?.id;

  await prisma.connectedAccount.deleteMany({
    where: {
      userId: gate.user.id,
      workspaceId: wid,
      provider,
      status: PENDING_STATUS,
    },
  });
  return { ok: true };
}

export async function setDefaultAccount({ email, accountId }) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const row = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: gate.user.id, NOT: { status: PENDING_STATUS } },
  });
  if (!row) return { ok: false, status: 404, error: "Connection not found" };

  const siblings = await prisma.connectedAccount.findMany({
    where: {
      userId: gate.user.id,
      workspaceId: row.workspaceId,
      provider: row.provider,
      NOT: { status: PENDING_STATUS },
    },
  });

  for (const sib of siblings) {
    let meta = {};
    try {
      meta = sib.metadata ? JSON.parse(sib.metadata) : {};
    } catch {
      meta = {};
    }
    meta.isDefault = sib.id === row.id;
    await prisma.connectedAccount.update({
      where: { id: sib.id },
      data: { metadata: JSON.stringify(meta) },
    });
  }

  const updated = await prisma.connectedAccount.findUnique({ where: { id: row.id } });
  return { ok: true, account: publicAccount(updated) };
}

export async function verifyAccount({ email, accountId }) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const row = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: gate.user.id, NOT: { status: PENDING_STATUS } },
  });
  if (!row) return { ok: false, status: 404, error: "Connection not found" };

  const expired =
    row.tokenExpiresAt && new Date(row.tokenExpiresAt).getTime() < Date.now();
  const okToken = row.authType === "oauth" && !!row.accessToken && !expired;

  let meta = {};
  try {
    meta = row.metadata ? JSON.parse(row.metadata) : {};
  } catch {
    meta = {};
  }
  meta.lastVerifiedAt = new Date().toISOString();
  meta.lastVerifyOk = okToken;

  const nextStatus = okToken ? "connected" : expired ? "expired" : row.status === "linked" ? "error" : row.status;
  const updated = await prisma.connectedAccount.update({
    where: { id: row.id },
    data: { status: nextStatus, metadata: JSON.stringify(meta) },
  });

  return {
    ok: true,
    account: publicAccount(updated),
    verified: okToken,
    message: okToken
      ? "Token is present and not expired."
      : expired
        ? "Token expired — reauthorize this account."
        : "No publishing token on this connection.",
  };
}
