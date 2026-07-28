"use client";

import Link from "next/link";
import { useState } from "react";
import { MapPin, Globe2, Sparkles } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api } from "@/lib/api-client";
import { CreditCostBadge, InsufficientCreditsBanner } from "@/components/ui/CreditCostBadge";

type Step = "domain" | "keywords" | "location";

export default function SitemapPage() {
  const { showToast } = useToast();
  const { state, setSitemapData, refreshState, applyApiCredits } = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [domain, setDomain] = useState("");
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
  const affordable = state.credits >= cost || !!state.unlimitedCredits;

  const analyzeDomain = async () => {
    if (!domain.trim()) {
      showToast("Enter a root domain, e.g. example.com", "error");
      return;
    }
    if (!affordable) {
      showToast(`Insufficient credits! Need ${cost}, you have ${state.credits}.`, "error");
      return;
    }

    setLoading(true);
    try {
      // Analyze first — only charge if it succeeds
      const result = await api.analyzeSite({
        domain: domain.trim(),
        email: state.email,
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
      applyApiCredits(spend.creditsLeft);

      setPrimaryKeyword(result.primaryKeyword);
      setSecondaryText(result.secondaryKeywords.join(", "));
      setMeta({
        domain: result.domain,
        urlCount: result.urlCount,
        pagesAnalyzed: result.pagesAnalyzed,
        method: result.method,
      });
      setLocation("");
      setAddress("");
      setStep("keywords");
      await refreshState();
      showToast(
        `Analyzed ${result.pagesAnalyzed} pages (${result.urlCount} sitemap URLs). Review keywords, then add location.`,
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

  const goToLocation = () => {
    if (!primaryKeyword.trim()) {
      showToast("Primary keyword is required.", "error");
      return;
    }
    setStep("location");
  };

  const saveWorkspace = async () => {
    if (!location.trim()) {
      showToast("Please enter your city / region location.", "error");
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
      showToast("Keywords & location saved for this client workspace.", "success");
    } catch (err) {
      showToast("Failed to save workspace sitemap data", "error");
    }
  };

  const sitemap = state.sitemap;

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
          <h2 className="text-base font-bold text-white">Sitemap Keyword & Location Parser</h2>
          <CreditCostBadge action="sitemap_parse" />
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Client:{" "}
          <span className="text-orange-400 font-bold">
            {(state.workspaces || []).find((w) => w.id === state.activeWorkspaceId)?.name ||
              "Active workspace"}
          </span>
          . Enter only your root domain. AI scans sitemap pages and posts to extract primary &amp;
          secondary keywords — then you confirm location.
        </p>

        <div className="flex flex-wrap gap-2 mb-6 text-[10px] font-bold uppercase tracking-wide">
          <StepPill active={step === "domain"} done={step !== "domain"} label="1. Domain" />
          <StepPill
            active={step === "keywords"}
            done={step === "location" || !!sitemap}
            label="2. Keywords"
          />
          <StepPill active={step === "location"} done={!!sitemap?.location} label="3. Location" />
        </div>

        {!affordable && (
          <div className="mb-4">
            <InsufficientCreditsBanner required={cost} available={state.credits} />
          </div>
        )}

        {step === "domain" && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="md:col-span-3">
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
              <p className="text-[10px] text-slate-500 mt-1.5">
                No sitemap URL needed — e.g. <span className="text-slate-300">nexadigital.com</span>
              </p>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={analyzeDomain}
                disabled={loading || !affordable}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl text-xs transition-all shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {loading ? "Analyzing pages..." : `Analyze (${cost} cr)`}
              </button>
            </div>
          </div>
        )}

        {step === "keywords" && (
          <div className="space-y-4 text-left">
            {meta && (
              <p className="text-[10px] text-slate-500">
                {meta.domain} · {meta.pagesAnalyzed} pages analyzed · {meta.urlCount} sitemap URLs ·
                method: {meta.method}
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
                className="w-full text-xs font-semibold border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-indigo-300 focus:ring-2 focus:ring-orange-500 outline-none resize-y"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setStep("domain")}
                className="text-xs font-bold text-slate-400 hover:text-white py-2.5 px-4"
              >
                ← Change domain
              </button>
              <button
                type="button"
                onClick={goToLocation}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-4 rounded-xl text-xs"
              >
                Next: Confirm Location →
              </button>
            </div>
          </div>
        )}

        {step === "location" && (
          <div className="space-y-4 text-left">
            <div className="flex items-center gap-2 text-amber-400 font-bold text-xs mb-1">
              <MapPin className="w-4 h-4" />
              Where is this business located?
            </div>
            <p className="text-[10px] text-slate-500 -mt-2 mb-2">
              Location is not guessed automatically — enter the real city/region for local SEO posts.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Target City / Region *
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Manhattan, New York, USA"
                  className="w-full text-xs font-bold bg-navy-900 border border-navy-700 rounded-xl px-3 py-2.5 text-white outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Full Physical Address (optional)
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Street, suite, ZIP"
                  className="w-full text-xs font-bold bg-navy-900 border border-navy-700 rounded-xl px-3 py-2.5 text-white outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => setStep("keywords")}
                className="text-xs font-bold text-slate-400 hover:text-white py-2.5 px-4"
              >
                ← Edit keywords
              </button>
              <button
                type="button"
                onClick={saveWorkspace}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-4 rounded-xl text-xs"
              >
                Save Keywords &amp; Location
              </button>
            </div>
          </div>
        )}
      </div>

      {sitemap?.location && (
        <div className="glass-panel p-6 rounded-2xl border border-orange-500/30 text-white">
          <div className="flex flex-col md:flex-row justify-between items-center mb-4 gap-3">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-orange-400 bg-orange-950 border border-orange-800 px-2.5 py-0.5 rounded-full">
                Saved Workspace
              </span>
              <h3 className="text-lg font-black mt-2">{sitemap.primaryKeyword}</h3>
              <p className="text-[10px] text-slate-500 mt-1">
                {sitemap.url} · {sitemap.location}
                {sitemap.address ? ` · ${sitemap.address}` : ""} · {sitemap.urlCount} URLs
              </p>
            </div>
            <Link
              href="/dashboard/social-post"
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-lg transition-all"
            >
              Proceed to Post Writer →
            </Link>
          </div>
          <div className="bg-navy-900 p-4 rounded-xl border border-navy-800 text-xs text-left">
            <span className="text-slate-400 font-bold block mb-1">Secondary Keywords:</span>
            <span className="text-indigo-300 font-semibold">
              {sitemap.secondaryKeywords.join(", ")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function StepPill({
  label,
  active,
  done,
}: {
  label: string;
  active: boolean;
  done: boolean;
}) {
  return (
    <span
      className={`px-3 py-1 rounded-full border ${
        active
          ? "border-orange-500 text-orange-400 bg-orange-500/10"
          : done
            ? "border-emerald-700 text-emerald-400 bg-emerald-950/30"
            : "border-navy-700 text-slate-500"
      }`}
    >
      {label}
    </span>
  );
}
