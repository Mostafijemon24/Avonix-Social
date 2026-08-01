"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Facebook,
  Globe,
  Image as ImageIcon,
  Instagram,
  Linkedin,
  Lock,
  MapPin,
  Play,
  PlusCircle,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api, isApiError, type StudioPostRecord } from "@/lib/api-client";

const TONE_PRESETS = [
  "Professional",
  "Enthusiastic",
  "Empathetic",
  "Authoritative",
  "Storytelling",
] as const;

const PLATFORM_MIN_WORDS: Record<string, number> = {
  Facebook: 120,
  Instagram: 70,
  LinkedIn: 150,
  GMB: 90,
};

type AnalyzedKeyword = {
  url: string;
  reachable?: boolean;
  keywords: {
    primary: string;
    secondary: string;
    general: string[];
  };
};

type ListFilter = "draft" | "published" | "scheduled";

function platformIcon(platform: string) {
  switch (platform) {
    case "Facebook":
      return <Facebook className="w-4 h-4 text-blue-400 shrink-0" />;
    case "Instagram":
      return <Instagram className="w-4 h-4 text-pink-400 shrink-0" />;
    case "LinkedIn":
      return <Linkedin className="w-4 h-4 text-sky-400 shrink-0" />;
    case "GMB":
      return <Globe className="w-4 h-4 text-emerald-400 shrink-0" />;
    default:
      return <Globe className="w-4 h-4 shrink-0" />;
  }
}

function countWords(text: string) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function ContentStudioPage() {
  const { showToast } = useToast();
  const { state } = useWorkspace();

  const [urlsInput, setUrlsInput] = useState("");
  const [location, setLocation] = useState("");
  const [selectedTone, setSelectedTone] =
    useState<(typeof TONE_PRESETS)[number]>("Professional");
  const [isScanning, setIsScanning] = useState(false);
  const [generateDone, setGenerateDone] = useState(false);
  const [analyzedKeywords, setAnalyzedKeywords] = useState<AnalyzedKeyword[]>([]);
  const [generatedPosts, setGeneratedPosts] = useState<StudioPostRecord[]>([]);
  const [listFilter, setListFilter] = useState<ListFilter>("draft");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    if (!state.email) return [] as StudioPostRecord[];
    try {
      const data = await api.listStudioPosts(
        state.email,
        state.activeWorkspaceId || undefined
      );
      const posts = data.posts || [];
      setGeneratedPosts(posts);
      return posts;
    } catch {
      return [] as StudioPostRecord[];
    }
  }, [state.email, state.activeWorkspaceId]);

  // Reload posts + location when client/agency workspace switches
  useEffect(() => {
    setGeneratedPosts([]);
    setAnalyzedKeywords([]);
    setGenerateDone(false);
    setExpandedId(null);
    setLocation(state.sitemap?.location || "");
    loadRecords();
  }, [state.activeWorkspaceId, state.email, state.sitemap?.location, loadRecords]);

  const handleScanAndGenerate = async () => {
    if (!urlsInput.trim() || !location.trim()) {
      showToast("Provide page URLs and target location.", "error");
      return;
    }
    if (!state.email) return;

    const urls = urlsInput
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean)
      .slice(0, 15);
    if (!urls.length) {
      showToast("Enter at least one URL", "error");
      return;
    }

    setIsScanning(true);
    setGenerateDone(false);
    setAnalyzedKeywords([]);
    setGeneratedPosts([]);

    try {
      const result = await api.generateAutoPoster({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        urls,
        location: location.trim(),
        tone: selectedTone,
      });

      const posts = result.posts || [];
      setAnalyzedKeywords(result.analyzed || []);
      setGeneratedPosts(posts);
      setListFilter("draft");
      setGenerateDone(true);
      showToast(
        `Complete — ${posts.length} posts from ${result.analyzed?.length || 0} pages`,
        "success"
      );

      // Confirm against DB (in case of partial response)
      await loadRecords();
    } catch (err) {
      // Backend may have finished even if proxy/client timed out — poll briefly
      showToast(
        isApiError(err)
          ? err.error
          : "Generation request interrupted — checking for completed posts…",
        "error"
      );
      for (let i = 0; i < 6; i++) {
        await sleep(2500);
        const posts = await loadRecords();
        if (posts.length) {
          setListFilter("draft");
          setGenerateDone(true);
          showToast(`Complete — ${posts.length} posts ready`, "success");
          break;
        }
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handlePublish = async (postId: string) => {
    if (!state.email) return;
    try {
      const result = await api.publishStudioPost({
        email: state.email,
        postId,
        alsoLive: true,
      });
      setGeneratedPosts((prev) =>
        prev.map((p) => (p.id === result.post.id ? result.post : p))
      );
      setListFilter("published");
      showToast("Published live to connected account & locked", "success");
    } catch (err) {
      showToast(
        isApiError(err)
          ? err.error
          : "Live publish failed. Connect this platform for the active client first.",
        "error"
      );
    }
  };

  const handleSchedule = async (postId: string, date: string) => {
    if (!date || !state.email) {
      showToast("Select a date and time", "error");
      return;
    }
    try {
      const result = await api.scheduleStudioPost({
        email: state.email,
        postId,
        scheduledAt: new Date(date).toISOString(),
      });
      setGeneratedPosts((prev) =>
        prev.map((p) => (p.id === result.post.id ? result.post : p))
      );
      setListFilter("scheduled");
      showToast("Scheduled — will publish live when due", "success");
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Schedule failed", "error");
    }
  };

  const handleRewrite = async (postId: string) => {
    if (!state.email) return;
    try {
      const result = await api.rewriteStudioPost({
        email: state.email,
        postId,
        tone: selectedTone,
      });
      setGeneratedPosts((prev) =>
        prev.map((p) => (p.id === result.post.id ? result.post : p))
      );
      setListFilter("draft");
      showToast("Rewritten — back to draft", "success");
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Rewrite failed", "error");
    }
  };

  const filtered = generatedPosts.filter((p) => p.status === listFilter);
  const urlCount = urlsInput.split("\n").filter((l) => l.trim()).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center">
      <div className="glass-card p-6 sm:p-8 rounded-2xl border border-navy-800">
        <h2 className="text-base font-bold text-white mb-1">Content Studio</h2>
        <p className="text-xs text-slate-400 mb-6 max-w-2xl mx-auto">
          Paste up to 15 page URLs. Each page gets SEO-length posts for Facebook, Instagram,
          LinkedIn, and GBP — word count never drops below the platform minimum.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6 text-center items-stretch">
          <div className="flex flex-col h-full">
            <label className="block text-xs font-bold text-slate-300 mb-2 w-full text-center">
              Page URLs (max 15)
            </label>
            <textarea
              value={urlsInput}
              onChange={(e) => setUrlsInput(e.target.value)}
              placeholder={"https://example.com/services\nhttps://example.com/about"}
              rows={6}
              className="w-full flex-1 min-h-[160px] text-xs border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-orange-500 outline-none resize-y text-center sm:text-left"
            />
            <p className="text-[10px] text-slate-500 mt-2">{urlCount}/15 URLs</p>
          </div>

          <div className="flex flex-col h-full">
            <label className="block text-xs font-bold text-slate-300 mb-2 w-full text-center">
              Target Location
            </label>
            <div className="relative w-full flex-1 flex flex-col">
              <MapPin className="absolute left-3 top-3.5 w-4 h-4 text-slate-500 pointer-events-none" />
              <textarea
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={"e.g. Denver, CO\nor full service area"}
                rows={6}
                className="w-full flex-1 min-h-[160px] text-xs font-semibold border border-navy-700 bg-navy-900 rounded-xl pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none resize-y text-center"
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-2">Same size as Page URLs</p>
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-xs font-bold text-slate-300 mb-3 text-center">
            Post tone / preset
          </label>
          <div className="flex flex-wrap justify-center gap-2">
            {TONE_PRESETS.map((tone) => (
              <button
                key={tone}
                type="button"
                onClick={() => setSelectedTone(tone)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all ${
                  selectedTone === tone
                    ? "bg-orange-500 text-white"
                    : "bg-navy-900 text-slate-400 border border-navy-700 hover:border-orange-500/50"
                }`}
              >
                {tone}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleScanAndGenerate}
            disabled={isScanning}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl text-xs transition-all shadow-lg shadow-orange-500/20 inline-flex items-center justify-center gap-2"
          >
            {isScanning ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Scanning & generating…
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" /> Analyze URLs & generate posts
              </>
            )}
          </button>

          {isScanning && (
            <p className="text-[11px] text-slate-400">
              This can take a few minutes for images — stay on this page.
            </p>
          )}

          {generateDone && !isScanning && (
            <p className="text-[11px] text-emerald-400 font-bold inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Generation complete — {generatedPosts.length} post
              {generatedPosts.length === 1 ? "" : "s"} ready
            </p>
          )}
        </div>

        {analyzedKeywords.length > 0 && (
          <div className="mt-6 pt-4 border-t border-navy-700">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-3 text-center">
              Extracted per page ({analyzedKeywords.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {analyzedKeywords.slice(0, 6).map((item, idx) => (
                <div
                  key={idx}
                  className="bg-navy-900 border border-navy-700 rounded-xl p-3 text-xs text-center"
                >
                  <p className="text-orange-400 font-bold truncate" title={item.url}>
                    {item.url}
                  </p>
                  <p className="text-slate-300 mt-1">
                    P: <span className="text-slate-400">{item.keywords.primary}</span>
                  </p>
                  <p className="text-slate-300">
                    S: <span className="text-slate-400">{item.keywords.secondary}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {generatedPosts.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <h3 className="text-sm font-bold text-white w-full sm:w-auto">Posts</h3>
            <div className="flex flex-wrap justify-center gap-2">
              {(["draft", "scheduled", "published"] as ListFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setListFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold capitalize ${
                    listFilter === f
                      ? "bg-orange-500 text-white"
                      : "bg-navy-900 text-slate-400 border border-navy-700"
                  }`}
                >
                  {f}
                  {f === "published" ? " (locked)" : ""} (
                  {generatedPosts.filter((p) => p.status === f).length})
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="glass-card p-10 rounded-2xl border border-navy-800 text-center text-slate-500 text-sm">
              No {listFilter} posts.
            </div>
          ) : (
            <div className="space-y-2 text-left">
              {filtered.map((post) => (
                <PostListRow
                  key={post.id}
                  post={post}
                  expanded={expandedId === post.id}
                  onToggle={() =>
                    setExpandedId((id) => (id === post.id ? null : post.id))
                  }
                  onPublish={handlePublish}
                  onSchedule={handleSchedule}
                  onRewrite={handleRewrite}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-slate-500 text-center">
        Publish requires a live OAuth connection for that platform on the active client.{" "}
        <Link href="/dashboard/connections" className="text-orange-400 font-bold hover:underline">
          Connect accounts →
        </Link>
      </p>
    </div>
  );
}

function PostListRow({
  post,
  expanded,
  onToggle,
  onPublish,
  onSchedule,
  onRewrite,
}: {
  post: StudioPostRecord;
  expanded: boolean;
  onToggle: () => void;
  onPublish: (id: string) => void;
  onSchedule: (id: string, date: string) => void;
  onRewrite: (id: string) => void;
}) {
  const [scheduleDate, setScheduleDate] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const locked = post.status === "published" && post.locked;
  const words =
    post.wordCount || countWords(post.contentHtml || post.content);
  const minWords = PLATFORM_MIN_WORDS[post.platform] || 80;
  const snippet = String(post.content || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

  return (
    <div className="glass-card rounded-xl border border-navy-800 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-navy-900/50 text-left"
      >
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-navy-900 shrink-0 border border-navy-700">
          {post.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.image} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-600">
              <ImageIcon className="w-4 h-4" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            {platformIcon(post.platform)}
            <span className="text-sm font-bold text-white">{post.platform}</span>
            <span className="text-[10px] uppercase font-bold text-slate-500 border border-navy-600 px-1.5 py-0.5 rounded">
              {post.tone}
            </span>
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                words >= minWords
                  ? "text-emerald-400 bg-emerald-950/30"
                  : "text-red-400 bg-red-950/30"
              }`}
            >
              {words} words · min {minWords}
            </span>
            {locked && (
              <span className="text-[10px] font-bold text-emerald-400 inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> Locked
              </span>
            )}
            {post.status === "scheduled" && post.scheduledDate && (
              <span className="text-[10px] font-bold text-sky-300 inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(post.scheduledDate).toLocaleString()}
              </span>
            )}
          </div>
          <p className="text-xs font-semibold text-slate-200 truncate">{post.heading}</p>
          {!expanded && (
            <p className="text-[11px] text-slate-500 truncate mt-0.5">{snippet}…</p>
          )}
        </div>

        <span className="text-[10px] text-slate-500 font-bold shrink-0">
          {expanded ? "Hide" : "Open"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-navy-800 space-y-3">
          <div
            className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed text-left [&_a]:text-orange-400 [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: post.contentHtml || post.content }}
          />
          <div className="flex flex-wrap gap-2">
            <span className="text-[10px] font-semibold text-orange-400 bg-orange-950/40 border border-orange-800/40 px-2 py-1 rounded">
              P: {post.keywords.primary}
            </span>
            <span className="text-[10px] font-semibold text-sky-300 bg-sky-950/40 border border-sky-800/40 px-2 py-1 rounded">
              S: {post.keywords.secondary}
            </span>
          </div>

          <div className="pt-2 border-t border-navy-700 flex flex-wrap gap-2">
            {locked ? (
              <button
                type="button"
                onClick={() => onRewrite(post.id)}
                className="inline-flex items-center justify-center gap-2 border border-navy-600 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl hover:bg-navy-900"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Rewrite & reuse
              </button>
            ) : (
              <>
                <div className="relative">
                  {showPicker && (
                    <div className="absolute bottom-full left-0 mb-2 bg-navy-900 border border-navy-600 rounded-xl p-3 z-20 w-[260px] shadow-xl">
                      <input
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="w-full text-xs border border-navy-600 bg-navy-950 rounded-lg px-2 py-2 text-slate-200 mb-2"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onSchedule(post.id, scheduleDate);
                            setShowPicker(false);
                          }}
                          className="flex-1 bg-sky-600 text-white text-xs font-bold py-2 rounded-lg"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowPicker(false)}
                          className="flex-1 bg-navy-800 text-slate-300 text-xs font-bold py-2 rounded-lg"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPicker(!showPicker)}
                    className="inline-flex items-center justify-center gap-1.5 border border-sky-800/50 text-sky-300 text-xs font-bold px-3 py-2 rounded-xl bg-sky-950/30"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    Schedule
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => onPublish(post.id)}
                  className="inline-flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3 py-2 rounded-xl"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Publish live
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
