"use client";

import Link from "next/link";
import { useState } from "react";
import { MapPin } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api, isApiError } from "@/lib/api-client";
import { CreditCostBadge, InsufficientCreditsBanner } from "@/components/ui/CreditCostBadge";

export default function SitemapPage() {
  const { showToast } = useToast();
  const { state, setSitemapData, refreshState, applyApiCredits } = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [sitemapUrl, setSitemapUrl] = useState("https://nexadigital.com/sitemap.xml");

  const sitemap = state.sitemap;
  const cost = 1;
  const affordable = state.credits >= cost;

  const processSitemap = async () => {
    if (!affordable) {
      showToast(`Insufficient credits! Need ${cost}, you have ${state.credits}.`, "error");
      return;
    }

    setLoading(true);
    try {
      const spend = await api.spendFixed({
        email: state.email,
        action: "sitemap_parse",
        metadata: { url: sitemapUrl },
      });

      applyApiCredits(spend.creditsLeft);

      const aiRes = await fetch("/api/ai?endpoint=/parse-sitemap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sitemapUrl }),
      });
      const data = await aiRes.json();
      const parsed = data.fallback ?? data;

      setSitemapData({
        url: sitemapUrl,
        primaryKeyword: parsed.primaryKeyword,
        secondaryKeywords: parsed.secondaryKeywords,
        location: parsed.location,
        address: parsed.address,
        urlCount: parsed.urlCount ?? 0,
        parsedAt: new Date().toISOString(),
      });

      await refreshState();
      showToast(`Sitemap parsed! ${spend.creditsDeducted} credit used. Balance: ${spend.creditsLeft}`, "success");
    } catch (err) {
      if (isApiError(err)) {
        showToast(err.error, "error");
      } else {
        showToast("Sitemap parse failed.", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
          <h2 className="text-base font-bold text-white">Sitemap Keyword & Location Parser</h2>
          <CreditCostBadge action="sitemap_parse" />
        </div>
        <p className="text-xs text-slate-400 mb-6">
          Fixed cost: 1 credit per parse. Logged in Usage Logs table.
        </p>

        {!affordable && (
          <div className="mb-4">
            <InsufficientCreditsBanner required={cost} available={state.credits} />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-3">
            <label className="block text-xs font-bold text-slate-300 mb-1">Sitemap XML URL</label>
            <input
              type="url"
              value={sitemapUrl}
              onChange={(e) => setSitemapUrl(e.target.value)}
              className="w-full text-xs font-semibold border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={processSitemap}
              disabled={loading || !affordable}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl text-xs transition-all shadow-lg shadow-orange-500/20"
            >
              {loading ? "Scraping..." : `Parse (${cost} cr)`}
            </button>
          </div>
        </div>
      </div>

      {sitemap && (
        <>
          <div className="glass-card border border-amber-500/30 p-6 rounded-2xl bg-amber-950/10">
            <div className="flex items-center space-x-2 text-amber-400 font-bold text-xs mb-3 justify-center sm:justify-start">
              <MapPin className="w-5 h-5 text-amber-500" />
              <span>AUTO-DETECTED LOCATION (EDITABLE):</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Target City / Region</label>
                <input
                  type="text"
                  defaultValue={sitemap.location}
                  className="w-full text-xs font-bold bg-navy-900 border border-navy-700 rounded-xl px-3 py-2.5 text-white outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Full Physical Address</label>
                <input
                  type="text"
                  defaultValue={sitemap.address}
                  className="w-full text-xs font-bold bg-navy-900 border border-navy-700 rounded-xl px-3 py-2.5 text-white outline-none"
                />
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 rounded-2xl border border-orange-500/30 text-white">
            <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-orange-400 bg-orange-950 border border-orange-800 px-2.5 py-0.5 rounded-full">
                  Homepage Focus
                </span>
                <h3 className="text-lg font-black mt-2">Homepage Keywords Extracted</h3>
                <p className="text-[10px] text-slate-500 mt-1">
                  {sitemap.urlCount} URLs · {new Date(sitemap.parsedAt).toLocaleString()}
                </p>
              </div>
              <Link
                href="/dashboard/social-post"
                className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-lg transition-all"
              >
                Proceed to Post Writer →
              </Link>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="bg-navy-900 p-4 rounded-xl border border-navy-800">
                <span className="text-slate-400 font-bold block mb-1">Primary Keyword:</span>
                <span className="text-emerald-400 font-extrabold text-sm">{sitemap.primaryKeyword}</span>
              </div>
              <div className="bg-navy-900 p-4 rounded-xl border border-navy-800">
                <span className="text-slate-400 font-bold block mb-1">Secondary Keywords:</span>
                <span className="text-indigo-300 font-semibold">
                  {sitemap.secondaryKeywords.join(", ")}
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
