/**
 * Credit Calculation Engine — USD Cost Based
 * ───────────────────────────────────────────
 * Formula:
 *   actualCostUSD = (promptTokens × inputPrice) + (completionTokens × outputPrice)
 *   credits       = max(1, ceil(actualCostUSD × MARGIN × CREDITS_PER_DOLLAR))
 *
 * Configure in .env:
 *   CREDITS_PER_DOLLAR=100   → $1.00 = 100 credits ($0.01 = 1 credit)
 *   MARGIN_MULTIPLIER=1.3    → 30% profit margin on top of OpenRouter cost
 */

export const CREDITS_PER_DOLLAR = Number(process.env.CREDITS_PER_DOLLAR || 100);
export const MARGIN_MULTIPLIER = Number(process.env.MARGIN_MULTIPLIER || 1.3);
export const MIN_CREDITS_PER_REQUEST = 1;

/** Fixed credit costs for non-AI actions (sitemap parse, etc.) */
export const FIXED_ACTION_COSTS = {
  sitemap_parse: 1,
};

/** Default OpenRouter models per action */
export const ACTION_MODELS = {
  social_post: process.env.DEFAULT_AI_MODEL || "google/gemini-2.5-flash",
  gbp_post: process.env.DEFAULT_AI_MODEL || "google/gemini-2.5-flash",
  review_reply: process.env.DEFAULT_AI_MODEL || "google/gemini-2.5-flash",
};

/**
 * Calculate actual USD cost from per-token prices (OpenRouter rates)
 */
export function calculateUsdCost({ promptTokens, completionTokens, promptPrice, completionPrice }) {
  return promptTokens * promptPrice + completionTokens * completionPrice;
}

/**
 * Convert USD cost to credits with margin + minimum 1 credit rule
 */
export function usdCostToCredits(actualCostUsd) {
  const costWithMargin = actualCostUsd * MARGIN_MULTIPLIER;
  const rawCredits = costWithMargin * CREDITS_PER_DOLLAR;
  return Math.max(MIN_CREDITS_PER_REQUEST, Math.ceil(rawCredits));
}

export function getFixedCost(action) {
  return FIXED_ACTION_COSTS[action] ?? null;
}

/** USD debited from wallet when plan credits are exhausted (1 credit ≈ $0.01) */
export function fixedActionUsd(action) {
  const credits = getFixedCost(action);
  if (!credits) return null;
  return Math.max(0.01, credits / CREDITS_PER_DOLLAR);
}

export function creditsToUsd(credits) {
  return Math.max(0.01, credits / CREDITS_PER_DOLLAR);
}

export function getCreditConfig() {
  return {
    mode: "usd_cost",
    creditsPerDollar: CREDITS_PER_DOLLAR,
    marginMultiplier: MARGIN_MULTIPLIER,
    minCreditsPerRequest: MIN_CREDITS_PER_REQUEST,
    formula: "credits = max(1, ceil((promptTokens×inputPrice + completionTokens×outputPrice) × margin × creditsPerDollar))",
  };
}
