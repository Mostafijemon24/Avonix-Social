export const PUBLIC_NAV = [
  { href: "/", label: "Home", match: "home" },
  { href: "/features", label: "Features", match: "features" },
  { href: "/how-it-works", label: "How It Works", match: "howitworks" },
  { href: "/gbp", label: "GBP Automation", match: "gbp" },
  { href: "/pricing", label: "Pricing & Plans", match: "pricing" },
  { href: "/api-integrations", label: "API Integrations", match: "api" },
  { href: "/about", label: "About Us", match: "about" },
  { href: "/support", label: "Support", match: "support" },
  { href: "/contact", label: "Contact Us", match: "contact" },
] as const;

export const DASHBOARD_PRIMARY_NAV = [
  { href: "/dashboard", label: "Dashboard", id: "dashboard" },
  { href: "/dashboard/social-post", label: "Content Studio", id: "socialpost" },
  { href: "/dashboard/connections", label: "Connections", id: "connections" },
] as const;

export const DASHBOARD_MORE_NAV = [
  { href: "/dashboard/library", label: "Post Library", id: "library" },
  { href: "/dashboard/automation", label: "30-Day Automation", id: "automation" },
  { href: "/dashboard/scheduling", label: "Scheduling", id: "scheduling" },
  { href: "/dashboard/review-reply", label: "Review Reply", id: "reviewreply" },
  { href: "/dashboard/notification", label: "Notifications", id: "notification" },
  { href: "/dashboard/report", label: "Reports", id: "report" },
  { href: "/dashboard/billing", label: "Billing", id: "billing" },
  { href: "/dashboard/support", label: "Support", id: "support" },
  { href: "/dashboard/audit", label: "Pre-Production Audit", id: "audit" },
] as const;

export const DASHBOARD_NAV = [
  ...DASHBOARD_PRIMARY_NAV,
  ...DASHBOARD_MORE_NAV,
] as const;

export const PRICING_PLANS = [
  {
    id: "free",
    name: "Free Trial",
    price: 0,
    description: "10 Posts and 1 sitemap parse included.",
    cta: "Start Free Trial",
    recommended: false,
  },
  {
    id: "pro",
    name: "Pro Growth",
    price: 29,
    description: "300 Credits, 5 Intent Modes & GBP Auto-Reply.",
    cta: "Subscribe Now",
    recommended: true,
  },
  {
    id: "agency",
    name: "Agency Enterprise",
    price: 89,
    description: "Unlimited sitemaps & WhatsApp dispatch alerts.",
    cta: "Subscribe Agency",
    recommended: false,
  },
] as const;
