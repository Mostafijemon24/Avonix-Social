"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { api, isApiError, type ConnectedAccount } from "@/lib/api-client";

type Action = "social_post" | "gbp_post" | "review_reply";

const LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  google_business: "Google Business",
};

export function PublishBar({
  email,
  content,
  action,
  imageUrl,
  reviewName,
}: {
  email: string;
  content: string;
  action: Action;
  imageUrl?: string;
  reviewName?: string;
}) {
  const { showToast } = useToast();
  const [targets, setTargets] = useState<ConnectedAccount[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [publishing, setPublishing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!email) return;
    const allowedProviders =
      action === "social_post"
        ? ["facebook", "instagram", "linkedin"]
        : ["google_business"];
    api
      .getConnections(email)
      .then((data) => {
        const ready = (data.accounts || []).filter(
          (a) => a.publishReady && allowedProviders.includes(a.provider)
        );
        const seen = new Set<string>();
        const unique: ConnectedAccount[] = [];
        for (const a of ready) {
          if (seen.has(a.provider)) continue;
          seen.add(a.provider);
          unique.push(a);
        }
        setTargets(unique);
        setSelected(Object.fromEntries(unique.map((a) => [a.provider, true])));
      })
      .catch(() => setTargets([]))
      .finally(() => setLoaded(true));
  }, [email, action]);

  const chosen = targets.filter((t) => selected[t.provider]);

  const publish = async () => {
    if (!content.trim()) {
      showToast("Generate content first", "error");
      return;
    }
    if (!chosen.length) {
      showToast("Select at least one connected account", "error");
      return;
    }
    if (action === "review_reply" && !reviewName) {
      showToast(
        "Live review ID required to publish replies. Connect GBP and sync reviews first.",
        "error"
      );
      return;
    }

    setPublishing(true);
    try {
      const result = await api.publishContent({
        email,
        content,
        action,
        providers: chosen.map((c) => c.provider),
        imageUrl,
        reviewName,
      });
      if (result.published?.length) {
        showToast(result.message || "Published!", "success");
      }
      if (result.failed?.length) {
        showToast(result.failed.map((f) => `${LABELS[f.provider] || f.provider}: ${f.error}`).join(" · "), "error");
      }
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Publish failed", "error");
    } finally {
      setPublishing(false);
    }
  };

  if (!loaded) {
    return (
      <div className="glass-card p-4 rounded-2xl border border-navy-800 text-[11px] text-slate-500">
        Checking connections…
      </div>
    );
  }

  if (!targets.length) {
    return (
      <div className="glass-card p-4 rounded-2xl border border-amber-500/30 bg-amber-950/10 text-left">
        <p className="text-xs text-amber-300 mb-2">
          No publish-ready {action === "social_post" ? "social" : "Google Business"} connection.
          Complete OAuth in Connections first (URL-only links cannot publish).
        </p>
        <Link
          href="/dashboard/connections"
          className="text-[11px] font-bold text-orange-400 hover:text-orange-300"
        >
          Open Connections →
        </Link>
      </div>
    );
  }

  return (
    <div className="glass-card p-4 rounded-2xl border border-navy-800 text-left space-y-3">
      <p className="text-xs font-bold text-white">Publish to connected accounts</p>
      <div className="flex flex-wrap gap-3">
        {targets.map((t) => (
          <label key={t.id} className="inline-flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              className="accent-orange-500"
              checked={!!selected[t.provider]}
              onChange={(e) =>
                setSelected((s) => ({ ...s, [t.provider]: e.target.checked }))
              }
            />
            <span>
              {LABELS[t.provider] || t.provider}
              {t.accountName ? ` · ${t.accountName}` : ""}
            </span>
          </label>
        ))}
      </div>
      {action === "social_post" && selected.instagram && !imageUrl && (
        <p className="text-[10px] text-amber-400">
          Instagram needs a public image URL. Facebook / LinkedIn can publish text-only.
        </p>
      )}
      {action === "review_reply" && !reviewName && (
        <p className="text-[10px] text-amber-400">
          Demo review has no live Google review ID — reply publish will be blocked until reviews sync.
        </p>
      )}
      <button
        type="button"
        disabled={publishing || !chosen.length}
        onClick={publish}
        className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-xl"
      >
        <Send className="w-3.5 h-3.5" />
        {publishing ? "Publishing…" : `Publish (${chosen.length})`}
      </button>
    </div>
  );
}
