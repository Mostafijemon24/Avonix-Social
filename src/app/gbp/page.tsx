import { PublicLayout } from "@/components/public/PublicLayout";

export const metadata = { title: "GBP Automation" };

export default function GbpPage() {
  return (
    <PublicLayout>
      <div className="flex-1 px-4 py-16 max-w-5xl mx-auto text-center sm:text-left animate-fade-in">
        <h1 className="text-3xl font-black text-white mb-2">
          Google Business Profile Review Automation
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm mb-12">
          Improve local search visibility and manage customer feedback with dual AI operating
          modes.
        </p>

        <div className="space-y-8 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <div className="glass-card p-8 rounded-2xl border border-navy-800">
            <h2 className="text-xl font-bold text-white mb-3">
              1. Confirm-to-Reply Mode (Human Oversight)
            </h2>
            <p className="mb-4">
              The AI automatically drafts personalized, brand-aligned responses for incoming
              Google reviews. The drafts appear on your dashboard or trigger WhatsApp alerts
              for quick one-click approval before publishing to Google.
            </p>
            <p className="text-slate-400">
              Recommended for businesses requiring strict human compliance checks on all
              public communications.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl border border-navy-800">
            <h2 className="text-xl font-bold text-white mb-3">
              2. Full Auto-Reply Mode (100% Hands-Free)
            </h2>
            <p className="mb-4">
              Positive 4-star and 5-star customer reviews receive instant personalized AI
              replies within 2 minutes of submission. Critical 1-3 star reviews are held for
              manual review to protect your brand reputation.
            </p>
            <p className="text-slate-400">
              Ideal for high-volume local businesses like restaurants, medical practices, and
              service centers.
            </p>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
