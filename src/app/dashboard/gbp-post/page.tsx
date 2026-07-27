"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api, isApiError } from "@/lib/api-client";
import { InsufficientCreditsBanner } from "@/components/ui/CreditCostBadge";

export default function GbpPostPage() {
  const { showToast } = useToast();
  const router = useRouter();
  const { state, refreshState, applyApiCredits } = useWorkspace();
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);

  const kw = state.sitemap?.primaryKeyword ?? "Enterprise Local SEO Services";
  const location = state.sitemap?.location ?? "Manhattan, New York, USA";
  const address = state.sitemap?.address ?? "350 Fifth Ave, Suite 4100, New York, NY 10118";
  const affordable = state.credits > 0;

  const generate = async () => {
    if (!affordable) {
      showToast("Insufficient credits!", "error");
      router.push("/dashboard/billing");
      return;
    }

    setLoading(true);
    const prompt = `Generate a Google Business Profile local post (zero emojis).
Business keyword: "${kw}"
Location: ${location}
Address: ${address}
Website: https://nexadigital.com/
Include local SEO hashtags.`;

    try {
      const result = await api.generate({
        email: state.email,
        action: "gbp_post",
        prompt,
        metadata: { keyword: kw, location, address },
      });

      setOutput(result.content);
      applyApiCredits(result.creditsLeft);
      await refreshState();
      showToast(`${result.creditsDeducted} credits used. Balance: ${result.creditsLeft}`, "success");
    } catch (err) {
      if (isApiError(err)) {
        showToast(err.error, "error");
        if (err.status === 403) router.push("/dashboard/billing");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
          <h2 className="text-base font-bold text-white">Google Business Profile Post Generator</h2>
          <span className="text-[10px] font-bold text-orange-400 bg-orange-950/50 border border-orange-800/50 px-2 py-0.5 rounded-full">
            Token-based credits
          </span>
        </div>

        {!affordable && (
          <div className="mb-4">
            <InsufficientCreditsBanner required={1} available={state.credits} />
          </div>
        )}

        <button
          type="button"
          onClick={generate}
          disabled={loading || !affordable}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-orange-500/20"
        >
          {loading ? "Generating..." : "Generate GBP Local Post"}
        </button>
      </div>

      {output && (
        <div className="glass-card p-5 rounded-2xl border border-navy-800">
          <p className="text-xs font-bold text-white mb-2">GBP Post Content:</p>
          <div className="bg-navy-900 border border-navy-800 p-4 rounded-xl text-xs text-slate-300 whitespace-pre-line leading-relaxed">
            {output}
          </div>
        </div>
      )}
    </div>
  );
}
