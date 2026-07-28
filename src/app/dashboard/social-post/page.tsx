"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Calendar,
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
      return <Facebook className="w-4 h-4 text-blue-400" />;
    case "Instagram":
      return <Instagram className="w-4 h-4 text-pink-400" />;
    case "LinkedIn":
      return <Linkedin className="w-4 h-4 text-sky-400" />;
    case "GMB":
      return <Globe className="w-4 h-4 text-emerald-400" />;
    default:
      return <Globe className="w-4 h-4" />;
  }
}

function imageSizeLabel(platform: string) {
  if (platform === "Instagram") return "1080×1080";
  if (platform === "GMB") return "1024×576";
  if (platform === "LinkedIn") return "1200×627";
  return "1200×630";
}

export default function ContentStudioPage() {
  const { showToast } = useToast();
  const { state } = useWorkspace();

  const [urlsInput, setUrlsInput] = useState("");
  const [location, setLocation] = useState("");
  const [selectedTone, setSelectedTone] =
    useState<(typeof TONE_PRESETS)[number]>("Professional");
  const [isScanning, setIsScanning] = useState(false);
  const [analyzedKeywords, setAnalyzedKeywords] = useState<AnalyzedKeyword[]>([]);
  const [generatedPosts, setGeneratedPosts] = useState<StudioPostRecord[]>([]);
  const [listFilter, setListFilter] = useState<ListFilter>("draft");

  useEffect(() => {
    if (state.sitemap?.location && !location) {
      setLocation(state.sitemap.location);
    }
  }, [state.sitemap?.location, location]);

  const mergePosts = useCallback((incoming: StudioPostRecord[]) => {
    setGeneratedPosts((prev) => {
      const map = new Map(prev.map((p) => [p.id, p]));
      for (const p of incoming) map.set(p.id, p);
      return Array.from(map.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    });
  }, []);

  const loadRecords = useCallback(async () => {
    if (!state.email) return;
    try {
      const data = await api.listStudioPosts(
        state.email,
        state.activeWorkspaceId || undefined
      );
      if (data.posts) setGeneratedPosts(data.posts);
    } catch {
      /* keep local */
    }
  }, [state.email, state.activeWorkspaceId]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

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
    try {
      const result = await api.generateAutoPoster({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        urls,
        location: location.trim(),
        tone: selectedTone,
      });
      setAnalyzedKeywords(result.analyzed || []);
      await loadRecords();
      if (result.posts?.length) mergePosts(result.posts);
      setListFilter("draft");
      showToast(
        `Generated ${result.posts?.length || 0} posts from ${result.analyzed?.length || 0} pages`,
        "success"
      );
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Generation failed", "error");
    } finally {
      setIsScanning(false);
    }
  };

  const handlePublish = async (postId: string) => {
    if (!state.email) return;
    try {
      const result = await api.publishStudioPost({ email: state.email, postId });
      mergePosts([result.post]);
      showToast("Published & locked", "success");
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Publish failed", "error");
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
      mergePosts([result.post]);
      setListFilter("scheduled");
      showToast("Scheduled", "success");
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
      mergePosts([result.post]);
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
          Paste up to 15 page URLs. Each page gets 1 primary, 1 secondary, and 4 general
          keywords, then Facebook, Instagram, LinkedIn, and GBP posts with platform rules and
          images.
        </p>

        {/* Page URLs | Target Location — side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6 text-center">
          <div className="flex flex-col items-center">
            <label className="block text-xs font-bold text-slate-300 mb-2 w-full text-center">
              Page URLs (max 15)
            </label>
            <textarea
              value={urlsInput}
              onChange={(e) => setUrlsInput(e.target.value)}
              placeholder={"https://example.com/services\nhttps://example.com/about"}
              rows={6}
              className="w-full text-xs border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-orange-500 outline-none resize-y text-center sm:text-left"
            />
            <p className="text-[10px] text-slate-500 mt-2">{urlCount}/15 URLs</p>
          </div>

          <div className="flex flex-col items-center justify-start">
            <label className="block text-xs font-bold text-slate-300 mb-2 w-full text-center">
              Target Location
            </label>
            <div className="relative w-full">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Denver, CO"
                className="w-full text-xs font-semibold border border-navy-700 bg-navy-900 rounded-xl pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none text-center"
              />
            </div>
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

        <div className="flex justify-center">
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filtered.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
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
        Need OAuth live publish?{" "}
        <Link href="/dashboard/connections" className="text-orange-400 font-bold hover:underline">
          Connect accounts →
        </Link>
      </p>
    </div>
  );
}

function PostCard({
  post,
  onPublish,
  onSchedule,
  onRewrite,
}: {
  post: StudioPostRecord;
  onPublish: (id: string) => void;
  onSchedule: (id: string, date: string) => void;
  onRewrite: (id: string) => void;
}) {
  const [scheduleDate, setScheduleDate] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const locked = post.status === "published" && post.locked;

  return (
    <div className="glass-card rounded-2xl border border-navy-800 overflow-hidden text-center flex flex-col">
      <div className="px-4 py-3 border-b border-navy-700 flex flex-wrap items-center justify-center gap-2 bg-navy-900/50">
        <div className="flex items-center gap-2">
          {platformIcon(post.platform)}
          <span className="text-sm font-bold text-white">{post.platform}</span>
          <span className="text-[10px] uppercase font-bold text-slate-500 border border-navy-600 px-2 py-0.5 rounded">
            {post.tone}
          </span>
        </div>
        {locked && (
          <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Locked
          </span>
        )}
        {post.status === "scheduled" && post.scheduledDate && (
          <span className="text-[10px] font-bold text-sky-300 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {new Date(post.scheduledDate).toLocaleString()}
          </span>
        )}
      </div>

      {post.image && (
        <div className="aspect-[16/9] relative bg-navy-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.image}
            alt={post.heading}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <span className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-2 py-1 rounded flex items-center gap-1">
            <ImageIcon className="w-3 h-3" />
            {imageSizeLabel(post.platform)}
          </span>
        </div>
      )}

      <div className="p-4 flex flex-col flex-grow gap-3 items-center">
        <h4 className="text-sm font-bold text-white leading-snug">{post.heading}</h4>
        <div
          className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed flex-grow w-full [&_a]:text-orange-400 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: post.contentHtml || post.content }}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <span className="text-[10px] font-semibold text-orange-400 bg-orange-950/40 border border-orange-800/40 px-2 py-1 rounded truncate max-w-full">
            P: {post.keywords.primary}
          </span>
          <span className="text-[10px] font-semibold text-sky-300 bg-sky-950/40 border border-sky-800/40 px-2 py-1 rounded truncate max-w-full">
            S: {post.keywords.secondary}
          </span>
        </div>

        <div className="pt-3 border-t border-navy-700 flex flex-wrap justify-center gap-2 mt-auto w-full">
          {locked ? (
            <button
              type="button"
              onClick={() => onRewrite(post.id)}
              className="w-full inline-flex items-center justify-center gap-2 border border-navy-600 text-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl hover:bg-navy-900"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Rewrite & reuse
            </button>
          ) : (
            <>
              <div className="relative flex-1 min-w-[120px]">
                {showPicker && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-navy-900 border border-navy-600 rounded-xl p-3 z-20 w-[260px] shadow-xl">
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
                  className="w-full inline-flex items-center justify-center gap-1.5 border border-sky-800/50 text-sky-300 text-xs font-bold px-3 py-2.5 rounded-xl bg-sky-950/30"
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Schedule
                </button>
              </div>
              <button
                type="button"
                onClick={() => onPublish(post.id)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3 py-2.5 rounded-xl"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Publish
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
