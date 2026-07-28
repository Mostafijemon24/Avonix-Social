"use client";

import Link from "next/link";
import { useState } from "react";
import { MapPin, Globe2, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api } from "@/lib/api-client";
import { canAffordUsage } from "@/lib/credits";
import { CreditCostBadge, InsufficientCreditsBanner } from "@/components/ui/CreditCostBadge";

type Step = "domain" | "keywords";

export default function SitemapPage() {
  const { showToast } = useToast();
  const { state, setSitemapData, refreshState, applyApiCredits } = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [domain, setDomain] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [step, setStep] = useState<Step>("domain");

  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [secondaryText, setSecondaryText] = useState("");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");
  const [meta, setMeta] = useState<{
    domain: string;
    urlCount: number;
    pagesAnalyzed: number;
    method: string;
  } | null>(null);

  const cost = 1;
  const affordable = canAffordUsage(state, cost);

  const analyzeDomain = async () => {
    if (!domain.trim()) {
      showToast("Enter a root domain, e.g. example.com", "error");
      return;
    }
    if (!locationInput.trim()) {
      showToast("Enter city / region so keywords can be location-focused.", "error");
      return;
    }
    if (!affordable) {
      showToast(`Insufficient credits! Need ${cost}, you have ${state.credits}.`, "error");
      return;
    }

    setLoading(true);
    try {
      const result = await api.analyzeSite({
        domain: domain.trim(),
        email: state.email,
        location: locationInput.trim(),
      });

      if (!result.ok) {
        showToast(result.error || "Site analysis failed.", "error");
        return;
      }

      const spend = await api.spendFixed({
        email: state.email,
        action: "sitemap_parse",
        metadata: {
          domain: result.domain,
          pagesAnalyzed: result.pagesAnalyzed,
          urlCount: result.urlCount,
        },
      });
      applyApiCredits(spend.creditsLeft, spend.walletBalanceUsd);

      setPrimaryKeyword(result.primaryKeyword);
      setSecondaryText(result.secondaryKeywords.join(", "));
      setLocation(result.location || locationInput.trim());
      setAddress(result.address || "");
      setMeta({
        domain: result.domain,
        urlCount: result.urlCount,
        pagesAnalyzed: result.pagesAnalyzed,
        method: result.method,
      });
      setStep("keywords");
      await refreshState();
      showToast(
        `Backend analyzed ${result.pagesAnalyzed} pages from ${result.urlCount} discovered URLs.`,
        "success"
      );
    } catch (err) {
      const msg =
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Site analysis failed. Check domain / API connection.";
      showToast(msg, "error");
      console.error("[analyzeSite]", err);
    } finally {
      setLoading(false);
    }
  };

  const saveWorkspace = async () => {
    if (!primaryKeyword.trim()) {
      showToast("Primary keyword is required.", "error");
      return;
    }
    if (!location.trim()) {
      showToast("Location is required.", "error");
      return;
    }
    if (!meta) return;

    const secondaryKeywords = secondaryText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      await setSitemapData({
        url: meta.domain,
        primaryKeyword: primaryKeyword.trim(),
        secondaryKeywords,
        location: location.trim(),
        address: address.trim(),
        urlCount: meta.urlCount,
        parsedAt: new Date().toISOString(),
      });
      showToast("Keywords saved for this client workspace.", "success");
    } catch {
      showToast("Failed to save workspace sitemap data", "error");
    }
  };

  const sitemap = state.sitemap;

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
          <h2 className="text-base font-bold text-white">Website Keyword Analyzer</h2>
          <CreditCostBadge action="sitemap_parse" />
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Client:{" "}
          <span className="text-orange-400 font-bold">
            {(state.workspaces || []).find((w) => w.id === state.activeWorkspaceId)?.name ||
              "Active workspace"}
          </span>
          . Backend discovers page/post URLs, reads content, and returns the best primary &amp;
          secondary keywords for your location. You only review the keywords.
        </p>

        <div className="flex flex-wrap gap-2 mb-6 text-[10px] font-bold uppercase tracking-wide">
          <StepPill active={step === "domain"} done={step !== "domain"} label="1. Domain + Location" />
          <StepPill active={step === "keywords"} done={!!sitemap} label="2. Keywords" />
        </div>

        {!affordable && (
          <div className="mb-4">
            <InsufficientCreditsBanner required={cost} available={state.credits} />
          </div>
        )}

        {step === "domain" && (
          <div className="space-y-4 text-left">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Website Root Domain
                </label>
                <div className="relative">
                  <Globe2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="example.com"
                    className="w-full text-xs font-semibold border border-navy-700 bg-navy-900 rounded-xl pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Target Location (city / region)
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={locationInput}
                    onChange={(e) => setLocationInput(e.target.value)}
                    placeholder="Denver, CO"
                    className="w-full text-xs font-semibold border border-navy-700 bg-navy-900 rounded-xl pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                  />
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={analyzeDomain}
              disabled={loading || !affordable}
              className="w-full md:w-auto bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl text-xs transition-all shadow-lg shadow-orange-500/20 inline-flex items-center justify-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {loading ? "Crawling pages & analyzing…" : `Analyze website (${cost} cr)`}
            </button>
            <p className="text-[10px] text-slate-500">
              Full crawl runs on the server (sitemap + pages/posts). This can take up to a minute.
            </p>
          </div>
        )}

        {step === "keywords" && (
          <div className="space-y-4 text-left">
            {meta && (
              <p className="text-[10px] text-slate-500">
                {meta.domain} · {meta.pagesAnalyzed} pages read · {meta.urlCount} URLs discovered ·{" "}
                {meta.method}
              </p>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">Primary Keyword</label>
              <input
                type="text"
                value={primaryKeyword}
                onChange={(e) => setPrimaryKeyword(e.target.value)}
                className="w-full text-xs font-bold border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-emerald-400 focus:ring-2 focus:ring-orange-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Secondary Keywords (comma-separated)
              </label>
              <textarea
                value={secondaryText}
                onChange={(e) => setSecondaryText(e.target.value)}
                rows={3}
                className="w-full text-xs border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-orange-500 outline-none"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full text-xs border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Street address (optional)
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full text-xs border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setStep("domain")}
                className="border border-navy-700 text-slate-300 text-xs font-bold px-4 py-2.5 rounded-xl"
              >
                Back
              </button>
              <button
                type="button"
                onClick={saveWorkspace}
                className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl"
              >
                Save keywords
              </button>
              <Link
                href="/dashboard/social-post"
                className="inline-flex items-center text-xs font-bold text-orange-400 hover:text-orange-300 px-2"
              >
                Generate social posts →
              </Link>
            </div>
          </div>
        )}
      </div>

      {sitemap?.location && (
        <div className="glass-card p-6 rounded-2xl border border-navy-800 text-left">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">Saved</p>
          <h3 className="text-lg font-black mt-2 text-white">{sitemap.primaryKeyword}</h3>
          <p className="text-xs text-slate-400 mt-1">
            {sitemap.url} · {sitemap.location}
            {sitemap.address ? ` · ${sitemap.address}` : ""} · {sitemap.urlCount} URLs
          </p>
          <p className="text-xs text-slate-300 mt-3">
            {(sitemap.secondaryKeywords || []).join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}

function StepPill({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <span
      className={`px-3 py-1 rounded-full border ${
        active
          ? "border-orange-500 text-orange-400 bg-orange-950/30"
          : done
            ? "border-emerald-700 text-emerald-400"
            : "border-navy-700 text-slate-500"
      }`}
    >
      {label}
    </span>
  );
}
