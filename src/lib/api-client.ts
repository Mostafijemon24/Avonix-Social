const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });

  const data = await res.json();

  if (!res.ok) {
    throw { status: res.status, ...data };
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
