const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
const EMAIL_KEY = "avonix-social-email";
const TOKEN_KEY = "avonix-social-session";

export function getSessionToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(email: string, token: string) {
  localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase());
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession() {
  localStorage.removeItem(EMAIL_KEY);
  localStorage.removeItem(TOKEN_KEY);
}

export function getStoredEmail() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(EMAIL_KEY);
}

async function request<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  let res: Response;
  const token = typeof window !== "undefined" ? getSessionToken() : null;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const { timeoutMs, ...fetchOptions } = options || {};
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer =
    controller && timeoutMs
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers,
      signal: controller?.signal || fetchOptions.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw {
        status: 0,
        error: "Request timed out. Generation may still finish on the server — refresh in a moment.",
      };
    }
    throw { status: 0, error: `Cannot reach API (${API_BASE}). Is the backend running?` };
  } finally {
    if (timer) clearTimeout(timer);
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw {
      status: res.status,
      error: `Invalid API response (${res.status}). Backend may be outdated — pull latest and restart avonix-api.`,
    };
  }

  if (!res.ok) {
    throw { status: res.status, ...data, error: (data.error as string) || res.statusText };
  }

  return data as T;
}

export type StudioPostRecord = {
  id: string;
  url: string;
  platform: string;
  tone: string;
  location: string;
  keywords: {
    primary: string;
    secondary: string;
    general: string[];
  };
  heading: string;
  content: string;
  contentHtml: string;
  wordCount?: number;
  image: string | null;
  status: "draft" | "scheduled" | "published" | string;
  locked: boolean;
  scheduledDate: string | null;
  publishedAt: string | null;
  fingerprint: string;
  websiteOrigin?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  workspaceId: string | null;
  archived?: boolean;
  archivedAt?: string | null;
  publishLocked?: boolean;
};

export type ArchiveWebsiteTable = {
  websiteOrigin: string;
  archivedAt: string | null;
  count: number;
  lockedCount: number;
  posts: StudioPostRecord[];
};

export type StudioPageAnalysis = {
  url: string;
  reachable?: boolean;
  title?: string;
  areaCoverage: string;
  writingIntent: string;
  masterIntent: string;
  keywords: {
    primary: string;
    secondary: string[];
  };
};

export type WebsiteAnalyzeResult = {
  ok: boolean;
  workspaceId: string | null;
  websiteUrl: string;
  location: string;
  needsLocation: boolean;
  discoveredCount: number;
  pageCount: number;
  areaCoverage: {
    summary: string;
    areas: string[];
  };
  masterIntent: string;
  dominantIntent: string;
  pages: StudioPageAnalysis[];
  error?: string;
};

export const api = {
  register: (payload: {
    email: string;
    phone: string;
    name?: string;
    company?: string;
    password: string;
    confirmPassword: string;
  }) =>
    request<{
      ok: boolean;
      email: string;
      phone: string;
      next: string;
      delivery?: {
        email?: string;
        emailError?: string | null;
      };
    }>("/auth/register", { method: "POST", body: JSON.stringify(payload) }),

  resendOtp: (email: string) =>
    request<{
      ok: boolean;
      email: string;
      phone?: string | null;
      delivery?: {
        email?: string;
        emailError?: string | null;
      };
    }>("/auth/resend-otp", { method: "POST", body: JSON.stringify({ email }) }),

  verify: (payload: { email: string; emailCode: string }) =>
    request<{ ok: boolean; next: string; message?: string }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  attachCard: (payload: {
    email: string;
    cardNumber: string;
    expMonth: string;
    expYear: string;
    cvc: string;
    brand?: string;
  }) =>
    request<{ ok: boolean; user: ApiUserState; message?: string }>("/auth/card", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  login: (email: string, password: string) =>
    request<{ ok: boolean; user: ApiUserState; sessionToken?: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  forgotPassword: (email: string) =>
    request<{
      ok: boolean;
      email: string;
      next?: string;
      message?: string;
      delivery?: { email?: string; emailError?: string | null };
    }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),

  resendPasswordReset: (email: string) =>
    request<{
      ok: boolean;
      email: string;
      message?: string;
      delivery?: { email?: string; emailError?: string | null };
    }>("/auth/resend-password-reset", { method: "POST", body: JSON.stringify({ email }) }),

  resetPassword: (payload: {
    email: string;
    code: string;
    password: string;
    confirmPassword: string;
  }) =>
    request<{ ok: boolean; email: string; next?: string; message?: string }>(
      "/auth/reset-password",
      { method: "POST", body: JSON.stringify(payload) }
    ),

  getAuthStatus: (email: string) =>
    request<{
      ok: boolean;
      email: string;
      phone?: string | null;
      emailVerified: boolean;
      phoneVerified: boolean;
      cardOnFile: boolean;
      fullyVerified: boolean;
      next: string;
      error?: string;
    }>(`/auth/status/${encodeURIComponent(email)}`),

  getCredits: (email: string) =>
    request<ApiUserState>(`/users/${encodeURIComponent(email)}/credits`),

  getWallet: (email: string) =>
    request<{
      walletBalanceUsd: number;
      accountStatus: string;
      cardOnFile: boolean;
      cardLast4: string | null;
      transactions: Array<{
        id: string;
        type: string;
        amountUsd: number;
        balanceAfter: number;
        gateway: string | null;
        createdAt: string;
      }>;
    }>(`/wallet/${encodeURIComponent(email)}`),

  topUp: (payload: { email: string; amountUsd: number; gateway: string }) =>
    request<{ ok: boolean; walletBalanceUsd: number; user: ApiUserState; message?: string }>(
      "/wallet/topup",
      { method: "POST", body: JSON.stringify(payload) }
    ),

  saveNotificationPrefs: (
    email: string,
    prefs: {
      notifyEmail?: boolean;
      notifyWhatsapp?: boolean;
      notifyTelegram?: boolean;
      whatsappNumber?: string;
      telegramChatId?: string;
    }
  ) =>
    request(`/users/${encodeURIComponent(email)}/notifications`, {
      method: "PUT",
      body: JSON.stringify(prefs),
    }),

  getNotificationLogs: (email: string) =>
    request<
      Array<{
        id: string;
        channel: string;
        type: string;
        title: string;
        body: string;
        status: string;
        createdAt: string;
      }>
    >(`/users/${encodeURIComponent(email)}/notifications`),

  generate: (payload: {
    email: string;
    action: string;
    prompt: string;
    model?: string;
    metadata?: Record<string, unknown>;
  }) =>
    request<GenerateResult>("/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  generateSocialSuite: (payload: {
    email: string;
    workspaceId?: string;
    intent?: string;
  }) =>
    request<{
      ok: boolean;
      workspaceId: string;
      primaryKeyword: string;
      secondaryKeywords: string[];
      location: string;
      intent: string;
      posts: Record<
        string,
        {
          provider: string;
          label: string;
          content: string;
          maxWords: number;
          accountName: string | null;
          connectionId: string | null;
          creditsDeducted: number;
        }
      >;
      skipped: Array<{ provider: string; reason: string }>;
      imageUrl: string | null;
      imageError: string | null;
      creditsDeducted: number;
      creditsLeft: number;
      walletBalanceUsd?: number;
      error?: string;
    }>("/generate/social-suite", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  spendFixed: (payload: { email: string; action: string; metadata?: Record<string, unknown> }) =>
    request<{
      ok: boolean;
      creditsDeducted: number;
      creditsLeft: number;
      walletBalanceUsd?: number;
      paidVia?: string;
    }>("/credits/spend", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  analyzeSite: (payload: { domain: string; email?: string; location?: string }) =>
    request<{
      ok: boolean;
      domain: string;
      urlCount: number;
      pagesAnalyzed: number;
      sampleUrls: string[];
      primaryKeyword: string;
      secondaryKeywords: string[];
      location: string;
      address: string;
      needsLocation: boolean;
      method: string;
      error?: string;
    }>("/site/analyze", { method: "POST", body: JSON.stringify(payload) }),

  subscribe: (payload: {
    email: string;
    plan: string;
    gateway: string;
    gatewaySubId?: string;
  }) =>
    request<{ ok: boolean; user: ApiUserState; credits: number }>("/billing/subscribe", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getCreditConfig: () =>
    request<{
      mode: string;
      creditsPerDollar: number;
      marginMultiplier: number;
      minCreditsPerRequest: number;
      formula: string;
    }>("/credits/config"),

  getConnections: (email: string, workspaceId?: string) =>
    request<{
      ok: boolean;
      workspaceId?: string;
      accounts: ConnectedAccount[];
      byProvider: Record<string, ConnectedAccount | null>;
      setup: ConnectionsSetup;
    }>(
      `/connections?email=${encodeURIComponent(email)}${
        workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ""
      }`
    ),

  startConnectionOAuth: (email: string, provider: string, workspaceId?: string) =>
    request<{ ok: boolean; authUrl: string; redirectUri?: string; error?: string }>(
      `/connections/oauth/${encodeURIComponent(provider)}/start?email=${encodeURIComponent(email)}${
        workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ""
      }`
    ),

  saveManualConnection: (payload: {
    email: string;
    provider: string;
    accountUrl: string;
    accountName?: string;
    workspaceId?: string;
  }) =>
    request<{ ok: boolean; account: ConnectedAccount }>("/connections/manual", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  disconnectConnection: (email: string, id: string) =>
    request<{ ok: boolean }>(`/connections/${encodeURIComponent(id)}?email=${encodeURIComponent(email)}`, {
      method: "DELETE",
    }),

  publishContent: (payload: {
    email: string;
    content: string;
    action: "social_post" | "gbp_post" | "review_reply" | "social_suite";
    providers?: string[];
    imageUrl?: string;
    reviewName?: string;
    connectionIds?: string[];
    workspaceId?: string;
    contentByProvider?: Record<string, string>;
  }) =>
    request<{
      ok: boolean;
      message?: string;
      published: Array<{
        ok: boolean;
        provider: string;
        connectionId: string;
        accountName?: string | null;
        externalId?: string | null;
        url?: string | null;
      }>;
      failed: Array<{
        ok: boolean;
        provider: string;
        connectionId: string;
        accountName?: string | null;
        error: string;
      }>;
      error?: string;
    }>("/connections/publish", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listWorkspaces: (email: string) =>
    request<{
      ok: boolean;
      activeWorkspaceId: string;
      limit: number;
      workspaces: import("./types").ClientWorkspaceSummary[];
    }>(`/workspaces?email=${encodeURIComponent(email)}`),

  createWorkspace: (payload: {
    email: string;
    name: string;
    websiteUrl?: string;
    notes?: string;
  }) =>
    request<{
      ok: boolean;
      workspace: import("./types").ClientWorkspaceSummary;
      activeWorkspaceId: string;
    }>("/workspaces", { method: "POST", body: JSON.stringify(payload) }),

  activateWorkspace: (email: string, workspaceId: string) =>
    request<{
      ok: boolean;
      workspace: import("./types").ClientWorkspaceSummary;
      activeWorkspaceId: string;
    }>(`/workspaces/${encodeURIComponent(workspaceId)}/activate`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  deleteWorkspace: (email: string, workspaceId: string) =>
    request<{ ok: boolean; activeWorkspaceId: string | null }>(
      `/workspaces/${encodeURIComponent(workspaceId)}?email=${encodeURIComponent(email)}`,
      { method: "DELETE" }
    ),

  saveWorkspaceSitemap: (
    email: string,
    workspaceId: string,
    sitemap: import("./types").SitemapData
  ) =>
    request<{
      ok: boolean;
      workspace: import("./types").ClientWorkspaceSummary;
      activeWorkspaceId: string;
    }>(`/workspaces/${encodeURIComponent(workspaceId)}/sitemap`, {
      method: "PUT",
      body: JSON.stringify({ email, sitemap }),
    }),

  /** Avonix Social — Part 2: ≤15 pages × FB/LinkedIn/GMB posts */
  generateAutoPoster: (payload: {
    email: string;
    workspaceId?: string;
    urls?: string[] | string;
    location: string;
    tone?: string;
    pages?: StudioPageAnalysis[];
    masterIntent?: string;
    includeImages?: boolean;
    imageSource?: "auto" | "ai" | "free";
    platforms?: string[];
    websiteUrl?: string;
  }) =>
    request<{
      ok: boolean;
      workspaceId: string | null;
      location: string;
      tone: string;
      platforms?: string[];
      expectedTotal?: number;
      pageCount?: number;
      websiteOrigin?: string | null;
      switchingWebsite?: boolean;
      archivedCount?: number;
      masterIntent?: string | null;
      includeImages?: boolean;
      imageSource?: string | null;
      providerDecision?: {
        method?: string;
        writing?: { id: string; model: string; label: string; reason: string };
        image?: {
          id: string;
          model: string | null;
          source: string;
          label: string;
          reason: string;
        };
      };
      analyzed: Array<{
        url: string;
        reachable: boolean;
        title?: string;
        keywords: {
          primary: string;
          secondary: string;
          general: string[];
          secondaryKeywords?: string[];
        };
        writingIntent?: string;
        masterIntent?: string;
        areaCoverage?: string;
      }>;
      posts: StudioPostRecord[];
      skippedLocked: Array<{ url: string; platform: string; reason: string }>;
      tones: string[];
      error?: string;
    }>("/auto-poster/generate", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 5 * 60 * 1000,
    }),

  /** Part 1 — website → pages + coverage + intent + keywords */
  analyzeWebsiteForStudio: (payload: {
    email: string;
    workspaceId?: string;
    websiteUrl: string;
    location?: string;
    maxPages?: number;
  }) =>
    request<WebsiteAnalyzeResult>("/auto-poster/analyze-website", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 3 * 60 * 1000,
    }),

  listStudioPosts: (email: string, workspaceId?: string, status?: string) =>
    request<{ ok: boolean; posts: StudioPostRecord[] }>(
      `/auto-poster/posts?email=${encodeURIComponent(email)}${
        workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ""
      }${status ? `&status=${encodeURIComponent(status)}` : ""}`
    ),

  listArchivedStudioPosts: (email: string, workspaceId?: string) =>
    request<{
      ok: boolean;
      total: number;
      websiteCount: number;
      tables: ArchiveWebsiteTable[];
      error?: string;
    }>(
      `/auto-poster/archive?email=${encodeURIComponent(email)}${
        workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ""
      }`
    ),

  clearStudioArchive: (payload: {
    email: string;
    workspaceId?: string;
    websiteOrigin?: string;
    confirm: boolean | "CLEAR";
  }) =>
    request<{
      ok: boolean;
      deleted: number;
      websiteOrigin?: string | null;
      error?: string;
    }>("/auto-poster/archive/clear", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  publishStudioPost: (payload: { email: string; postId: string; alsoLive?: boolean }) =>
    request<{ ok: boolean; post: StudioPostRecord; live?: unknown; error?: string }>(
      "/auto-poster/publish",
      { method: "POST", body: JSON.stringify(payload) }
    ),

  scheduleStudioPost: (payload: { email: string; postId: string; scheduledAt: string }) =>
    request<{ ok: boolean; post: StudioPostRecord; error?: string }>("/auto-poster/schedule", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  unscheduleStudioPost: (payload: { email: string; postId: string }) =>
    request<{ ok: boolean; post: StudioPostRecord; error?: string }>("/auto-poster/unschedule", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  rewriteStudioPost: (payload: {
    email: string;
    postId: string;
    tone?: string;
    includeImages?: boolean;
    imageSource?: "auto" | "ai" | "free";
  }) =>
    request<{
      ok: boolean;
      post: StudioPostRecord;
      unlocked?: boolean;
      restoredFromArchive?: boolean;
      previousPublishedAt?: string | null;
      error?: string;
    }>("/auto-poster/rewrite", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  setStudioPostImage: (payload: {
    email: string;
    postId: string;
    action?: "generate" | "clear";
    imageSource?: "auto" | "ai" | "free";
  }) =>
    request<{
      ok: boolean;
      post: StudioPostRecord;
      imageMeta?: { url?: string | null; source?: string; provider?: string | null };
      error?: string;
    }>("/auto-poster/post-image", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 2 * 60 * 1000,
    }),

  attachStudioImages: (payload: {
    email: string;
    workspaceId?: string;
    imageSource?: "auto" | "ai" | "free";
    onlyMissing?: boolean;
    postIds?: string[];
  }) =>
    request<{
      ok: boolean;
      attached: number;
      failed: number;
      imageSource: string;
      providerDecision?: {
        method?: string;
        writing?: { id: string; model: string; label: string; reason: string };
        image?: {
          id: string;
          model: string | null;
          source: string;
          label: string;
          reason: string;
        };
      };
      posts: StudioPostRecord[];
      error?: string;
    }>("/auto-poster/attach-images", {
      method: "POST",
      body: JSON.stringify(payload),
      timeoutMs: 5 * 60 * 1000,
    }),
};

export type ConnectedAccount = {
  id: string;
  provider: string;
  authType: string;
  status: string;
  accountId: string | null;
  accountName: string | null;
  accountUrl: string | null;
  tokenExpiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
  publishReady?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ConnectionsSetup = {
  facebook: boolean;
  instagram: boolean;
  google_business: boolean;
  linkedin: boolean;
  callbacks?: Record<string, string>;
};

export type ApiUserState = {
  email: string;
  planId: string;
  planName: string;
  credits: number;
  creditLimit: number;
  unlimitedCredits?: boolean;
  walletBalanceUsd?: number;
  accountStatus?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  phone?: string | null;
  cardOnFile?: boolean;
  cardLast4?: string | null;
  fullyVerified?: boolean;
  notifyEmail?: boolean;
  notifyWhatsapp?: boolean;
  notifyTelegram?: boolean;
  whatsappNumber?: string | null;
  telegramChatId?: string | null;
  usage: {
    scrapedPages: number;
    uniquePosts: number;
    aiImages: number;
    gbpReplies: number;
  };
  transactions: Array<{
    id: string;
    type: string;
    amount: number;
    label: string;
    timestamp: string;
    tokens?: number;
  }>;
};

export type GenerateResult = {
  ok: boolean;
  content: string;
  creditsDeducted: number;
  creditsLeft: number;
  walletBalanceUsd?: number;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    apiCostUsd: number;
  };
  usageDetails?: Record<string, unknown>;
  model?: string;
  mock?: boolean;
  error?: string;
};

export function isApiError(err: unknown): err is { status: number; error: string } {
  return !!err && typeof err === "object" && "error" in err;
}
