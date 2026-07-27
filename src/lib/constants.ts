export const PUBLIC_NAV = [
  { href: "/", label: "Home", match: "home" },
  { href: "/features", label: "Features", match: "features" },
  { href: "/how-it-works", label: "How It Works", match: "howitworks" },
  { href: "/gbp", label: "GBP Automation", match: "gbp" },
  { href: "/pricing", label: "Pricing & Plans", match: "pricing" },
  { href: "/api-integrations", label: "API Integrations", match: "api" },
  { href: "/about", label: "About Us", match: "about" },
  { href: "/contact", label: "Contact Us", match: "contact" },
] as const;

export const DASHBOARD_NAV = [
  { href: "/dashboard", label: "Dashboard", id: "dashboard" },
  { href: "/dashboard/analytics", label: "Analytics", id: "analytics" },
  { href: "/dashboard/sitemap", label: "Sitemap & Keywords", id: "sitemap" },
  { href: "/dashboard/social-post", label: "Social Post", id: "socialpost" },
  { href: "/dashboard/gbp-post", label: "GBP Post", id: "gbppost" },
  { href: "/dashboard/review-reply", label: "Review Reply", id: "reviewreply" },
  { href: "/dashboard/notification", label: "Notification", id: "notification" },
  { href: "/dashboard/report", label: "Report", id: "report" },
  { href: "/dashboard/billing", label: "Plan & Price", id: "billing" },
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
