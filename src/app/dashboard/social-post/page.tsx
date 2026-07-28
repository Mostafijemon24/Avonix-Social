"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  Clock,
  Facebook,
  Globe,
  Globe2,
  Image as ImageIcon,
  Instagram,
  Linkedin,
  Lock,
  MapPin,
  Play,
  PlusCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api, isApiError, type StudioPostRecord } from "@/lib/api-client";
import { canAffordUsage } from "@/lib/credits";
import { CreditCostBadge, InsufficientCreditsBanner } from "@/components/ui/CreditCostBadge";

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
  const { state, setSitemapData, refreshState, applyApiCredits } = useWorkspace();

  // ── Keywords (domain crawl) ──
  const [domain, setDomain] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [keywordLoading, setKeywordLoading] = useState(false);
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

  // ── Multi-URL scan + posts ──
  const [urlsInput, setUrlsInput] = useState("");
  const [selectedTone, setSelectedTone] =
    useState<(typeof TONE_PRESETS)[number]>("Professional");
  const [isScanning, setIsScanning] = useState(false);
  const [analyzedKeywords, setAnalyzedKeywords] = useState<AnalyzedKeyword[]>([]);
  const [generatedPosts, setGeneratedPosts] = useState<StudioPostRecord[]>([]);
  const [listFilter, setListFilter] = useState<ListFilter>("draft");

  const cost = 1;
  const affordable = canAffordUsage(state, cost);
  const sitemap = state.sitemap;

  useEffect(() => {
    if (sitemap?.primaryKeyword && !primaryKeyword) {
      setPrimaryKeyword(sitemap.primaryKeyword);
      setSecondaryText((sitemap.secondaryKeywords || []).join(", "));
      setLocation(sitemap.location || "");
      setAddress(sitemap.address || "");
    }
    if (sitemap?.location && !locationInput) setLocationInput(sitemap.location);
  }, [sitemap, primaryKeyword, locationInput]);

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

  const analyzeDomain = async () => {
    if (!domain.trim()) {
      showToast("Enter a root domain, e.g. example.com", "error");
      return;
    }
    if (!locationInput.trim()) {
      showToast("Enter city / region so keywords can be location-focused.", "error");
      return;
    }
    if (!affordable) {
      showToast(`Insufficient credits! Need ${cost}, you have ${state.credits}.`, "error");
      return;
    }

    setKeywordLoading(true);
    try {
      const result = await api.analyzeSite({
        domain: domain.trim(),
        email: state.email,
        location: locationInput.trim(),
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
      applyApiCredits(spend.creditsLeft, spend.walletBalanceUsd);

      setPrimaryKeyword(result.primaryKeyword);
      setSecondaryText(result.secondaryKeywords.join(", "));
      setLocation(result.location || locationInput.trim());
      setAddress(result.address || "");
      setMeta({
        domain: result.domain,
        urlCount: result.urlCount,
        pagesAnalyzed: result.pagesAnalyzed,
        method: result.method,
      });
      await refreshState();
      showToast(
        `Analyzed ${result.pagesAnalyzed} pages from ${result.urlCount} URLs.`,
        "success"
      );
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Site analysis failed.", "error");
    } finally {
      setKeywordLoading(false);
    }
  };

  const saveWorkspace = async () => {
    if (!primaryKeyword.trim() || !location.trim()) {
      showToast("Primary keyword and location are required.", "error");
      return;
    }
    const secondaryKeywords = secondaryText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await setSitemapData({
        url: meta?.domain || sitemap?.url || domain.trim(),
        primaryKeyword: primaryKeyword.trim(),
        secondaryKeywords,
        location: location.trim(),
        address: address.trim(),
        urlCount: meta?.urlCount || sitemap?.urlCount || 0,
        parsedAt: new Date().toISOString(),
      });
      showToast("Keywords saved for this client workspace.", "success");
    } catch {
      showToast("Failed to save keywords", "error");
    }
  };

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
  const clientName =
    (state.workspaces || []).find((w) => w.id === state.activeWorkspaceId)?.name ||
    "Active workspace";

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      {/* ── Section: Keywords ── */}
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1">
          <h2 className="text-base font-bold text-white">Content Studio</h2>
          <CreditCostBadge action="sitemap_parse" />
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Client: <span className="text-orange-400 font-bold">{clientName}</span>. Analyze the
          website for keywords, then generate Facebook, Instagram, LinkedIn, and GBP posts from
          up to 15 page URLs.
        </p>

        {!affordable && (
          <div className="mb-4">
            <InsufficientCreditsBanner required={cost} available={state.credits} />
          </div>
        )}

        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 text-left">
          1. Website keywords
        </h3>
        <div className="space-y-4 text-left">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
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
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1">
                Target Location
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={locationInput}
                  onChange={(e) => {
                    setLocationInput(e.target.value);
                    setLocation(e.target.value);
                  }}
                  placeholder="Denver, CO"
                  className="w-full text-xs font-semibold border border-navy-700 bg-navy-900 rounded-xl pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={analyzeDomain}
            disabled={keywordLoading || !affordable}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl text-xs transition-all shadow-lg shadow-orange-500/20 inline-flex items-center justify-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {keywordLoading ? "Crawling pages…" : `Analyze website (${cost} cr)`}
          </button>

          {(primaryKeyword || sitemap?.primaryKeyword) && (
            <div className="space-y-3 pt-2 border-t border-navy-700">
              {meta && (
                <p className="text-[10px] text-slate-500">
                  {meta.domain} · {meta.pagesAnalyzed} pages · {meta.urlCount} URLs · {meta.method}
                </p>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Primary Keyword
                </label>
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
                  rows={2}
                  className="w-full text-xs border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Location</label>
                  <input
                    type="text"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="w-full text-xs border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Street address (optional)
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full text-xs border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-orange-500 outline-none"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={saveWorkspace}
                className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-4 py-2.5 rounded-xl"
              >
                Save keywords
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Section: Generate posts from page URLs ── */}
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1 text-left">
          2. Generate platform posts
        </h3>
        <p className="text-xs text-slate-400 mb-4 text-left">
          Paste up to 15 page URLs (one per line). Each page gets 1 primary, 1 secondary, and 4
          general keywords, then FB / IG / LinkedIn / GMB posts with platform rules and images.
        </p>

        <div className="space-y-4 text-left">
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">
              Page URLs (max 15)
            </label>
            <textarea
              value={urlsInput}
              onChange={(e) => setUrlsInput(e.target.value)}
              placeholder={"https://example.com/services\nhttps://example.com/about"}
              rows={5}
              className="w-full text-xs border border-navy-700 bg-navy-900 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-orange-500 outline-none resize-y"
            />
            <p className="text-[10px] text-slate-500 mt-1">
              {urlsInput.split("\n").filter((l) => l.trim()).length}/15 URLs
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2">
              Post tone / preset
            </label>
            <div className="flex flex-wrap gap-2">
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

          {!state.sitemap?.primaryKeyword && !primaryKeyword && (
            <p className="text-[11px] text-amber-400">
              Tip: run website keyword analysis above (or set location) before generating.
            </p>
          )}
        </div>

        {analyzedKeywords.length > 0 && (
          <div className="mt-6 pt-4 border-t border-navy-700 text-left">
            <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-3">
              Extracted per page ({analyzedKeywords.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {analyzedKeywords.slice(0, 6).map((item, idx) => (
                <div
                  key={idx}
                  className="bg-navy-900 border border-navy-700 rounded-xl p-3 text-xs"
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

      {/* ── Section: Post list ── */}
      {generatedPosts.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-white">Posts</h3>
            <div className="flex flex-wrap gap-2">
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

      <p className="text-[10px] text-slate-500 text-left">
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
    <div className="glass-card rounded-2xl border border-navy-800 overflow-hidden text-left flex flex-col">
      <div className="px-4 py-3 border-b border-navy-700 flex flex-wrap items-center justify-between gap-2 bg-navy-900/50">
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

      <div className="p-4 flex flex-col flex-grow gap-3">
        <h4 className="text-sm font-bold text-white leading-snug">{post.heading}</h4>
        <div
          className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed flex-grow [&_a]:text-orange-400 [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: post.contentHtml || post.content }}
        />
        <div className="flex flex-wrap gap-2">
          <span className="text-[10px] font-semibold text-orange-400 bg-orange-950/40 border border-orange-800/40 px-2 py-1 rounded truncate max-w-full">
            P: {post.keywords.primary}
          </span>
          <span className="text-[10px] font-semibold text-sky-300 bg-sky-950/40 border border-sky-800/40 px-2 py-1 rounded truncate max-w-full">
            S: {post.keywords.secondary}
          </span>
        </div>

        <div className="pt-3 border-t border-navy-700 flex flex-wrap gap-2 mt-auto">
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
