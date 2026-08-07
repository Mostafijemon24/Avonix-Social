"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Download,
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
  Search,
  Target,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  api,
  isApiError,
  type StudioPageAnalysis,
  type StudioPostRecord,
  type WebsiteAnalyzeResult,
  type ArchiveWebsiteTable,
} from "@/lib/api-client";

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

type ListFilter = "draft" | "published" | "scheduled";
type ImageSource = "auto" | "ai" | "free";
type MainTab = "active" | "archive";

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

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Cross-origin fallback — open in new tab
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export default function ContentStudioPage() {
  const { showToast } = useToast();
  const { state } = useWorkspace();

  // —— Part 1: website analysis ——
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [location, setLocation] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<WebsiteAnalyzeResult | null>(null);
  const [selectedPages, setSelectedPages] = useState<StudioPageAnalysis[]>([]);

  // —— Existing generate / publish (later parts reuse) ——
  const [selectedTone, setSelectedTone] =
    useState<(typeof TONE_PRESETS)[number]>("Professional");
  const [isScanning, setIsScanning] = useState(false);
  const [generateDone, setGenerateDone] = useState(false);
  const [generatedPosts, setGeneratedPosts] = useState<StudioPostRecord[]>([]);
  const [listFilter, setListFilter] = useState<ListFilter>("draft");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // —— Part 3: images ——
  const [includeImages, setIncludeImages] = useState(false);
  const [imageSource, setImageSource] = useState<ImageSource>("auto");
  const [isAttachingImages, setIsAttachingImages] = useState(false);
  const [imageBusyId, setImageBusyId] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  // —— Part 5: archive ——
  const [mainTab, setMainTab] = useState<MainTab>("active");
  const [archiveTables, setArchiveTables] = useState<ArchiveWebsiteTable[]>([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [isLoadingArchive, setIsLoadingArchive] = useState(false);
  const [clearConfirmOrigin, setClearConfirmOrigin] = useState<string | null>(null);
  const [isClearingArchive, setIsClearingArchive] = useState(false);

  // —— Part 6: AI provider decision ——
  const [providerDecision, setProviderDecision] = useState<{
    method?: string;
    writing?: { id: string; model: string; label: string; reason: string };
    image?: {
      id: string;
      model: string | null;
      source: string;
      label: string;
      reason: string;
    };
  } | null>(null);

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

  const loadArchive = useCallback(async () => {
    if (!state.email) return;
    setIsLoadingArchive(true);
    try {
      const data = await api.listArchivedStudioPosts(
        state.email,
        state.activeWorkspaceId || undefined
      );
      setArchiveTables(data.tables || []);
      setArchiveTotal(data.total || 0);
    } catch {
      setArchiveTables([]);
      setArchiveTotal(0);
    } finally {
      setIsLoadingArchive(false);
    }
  }, [state.email, state.activeWorkspaceId]);

  useEffect(() => {
    setGeneratedPosts([]);
    setAnalysis(null);
    setSelectedPages([]);
    setGenerateDone(false);
    setExpandedId(null);
    setArchiveTables([]);
    setArchiveTotal(0);
    setMainTab("active");
    setProviderDecision(null);
    setLocation(state.sitemap?.location || "");
    loadRecords();
    loadArchive();
  }, [state.activeWorkspaceId, state.email, state.sitemap?.location, loadRecords, loadArchive]);

  const handleAnalyzeWebsite = async () => {
    if (!websiteUrl.trim()) {
      showToast("Enter a website URL", "error");
      return;
    }
    if (!state.email) return;

    setIsAnalyzing(true);
    setAnalysis(null);
    setSelectedPages([]);
    setGenerateDone(false);

    try {
      const result = await api.analyzeWebsiteForStudio({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        websiteUrl: websiteUrl.trim(),
        location: location.trim() || undefined,
        maxPages: 15,
      });

      setAnalysis(result);
      setSelectedPages(result.pages || []);
      if (result.location && !location.trim()) {
        setLocation(result.location);
      }
      showToast(
        `Part 1 done — ${result.pageCount} pages from ${result.discoveredCount} discovered`,
        "success"
      );
    } catch (err) {
      showToast(
        isApiError(err) ? err.error : "Website analysis failed",
        "error"
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const togglePage = (url: string) => {
    setSelectedPages((prev) => {
      const exists = prev.some((p) => p.url === url);
      if (exists) return prev.filter((p) => p.url !== url);
      const page = analysis?.pages.find((p) => p.url === url);
      if (!page) return prev;
      if (prev.length >= 15) {
        showToast("Max 15 pages for post generation", "error");
        return prev;
      }
      return [...prev, page];
    });
  };

  const handleScanAndGenerate = async () => {
    if (!selectedPages.length) {
      showToast("Analyze a website and keep at least one page selected", "error");
      return;
    }
    if (!location.trim()) {
      showToast("Target location is required before generating posts", "error");
      return;
    }
    if (!state.email) return;

    setIsScanning(true);
    setGenerateDone(false);
    setGeneratedPosts([]);

    try {
      const result = await api.generateAutoPoster({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        location: location.trim(),
        tone: selectedTone,
        pages: selectedPages,
        masterIntent: analysis?.masterIntent,
        includeImages,
        imageSource,
        platforms: ["Facebook", "LinkedIn", "GMB"],
        websiteUrl: analysis?.websiteUrl || websiteUrl.trim() || undefined,
      });

      const posts = result.posts || [];
      setGeneratedPosts(posts);
      setProviderDecision(result.providerDecision || null);
      setListFilter("draft");
      setGenerateDone(true);
      setMainTab("active");
      if (result.archivedCount) {
        await loadArchive();
        showToast(
          `Complete — ${posts.length} posts. ${result.archivedCount} moved to Archive.`,
          "success"
        );
      } else {
        const writer = result.providerDecision?.writing?.label || "template";
        showToast(
          `Complete — ${posts.length} posts via ${writer}`,
          "success"
        );
      }
      await loadRecords();
    } catch (err) {
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
    setActionBusyId(postId);
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
      showToast("Published live & locked — regenerate to reuse", "success");
    } catch (err) {
      showToast(
        isApiError(err)
          ? err.error
          : "Live publish failed. Connect this platform for the active client first.",
        "error"
      );
    } finally {
      setActionBusyId(null);
    }
  };

  const handleSchedule = async (postId: string, date: string) => {
    if (!date || !state.email) {
      showToast("Select a date and time", "error");
      return;
    }
    setActionBusyId(postId);
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
      showToast("Scheduled for auto-publish when due", "success");
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Schedule failed", "error");
    } finally {
      setActionBusyId(null);
    }
  };

  const handleUnschedule = async (postId: string) => {
    if (!state.email) return;
    setActionBusyId(postId);
    try {
      const result = await api.unscheduleStudioPost({
        email: state.email,
        postId,
      });
      setGeneratedPosts((prev) =>
        prev.map((p) => (p.id === result.post.id ? result.post : p))
      );
      setListFilter("draft");
      showToast("Schedule cancelled — back to draft", "success");
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Unschedule failed", "error");
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRewrite = async (postId: string) => {
    if (!state.email) return;
    setActionBusyId(postId);
    try {
      const result = await api.rewriteStudioPost({
        email: state.email,
        postId,
        tone: selectedTone,
        includeImages,
        imageSource,
      });
      if (result.restoredFromArchive) {
        setArchiveTables((prev) =>
          prev
            .map((t) => ({
              ...t,
              posts: t.posts.filter((p) => p.id !== postId),
              count: t.posts.filter((p) => p.id !== postId).length,
            }))
            .filter((t) => t.posts.length > 0)
        );
        setArchiveTotal((n) => Math.max(0, n - 1));
        setGeneratedPosts((prev) => [result.post, ...prev.filter((p) => p.id !== result.post.id)]);
        setMainTab("active");
        setListFilter("draft");
        showToast("Unlocked from Archive → Active drafts", "success");
      } else {
        setGeneratedPosts((prev) =>
          prev.map((p) => (p.id === result.post.id ? result.post : p))
        );
        setListFilter("draft");
        showToast(
          result.unlocked
            ? "Unlocked & regenerated — ready to publish again"
            : "Regenerated — back to draft",
          "success"
        );
      }
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Regenerate failed", "error");
    } finally {
      setActionBusyId(null);
    }
  };

  const handleClearArchive = async (websiteOrigin?: string | null) => {
    if (!state.email) return;
    setIsClearingArchive(true);
    try {
      const result = await api.clearStudioArchive({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        websiteOrigin: websiteOrigin || undefined,
        confirm: true,
      });
      await loadArchive();
      setClearConfirmOrigin(null);
      showToast(
        websiteOrigin
          ? `Cleared archive for ${websiteOrigin} (${result.deleted} posts)`
          : `Cleared entire archive (${result.deleted} posts)`,
        "success"
      );
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Clear archive failed", "error");
    } finally {
      setIsClearingArchive(false);
    }
  };

  const handleAttachAllImages = async (onlyMissing = true) => {
    if (!state.email) return;
    if (!includeImages) {
      showToast("Enable “Include images” checkbox first", "error");
      return;
    }
    setIsAttachingImages(true);
    try {
      const result = await api.attachStudioImages({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        imageSource,
        onlyMissing,
      });
      if (result.posts?.length) {
        setGeneratedPosts((prev) => {
          const map = new Map(result.posts.map((p) => [p.id, p]));
          return prev.map((p) => map.get(p.id) || p);
        });
      } else {
        await loadRecords();
      }
      showToast(
        `Images attached: ${result.attached}${result.failed ? ` · failed ${result.failed}` : ""}${
          result.providerDecision?.image?.label
            ? ` · via ${result.providerDecision.image.label}`
            : ""
        }`,
        result.attached ? "success" : "error"
      );
      if (result.providerDecision) setProviderDecision(result.providerDecision);
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Image attach failed", "error");
    } finally {
      setIsAttachingImages(false);
    }
  };

  const handlePostImage = async (
    postId: string,
    action: "generate" | "clear"
  ) => {
    if (!state.email) return;
    setImageBusyId(postId);
    try {
      const result = await api.setStudioPostImage({
        email: state.email,
        postId,
        action,
        imageSource,
      });
      setGeneratedPosts((prev) =>
        prev.map((p) => (p.id === result.post.id ? result.post : p))
      );
      showToast(
        action === "clear" ? "Image detached" : "Image ready",
        "success"
      );
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Image update failed", "error");
    } finally {
      setImageBusyId(null);
    }
  };

  const filtered = generatedPosts.filter((p) => p.status === listFilter);
  const platformCounts = {
    Facebook: generatedPosts.filter((p) => p.platform === "Facebook").length,
    LinkedIn: generatedPosts.filter((p) => p.platform === "LinkedIn").length,
    GMB: generatedPosts.filter((p) => p.platform === "GMB").length,
  };
  const postsMissingImages = generatedPosts.filter(
    (p) =>
      !p.image &&
      p.status !== "published" &&
      !p.locked
  ).length;
  const lockedCount = generatedPosts.filter(
    (p) => p.publishLocked || (p.status === "published" && p.locked)
  ).length;
  const lastPostedAt = generatedPosts
    .map((p) => p.publishedAt)
    .filter(Boolean)
    .sort()
    .reverse()[0] as string | undefined;

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center">
      {/* —— PART 1 —— */}
      <div className="glass-card p-6 sm:p-8 rounded-2xl border border-navy-800">
        <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-2">
          <span className="bg-orange-500/20 border border-orange-500/40 px-2 py-0.5 rounded-full">
            Part 1
          </span>
          Website → pages → coverage → intent → keywords
        </div>
        <h2 className="text-base font-bold text-white mb-1">Content Studio</h2>
        <p className="text-xs text-slate-400 mb-6 max-w-2xl mx-auto">
          Enter a website URL. We discover up to 15 pages, detect area coverage and writing
          intent, then extract 1 primary + 4 secondary keywords per page.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6 text-center items-stretch">
          <div className="flex flex-col h-full">
            <label className="block text-xs font-bold text-slate-300 mb-2 w-full text-center">
              Website URL
            </label>
            <div className="relative w-full flex-1 flex flex-col">
              <Globe className="absolute left-3 top-3.5 w-4 h-4 text-slate-500 pointer-events-none" />
              <input
                type="url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full flex-1 min-h-[48px] text-xs font-semibold border border-navy-700 bg-navy-900 rounded-xl pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none text-center sm:text-left"
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-2">
              Root domain is enough — sitemap & pages are discovered automatically
            </p>
          </div>

          <div className="flex flex-col h-full">
            <label className="block text-xs font-bold text-slate-300 mb-2 w-full text-center">
              Target Location (area coverage)
            </label>
            <div className="relative w-full flex-1 flex flex-col">
              <MapPin className="absolute left-3 top-3.5 w-4 h-4 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Denver, CO — optional; AI can infer"
                className="w-full flex-1 min-h-[48px] text-xs font-semibold border border-navy-700 bg-navy-900 rounded-xl pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none text-center"
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-2">
              Used for local SEO keywords; auto-filled from site when possible
            </p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleAnalyzeWebsite}
            disabled={isAnalyzing}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl text-xs transition-all shadow-lg shadow-orange-500/20 inline-flex items-center justify-center gap-2"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analyzing website…
              </>
            ) : (
              <>
                <Search className="w-3.5 h-3.5" /> Analyze website (Part 1)
              </>
            )}
          </button>
          {isAnalyzing && (
            <p className="text-[11px] text-slate-400">
              Crawling sitemap & pages — this can take a minute.
            </p>
          )}
        </div>

        {analysis && (
          <div className="mt-6 pt-4 border-t border-navy-700 space-y-4 text-left">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-navy-900 border border-navy-700 rounded-xl p-3 text-center">
                <p className="text-[10px] uppercase text-slate-500 font-bold mb-1">Website</p>
                <p className="text-xs text-orange-400 font-bold truncate" title={analysis.websiteUrl}>
                  {analysis.websiteUrl}
                </p>
                <p className="text-[10px] text-slate-500 mt-1">
                  {analysis.discoveredCount} discovered · {analysis.pageCount} analyzed
                </p>
              </div>
              <div className="bg-navy-900 border border-navy-700 rounded-xl p-3 text-center">
                <p className="text-[10px] uppercase text-slate-500 font-bold mb-1 inline-flex items-center gap-1 justify-center w-full">
                  <MapPin className="w-3 h-3" /> Area coverage
                </p>
                <p className="text-xs text-slate-200 font-semibold">
                  {analysis.areaCoverage?.summary || location || "—"}
                </p>
              </div>
              <div className="bg-navy-900 border border-navy-700 rounded-xl p-3 text-center">
                <p className="text-[10px] uppercase text-slate-500 font-bold mb-1 inline-flex items-center gap-1 justify-center w-full">
                  <Target className="w-3 h-3" /> Master intent
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {analysis.masterIntent}
                </p>
                <p className="text-[10px] text-emerald-400 font-bold mt-1">
                  Dominant: {analysis.dominantIntent}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-navy-700">
              <table className="w-full text-left text-xs min-w-[720px]">
                <thead className="bg-navy-950 text-slate-500 uppercase text-[10px] tracking-wide">
                  <tr>
                    <th className="px-3 py-2 font-bold w-10">Use</th>
                    <th className="px-3 py-2 font-bold">Page URL</th>
                    <th className="px-3 py-2 font-bold">Area</th>
                    <th className="px-3 py-2 font-bold">Intent</th>
                    <th className="px-3 py-2 font-bold">Primary KW</th>
                    <th className="px-3 py-2 font-bold">Secondary (4)</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysis.pages || []).map((page) => {
                    const checked = selectedPages.some((p) => p.url === page.url);
                    return (
                      <tr
                        key={page.url}
                        className="border-t border-navy-800 hover:bg-navy-900/40"
                      >
                        <td className="px-3 py-2 align-top">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePage(page.url)}
                            className="rounded border-navy-600 bg-navy-900 text-orange-500 focus:ring-orange-500"
                          />
                        </td>
                        <td className="px-3 py-2 align-top max-w-[220px]">
                          <a
                            href={page.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-orange-400 hover:underline font-semibold break-all"
                          >
                            {page.url.replace(/^https?:\/\//, "")}
                          </a>
                          {page.title ? (
                            <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                              {page.title}
                            </p>
                          ) : null}
                          {!page.reachable && (
                            <span className="text-[10px] text-amber-400 font-bold">
                              Unreachable — slug fallback
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-slate-300 max-w-[140px]">
                          {page.areaCoverage}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className="text-emerald-400 font-bold whitespace-nowrap">
                            {page.writingIntent}
                          </span>
                          <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                            {page.masterIntent}
                          </p>
                        </td>
                        <td className="px-3 py-2 align-top text-white font-semibold max-w-[140px]">
                          {page.keywords.primary}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <ul className="space-y-0.5 text-slate-400">
                            {(page.keywords.secondary || []).slice(0, 4).map((kw, i) => (
                              <li key={i}>
                                <span className="text-slate-600">{i + 1}.</span> {kw}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-500 text-center">
              {selectedPages.length}/15 pages selected for Part 2 (post generation)
            </p>
          </div>
        )}
      </div>

      {/* —— PART 2 —— */}
      {analysis && selectedPages.length > 0 && (
        <div className="glass-card p-6 sm:p-8 rounded-2xl border border-navy-800">
          <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-2">
            <span className="bg-orange-500/20 border border-orange-500/40 px-2 py-0.5 rounded-full">
              Part 2
            </span>
            15 pages × 3 platforms = up to 45 posts
          </div>
          <h3 className="text-sm font-bold text-white mb-1">Generate platform posts</h3>
          <p className="text-xs text-slate-400 mb-4 max-w-2xl mx-auto">
            Uses Part 1 keywords + master intent. Word floors: Facebook 120–160 · LinkedIn
            150–200 · Google Business 90–130.
          </p>

          <div className="flex flex-wrap justify-center gap-2 mb-5">
            {[
              { name: "Facebook", min: 120, max: 160, icon: Facebook, color: "text-blue-400" },
              { name: "LinkedIn", min: 150, max: 200, icon: Linkedin, color: "text-sky-400" },
              { name: "GMB", min: 90, max: 130, icon: Globe, color: "text-emerald-400" },
            ].map((p) => (
              <span
                key={p.name}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-navy-900 border border-navy-700 rounded-full px-3 py-1.5 text-slate-200"
              >
                <p.icon className={`w-3.5 h-3.5 ${p.color}`} />
                {p.name}
                <span className="text-slate-500 font-semibold">
                  {p.min}–{p.max}w
                </span>
              </span>
            ))}
          </div>

          {analysis.masterIntent && (
            <div className="mb-5 mx-auto max-w-2xl bg-navy-900/80 border border-navy-700 rounded-xl px-4 py-3 text-left">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold mb-1">
                Master intent (applied to every post)
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">{analysis.masterIntent}</p>
            </div>
          )}

          <div className="mb-4">
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

          {/* —— PART 3 image controls (shared with generate) —— */}
          <div className="mb-5 mx-auto max-w-xl border border-navy-700 rounded-xl p-4 bg-navy-950/50 text-left">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-3">
              <span className="bg-orange-500/20 border border-orange-500/40 px-2 py-0.5 rounded-full">
                Part 3
              </span>
              Images (optional)
            </div>
            <label className="flex items-start gap-3 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
                className="mt-0.5 rounded border-navy-600 bg-navy-900 text-orange-500 focus:ring-orange-500"
              />
              <span>
                <span className="text-xs font-bold text-white block">
                  Include relevant images with posts
                </span>
                <span className="text-[10px] text-slate-500">
                  Uncheck to publish text-only. You can attach images later per post or in bulk.
                </span>
              </span>
            </label>
            <div
              className={`space-y-2 ${includeImages ? "opacity-100" : "opacity-40 pointer-events-none"}`}
            >
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
                Image source
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    {
                      id: "auto" as const,
                      label: "AI picks best (recommended)",
                    },
                    { id: "ai" as const, label: "Paid AI only" },
                    { id: "free" as const, label: "Free only ($0)" },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setImageSource(opt.id)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-bold ${
                      imageSource === opt.id
                        ? "bg-orange-500 text-white"
                        : "bg-navy-900 text-slate-400 border border-navy-700"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 mt-2">
                Recommended: AI picks ChatGPT Images (paid, HD, topic-matched). Free Pollinations is
                $0 but often generic/low quality. Platform sizes: FB 1920×1008 · LI 1920×1005 · GMB
                1200×900. Needs OPENROUTER_API_KEY on the server.
              </p>
            </div>
          </div>

          {providerDecision && (
            <div className="mb-5 mx-auto max-w-xl border border-orange-900/40 rounded-xl p-4 bg-orange-950/10 text-left">
              <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-2">
                <span className="bg-orange-500/20 border border-orange-500/40 px-2 py-0.5 rounded-full">
                  Part 6
                </span>
                AI provider decision ({providerDecision.method || "ai"})
              </div>
              <div className="space-y-2 text-xs text-slate-300">
                {providerDecision.writing && (
                  <p>
                    <span className="font-bold text-white">Writing:</span>{" "}
                    {providerDecision.writing.label}
                    <span className="block text-[10px] text-slate-500 mt-0.5">
                      {providerDecision.writing.reason}
                    </span>
                  </p>
                )}
                {providerDecision.image && (
                  <p>
                    <span className="font-bold text-white">Images:</span>{" "}
                    {providerDecision.image.label}
                    <span className="block text-[10px] text-slate-500 mt-0.5">
                      {providerDecision.image.reason}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleScanAndGenerate}
              disabled={isScanning}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl text-xs transition-all shadow-lg shadow-orange-500/20 inline-flex items-center justify-center gap-2"
            >
              {isScanning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />{" "}
                  {includeImages ? "Writing posts + images…" : "Writing posts…"}
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" /> Generate{" "}
                  {selectedPages.length * 3} posts
                  {includeImages ? " + images" : ""}
                </>
              )}
            </button>
            <p className="text-[10px] text-slate-500">
              {selectedPages.length} pages × 3 platforms = {selectedPages.length * 3} drafts
              {includeImages
                ? ` · images via ${imageSource}`
                : " · text only (images optional)"}
            </p>
            {isScanning && (
              <p className="text-[11px] text-slate-400">
                Writing FB / LinkedIn / GMB copy with word limits — stay on this page.
              </p>
            )}
            {generateDone && !isScanning && (
              <p className="text-[11px] text-emerald-400 font-bold inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Ready — {generatedPosts.length} post
                {generatedPosts.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>
      )}

      {/* —— PART 3 batch attach (for existing drafts) —— */}
      {generatedPosts.length > 0 && (
        <div className="glass-card p-5 sm:p-6 rounded-2xl border border-navy-800">
          <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-2">
            <span className="bg-orange-500/20 border border-orange-500/40 px-2 py-0.5 rounded-full">
              Part 3
            </span>
            Attach / refresh images
          </div>
          <p className="text-xs text-slate-400 mb-4 max-w-xl mx-auto">
            {postsMissingImages} draft/scheduled post
            {postsMissingImages === 1 ? "" : "s"} missing images. Per-post download,
            regenerate, or detach is available when you open a row.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              disabled={isAttachingImages || !includeImages}
              onClick={() => handleAttachAllImages(true)}
              className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-xs font-bold px-4 py-2 rounded-xl"
            >
              {isAttachingImages ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5" />
              )}
              Attach missing images
            </button>
            <button
              type="button"
              disabled={isAttachingImages || !includeImages}
              onClick={() => handleAttachAllImages(false)}
              className="inline-flex items-center gap-1.5 border border-navy-600 text-slate-200 text-xs font-bold px-4 py-2 rounded-xl hover:bg-navy-900 disabled:opacity-40"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerate all draft images
            </button>
          </div>
          {!includeImages && (
            <p className="text-[10px] text-amber-400/90 mt-3 text-center">
              Check “Include relevant images” above to enable attach / regenerate.
            </p>
          )}
        </div>
      )}

      {/* —— PART 5: Active / Archive tabs —— */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setMainTab("active")}
          className={`px-4 py-2 rounded-xl text-xs font-bold ${
            mainTab === "active"
              ? "bg-orange-500 text-white"
              : "bg-navy-900 text-slate-400 border border-navy-700"
          }`}
        >
          Active posts ({generatedPosts.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setMainTab("archive");
            loadArchive();
          }}
          className={`px-4 py-2 rounded-xl text-xs font-bold ${
            mainTab === "archive"
              ? "bg-orange-500 text-white"
              : "bg-navy-900 text-slate-400 border border-navy-700"
          }`}
        >
          Archive ({archiveTotal})
        </button>
      </div>

      {mainTab === "active" && generatedPosts.length > 0 && (
        <div className="space-y-4">
          <div className="glass-card p-4 rounded-2xl border border-navy-800">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-2">
              <span className="bg-orange-500/20 border border-orange-500/40 px-2 py-0.5 rounded-full">
                Part 4
              </span>
              Publish lock · regenerate unlock · schedule · last posted
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1 font-bold text-slate-300">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                {lockedCount} locked
              </span>
              {lastPostedAt ? (
                <span className="inline-flex items-center gap-1 font-semibold">
                  <Clock className="w-3.5 h-3.5 text-sky-400" />
                  Last posted:{" "}
                  <span className="text-white">
                    {new Date(lastPostedAt).toLocaleString()}
                  </span>
                </span>
              ) : (
                <span className="text-slate-500">No posts published yet</span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 mt-2 max-w-xl mx-auto">
              Drafts show <span className="text-slate-300">Unlocked</span>. After you press Publish,
              the post gets a green <span className="text-emerald-400">Locked</span> padlock (text +
              image). Regenerate unlocks it so you can publish again.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <h3 className="text-sm font-bold text-white w-full sm:w-auto">
              Posts ({generatedPosts.length})
            </h3>
            <div className="flex flex-wrap justify-center gap-2 text-[10px] font-bold text-slate-400">
              <span className="inline-flex items-center gap-1 bg-navy-900 border border-navy-700 px-2 py-1 rounded-full">
                <Facebook className="w-3 h-3 text-blue-400" /> {platformCounts.Facebook}
              </span>
              <span className="inline-flex items-center gap-1 bg-navy-900 border border-navy-700 px-2 py-1 rounded-full">
                <Linkedin className="w-3 h-3 text-sky-400" /> {platformCounts.LinkedIn}
              </span>
              <span className="inline-flex items-center gap-1 bg-navy-900 border border-navy-700 px-2 py-1 rounded-full">
                <Globe className="w-3 h-3 text-emerald-400" /> {platformCounts.GMB}
              </span>
            </div>
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
                  imageBusy={imageBusyId === post.id}
                  actionBusy={actionBusyId === post.id}
                  onToggle={() =>
                    setExpandedId((id) => (id === post.id ? null : post.id))
                  }
                  onPublish={handlePublish}
                  onSchedule={handleSchedule}
                  onUnschedule={handleUnschedule}
                  onRewrite={handleRewrite}
                  onGenerateImage={(id) => handlePostImage(id, "generate")}
                  onClearImage={(id) => handlePostImage(id, "clear")}
                  onDownloadImage={(url, name) => downloadImage(url, name)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {mainTab === "archive" && (
        <div className="space-y-4">
          <div className="glass-card p-5 sm:p-6 rounded-2xl border border-navy-800">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-orange-400 mb-2">
              <span className="bg-orange-500/20 border border-orange-500/40 px-2 py-0.5 rounded-full">
                Part 5
              </span>
              Archive · per-website tables · clear with confirm
            </div>
            <p className="text-xs text-slate-400 mb-4 max-w-2xl mx-auto">
              When you generate posts for a new website, previous posts move here — grouped by
              website. Locked posts stay padlocked until Re-generate (then restore to Active).
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                disabled={isLoadingArchive}
                onClick={() => loadArchive()}
                className="inline-flex items-center gap-1.5 border border-navy-600 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl hover:bg-navy-900 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingArchive ? "animate-spin" : ""}`} />
                Refresh archive
              </button>
              {archiveTotal > 0 && (
                <button
                  type="button"
                  disabled={isClearingArchive}
                  onClick={() => setClearConfirmOrigin("__ALL__")}
                  className="inline-flex items-center gap-1.5 border border-red-900/50 text-red-300 text-xs font-bold px-3 py-2 rounded-xl bg-red-950/20 hover:bg-red-950/40 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear entire archive
                </button>
              )}
            </div>
          </div>

          {clearConfirmOrigin && (
            <div className="glass-card p-5 rounded-2xl border border-red-900/40 bg-red-950/20 text-center space-y-3">
              <p className="text-sm font-bold text-white">Confirm clear archive?</p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {clearConfirmOrigin === "__ALL__"
                  ? `Permanently delete all ${archiveTotal} archived posts. This cannot be undone.`
                  : `Permanently delete archived posts for ${clearConfirmOrigin}. This cannot be undone.`}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  disabled={isClearingArchive}
                  onClick={() =>
                    handleClearArchive(
                      clearConfirmOrigin === "__ALL__" ? null : clearConfirmOrigin
                    )
                  }
                  className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-xl inline-flex items-center gap-1.5"
                >
                  {isClearingArchive ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Yes, clear
                </button>
                <button
                  type="button"
                  disabled={isClearingArchive}
                  onClick={() => setClearConfirmOrigin(null)}
                  className="border border-navy-600 text-slate-300 text-xs font-bold px-4 py-2 rounded-xl"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isLoadingArchive ? (
            <div className="glass-card p-10 rounded-2xl border border-navy-800 text-center text-slate-500 text-sm">
              Loading archive…
            </div>
          ) : archiveTables.length === 0 ? (
            <div className="glass-card p-10 rounded-2xl border border-navy-800 text-center text-slate-500 text-sm">
              Archive is empty. Generate posts for a new website to move previous batches here.
            </div>
          ) : (
            archiveTables.map((table) => (
              <div
                key={table.websiteOrigin}
                className="glass-card rounded-2xl border border-navy-800 overflow-hidden text-left"
              >
                <div className="px-4 py-3 border-b border-navy-800 flex flex-wrap items-center justify-between gap-2 bg-navy-950/50">
                  <div>
                    <p className="text-xs font-bold text-orange-400 truncate max-w-[420px]">
                      {table.websiteOrigin}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {table.count} posts · {table.lockedCount} locked
                      {table.archivedAt
                        ? ` · archived ${new Date(table.archivedAt).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isClearingArchive}
                    onClick={() => setClearConfirmOrigin(table.websiteOrigin)}
                    className="text-[10px] font-bold text-red-300 border border-red-900/40 px-2.5 py-1.5 rounded-lg hover:bg-red-950/30 disabled:opacity-50"
                  >
                    Clear this website
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs min-w-[640px]">
                    <thead className="bg-navy-950 text-slate-500 uppercase text-[10px] tracking-wide">
                      <tr>
                        <th className="px-3 py-2 font-bold">Platform</th>
                        <th className="px-3 py-2 font-bold">Page</th>
                        <th className="px-3 py-2 font-bold">Primary KW</th>
                        <th className="px-3 py-2 font-bold">Status</th>
                        <th className="px-3 py-2 font-bold">Last posted</th>
                        <th className="px-3 py-2 font-bold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.posts.map((post) => {
                        const locked = !!(
                          post.publishLocked ||
                          (post.status === "published" && post.locked)
                        );
                        return (
                          <tr
                            key={post.id}
                            className="border-t border-navy-800 hover:bg-navy-900/40"
                          >
                            <td className="px-3 py-2 align-top">
                              <span className="inline-flex items-center gap-1.5 font-bold text-white">
                                {platformIcon(post.platform)}
                                {post.platform}
                                {locked && (
                                  <Lock className="w-3 h-3 text-emerald-400" />
                                )}
                              </span>
                            </td>
                            <td className="px-3 py-2 align-top max-w-[180px]">
                              <p className="text-slate-300 truncate" title={post.url}>
                                {post.url.replace(/^https?:\/\//, "")}
                              </p>
                              <p className="text-[10px] text-slate-500 truncate">
                                {post.heading}
                              </p>
                            </td>
                            <td className="px-3 py-2 align-top text-slate-300">
                              {post.keywords.primary}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <span className="capitalize text-slate-400">{post.status}</span>
                              {locked && (
                                <span className="block text-[10px] text-emerald-400 font-bold">
                                  Padlocked
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top text-slate-500 whitespace-nowrap">
                              {post.publishedAt
                                ? new Date(post.publishedAt).toLocaleString()
                                : "—"}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <button
                                type="button"
                                disabled={actionBusyId === post.id}
                                onClick={() => handleRewrite(post.id)}
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-300 border border-orange-800/50 bg-orange-950/30 px-2 py-1.5 rounded-lg hover:bg-orange-950/60 disabled:opacity-50"
                                title={
                                  locked
                                    ? "Re-generate unlocks and restores to Active"
                                    : "Re-generate and restore to Active"
                                }
                              >
                                {actionBusyId === post.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : locked ? (
                                  <Unlock className="w-3 h-3" />
                                ) : (
                                  <RefreshCw className="w-3 h-3" />
                                )}
                                Re-generate
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
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
  imageBusy,
  actionBusy,
  onToggle,
  onPublish,
  onSchedule,
  onUnschedule,
  onRewrite,
  onGenerateImage,
  onClearImage,
  onDownloadImage,
}: {
  post: StudioPostRecord;
  expanded: boolean;
  imageBusy?: boolean;
  actionBusy?: boolean;
  onToggle: () => void;
  onPublish: (id: string) => void;
  onSchedule: (id: string, date: string) => void;
  onUnschedule: (id: string) => void;
  onRewrite: (id: string) => void;
  onGenerateImage: (id: string) => void;
  onClearImage: (id: string) => void;
  onDownloadImage: (url: string, filename: string) => void;
}) {
  const [scheduleDate, setScheduleDate] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const locked = !!(post.publishLocked || (post.status === "published" && post.locked));
  const words =
    post.wordCount || countWords(post.contentHtml || post.content);
  const minWords = PLATFORM_MIN_WORDS[post.platform] || 80;
  const snippet = String(post.content || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const busy = !!(imageBusy || actionBusy);

  return (
    <div
      className={`glass-card rounded-xl border overflow-hidden ${
        locked ? "border-emerald-900/60" : "border-navy-800"
      }`}
    >
      <div className="flex items-stretch gap-0">
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 flex items-center gap-3 px-3 py-2.5 hover:bg-navy-900/50 text-left"
        >
          <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-navy-900 shrink-0 border border-navy-700">
            {post.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.image}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => {
                  const el = e.currentTarget;
                  el.style.display = "none";
                  const fallback = el.nextElementSibling;
                  if (fallback instanceof HTMLElement) fallback.style.display = "flex";
                }}
              />
            ) : null}
            <div
              className={`w-full h-full flex items-center justify-center text-slate-600 ${
                post.image ? "hidden" : ""
              }`}
              style={post.image ? { display: "none" } : undefined}
            >
              <ImageIcon className="w-4 h-4" />
            </div>
            {locked ? (
              <span className="absolute inset-0 bg-navy-950/55 flex items-center justify-center">
                <Lock className="w-4 h-4 text-emerald-400" />
              </span>
            ) : (
              <span
                className="absolute bottom-0.5 right-0.5 bg-navy-950/80 rounded p-0.5 border border-navy-600"
                title="Unlocked draft — locks after publish"
              >
                <Unlock className="w-3 h-3 text-slate-400" />
              </span>
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
              {post.image ? (
                <span className="text-[10px] font-bold text-violet-300 bg-violet-950/30 px-1.5 py-0.5 rounded">
                  Image on
                </span>
              ) : (
                <span className="text-[10px] font-bold text-slate-500 bg-navy-900 px-1.5 py-0.5 rounded">
                  No image
                </span>
              )}
              {locked ? (
                <span className="text-[10px] font-bold text-emerald-400 inline-flex items-center gap-1 bg-emerald-950/40 border border-emerald-800/50 px-1.5 py-0.5 rounded">
                  <Lock className="w-3 h-3" /> Locked
                </span>
              ) : (
                <span className="text-[10px] font-bold text-slate-400 inline-flex items-center gap-1 bg-navy-900 border border-navy-600 px-1.5 py-0.5 rounded">
                  <Unlock className="w-3 h-3" /> Unlocked
                </span>
              )}
              {post.status === "scheduled" && post.scheduledDate && (
                <span className="text-[10px] font-bold text-sky-300 inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(post.scheduledDate).toLocaleString()}
                </span>
              )}
              {post.publishedAt && (
                <span className="text-[10px] font-bold text-slate-400 inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Last posted {new Date(post.publishedAt).toLocaleString()}
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

        {/* Always-visible lock + regenerate (Part 4) */}
        {locked && (
          <div className="flex items-center gap-1 pr-2 pl-1 border-l border-navy-800 bg-navy-950/40">
            <button
              type="button"
              disabled={busy}
              title="Regenerate unlocks this post for reuse"
              onClick={() => onRewrite(post.id)}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-300 border border-orange-800/50 bg-orange-950/30 px-2 py-1.5 rounded-lg hover:bg-orange-950/60 disabled:opacity-50"
            >
              {actionBusy ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Unlock className="w-3 h-3" />
              )}
              Re-generate
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-navy-800 space-y-3">
          {post.publishedAt && (
            <p className="text-[11px] text-slate-400 font-semibold inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              Last posted:{" "}
              <span className="text-white">{new Date(post.publishedAt).toLocaleString()}</span>
              {locked ? " · locked until re-generate" : " · unlocked for reuse"}
            </p>
          )}

          {post.image && (
            <div
              className={`rounded-xl overflow-hidden border border-navy-700 max-w-md relative ${
                locked ? "opacity-80" : ""
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.image} alt="" className="w-full h-auto object-cover" />
              {locked && (
                <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] font-bold bg-navy-950/80 text-emerald-400 px-2 py-1 rounded-lg border border-emerald-900/50">
                  <Lock className="w-3 h-3" /> Image locked
                </span>
              )}
            </div>
          )}

          <div
            className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed text-left [&_a]:text-orange-400 [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: post.contentHtml || post.content }}
          />
          <div className="flex flex-wrap gap-2">
            <span className="text-[10px] font-semibold text-orange-400 bg-orange-950/40 border border-orange-800/40 px-2 py-1 rounded">
              P: {post.keywords.primary}
            </span>
            {(post.keywords.general?.length
              ? post.keywords.general
              : [post.keywords.secondary].filter(Boolean)
            )
              .slice(0, 4)
              .map((kw, i) => (
                <span
                  key={i}
                  className="text-[10px] font-semibold text-sky-300 bg-sky-950/40 border border-sky-800/40 px-2 py-1 rounded"
                >
                  S{i + 1}: {kw}
                </span>
              ))}
          </div>

          {/* Image controls — locked posts cannot change image until regenerate */}
          {!locked && (
            <div className="pt-2 border-t border-navy-700 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onGenerateImage(post.id)}
                className="inline-flex items-center justify-center gap-1.5 border border-violet-800/50 text-violet-300 text-xs font-bold px-3 py-2 rounded-xl bg-violet-950/30 disabled:opacity-50"
              >
                {imageBusy ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ImageIcon className="w-3.5 h-3.5" />
                )}
                {post.image ? "Regenerate image" : "Attach image"}
              </button>
              {post.image && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      onDownloadImage(
                        post.image!,
                        `avonix-${post.platform}-${post.id.slice(0, 8)}.jpg`
                      )
                    }
                    className="inline-flex items-center justify-center gap-1.5 border border-navy-600 text-slate-200 text-xs font-bold px-3 py-2 rounded-xl hover:bg-navy-900"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onClearImage(post.id)}
                    className="inline-flex items-center justify-center gap-1.5 border border-navy-600 text-slate-400 text-xs font-bold px-3 py-2 rounded-xl hover:bg-navy-900 disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Detach
                  </button>
                </>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-navy-700 flex flex-wrap gap-2">
            {locked ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRewrite(post.id)}
                className="inline-flex items-center justify-center gap-2 border border-orange-800/50 text-orange-300 text-xs font-bold px-3 py-2 rounded-xl bg-orange-950/30 hover:bg-orange-950/50 disabled:opacity-50"
              >
                {actionBusy ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Unlock className="w-3.5 h-3.5" />
                )}
                Re-generate & unlock
              </button>
            ) : post.status === "scheduled" ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onUnschedule(post.id)}
                  className="inline-flex items-center justify-center gap-1.5 border border-navy-600 text-slate-300 text-xs font-bold px-3 py-2 rounded-xl hover:bg-navy-900 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel schedule
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPublish(post.id)}
                  className="inline-flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-xl"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Publish now
                </button>
              </>
            ) : (
              <>
                <div className="relative">
                  {showPicker && (
                    <div className="absolute bottom-full left-0 mb-2 bg-navy-900 border border-navy-600 rounded-xl p-3 z-20 w-[260px] shadow-xl">
                      <p className="text-[10px] text-slate-400 font-bold mb-2">
                        Auto-post at
                      </p>
                      <input
                        type="datetime-local"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        className="w-full text-xs border border-navy-600 bg-navy-950 rounded-lg px-2 py-2 text-slate-200 mb-2"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            onSchedule(post.id, scheduleDate);
                            setShowPicker(false);
                          }}
                          className="flex-1 bg-sky-600 text-white text-xs font-bold py-2 rounded-lg disabled:opacity-50"
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
                    disabled={busy}
                    onClick={() => setShowPicker(!showPicker)}
                    className="inline-flex items-center justify-center gap-1.5 border border-sky-800/50 text-sky-300 text-xs font-bold px-3 py-2 rounded-xl bg-sky-950/30 disabled:opacity-50"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    Schedule auto-post
                  </button>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onPublish(post.id)}
                  className="inline-flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-3 py-2 rounded-xl"
                >
                  {actionBusy ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <PlusCircle className="w-3.5 h-3.5" />
                  )}
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
