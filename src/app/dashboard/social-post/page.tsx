"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api, isApiError, type ConnectedAccount } from "@/lib/api-client";
import { InsufficientCreditsBanner } from "@/components/ui/CreditCostBadge";

const INTENTS = [
  "Educational",
  "Commercial / Sales",
  "Problem Solving",
  "Transactional",
  "Brand Story",
];

const LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  google_business: "Google Business",
};

type SuitePost = {
  provider: string;
  label: string;
  content: string;
  maxWords: number;
  accountName: string | null;
};

export default function SocialPostPage() {
  const { showToast } = useToast();
  const router = useRouter();
  const { state, refreshState, applyApiCredits } = useWorkspace();
  const [intent, setIntent] = useState(INTENTS[0]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [posts, setPosts] = useState<Record<string, SuitePost>>({});
  const [skipped, setSkipped] = useState<Array<{ provider: string; reason: string }>>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [readyProviders, setReadyProviders] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [tokenInfo, setTokenInfo] = useState("");

  const affordable = state.credits > 0 || !!state.unlimitedCredits;
  const hasKeywords = !!state.sitemap?.primaryKeyword;
  const postList = Object.values(posts);

  useEffect(() => {
    if (!state.email) return;
    api
      .getConnections(state.email, state.activeWorkspaceId || undefined)
      .then((data) => {
        const ready = (data.accounts || [])
          .filter((a: ConnectedAccount) => a.publishReady)
          .map((a) => a.provider);
        const unique = [...new Set(ready)];
        setReadyProviders(unique);
        setSelected(Object.fromEntries(unique.map((p) => [p, true])));
      })
      .catch(() => setReadyProviders([]));
  }, [state.email, state.activeWorkspaceId]);

  const generate = async () => {
    if (!affordable) {
      showToast("Insufficient credits! Upgrade your plan.", "error");
      router.push("/dashboard/billing");
      return;
    }
    if (!hasKeywords) {
      showToast("Parse Sitemap & Keywords first for this client.", "error");
      router.push("/dashboard/sitemap");
      return;
    }
    if (!readyProviders.length) {
      showToast("Connect at least one social account with OAuth first.", "error");
      router.push("/dashboard/connections");
      return;
    }

    setLoading(true);
    setPosts({});
    setImageUrl(null);
    setImageError(null);
    try {
      const result = await api.generateSocialSuite({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        intent,
      });
      setPosts(result.posts || {});
      setSkipped(result.skipped || []);
      setImageUrl(result.imageUrl || null);
      setImageError(result.imageError || null);
      applyApiCredits(result.creditsLeft);
      setTokenInfo(
        `${result.creditsDeducted} credits used · ${Object.keys(result.posts || {}).length} platform(s)`
      );
      await refreshState();
      showToast(
        `Generated for ${Object.keys(result.posts || {}).length} connected platform(s)`,
        "success"
      );
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

  const publish = async () => {
    const providers = postList
      .map((p) => p.provider)
      .filter((p) => selected[p]);
    if (!providers.length) {
      showToast("Select at least one generated post to publish", "error");
      return;
    }
    if (providers.includes("instagram") && !imageUrl) {
      showToast("Instagram needs an image. Re-generate or fix IMAGE_MODEL.", "error");
      return;
    }

    setPublishing(true);
    try {
      const contentByProvider = Object.fromEntries(
        postList.filter((p) => selected[p.provider]).map((p) => [p.provider, p.content])
      );
      const result = await api.publishContent({
        email: state.email,
        content: postList[0]?.content || "",
        action: "social_suite",
        providers,
        contentByProvider,
        imageUrl: imageUrl || undefined,
        workspaceId: state.activeWorkspaceId || undefined,
      });
      if (result.published?.length) {
        showToast(result.message || "Published!", "success");
      }
      if (result.failed?.length) {
        showToast(
          result.failed.map((f) => `${LABELS[f.provider] || f.provider}: ${f.error}`).join(" · "),
          "error"
        );
      }
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Publish failed", "error");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-fade-in text-center sm:text-left">
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
          <h2 className="text-base font-bold text-white">Social Content Studio</h2>
          <span className="text-[10px] font-bold text-orange-400 bg-orange-950/50 border border-orange-800/50 px-2 py-0.5 rounded-full">
            Connected platforms only · no links · no emojis
          </span>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Uses saved keywords for{" "}
          <span className="text-orange-400 font-bold">
            {(state.workspaces || []).find((w) => w.id === state.activeWorkspaceId)?.name ||
              "this client"}
          </span>
          . Writes separate Facebook, Instagram, GBP, and LinkedIn copy only when that network is
          connected.
        </p>

        {!hasKeywords && (
          <div className="mb-4 bg-amber-950/20 border border-amber-500/30 rounded-xl p-4 text-xs text-amber-300 text-left">
            No keywords saved yet.{" "}
            <Link href="/dashboard/sitemap" className="font-bold text-orange-400 hover:underline">
              Analyze your website first →
            </Link>
          </div>
        )}

        {!readyProviders.length && (
          <div className="mb-4 bg-amber-950/20 border border-amber-500/30 rounded-xl p-4 text-xs text-amber-300 text-left">
            No OAuth connections.{" "}
            <Link
              href="/dashboard/connections"
              className="font-bold text-orange-400 hover:underline"
            >
              Connect accounts →
            </Link>
          </div>
        )}

        {!!readyProviders.length && (
          <p className="text-[11px] text-emerald-400 mb-3">
            Will generate for: {readyProviders.map((p) => LABELS[p] || p).join(", ")}
          </p>
        )}

        {!affordable && (
          <div className="mb-4">
            <InsufficientCreditsBanner required={1} available={state.credits} />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end mb-4">
          <div className="text-left">
            <label className="block text-[10px] font-bold text-slate-500 mb-1">Content intent</label>
            <select
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              className="w-full bg-navy-900 border border-navy-700 rounded-xl px-3 py-2.5 text-xs text-slate-200"
            >
              {INTENTS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={loading || !affordable || !hasKeywords || !readyProviders.length}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-5 rounded-xl text-xs uppercase tracking-wider shadow-lg shadow-orange-500/20"
          >
            {loading ? "Generating…" : "Generate posts + image"}
          </button>
        </div>

        {state.sitemap && (
          <p className="text-[10px] text-slate-500 text-left">
            Keyword: <span className="text-slate-300">{state.sitemap.primaryKeyword}</span>
            {state.sitemap.location ? ` · ${state.sitemap.location}` : ""}
          </p>
        )}
        {tokenInfo && <p className="text-[10px] text-slate-500 mt-1 text-left">{tokenInfo}</p>}
      </div>

      {postList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {postList.map((p) => (
            <div
              key={p.provider}
              className="glass-card p-5 rounded-2xl border border-navy-800 text-left space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">{p.label}</h3>
                  <p className="text-[10px] text-slate-500">
                    ≤ {p.maxWords} words
                    {p.accountName ? ` · ${p.accountName}` : ""}
                  </p>
                </div>
                <label className="inline-flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-orange-500"
                    checked={!!selected[p.provider]}
                    onChange={(e) =>
                      setSelected((s) => ({ ...s, [p.provider]: e.target.checked }))
                    }
                  />
                  Publish
                </label>
              </div>
              <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                {p.content}
              </p>
            </div>
          ))}
        </div>
      )}

      {(imageUrl || imageError) && (
        <div className="glass-card p-5 rounded-2xl border border-navy-800 text-left">
          <h3 className="text-sm font-bold text-white mb-3">Related image</h3>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt="Generated social creative"
              className="w-full max-w-md rounded-xl border border-navy-700"
            />
          ) : (
            <p className="text-xs text-amber-400">{imageError}</p>
          )}
        </div>
      )}

      {!!skipped.length && (
        <p className="text-[10px] text-slate-500 text-left">
          Skipped (not connected):{" "}
          {skipped.map((s) => LABELS[s.provider] || s.provider).join(", ")}
        </p>
      )}

      {postList.length > 0 && (
        <button
          type="button"
          disabled={publishing}
          onClick={publish}
          className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-xl"
        >
          <Send className="w-3.5 h-3.5" />
          {publishing ? "Publishing…" : "Publish selected"}
        </button>
      )}
    </div>
  );
}
