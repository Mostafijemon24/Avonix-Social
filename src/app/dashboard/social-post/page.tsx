"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api, isApiError } from "@/lib/api-client";
import { InsufficientCreditsBanner } from "@/components/ui/CreditCostBadge";
import { PublishBar } from "@/components/dashboard/PublishBar";

const INTENTS = [
  "Educational",
  "Commercial / Sales",
  "Problem Solving",
  "Transactional",
  "Brand Story",
];

export default function SocialPostPage() {
  const { showToast } = useToast();
  const router = useRouter();
  const { state, refreshState, applyApiCredits } = useWorkspace();
  const [output, setOutput] = useState("");
  const [tokenInfo, setTokenInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [intent, setIntent] = useState(INTENTS[0]);

  const kw = state.sitemap?.primaryKeyword ?? "Enterprise Local SEO Services";
  const location = state.sitemap?.location ?? "Manhattan, New York, USA";
  const address = state.sitemap?.address ?? "350 Fifth Ave, Suite 4100, New York, NY 10118";
  const affordable = state.credits > 0;

  const generate = async () => {
    if (!affordable) {
      showToast("Insufficient credits! Upgrade your plan.", "error");
      router.push("/dashboard/billing");
      return;
    }

    setLoading(true);
    const prompt = `Generate a zero-emoji Facebook post for a local SEO business.
Primary keyword: "${kw}"
Location: ${location}
Address: ${address}
Content intent: ${intent}
Include website link https://nexadigital.com/ and relevant hashtags. Professional B2B tone.`;

    try {
      const result = await api.generate({
        email: state.email,
        action: "social_post",
        prompt,
        metadata: { intent, keyword: kw, location },
      });

      setOutput(result.content);
      const details = result.usageDetails;
      setTokenInfo(
        details
          ? `${details.promptTokens} in + ${details.completionTokens} out tokens · $${details.actualCostUSD} USD → ${details.creditsDeducted} credits` +
            (result.mock ? " (demo)" : "")
          : `${result.usage.totalTokens} tokens → ${result.creditsDeducted} credits`
      );
      applyApiCredits(result.creditsLeft);
      await refreshState();
      showToast(`Generated! ${result.creditsDeducted} credits used. Balance: ${result.creditsLeft}`, "success");
    } catch (err) {
      if (isApiError(err)) {
        showToast(err.error, "error");
        if (err.status === 403 || err.status === 402) router.push("/dashboard/billing");
      } else {
        showToast("Generation failed.", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      {!state.sitemap && (
        <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-4 text-xs text-amber-300">
          Tip: Parse a sitemap first to inject live keywords. Credits deducted by token usage via OpenRouter.
        </div>
      )}

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
          <h2 className="text-base font-bold text-white">Facebook Post Generator</h2>
          <span className="text-[10px] font-bold text-orange-400 bg-orange-950/50 border border-orange-800/50 px-2 py-0.5 rounded-full">
            USD cost-based · $1 = 100 credits
          </span>
        </div>

        {!affordable && (
          <div className="mb-4">
            <InsufficientCreditsBanner required={1} available={state.credits} />
          </div>
        )}

        <label className="block text-xs font-bold text-slate-300 mb-2">Content Intent:</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          {INTENTS.map((item) => (
            <label
              key={item}
              className="border border-navy-800 rounded-xl p-3 flex flex-col items-center cursor-pointer hover:border-orange-500 has-[:checked]:bg-orange-950/40 has-[:checked]:border-orange-500 transition-all"
            >
              <input
                type="radio"
                name="intent"
                checked={intent === item}
                onChange={() => setIntent(item)}
                className="mb-1.5 accent-orange-500"
              />
              <span className="text-xs font-bold text-slate-200">{item.split(" / ")[0]}</span>
            </label>
          ))}
        </div>

        <button
          type="button"
          onClick={generate}
          disabled={loading || !affordable}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-orange-500/20"
        >
          {loading ? "Generating via OpenRouter..." : "Generate Facebook Post + AI Graphic"}
        </button>
      </div>

      {output && (
        <div className="space-y-4">
          {tokenInfo && (
            <p className="text-[10px] text-slate-500 font-mono">{tokenInfo}</p>
          )}
          <div className="glass-card p-5 rounded-2xl border border-navy-800">
            <p className="text-xs font-bold text-orange-500 mb-2">AI Visual Graphic Concept:</p>
            <div className="bg-navy-900 border border-navy-800 p-4 rounded-xl text-xs text-slate-300 font-mono">
              Primary Keyword Tag: {kw} Graphic (PNG Embedded)
            </div>
          </div>
          <div className="glass-card p-5 rounded-2xl border border-navy-800">
            <p className="text-xs font-bold text-white mb-2">Facebook Post (Zero Emojis):</p>
            <div className="bg-navy-900 border border-navy-800 p-4 rounded-xl text-xs text-slate-300 whitespace-pre-line leading-relaxed">
              {output}
            </div>
          </div>
          {state.email && (
            <PublishBar
              email={state.email}
              content={output}
              action="social_post"
              workspaceId={state.activeWorkspaceId || undefined}
            />
          )}
        </div>
      )}
    </div>
  );
}
