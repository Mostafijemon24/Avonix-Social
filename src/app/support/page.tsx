"use client";

import Link from "next/link";
import { PublicLayout } from "@/components/public/PublicLayout";
import { SupportTicketForm } from "@/components/support/SupportTicketForm";

const FAQS = [
  {
    q: "How do I connect Facebook, Instagram, or Google Business?",
    a: "Open Dashboard → Connections. Use OAuth when API keys are configured, or save the profile URL for reference. Each client workspace has its own connections.",
  },
  {
    q: "Why can’t I publish a post?",
    a: "Publishing needs an OAuth-connected account (not URL-only). Instagram also needs a public image URL. Complete Connections for the active client workspace first.",
  },
  {
    q: "I forgot my password / old account has no password",
    a: "Sign-in now requires email + password. Accounts created before password auth must register again with a strong password, or contact us below with your account email.",
  },
  {
    q: "How do multi-client workspaces work?",
    a: "Use Client Workspace in the header to add/switch clients. Sitemap keywords and social connections are stored per client. Free = 1, Pro = 10, Agency = 100 workspaces.",
  },
  {
    q: "Credits and billing questions",
    a: "Open Dashboard → Plan & Price for plans, wallet top-up, and usage. Generation uses USD cost–based credits via OpenRouter.",
  },
];

export default function SupportPage() {
  return (
    <PublicLayout>
      <div className="flex-1 px-4 py-16 max-w-5xl mx-auto text-center sm:text-left animate-fade-in">
        <h1 className="text-3xl font-black text-white mb-2">Support Center</h1>
        <p className="text-slate-400 text-xs sm:text-sm mb-10">
          Help with connections, publishing, workspaces, passwords, and billing. Logged-in users can
          also open{" "}
          <Link href="/dashboard/support" className="text-orange-400 hover:underline font-bold">
            Dashboard → Support
          </Link>
          .
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-3 text-left">
            <h2 className="text-sm font-bold text-white mb-2">Frequently asked</h2>
            {FAQS.map((item) => (
              <details
                key={item.q}
                className="glass-card rounded-2xl border border-navy-800 p-4 group"
              >
                <summary className="text-xs font-bold text-slate-200 cursor-pointer list-none flex justify-between gap-2">
                  {item.q}
                  <span className="text-orange-400 group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">{item.a}</p>
              </details>
            ))}

            <div className="glass-card p-5 rounded-2xl border border-navy-800 text-xs text-slate-400 mt-4">
              <p className="font-bold text-white mb-1">Direct email</p>
              <a href="mailto:support@avonixsocial.com" className="text-orange-400 hover:underline">
                support@avonixsocial.com
              </a>
              <p className="mt-2">Typical reply within 2 business hours.</p>
            </div>
          </div>

          <div className="glass-card p-6 rounded-2xl border border-navy-800 text-left">
            <h2 className="text-lg font-bold text-white mb-1">Submit a ticket</h2>
            <p className="text-[11px] text-slate-400 mb-5">
              Tell us what broke or what you need. We route tickets to the support team.
            </p>
            <SupportTicketForm source="support" />
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
