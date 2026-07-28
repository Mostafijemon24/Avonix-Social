"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api, isApiError } from "@/lib/api-client";
import { CreditCostBadge, InsufficientCreditsBanner } from "@/components/ui/CreditCostBadge";
import { PublishBar } from "@/components/dashboard/PublishBar";

export default function ReviewReplyPage() {
  const { showToast } = useToast();
  const router = useRouter();
  const { state, refreshState, applyApiCredits } = useWorkspace();
  const [mode, setMode] = useState<"confirm" | "auto">("confirm");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const affordable = state.credits > 0;

  const setGbpMode = (next: "confirm" | "auto") => {
    setMode(next);
    showToast(
      next === "auto" ? "Switched to FULL AUTO REPLY Mode!" : "Switched to CONFIRM TO REPLY Mode!",
      "info"
    );
  };

  const draftReply = async () => {
    if (!affordable) {
      showToast("Insufficient credits!", "error");
      router.push("/dashboard/billing");
      return;
    }

    setLoading(true);
    const prompt = `Write a professional Google Business review reply (zero emojis).
Reviewer: John Doe, 5/5 stars
Review: "Avonix Social SEO automation doubled our local search visibility within 60 days. Excellent service!"
Brand: Avonix Social SEO agency`;

    try {
      const result = await api.generate({
        email: state.email,
        action: "review_reply",
        prompt,
        metadata: { reviewer: "John Doe", rating: 5 },
      });

      setDraft(result.content);
      applyApiCredits(result.creditsLeft);
      await refreshState();
      showToast(`${result.creditsDeducted} credits used. Balance: ${result.creditsLeft}`, "success");
    } catch (err) {
      if (isApiError(err)) showToast(err.error, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 pb-4 border-b border-navy-800 gap-4">
          <div>
            <h2 className="text-base font-bold text-white">Google Business Review Reply Hub</h2>
            <p className="text-xs text-slate-400">AI drafts logged in Usage Logs with token + credit data.</p>
          </div>
          <div className="bg-navy-900 p-1 rounded-2xl flex items-center space-x-1 border border-navy-800">
            <button
              type="button"
              onClick={() => setGbpMode("confirm")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                mode === "confirm" ? "bg-orange-500 text-white shadow-md" : "text-slate-400 hover:text-white"
              }`}
            >
              Confirm to Reply
            </button>
            <button
              type="button"
              onClick={() => setGbpMode("auto")}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                mode === "auto" ? "bg-emerald-500 text-white shadow-md" : "text-slate-400 hover:text-white"
              }`}
            >
              Auto Reply Mode
            </button>
          </div>
        </div>

        {!affordable && (
          <div className="mb-4">
            <InsufficientCreditsBanner required={1} available={state.credits} />
          </div>
        )}

        <div className="border border-navy-800 rounded-2xl p-4 bg-navy-900/60">
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-xs font-bold text-white">John Doe</p>
              <p className="text-[10px] text-amber-400 font-bold">5/5 stars</p>
            </div>
            <CreditCostBadge action="review_reply" />
          </div>
          <p className="text-xs text-slate-300 mb-3">
            &quot;Avonix Social SEO automation doubled our local search visibility within 60 days. Excellent service!&quot;
          </p>

          {draft && (
            <div className="bg-navy-950 p-3.5 rounded-xl border border-navy-800 mb-3 text-xs text-slate-300">
              <strong className="text-orange-500 block mb-1">AI Generated Reply Draft:</strong>
              &quot;{draft}&quot;
            </div>
          )}

          <div className="flex space-x-2 justify-center sm:justify-start">
            <button
              type="button"
              onClick={draftReply}
              disabled={loading || !affordable || !!draft}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-3.5 py-2 rounded-xl transition-all"
            >
              {loading ? "Drafting..." : "Draft AI Reply"}
            </button>
          </div>
          {draft && state.email && (
            <div className="mt-4">
              <PublishBar
                email={state.email}
                content={draft}
                action="review_reply"
                workspaceId={state.activeWorkspaceId || undefined}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
