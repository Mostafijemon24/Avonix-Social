"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useToast } from "@/components/ui/Toast";
import { api, isApiError, type StudioPostRecord } from "@/lib/api-client";
import PostDetailsDrawer from "@/components/dashboard/PostDetailsDrawer";

const STATUS = ["all", "draft", "scheduled", "published", "archived"] as const;
const PLATFORMS = ["all", "Facebook", "Instagram", "LinkedIn", "GMB"] as const;
const TYPES = ["all", "INTENT_PROXIMITY", "OFFER_PROMOTION_EVENT", "AUTHORITY_TRUST_PROOF", "FAQ_EDUCATIONAL"] as const;
const TYPE_LABEL: Record<string, string> = {
  all: "All types",
  INTENT_PROXIMITY: "Intent",
  OFFER_PROMOTION_EVENT: "Offer",
  AUTHORITY_TRUST_PROOF: "Authority",
  FAQ_EDUCATIONAL: "FAQ",
};

type BulkKind = "publish" | "schedule" | "archive" | "regenerate" | null;

function statusPill(p: StudioPostRecord) {
  if (p.archived) return "status-pill status-pill-muted";
  if (p.status === "published") return "status-pill status-pill-ready";
  if (p.status === "scheduled") return "status-pill status-pill-info";
  return "status-pill status-pill-warn";
}

export default function PostLibraryPage() {
  const { state } = useWorkspace();
  const { showToast } = useToast();
  const [posts, setPosts] = useState<StudioPostRecord[]>([]);
  const [filter, setFilter] = useState<(typeof STATUS)[number]>("all");
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]>("all");
  const [contentType, setContentType] = useState<(typeof TYPES)[number]>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<StudioPostRecord | null>(null);
  const [bulk, setBulk] = useState<BulkKind>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!state.email) return;
    setLoading(true);
    try {
      const data = await api.listStudioPosts(
        state.email,
        state.activeWorkspaceId || undefined,
        undefined,
        true
      );
      setPosts(data.posts || []);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [state.email, state.activeWorkspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    return posts.filter((p) => {
      if (filter === "archived") {
        if (!p.archived) return false;
      } else if (filter !== "all") {
        if (p.archived || p.status !== filter) return false;
      }
      if (platform !== "all" && p.platform !== platform) return false;
      if (contentType !== "all" && p.gmbCategory !== contentType) return false;
      if (dateFrom) {
        const t = new Date(p.createdAt).getTime();
        if (t < new Date(dateFrom).getTime()) return false;
      }
      if (dateTo) {
        const t = new Date(p.createdAt).getTime();
        if (t > new Date(`${dateTo}T23:59:59`).getTime()) return false;
      }
      return true;
    });
  }, [posts, filter, platform, contentType, dateFrom, dateTo]);

  const visibleIds = filtered.map((p) => p.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  const toggleAll = () => {
    if (allVisibleSelected) {
      setSelected((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelected((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const runBulk = async () => {
    if (!state.email || !bulk || !selected.length) return;
    if (bulk === "schedule" && !scheduleAt) {
      showToast("Pick a date and time", "error");
      return;
    }
    setBusy(true);
    try {
      if (bulk === "archive") {
        await api.archiveStudioPosts({
          email: state.email,
          postIds: selected,
          confirm: true,
          workspaceId: state.activeWorkspaceId || undefined,
        });
        showToast(`Archived ${selected.length} posts`, "success");
      } else {
        let ok = 0;
        let fail = 0;
        for (const id of selected) {
          try {
            if (bulk === "publish") {
              await api.publishStudioPost({ email: state.email, postId: id, alsoLive: true });
            } else if (bulk === "schedule") {
              await api.scheduleStudioPost({
                email: state.email,
                postId: id,
                scheduledAt: new Date(scheduleAt).toISOString(),
              });
            } else if (bulk === "regenerate") {
              await api.rewriteStudioPost({ email: state.email, postId: id });
            }
            ok += 1;
          } catch {
            fail += 1;
          }
        }
        showToast(
          fail ? `${ok} succeeded, ${fail} failed` : `${ok} posts updated`,
          fail ? "error" : "success"
        );
      }
      setSelected([]);
      setBulk(null);
      await load();
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Bulk action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const countFor = (s: (typeof STATUS)[number]) => {
    if (s === "all") return posts.length;
    if (s === "archived") return posts.filter((p) => p.archived).length;
    return posts.filter((p) => !p.archived && p.status === s).length;
  };

  const platformsInSelection = Array.from(
    new Set(posts.filter((p) => selected.includes(p.id)).map((p) => p.platform))
  );

  return (
    <div className="space-y-5 max-w-5xl mx-auto animate-fade-in">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-white">Post Library</h1>
        <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
          All generated content for this client. Create new posts in Content Studio.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {STATUS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold capitalize min-h-[36px] ${
              filter === s ? "bg-orange-500 text-white" : "bg-[color:var(--color-card)] text-slate-400 border border-white/[0.07]"
            }`}
          >
            {s} ({countFor(s)})
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPlatform(p)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold min-h-[36px] ${
              platform === p ? "bg-navy-700 text-white" : "bg-[color:var(--color-card)] text-slate-500 border border-white/[0.07]"
            }`}
          >
            {p}
          </button>
        ))}
        <select
          className="input-field text-[11px] py-1.5"
          value={contentType}
          onChange={(e) => setContentType(e.target.value as (typeof TYPES)[number])}
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="input-field text-[11px] py-1.5"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="From date"
        />
        <input
          type="date"
          className="input-field text-[11px] py-1.5"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="To date"
        />
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 glass-card rounded-xl px-3 py-2">
          <span className="text-[11px] font-bold text-white">Selected: {selected.length}</span>
          <button type="button" className="btn-primary text-[11px]" onClick={() => setBulk("publish")}>
            Publish
          </button>
          <button type="button" className="btn-secondary text-[11px]" onClick={() => setBulk("schedule")}>
            Schedule
          </button>
          <button type="button" className="btn-secondary text-[11px]" onClick={() => setBulk("regenerate")}>
            Regenerate
          </button>
          <button type="button" className="btn-ghost text-[11px]" onClick={() => setBulk("archive")}>
            Archive
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-500">
          No posts yet.{" "}
          <Link href="/dashboard/social-post" className="text-orange-400 font-bold">
            Open Content Studio
          </Link>
        </p>
      ) : (
        <ul className="space-y-2">
          <li className="flex items-center gap-2 px-1 text-[11px] text-slate-500">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
            Select all
          </li>
          {filtered.map((p) => (
            <li key={p.id} className="glass-card rounded-xl px-4 py-3">
              <div className="flex flex-wrap items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected.includes(p.id)}
                  onChange={() =>
                    setSelected((prev) =>
                      prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                    )
                  }
                />
                <button
                  type="button"
                  className="flex-1 text-left min-w-0"
                  onClick={() => setDetail(p)}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-bold text-white">{p.platform}</span>
                    <span className={statusPill(p)}>{p.archived ? "archived" : p.status}</span>
                    {p.gmbCategory && <span className="text-orange-300">{TYPE_LABEL[p.gmbCategory] || p.gmbCategory}</span>}
                    {p.cta && <span className="text-slate-400">CTA · {p.cta}</span>}
                    <span className="text-slate-500 font-mono truncate">{p.url}</span>
                  </div>
                  <p className="text-sm text-white font-semibold mt-1">{p.heading}</p>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {detail && state.email && (
        <PostDetailsDrawer
          post={detail}
          email={state.email}
          onClose={() => setDetail(null)}
          onChanged={() => {
            load();
            setDetail(null);
          }}
          showToast={showToast}
        />
      )}

      {bulk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[color:var(--color-card)] border border-white/[0.07] p-5">
            <h3 className="text-base font-extrabold text-white">
              {bulk === "archive" && `Archive ${selected.length} posts?`}
              {bulk === "publish" && `Publish ${selected.length} posts?`}
              {bulk === "schedule" && `Schedule ${selected.length} posts?`}
              {bulk === "regenerate" && `Regenerate ${selected.length} posts?`}
            </h3>
            {bulk === "publish" && (
              <p className="text-[12px] text-slate-400 mt-2">
                Publishing uses connected accounts for {platformsInSelection.join(", ") || "each platform"}.
                Destinations are managed in Connections — not selected per post.
              </p>
            )}
            {bulk === "schedule" && (
              <div className="mt-3 space-y-2">
                <input
                  type="datetime-local"
                  className="input-field w-full"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                />
                <p className="text-[10px] text-slate-500">
                  Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </p>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-secondary text-[12px]" onClick={() => setBulk(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-[12px] min-h-[44px]"
                disabled={busy}
                onClick={runBulk}
              >
                {busy
                  ? "Working…"
                  : bulk === "archive"
                    ? `Archive ${selected.length}`
                    : bulk === "publish"
                      ? `Publish ${selected.length}`
                      : bulk === "schedule"
                        ? `Schedule ${selected.length}`
                        : `Regenerate ${selected.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
