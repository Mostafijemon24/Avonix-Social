/**
 * Admin API client — Super Admin panel
 * Session lives in sessionStorage only (cleared on tab close + idle logout).
 */
const ADMIN_API =
  process.env.NEXT_PUBLIC_API_URL?.replace("/api", "/api/admin") ||
  "http://localhost:4000/api/admin";

const TOKEN_KEY = "avonix-admin-token";
const ACTIVITY_KEY = "avonix-admin-last-activity";
const PREAUTH_KEY = "avonix-admin-preauth";
export const ADMIN_IDLE_MS = 30 * 60 * 1000; // 30 minutes

function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

async function adminRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(`${ADMIN_API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data as T;
}

export const adminApi = {
  /** Step 1 — password */
  login: (email: string, password: string) =>
    adminRequest<{
      ok: boolean;
      requires2fa: boolean;
      preAuthToken: string;
      email: string;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  /** Step 2 — TOTP */
  verify2fa: (preAuthToken: string, code: string) =>
    adminRequest<{
      ok: boolean;
      token: string;
      expiresInSeconds: number;
      idleTimeoutSeconds: number;
      admin: { email: string; name: string };
    }>("/auth/verify-2fa", {
      method: "POST",
      body: JSON.stringify({ preAuthToken, code }),
    }),

  me: () =>
    adminRequest<{
      id: string;
      email: string;
      name: string | null;
      role: string;
      totpEnabled: boolean;
    }>("/auth/me"),

  changePassword: (currentPassword: string, newPassword: string, totpCode: string) =>
    adminRequest<{ ok: boolean; message?: string; error?: string }>("/auth/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword, totpCode }),
    }),

  dashboard: () => adminRequest<DashboardStats>("/dashboard"),

  users: () => adminRequest<AdminUser[]>("/users"),

  user: (id: string) => adminRequest<UserDetail>(`/users/${id}`),

  createUser: (data: {
    email: string;
    name?: string;
    phone?: string;
    company?: string;
    planSlug?: string;
    credits?: number;
    unlimitedCredits?: boolean;
    notes?: string;
    password: string;
    sendWelcomeEmail?: boolean;
  }) =>
    adminRequest<{
      ok: boolean;
      user: AdminUser;
      delivery?: { email?: string | null; emailError?: string | null };
    }>("/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  setUserPassword: (id: string, password: string) =>
    adminRequest<{ ok: boolean; user: AdminUser }>(`/users/${id}/password`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    }),

  updateUser: (
    id: string,
    data: Partial<{
      name: string;
      phone: string;
      company: string;
      notes: string;
      planSlug: string;
      credits: number;
      unlimitedCredits: boolean;
      resetCreditsOnPlanChange: boolean;
    }>
  ) =>
    adminRequest<{ ok: boolean; user: AdminUser }>(`/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  setUnlimited: (id: string, unlimited: boolean, reason?: string) =>
    adminRequest<{ ok: boolean; user: AdminUser }>(`/users/${id}/unlimited`, {
      method: "PUT",
      body: JSON.stringify({ unlimited, reason }),
    }),

  deleteUser: (id: string) =>
    adminRequest<{ ok: boolean; deleted: string }>(`/users/${id}`, { method: "DELETE" }),

  adjustCredits: (id: string, credits: number, reason: string) =>
    adminRequest<{ ok: boolean; credits: number }>(`/users/${id}/credits`, {
      method: "PUT",
      body: JSON.stringify({ credits, reason }),
    }),

  subscriptions: () => adminRequest<AdminSubscription[]>("/subscriptions"),

  revenue: () => adminRequest<RevenueReport>("/revenue"),

  plans: () => adminRequest<AdminPlan[]>("/plans"),

  createPlan: (data: {
    name: string;
    slug?: string;
    monthlyCredits: number;
    priceUsd: number;
    renewalDays?: number;
  }) =>
    adminRequest<{ ok: boolean; plan: AdminPlan }>("/plans", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updatePlan: (slug: string, data: Partial<AdminPlan>) =>
    adminRequest<AdminPlan>(`/plans/${slug}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deletePlan: (slug: string) =>
    adminRequest<{ ok: boolean; deleted?: string; softDeleted?: boolean }>(`/plans/${slug}`, {
      method: "DELETE",
    }),

  leads: (status?: string) =>
    adminRequest<Lead[]>(status ? `/leads?status=${encodeURIComponent(status)}` : "/leads"),

  createLead: (data: Partial<Lead> & { name: string; email: string }) =>
    adminRequest<{ ok: boolean; lead: Lead }>("/leads", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateLead: (id: string, data: { status?: string; notes?: string }) =>
    adminRequest<{ ok: boolean; lead: Lead }>(`/leads/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteLead: (id: string) =>
    adminRequest<{ ok: boolean }>(`/leads/${id}`, { method: "DELETE" }),

  config: () => adminRequest<Record<string, string>>("/config"),

  saveConfig: (config: Record<string, string>) =>
    adminRequest<{ ok: boolean; config: Record<string, string> }>("/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),

  updateConfig: (config: Record<string, string>) =>
    adminRequest<{ ok: boolean; config: Record<string, string> }>("/config", {
      method: "PUT",
      body: JSON.stringify(config),
    }),
};

export function saveAdminToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(TOKEN_KEY); // never keep in persistent storage
  touchAdminActivity();
}

export function savePreAuthToken(token: string) {
  sessionStorage.setItem(PREAUTH_KEY, token);
}

export function getPreAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(PREAUTH_KEY);
}

export function clearPreAuthToken() {
  sessionStorage.removeItem(PREAUTH_KEY);
}

export function touchAdminActivity() {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(ACTIVITY_KEY, String(Date.now()));
}

export function getLastAdminActivity(): number {
  if (typeof window === "undefined") return 0;
  return Number(sessionStorage.getItem(ACTIVITY_KEY) || 0);
}

/** Wipe all admin session traces from the browser */
export function wipeAdminSession() {
  if (typeof window === "undefined") return;

  const keys = [TOKEN_KEY, ACTIVITY_KEY, PREAUTH_KEY, "avonix-admin-token"];
  for (const k of keys) {
    try {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }

  // Clear any avonix-admin* keys
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("avonix-admin")) localStorage.removeItem(k);
    }
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("avonix-admin")) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }

  // Expire cookies on this host that look like admin session
  try {
    document.cookie.split(";").forEach((c) => {
      const name = c.split("=")[0]?.trim();
      if (name && name.toLowerCase().includes("avonix")) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      }
    });
  } catch {
    /* ignore */
  }

  // Clear Cache Storage entries for this origin (best-effort)
  if ("caches" in window) {
    caches.keys().then((names) => {
      names.forEach((name) => {
        if (name.toLowerCase().includes("avonix") || name.toLowerCase().includes("admin")) {
          caches.delete(name);
        }
      });
    });
  }
}

/** @deprecated use wipeAdminSession */
export function clearAdminToken() {
  wipeAdminSession();
}

export function isAdminLoggedIn() {
  const token = getAdminToken();
  if (!token) return false;
  const last = getLastAdminActivity();
  if (last && Date.now() - last > ADMIN_IDLE_MS) {
    wipeAdminSession();
    return false;
  }
  return true;
}

export type DashboardStats = {
  userCount: number;
  activeSubscriptions: number;
  totalRevenue: number;
  monthlyRevenue: number;
  totalApiCostUsd: number;
  totalCreditsUsed: number;
  totalRequests: number;
  profitEstimate: number;
  recentUsers: AdminUser[];
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  phone?: string | null;
  company?: string | null;
  notes?: string | null;
  source?: string | null;
  planId: string;
  planName: string;
  credits: number;
  creditLimit: number;
  unlimitedCredits?: boolean;
  priceUsd: number;
  hasPassword?: boolean;
  emailVerified?: boolean;
  cardOnFile?: boolean;
  accountStatus?: string | null;
  createdAt: string;
  updatedAt?: string;
  usageCount?: number;
  subscription?: { gateway: string; status: string; periodEnd: string | null } | null;
};

export type UserDetail = AdminUser & {
  registration?: {
    email: string;
    name: string | null;
    phone: string | null;
    company: string | null;
    source: string | null;
    notes: string | null;
    registeredAt: string;
    lastUpdated: string;
    plan: string;
    unlimitedCredits: boolean;
    hasPassword?: boolean;
    emailVerified?: boolean;
    cardOnFile?: boolean;
    accountStatus?: string | null;
  };
  usageStats: {
    totalCredits: number;
    totalTokens: number;
    totalApiCost: number;
    sitemapParses: number;
    socialPosts: number;
    gbpPosts: number;
    reviewReplies: number;
  };
  usageLogs: Array<{
    id: string;
    action: string;
    model: string | null;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    apiCostUsd: number;
    creditsDeducted: number;
    createdAt: string;
  }>;
  paymentLogs: Array<{
    id: string;
    amountUsd: number;
    gateway: string;
    plan: string;
    status: string;
    createdAt: string;
  }>;
};

export type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  message: string | null;
  source: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminSubscription = {
  id: string;
  userId: string;
  status: string;
  gateway: string;
  gatewaySubId: string | null;
  currentPeriodEnd: string | null;
  createdAt: string;
  user: { email: string; name: string | null; remainingCredits: number };
  package: { name: string; priceUsd: number; slug?: string };
};

export type PaymentLog = {
  id: string;
  email: string;
  plan: string;
  amountUsd: number;
  gateway: string;
  createdAt: string;
};

export type RevenueReport = {
  total: number;
  byGateway: Record<string, number>;
  byPlan: Record<string, number>;
  payments: PaymentLog[];
};

export type ApiConfig = Record<string, string>;

export type AdminPlan = {
  id: string;
  slug: string;
  name: string;
  monthlyCredits: number;
  priceUsd: number;
  renewalDays: number;
  isActive: boolean;
};
