/**
 * Social profile connections — Meta (FB/IG), Google Business, LinkedIn
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import prisma from "../db.js";
import { isFullyVerified } from "./verifyService.js";

const PROVIDERS = ["facebook", "instagram", "google_business", "linkedin"];
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
      setupHint: "Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in backend/.env.",
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
    callbacks: {
      facebook: callbackUrl("facebook"),
      instagram: callbackUrl("instagram"),
      google_business: callbackUrl("google_business"),
      linkedin: callbackUrl("linkedin"),
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

function publicAccount(row) {
  let meta = null;
  try {
    meta = row.metadata ? JSON.parse(row.metadata) : null;
  } catch {
    meta = null;
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
    metadata: meta,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishReady: row.authType === "oauth" && row.status === "connected" && !!row.accessToken,
  };
}

export async function listConnections(email) {
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const rows = await prisma.connectedAccount.findMany({
    where: { userId: gate.user.id },
    orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
  });

  const byProvider = Object.fromEntries(PROVIDERS.map((p) => [p, null]));
  const accounts = rows.map(publicAccount);
  for (const a of accounts) {
    if (!byProvider[a.provider]) byProvider[a.provider] = a;
  }

  return {
    ok: true,
    accounts,
    byProvider,
    setup: getConnectionsSetupStatus(),
  };
}

export async function saveManualLink({ email, provider, accountUrl, accountName }) {
  if (!PROVIDERS.includes(provider)) {
    return { ok: false, status: 400, error: "Unsupported provider" };
  }
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const url = String(accountUrl || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return { ok: false, status: 400, error: "A valid https profile/page URL is required" };
  }

  const name =
    String(accountName || "").trim() ||
    url.replace(/^https?:\/\//i, "").split("/")[0] ||
    provider;

  const existing = await prisma.connectedAccount.findFirst({
    where: { userId: gate.user.id, provider, authType: "manual" },
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
  };

  const row = existing
    ? await prisma.connectedAccount.update({ where: { id: existing.id }, data })
    : await prisma.connectedAccount.create({
        data: { userId: gate.user.id, provider, ...data },
      });

  return { ok: true, account: publicAccount(row) };
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

export async function startOAuth({ email, provider }) {
  if (!PROVIDERS.includes(provider)) {
    return { ok: false, status: 400, error: "Unsupported provider" };
  }
  const gate = await requireVerifiedUser(email);
  if (!gate.ok) return gate;

  const cfg = providerConfig(provider);
  if (!cfg.configured) {
    return {
      ok: false,
      status: 503,
      error: `${cfg.label} OAuth is not configured on the server. ${cfg.setupHint}`,
      setup: getConnectionsSetupStatus(),
    };
  }

  const state = signState({
    email: gate.user.email,
    provider,
    n: crypto.randomBytes(8).toString("hex"),
  });
  const redirectUri = callbackUrl(provider);

  let authUrl;
  if (provider === "facebook" || provider === "instagram") {
    const scopes =
      provider === "instagram"
        ? [
            "pages_show_list",
            "pages_read_engagement",
            "pages_manage_posts",
            "instagram_basic",
            "instagram_content_publish",
            "business_management",
          ]
        : [
            "pages_show_list",
            "pages_read_engagement",
            "pages_manage_posts",
            "business_management",
          ];
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
      scope: "openid profile w_member_social r_organization_social w_organization_social",
    });
    authUrl = `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  }

  return { ok: true, authUrl, redirectUri };
}

async function upsertOAuthAccount(userId, provider, fields) {
  const accountId = fields.accountId || `unknown-${provider}`;
  const existing = await prisma.connectedAccount.findFirst({
    where: { userId, provider, accountId },
  });
  const data = {
    authType: "oauth",
    status: "connected",
    accountId,
    accountName: fields.accountName || provider,
    accountUrl: fields.accountUrl || null,
    accessToken: fields.accessToken || null,
    refreshToken: fields.refreshToken || null,
    tokenExpiresAt: fields.tokenExpiresAt || null,
    metadata: fields.metadata ? JSON.stringify(fields.metadata) : null,
  };
  if (existing) {
    return prisma.connectedAccount.update({ where: { id: existing.id }, data });
  }
  return prisma.connectedAccount.create({ data: { userId, provider, ...data } });
}

async function handleMetaCallback({ code, provider, user }) {
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
    `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`
  );
  const pagesData = await pagesRes.json();
  const pages = pagesData.data || [];

  if (!pages.length) {
    throw new Error(
      "No Facebook Pages found for this account. Create a Page, then reconnect."
    );
  }

  const saved = [];
  for (const page of pages) {
    if (provider === "facebook" || provider === "instagram") {
      // Always store Facebook page when connecting Facebook
      if (provider === "facebook") {
        saved.push(
          await upsertOAuthAccount(user.id, "facebook", {
            accountId: page.id,
            accountName: page.name,
            accountUrl: `https://www.facebook.com/${page.id}`,
            accessToken: page.access_token || userToken,
            metadata: { pageId: page.id },
          })
        );
      }
      // Instagram business linked to page
      if (page.instagram_business_account?.id) {
        const ig = page.instagram_business_account;
        saved.push(
          await upsertOAuthAccount(user.id, "instagram", {
            accountId: ig.id,
            accountName: ig.username || `IG ${ig.id}`,
            accountUrl: ig.username
              ? `https://www.instagram.com/${ig.username}/`
              : null,
            accessToken: page.access_token || userToken,
            metadata: { igUserId: ig.id, pageId: page.id },
          })
        );
      }
    }
  }

  if (provider === "instagram" && !saved.some((s) => s.provider === "instagram")) {
    throw new Error(
      "No Instagram Business account linked to your Facebook Pages. Link IG in Meta Business Suite, then retry."
    );
  }

  if (provider === "facebook" && !saved.some((s) => s.provider === "facebook")) {
    throw new Error("Could not save Facebook Page connection.");
  }

  return saved;
}

async function handleGoogleCallback({ code, user }) {
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

  // Business Profile API — accounts
  const accountsRes = await fetch(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const accountsData = await accountsRes.json();
  const accounts = accountsData.accounts || [];

  if (!accounts.length) {
    // Still save token so user is "connected" and can pick location later
    return [
      await upsertOAuthAccount(user.id, "google_business", {
        accountId: "google-user",
        accountName: "Google Business (no locations yet)",
        accountUrl: "https://business.google.com/",
        accessToken,
        refreshToken,
        tokenExpiresAt: expiresAt,
        metadata: { note: "No GBP accounts returned — enable Business Profile API" },
      }),
    ];
  }

  const saved = [];
  for (const acc of accounts.slice(0, 5)) {
    const accountName = acc.accountName || acc.name || "Google Business";
    saved.push(
      await upsertOAuthAccount(user.id, "google_business", {
        accountId: acc.name || accountName,
        accountName,
        accountUrl: "https://business.google.com/",
        accessToken,
        refreshToken,
        tokenExpiresAt: expiresAt,
        metadata: { googleAccount: acc.name, type: acc.type },
      })
    );
  }
  return saved;
}

async function handleLinkedInCallback({ code, user }) {
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

  // Prefer organization (Company Page)
  let orgRes = await fetch(
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
  if (orgs.length) {
    const saved = [];
    for (const el of orgs.slice(0, 5)) {
      const target = el["organizationalTarget~"] || {};
      const id = String(target.id || el.organizationalTarget || "").replace(
        "urn:li:organization:",
        ""
      );
      if (!id) continue;
      saved.push(
        await upsertOAuthAccount(user.id, "linkedin", {
          accountId: id,
          accountName: target.localizedName || `LinkedIn Page ${id}`,
          accountUrl: `https://www.linkedin.com/company/${id}/`,
          accessToken,
          tokenExpiresAt: expiresAt,
          metadata: { organizationUrn: `urn:li:organization:${id}` },
        })
      );
    }
    if (saved.length) return saved;
  }

  // Fallback: member profile
  const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const me = await meRes.json().catch(() => ({}));
  return [
    await upsertOAuthAccount(user.id, "linkedin", {
      accountId: me.sub || "linkedin-user",
      accountName: me.name || me.email || "LinkedIn Profile",
      accountUrl: "https://www.linkedin.com/",
      accessToken,
      tokenExpiresAt: expiresAt,
      metadata: { type: "member" },
    }),
  ];
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

  try {
    if (provider === "facebook" || provider === "instagram") {
      await handleMetaCallback({ code, provider, user: gate.user });
    } else if (provider === "google_business") {
      await handleGoogleCallback({ code, user: gate.user });
    } else if (provider === "linkedin") {
      await handleLinkedInCallback({ code, user: gate.user });
    } else {
      return { redirect: `${frontend}?error=${encodeURIComponent("Unknown provider")}` };
    }
    return { redirect: `${frontend}?connected=${encodeURIComponent(provider)}` };
  } catch (err) {
    console.error(`[connections/oauth/${provider}]`, err);
    return {
      redirect: `${frontend}?error=${encodeURIComponent(err.message || "OAuth failed")}`,
    };
  }
}
