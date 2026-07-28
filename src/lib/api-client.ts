const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...options?.headers },
      ...options,
    });
  } catch {
    throw { status: 0, error: `Cannot reach API (${API_BASE}). Is the backend running?` };
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

export const api = {
  register: (payload: { email: string; phone: string; name?: string; company?: string }) =>
    request<{
      ok: boolean;
      email: string;
      phone: string;
      next: string;
      delivery?: { email?: string; sms?: string };
    }>("/auth/register", { method: "POST", body: JSON.stringify(payload) }),

  verify: (payload: { email: string; emailCode: string; phoneCode: string }) =>
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

  login: (email: string) =>
    request<{ ok: boolean; user: ApiUserState }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

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

  spendFixed: (payload: { email: string; action: string; metadata?: Record<string, unknown> }) =>
    request<{ ok: boolean; creditsDeducted: number; creditsLeft: number }>("/credits/spend", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  analyzeSite: (payload: { domain: string; email?: string }) =>
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

  getConnections: (email: string) =>
    request<{
      ok: boolean;
      accounts: ConnectedAccount[];
      byProvider: Record<string, ConnectedAccount | null>;
      setup: ConnectionsSetup;
    }>(`/connections?email=${encodeURIComponent(email)}`),

  startConnectionOAuth: (email: string, provider: string) =>
    request<{ ok: boolean; authUrl: string; redirectUri?: string; error?: string }>(
      `/connections/oauth/${encodeURIComponent(provider)}/start?email=${encodeURIComponent(email)}`
    ),

  saveManualConnection: (payload: {
    email: string;
    provider: string;
    accountUrl: string;
    accountName?: string;
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
    action: "social_post" | "gbp_post" | "review_reply";
    providers?: string[];
    imageUrl?: string;
    reviewName?: string;
    connectionIds?: string[];
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
