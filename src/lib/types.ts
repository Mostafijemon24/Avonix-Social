import type { CreditAction, PlanId } from "./credits";

export type UsageStats = {
  scrapedPages: number;
  uniquePosts: number;
  aiImages: number;
  gbpReplies: number;
};

export type SitemapData = {
  url: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  location: string;
  address: string;
  urlCount: number;
  parsedAt: string;
};

export type CreditTransaction = {
  id: string;
  type: "debit" | "credit";
  amount: number;
  label: string;
  balanceAfter: number;
  timestamp: string;
};

export type WorkspaceState = {
  email: string;
  planId: PlanId;
  credits: number;
  creditLimit: number;
  unlimitedCredits?: boolean;
  walletBalanceUsd?: number;
  accountStatus?: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  cardOnFile?: boolean;
  cardLast4?: string | null;
  cardBrand?: string | null;
  fullyVerified?: boolean;
  usage: UsageStats;
  sitemap: SitemapData | null;
  transactions: CreditTransaction[];
  loggedIn: boolean;
  activeWorkspaceId?: string | null;
  workspaces?: ClientWorkspaceSummary[];
  workspaceLimit?: number;
};

export type ClientWorkspaceSummary = {
  id: string;
  name: string;
  websiteUrl?: string | null;
  domain?: string | null;
  notes?: string | null;
  isActive?: boolean;
  sitemap: SitemapData | null;
  createdAt?: string;
  updatedAt?: string;
};

export type SpendResult =
  | { ok: true; newBalance: number }
  | { ok: false; reason: "insufficient"; required: number; available: number };

export type CreditActionMeta = {
  action: CreditAction;
  label?: string;
};
