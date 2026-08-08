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

/** Perfect publish sizes (match backend PLATFORM_CONFIG) */
const PLATFORM_IMAGE_SIZE: Record<string, { w: number; h: number; label: string }> = {
  Facebook: { w: 1920, h: 1008, label: "1920×1008 · 16:9" },
  LinkedIn: { w: 1920, h: 1005, label: "1920×1005 · 16:9" },
  GMB: { w: 1200, h: 900, label: "1200×900 · 4:3" },
  Instagram: { w: 1080, h: 1080, label: "1080×1080 · 1:1" },
};

type ListFilter = "draft" | "published" | "scheduled";
type ImageSource = "auto" | "ai" | "free";
type MainTab = "active" | "archive";
type StudioStep = 1 | 2 | 3 | 4;

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
  const [step, setStep] = useState<StudioStep>(1);
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
    setStep(1);
    setLocation(state.sitemap?.location || "");
    loadRecords().then((posts) => {
      if (posts.length) setStep(4);
    });
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
      setStep(2);
      showToast(
        `Found ${result.pageCount} pages — pick which to use`,
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
      setStep(4);
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
          setStep(4);
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

  const STEPS = [
    { n: 1 as StudioStep, label: "Website", hint: "Add your site" },
    { n: 2 as StudioStep, label: "Pages", hint: "Pick pages" },
    { n: 3 as StudioStep, label: "Create", hint: "Tone & images" },
    { n: 4 as StudioStep, label: "Publish", hint: "Review & post" },
  ];

  const goStep = (n: StudioStep) => {
    if (n === 2 && !analysis) {
      showToast("Analyze your website first", "error");
      return;
    }
    if (n === 3 && !selectedPages.length) {
      showToast("Select at least one page first", "error");
      return;
    }
    if (n === 4 && !generatedPosts.length && !generateDone) {
      showToast("Create posts first", "error");
      return;
    }
    setStep(n);
    if (n === 4) setMainTab("active");
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto animate-fade-in text-left">
      {/* Header */}
      <div className="text-center space-y-1">
        <h2 className="text-xl font-bold text-white tracking-tight">Content Studio</h2>
        <p className="text-sm text-slate-400">
          Four simple steps: website → pages → create → publish.
        </p>
      </div>

      {/* Stepper */}
      <nav className="glass-card border border-navy-800 rounded-2xl p-3 sm:p-4">
        <ol className="grid grid-cols-4 gap-1 sm:gap-2">
          {STEPS.map((s) => {
            const active = step === s.n;
            const done = step > s.n;
            return (
              <li key={s.n}>
                <button
                  type="button"
                  onClick={() => goStep(s.n)}
                  className={`w-full rounded-xl px-1 py-2 sm:px-2 sm:py-2.5 text-center transition-all ${
                    active
                      ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20"
                      : done
                        ? "bg-emerald-950/40 text-emerald-300 border border-emerald-800/40"
                        : "bg-navy-900 text-slate-500 border border-navy-700"
                  }`}
                >
                  <span className="block text-[10px] sm:text-xs font-bold">
                    {done && !active ? "✓ " : ""}
                    {s.n}. {s.label}
                  </span>
                  <span
                    className={`hidden sm:block text-[10px] mt-0.5 ${
                      active ? "text-orange-100" : "text-slate-500"
                    }`}
                  >
                    {s.hint}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* —— STEP 1: Website —— */}
      {step === 1 && (
        <div className="glass-card p-5 sm:p-7 rounded-2xl border border-navy-800 space-y-5">
          <div>
            <h3 className="text-base font-bold text-white">1. Your website</h3>
            <p className="text-sm text-slate-400 mt-1">
              Enter the site URL. We find important pages automatically.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Website URL
              </label>
              <div className="relative">
                <Globe className="absolute left-3 top-3.5 w-4 h-4 text-slate-500" />
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://yourbusiness.com"
                  className="w-full text-sm font-semibold border border-navy-700 bg-navy-900 rounded-xl pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                City / area <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <MapPin className="absolute left-3 top-3.5 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Denver, CO"
                  className="w-full text-sm font-semibold border border-navy-700 bg-navy-900 rounded-xl pl-10 pr-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAnalyzeWebsite}
            disabled={isAnalyzing}
            className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-8 rounded-xl text-sm inline-flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Finding pages…
              </>
            ) : (
              <>
                <Search className="w-4 h-4" /> Continue
              </>
            )}
          </button>
          {isAnalyzing && (
            <p className="text-xs text-slate-400">This can take up to a minute.</p>
          )}

          {generatedPosts.length > 0 && (
            <button
              type="button"
              onClick={() => goStep(4)}
              className="block text-xs font-bold text-orange-400 hover:underline"
            >
              Skip to your existing posts →
            </button>
          )}
        </div>
      )}

      {/* —— STEP 2: Pages —— */}
      {step === 2 && analysis && (
        <div className="glass-card p-5 sm:p-7 rounded-2xl border border-navy-800 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white">2. Choose pages</h3>
              <p className="text-sm text-slate-400 mt-1">
                We write posts from the pages you keep selected ({selectedPages.length} of{" "}
                {(analysis.pages || []).length}).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-xs font-bold text-slate-400 hover:text-white"
            >
              ← Edit website
            </button>
          </div>

          <div className="rounded-xl border border-navy-700 bg-navy-950/50 px-3 py-2 text-xs text-slate-300">
            <span className="font-bold text-white">{analysis.areaCoverage?.summary || location || "—"}</span>
            <span className="text-slate-500"> · </span>
            Focus: <span className="text-emerald-400 font-semibold">{analysis.dominantIntent}</span>
          </div>

          <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {(analysis.pages || []).map((page) => {
              const checked = selectedPages.some((p) => p.url === page.url);
              return (
                <li key={page.url}>
                  <label
                    className={`flex items-start gap-3 rounded-xl border px-3 py-3 cursor-pointer transition-colors ${
                      checked
                        ? "border-orange-500/50 bg-orange-950/20"
                        : "border-navy-700 bg-navy-900/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePage(page.url)}
                      className="mt-1 rounded border-navy-600 bg-navy-900 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-white truncate">
                        {page.title || page.url.replace(/^https?:\/\//, "")}
                      </span>
                      <span className="block text-[11px] text-slate-500 truncate mt-0.5">
                        {page.url.replace(/^https?:\/\//, "")}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                        <span className="bg-navy-950 border border-navy-700 text-slate-300 px-1.5 py-0.5 rounded font-semibold">
                          {page.writingIntent}
                        </span>
                        <span className="bg-navy-950 border border-navy-700 text-orange-300 px-1.5 py-0.5 rounded font-semibold truncate max-w-[200px]">
                          {page.keywords.primary}
                        </span>
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!selectedPages.length}
              onClick={() => setStep(3)}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 px-6 rounded-xl text-sm"
            >
              Next: Create posts →
            </button>
          </div>
        </div>
      )}

      {/* —— STEP 3: Create —— */}
      {step === 3 && (
        <div className="glass-card p-5 sm:p-7 rounded-2xl border border-navy-800 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-white">3. How should posts sound?</h3>
              <p className="text-sm text-slate-400 mt-1">
                Writing for Facebook, LinkedIn & Google Business from {selectedPages.length} pages.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="text-xs font-bold text-slate-400 hover:text-white"
            >
              ← Pages
            </button>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-300 mb-2">Tone</p>
            <div className="flex flex-wrap gap-2">
              {TONE_PRESETS.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  onClick={() => setSelectedTone(tone)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold ${
                    selectedTone === tone
                      ? "bg-orange-500 text-white"
                      : "bg-navy-900 text-slate-400 border border-navy-700"
                  }`}
                >
                  {tone}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-300 mb-2">Images</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {(
                [
                  {
                    id: "best" as const,
                    title: "Best quality",
                    desc: "AI picks the best paid model",
                  },
                  {
                    id: "free" as const,
                    title: "Free",
                    desc: "$0 images · lower quality",
                  },
                  {
                    id: "none" as const,
                    title: "No images",
                    desc: "Text posts only",
                  },
                ] as const
              ).map((opt) => {
                const active =
                  (opt.id === "none" && !includeImages) ||
                  (opt.id === "best" && includeImages && imageSource === "auto") ||
                  (opt.id === "free" && includeImages && imageSource === "free") ||
                  (opt.id === "best" && includeImages && imageSource === "ai");
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      if (opt.id === "none") {
                        setIncludeImages(false);
                      } else if (opt.id === "free") {
                        setIncludeImages(true);
                        setImageSource("free");
                      } else {
                        setIncludeImages(true);
                        setImageSource("auto");
                      }
                    }}
                    className={`text-left rounded-xl border px-3 py-3 ${
                      active
                        ? "border-orange-500 bg-orange-950/30"
                        : "border-navy-700 bg-navy-900/50"
                    }`}
                  >
                    <span className="block text-sm font-bold text-white">{opt.title}</span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {providerDecision && (
            <p className="text-[11px] text-slate-500">
              Last run used{" "}
              <span className="text-slate-300 font-semibold">
                {providerDecision.writing?.label || "writer"}
              </span>
              {providerDecision.image?.label ? (
                <>
                  {" "}
                  · images via{" "}
                  <span className="text-slate-300 font-semibold">
                    {providerDecision.image.label}
                  </span>
                </>
              ) : null}
            </p>
          )}

          <button
            type="button"
            onClick={handleScanAndGenerate}
            disabled={isScanning || !selectedPages.length}
            className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3.5 px-8 rounded-xl text-sm inline-flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
          >
            {isScanning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                {includeImages ? "Writing posts + images…" : "Writing posts…"}
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Create posts
              </>
            )}
          </button>
        </div>
      )}

      {/* —— STEP 4: Publish —— */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="glass-card p-5 sm:p-6 rounded-2xl border border-navy-800 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-white">4. Review & publish</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Open a post → Publish live or Schedule. Published posts lock until you
                  re-generate.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setGenerateDone(false);
                }}
                className="text-xs font-bold text-orange-400 hover:underline"
              >
                + New website
              </button>
            </div>

            <div className="flex flex-wrap gap-2 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1 font-bold text-slate-300 bg-navy-900 border border-navy-700 px-2 py-1 rounded-lg">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                {lockedCount} locked
              </span>
              {lastPostedAt && (
                <span className="inline-flex items-center gap-1 font-semibold bg-navy-900 border border-navy-700 px-2 py-1 rounded-lg">
                  <Clock className="w-3.5 h-3.5 text-sky-400" />
                  Last: {new Date(lastPostedAt).toLocaleString()}
                </span>
              )}
              <span className="inline-flex items-center gap-1 bg-navy-900 border border-navy-700 px-2 py-1 rounded-lg">
                <Facebook className="w-3 h-3 text-blue-400" /> {platformCounts.Facebook}
              </span>
              <span className="inline-flex items-center gap-1 bg-navy-900 border border-navy-700 px-2 py-1 rounded-lg">
                <Linkedin className="w-3 h-3 text-sky-400" /> {platformCounts.LinkedIn}
              </span>
              <span className="inline-flex items-center gap-1 bg-navy-900 border border-navy-700 px-2 py-1 rounded-lg">
                <Globe className="w-3 h-3 text-emerald-400" /> {platformCounts.GMB}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["draft", "scheduled", "published"] as ListFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    setMainTab("active");
                    setListFilter(f);
                  }}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold capitalize ${
                    mainTab === "active" && listFilter === f
                      ? "bg-orange-500 text-white"
                      : "bg-navy-900 text-slate-400 border border-navy-700"
                  }`}
                >
                  {f} ({generatedPosts.filter((p) => p.status === f).length})
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setMainTab("archive");
                  loadArchive();
                }}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold ${
                  mainTab === "archive"
                    ? "bg-orange-500 text-white"
                    : "bg-navy-900 text-slate-400 border border-navy-700"
                }`}
              >
                Archive ({archiveTotal})
              </button>
            </div>

            {mainTab === "active" && includeImages && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isAttachingImages || !postsMissingImages}
                  onClick={() => handleAttachAllImages(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold border border-violet-800/50 text-violet-300 bg-violet-950/30 px-3 py-2 rounded-xl disabled:opacity-50"
                >
                  {isAttachingImages ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5" />
                  )}
                  Add missing images ({postsMissingImages})
                </button>
              </div>
            )}
          </div>

          {mainTab === "active" && (
            <>
              {filtered.length === 0 ? (
                <div className="glass-card p-8 rounded-2xl border border-navy-800 text-center text-slate-500 text-sm">
                  No {listFilter} posts yet.{" "}
                  <button
                    type="button"
                    className="text-orange-400 font-bold hover:underline"
                    onClick={() => setStep(1)}
                  >
                    Start from step 1
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
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
            </>
          )}

          {mainTab === "archive" && (
            <div className="space-y-3">
              {isLoadingArchive ? (
                <p className="text-sm text-slate-400 text-center py-6">Loading archive…</p>
              ) : archiveTables.length === 0 ? (
                <div className="glass-card p-8 rounded-2xl border border-navy-800 text-center text-slate-500 text-sm">
                  Archive is empty.
                </div>
              ) : (
                archiveTables.map((table) => (
                  <div
                    key={table.websiteOrigin}
                    className="glass-card rounded-2xl border border-navy-800 overflow-hidden"
                  >
                    <div className="px-4 py-3 border-b border-navy-800 flex flex-wrap justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-white">{table.websiteOrigin}</p>
                        <p className="text-[11px] text-slate-500">
                          {table.count} posts · {table.lockedCount} locked
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setClearConfirmOrigin(table.websiteOrigin)}
                        className="text-[11px] font-bold text-red-300 border border-red-900/40 px-2 py-1 rounded-lg"
                      >
                        Clear
                      </button>
                    </div>
                    <ul className="divide-y divide-navy-800">
                      {table.posts.slice(0, 8).map((post) => {
                        const locked = !!(
                          post.publishLocked ||
                          (post.status === "published" && post.locked)
                        );
                        return (
                          <li
                            key={post.id}
                            className="px-4 py-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="min-w-0 truncate text-slate-300">
                              {platformIcon(post.platform)}{" "}
                              <span className="font-semibold text-white">{post.heading}</span>
                              {locked && (
                                <Lock className="inline w-3 h-3 text-emerald-400 ml-1" />
                              )}
                            </span>
                            <button
                              type="button"
                              disabled={actionBusyId === post.id}
                              onClick={() => handleRewrite(post.id)}
                              className="shrink-0 text-[10px] font-bold text-orange-300 border border-orange-800/50 px-2 py-1 rounded-lg"
                            >
                              Re-generate
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}

              {clearConfirmOrigin && (
                <div className="glass-card p-5 rounded-2xl border border-red-900/40 bg-red-950/20 text-center space-y-3">
                  <p className="text-sm font-bold text-white">Clear archive for this site?</p>
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      disabled={isClearingArchive}
                      onClick={() => handleClearArchive(clearConfirmOrigin)}
                      className="bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-xl"
                    >
                      Yes, clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setClearConfirmOrigin(null)}
                      className="border border-navy-600 text-slate-300 text-xs font-bold px-4 py-2 rounded-xl"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-slate-500 text-center">
            Need accounts connected?{" "}
            <Link href="/dashboard/connections" className="text-orange-400 font-bold hover:underline">
              Connect Facebook / LinkedIn / Google →
            </Link>
          </p>
        </div>
      )}
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
              className={`w-full h-full flex flex-col items-center justify-center text-slate-600 ${
                post.image ? "hidden" : ""
              }`}
              style={post.image ? { display: "none" } : undefined}
            >
              <ImageIcon className="w-4 h-4" />
              <span className="text-[7px] font-bold text-slate-500 mt-0.5 leading-none px-0.5 text-center">
                {PLATFORM_IMAGE_SIZE[post.platform]?.label?.split(" · ")[0] || "HD"}
              </span>
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
              <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 text-[10px] font-bold bg-navy-950/85 text-slate-200 px-2 py-1 rounded-lg border border-navy-600 backdrop-blur-sm">
                Perfect size: {PLATFORM_IMAGE_SIZE[post.platform]?.label || "HD"}
              </span>
              {locked && (
                <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] font-bold bg-navy-950/80 text-emerald-400 px-2 py-1 rounded-lg border border-emerald-900/50">
                  <Lock className="w-3 h-3" /> Image locked
                </span>
              )}
            </div>
          )}

          <div className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed text-left">
            {String(post.content || post.contentHtml || "")
              .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<\/p>/gi, "\n\n")
              .replace(/<[^>]+>/g, "")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .trim()}
          </div>
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
