/**
 * Credit System Configuration
 * ───────────────────────────
 * Edit this file to change credit costs, plan limits, and initial balances.
 * All dashboard actions read from here — single source of truth.
 */

export const CREDIT_COSTS = {
  sitemap_parse: 1,
  social_post: 2,
  gbp_post: 1,
  review_reply: 1,
} as const;

export type CreditAction = keyof typeof CREDIT_COSTS;

export const CREDIT_ACTION_LABELS: Record<CreditAction, string> = {
  sitemap_parse: "Sitemap Parse",
  social_post: "Facebook Post + AI Graphic",
  gbp_post: "GBP Local Post",
  review_reply: "AI Review Reply Draft",
};

export const PLAN_CONFIG = {
  free: {
    id: "free" as const,
    name: "Free Trial",
    creditLimit: 10,
    initialCredits: 10,
    monthlyCredits: 0,
  },
  pro: {
    id: "pro" as const,
    name: "Pro Growth",
    creditLimit: 300,
    initialCredits: 300,
    monthlyCredits: 300,
  },
  agency: {
    id: "agency" as const,
    name: "Agency Enterprise",
    creditLimit: 9999,
    initialCredits: 9999,
    monthlyCredits: 9999,
  },
} as const;

export type PlanId = keyof typeof PLAN_CONFIG;

export function getCreditCost(action: CreditAction): number {
  return CREDIT_COSTS[action];
}

export function getPlanCredits(planId: PlanId) {
  return PLAN_CONFIG[planId];
}
