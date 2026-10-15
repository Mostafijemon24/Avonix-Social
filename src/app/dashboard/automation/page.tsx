"use client";

/**
 * 30-Day Automated Post Generation & Scheduling.
 *
 * Reads a Google Sheet (Date | Topic/Title | Generate_Image | Schedule_Time)
 * on the server, generates SEO content (+ optional images) via the existing
 * AI pipeline, and schedules each post. The browser only talks to our own
 * backend — no Google/OpenAI keys are ever exposed client-side.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Sparkles, ImageIcon, CalendarClock, AlertTriangle } from "lucide-react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useToast } from "@/components/ui/Toast";
import { api, isApiError, type StudioPostRecord } from "@/lib/api-client";
import AutomationPostEditor from "@/components/dashboard/AutomationPostEditor";

const PLATFORMS = ["Facebook", "Instagram", "LinkedIn", "GMB", "X", "Pinterest"];
const TONES = ["Professional", "Enthusiastic", "Empathetic", "Authoritative", "Storytelling"];

type SyncSummary = {
  created: number;
  updated: number;
  scheduled: number;
  drafts: number;
  skipped: number;
  failed?: number;
  message?: string;
  warnings?: string[];
  hasRowId?: boolean;
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  draft: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  scheduled: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  published: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-300 border-red-500/30",
};

function StatusBadge({ status, generated }: { status: string; generated: boolean }) {
  // A draft that hasn't been generated yet is "Pending"; once generated it is a "Draft".
  const key = status === "draft" ? (generated ? "draft" : "pending") : status;
  const label =
    key === "pending"
      ? "Pending"
      : key.charAt(0).toUpperCase() + key.slice(1);
  const cls = STATUS_STYLE[key] || STATUS_STYLE.pending;
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>
      {label}
    </span>
  );
}

export default function AutomationPage() {
  const { state } = useWorkspace();
  const { showToast } = useToast();

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [defaultRange, setDefaultRange] = useState("Sheet1!A:D");
  const [sheetId, setSheetId] = useState("");
  const [range, setRange] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([...PLATFORMS]);
  const [tone, setTone] = useState("Professional");
  const [location, setLocation] = useState("");
  const [autoSchedule, setAutoSchedule] = useState(true);

  const [posts, setPosts] = useState<StudioPostRecord[]>([]);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<StudioPostRecord | null>(null);

  const loadPosts = useCallback(async () => {
    if (!state.email) return;
    try {
      const data = await api.listSheetPosts(state.email, state.activeWorkspaceId || undefined);
      setPosts(data.posts || []);
    } catch {
      setPosts([]);
    }
  }, [state.email, state.activeWorkspaceId]);

  useEffect(() => {
    api
      .getSheetAutomationStatus()
      .then((s) => {
        setConfigured(s.configured);
        if (s.defaultSheetId) setSheetId((prev) => prev || s.defaultSheetId || "");
        if (s.defaultRange) setDefaultRange(s.defaultRange);
      })
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const togglePlatform = useCallback((p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }, []);

  const handleSync = useCallback(async () => {
    if (!state.email) {
      showToast("Sign in required", "error");
      return;
    }
    if (platforms.length === 0) {
      showToast("Select at least one platform", "error");
      return;
    }
    setSyncing(true);
    setSummary(null);
    try {
      const res = await api.syncSheetAutomation({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        sheetId: sheetId.trim() || undefined,
        range: range.trim() || undefined,
        platforms,
        tone,
        location: location.trim() || undefined,
        autoSchedule,
        // Interpret the sheet's wall-clock Schedule_Time in the user's timezone.
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      setSummary({
        created: res.created,
        updated: res.updated,
        scheduled: res.scheduled,
        drafts: res.drafts,
        skipped: res.skipped,
        failed: res.failed,
        message: res.message,
        warnings: res.warnings,
        hasRowId: res.hasRowId,
      });
      showToast(
        `Synced ${res.created + res.updated} row(s). Now click Generate.`,
        "success"
      );
      await loadPosts();
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Sync failed", "error");
    } finally {
      setSyncing(false);
    }
  }, [state.email, state.activeWorkspaceId, sheetId, range, platforms, tone, location, autoSchedule, showToast, loadPosts]);

  // Generate a single row on demand.
  const handleGenerateRow = useCallback(
    async (postId: string) => {
      if (!state.email) return;
      setGeneratingIds((prev) => new Set(prev).add(postId));
      try {
        const res = await api.generateSheetPosts({ email: state.email, postId });
        const failed = res.outcomes?.some((o) => o.outcome === "generation_failed");
        showToast(failed ? "Generation failed for this row" : "Post generated", failed ? "error" : "success");
        await loadPosts();
      } catch (err) {
        showToast(isApiError(err) ? err.error : "Generation failed", "error");
      } finally {
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
      }
    },
    [state.email, showToast, loadPosts]
  );

  // Bulk-generate every row that hasn't been generated yet.
  const handleGenerateAll = useCallback(async () => {
    if (!state.email) return;
    setGeneratingAll(true);
    try {
      const res = await api.generateSheetPosts({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        sheetId: sheetId.trim() || undefined,
      });
      showToast(res.message || `Generated ${res.generated} post(s)`, res.failed ? "error" : "success");
      await loadPosts();
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Bulk generation failed", "error");
    } finally {
      setGeneratingAll(false);
    }
  }, [state.email, state.activeWorkspaceId, sheetId, showToast, loadPosts]);

  // A sheet post is "generated" once content has been produced for it.
  const isGenerated = useCallback(
    (p: StudioPostRecord) => (p.sheet ? p.sheet.generated : !!p.content),
    []
  );

  const counts = useMemo(() => {
    const c = { pending: 0, scheduled: 0, published: 0, failed: 0 };
    for (const p of posts) {
      if (p.status === "published") c.published += 1;
      else if (p.status === "failed") c.failed += 1;
      else if (p.status === "scheduled") c.scheduled += 1;
      else if (!isGenerated(p)) c.pending += 1; // draft + not yet generated
    }
    return c;
  }, [posts, isGenerated]);

  // Rows that still need AI generation (ungenerated skeletons + failed retries).
  const toGenerate = useMemo(
    () => posts.filter((p) => p.status !== "published" && (!isGenerated(p) || p.status === "failed")),
    [posts, isGenerated]
  );

  return (
    <div className="space-y-5 max-w-6xl mx-auto animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">30-Day Automation</h1>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
            Pull a content calendar from Google Sheets, auto-generate posts &amp; images, and schedule
            them for live publishing.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-2 text-sm disabled:opacity-60"
          onClick={handleSync}
          disabled={syncing || generatingAll || configured === false}
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync from Google Sheet"}
        </button>
      </div>

      {configured === false && (
        <div className="glass-card rounded-xl p-4 border border-amber-500/30 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-muted">
            <p className="font-bold text-ink mb-1">Google Sheets not configured on the server.</p>
            Add <code className="text-amber-300">GOOGLE_SA_CLIENT_EMAIL</code> +{" "}
            <code className="text-amber-300">GOOGLE_SA_PRIVATE_KEY</code> (or{" "}
            <code className="text-amber-300">GOOGLE_SA_KEY_FILE</code>) to{" "}
            <code>backend/.env</code>, then share the sheet with the service-account email as Viewer.
          </div>
        </div>
      )}

      {/* Config */}
      <div className="glass-card rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="block">
          <span className="label-caps text-dim">Spreadsheet ID (optional)</span>
          <input
            className="input-field mt-1 w-full"
            placeholder="defaults to server CONTENT_SHEET_ID"
            value={sheetId}
            onChange={(e) => setSheetId(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label-caps text-dim">Range</span>
          <input
            className="input-field mt-1 w-full"
            placeholder={defaultRange}
            value={range}
            onChange={(e) => setRange(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label-caps text-dim">Location (optional)</span>
          <input
            className="input-field mt-1 w-full"
            placeholder="e.g. Denver, CO"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <div className="block sm:col-span-2 lg:col-span-3">
          <div className="flex items-center justify-between">
            <span className="label-caps text-dim">Platforms (each topic → one post per selected platform)</span>
            <div className="flex gap-2">
              <button type="button" className="text-[10px] text-orange-400 font-bold" onClick={() => setPlatforms([...PLATFORMS])}>
                All
              </button>
              <button type="button" className="text-[10px] text-dim font-bold" onClick={() => setPlatforms([])}>
                None
              </button>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {PLATFORMS.map((p) => {
              const on = platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition min-h-[36px] ${
                    on
                      ? "border-orange-500/50 bg-orange-500/15 text-orange-300"
                      : "border-line text-muted hover:border-orange-500/30"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {p}
                </button>
              );
            })}
          </div>
        </div>
        <label className="block">
          <span className="label-caps text-dim">Tone</span>
          <select className="input-field mt-1 w-full" value={tone} onChange={(e) => setTone(e.target.value)}>
            {TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 mt-6">
          <input
            type="checkbox"
            className="h-4 w-4 accent-orange-500"
            checked={autoSchedule}
            onChange={(e) => setAutoSchedule(e.target.checked)}
          />
          <span className="text-xs text-ink font-semibold">
            Auto-schedule rows with a future Schedule_Time
          </span>
        </label>
      </div>

      {/* Summary */}
      {summary && (
        <div className="glass-card rounded-xl p-4">
          <p className="text-sm font-bold text-ink mb-2">Last sync</p>
          <div className="flex flex-wrap gap-4 text-xs text-muted">
            <span>
              <b className="text-emerald-400">{summary.created}</b> new
            </span>
            <span>
              <b className="text-sky-400">{summary.updated}</b> updated
            </span>
            <span>
              <b className="text-amber-400">{summary.scheduled}</b> scheduled
            </span>
            <span>
              <b className="text-slate-300">{summary.drafts}</b> drafts
            </span>
            <span>
              <b className="text-slate-400">{summary.skipped}</b> skipped
            </span>
            {!!summary.failed && (
              <span>
                <b className="text-red-400">{summary.failed}</b> failed
              </span>
            )}
          </div>
          {summary.message && <p className="text-[11px] text-dim mt-2">{summary.message}</p>}
          {!!summary.warnings?.length && (
            <ul className="mt-2 space-y-1 text-[11px] text-amber-300">
              {summary.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Overview counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: "Pending", value: counts.pending, icon: Sparkles },
          { label: "Scheduled", value: counts.scheduled, icon: CalendarClock },
          { label: "Published", value: counts.published, icon: ImageIcon },
          { label: "Failed", value: counts.failed, icon: AlertTriangle },
        ].map((c) => (
          <div key={c.label} className="glass-card rounded-xl p-3">
            <p className="label-caps text-dim">{c.label}</p>
            <p className="text-2xl font-extrabold text-ink mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
          <p className="text-xs font-bold text-ink">
            Content calendar
            <span className="text-dim font-normal ml-2">
              {posts.length} row{posts.length === 1 ? "" : "s"}
              {toGenerate.length > 0 ? ` · ${toGenerate.length} to generate` : ""}
            </span>
          </p>
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2 text-xs disabled:opacity-50"
            onClick={handleGenerateAll}
            disabled={generatingAll || syncing || toGenerate.length === 0}
            title={toGenerate.length === 0 ? "All rows already generated" : "Generate content for all pending rows"}
          >
            {generatingAll ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generatingAll ? "Generating…" : `Generate Posts${toGenerate.length ? ` (${toGenerate.length})` : ""}`}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[color:var(--color-card-inner)] text-dim">
              <tr>
                <th className="px-3 py-2 font-bold">Topic / Title</th>
                <th className="px-3 py-2 font-bold">Platform</th>
                <th className="px-3 py-2 font-bold">Image</th>
                <th className="px-3 py-2 font-bold">Schedule_Time</th>
                <th className="px-3 py-2 font-bold">Status</th>
                <th className="px-3 py-2 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {posts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-dim">
                    No posts yet. Configure your sheet and click{" "}
                    <b className="text-ink">Sync from Google Sheet</b>, then{" "}
                    <b className="text-ink">Generate Posts</b>.
                  </td>
                </tr>
              ) : (
                posts.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t border-line hover:bg-white/[0.02] cursor-pointer"
                    onClick={() => setDetail(p)}
                  >
                    <td className="px-3 py-2 max-w-[320px]">
                      <p className="font-semibold text-ink line-clamp-1">{p.heading}</p>
                      <p className="text-[10px] text-dim line-clamp-1">{p.keywords?.primary}</p>
                    </td>
                    <td className="px-3 py-2 text-muted">{p.platform}</td>
                    <td className="px-3 py-2">
                      {p.image ? (
                        <span className="text-emerald-400 font-bold">Yes</span>
                      ) : p.sheet?.generateImage ? (
                        <span className="text-amber-300">Planned</span>
                      ) : (
                        <span className="text-dim">No</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {p.scheduledDate ? new Date(p.scheduledDate).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={p.status} generated={isGenerated(p)} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {p.status !== "published" && (
                          <button
                            type="button"
                            className="btn-primary text-[11px] whitespace-nowrap inline-flex items-center gap-1 disabled:opacity-50"
                            disabled={generatingIds.has(p.id) || generatingAll}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleGenerateRow(p.id);
                            }}
                          >
                            {generatingIds.has(p.id) ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Sparkles className="w-3 h-3" />
                            )}
                            {isGenerated(p) ? "Regenerate" : "Generate"}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-secondary text-[11px] whitespace-nowrap"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetail(p);
                          }}
                        >
                          View / Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detail && state.email && (
        <AutomationPostEditor
          post={detail}
          email={state.email}
          onClose={() => setDetail(null)}
          onChanged={async () => {
            await loadPosts();
            // Keep the drawer open with refreshed data after an edit.
            try {
              const fresh = await api.listSheetPosts(state.email!, state.activeWorkspaceId || undefined);
              const updated = (fresh.posts || []).find((x) => x.id === detail.id);
              setDetail(updated || null);
            } catch {
              setDetail(null);
            }
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
