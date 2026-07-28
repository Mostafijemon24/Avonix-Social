/** Paid plans may top up wallet (real gateway) and spend wallet balance */
export function isPaidPlanSlug(slug) {
  return slug === "pro" || slug === "agency";
}

export function canUseWalletBalance(user) {
  if (!user) return false;
  if (user.unlimitedCredits) return true;
  const slug = user.package?.slug || "free";
  return isPaidPlanSlug(slug);
}

export function isGatewayConfigured(gateway) {
  if (gateway === "stripe") return !!process.env.STRIPE_SECRET_KEY;
  if (gateway === "paypal") {
    return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
  }
  return false;
}

/** Local dev only — never enable on production VPS */
export function allowDemoTopUp() {
  return process.env.ALLOW_DEMO_TOPUP === "true";
}

export function spendableWalletUsd(user) {
  if (!canUseWalletBalance(user)) return 0;
  return user.walletBalanceUsd || 0;
}
