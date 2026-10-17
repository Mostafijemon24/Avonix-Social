"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Calendar,
  Check,
  Download,
  Globe,
  Image as ImageIcon,
  Link2 as LinkIcon,
  Lock,
  MapPin,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import PlatformGlyph, { PLATFORM_BRAND_COLOR } from "@/components/ui/PlatformGlyph";
import {
  api,
  isApiError,
  type StudioPageAnalysis,
  type StudioPostRecord,
  type OverlayConfig,
  type WebsiteAnalyzeResult,
  type ArchiveWebsiteTable,
} from "@/lib/api-client";
import {
  drawTitleOverlay,
  exportOverlayDataURL,
  OVERLAY_DEFAULTS,
  type OverlayDraftConfig,
} from "@/lib/overlay-layout";

const TONE_PRESETS = [
  "Professional",
  "Enthusiastic",
  "Empathetic",
  "Authoritative",
  "Storytelling",
] as const;

/**
 * Max pages fed into post GENERATION (pages × platforms ⇒ credits). This is a
 * cost control, NOT the analysis cap — analysis now covers every eligible page.
 */
const MAX_GEN_PAGES = 15;

/** Stable signature of a selection so we only auto-save real changes. */
function selectionSig(urls: string[], services: string[]): string {
  return JSON.stringify([[...urls].sort(), [...services].sort()]);
}

const PLATFORM_MIN_WORDS: Record<string, number> = {
  Facebook: 120,
  Instagram: 70,
  LinkedIn: 150,
  GMB: 90,
  X: 20,
  Pinterest: 30,
};

type PlatformLabel =
  | "Facebook"
  | "Instagram"
  | "LinkedIn"
  | "GMB"
  | "X"
  | "Pinterest";

const PLATFORM_RULE_SUMMARY: Record<
  string,
  { spec: string; img: string; key: PlatformLabel }
> = {
  Facebook: { key: "Facebook", spec: "120+ words · link included", img: "1920×1008" },
  Instagram: { key: "Instagram", spec: "70+ words · bio/link rules", img: "1080×1080" },
  LinkedIn: { key: "LinkedIn", spec: "150+ words · link included", img: "1920×1005" },
  GMB: { key: "GMB", spec: "1,000–1,100 chars (target 1,020–1,050)", img: "1200×900" },
  X: { key: "X", spec: "280 chars · link included", img: "1600×900" },
  Pinterest: { key: "Pinterest", spec: "pin description · keyword-rich", img: "1000×1500" },
};

const GMB_CATEGORY_FALLBACK = [
  {
    id: "INTENT_PROXIMITY",
    label: "Intent & Proximity",
    short: "Local service + location, near-me searches",
    recommendedUse: "High-intent mobile, Maps, voice, and AI local searches.",
    accent: "#ff7a1a",
    requiresVerifiedOffer: false,
  },
  {
    id: "OFFER_PROMOTION_EVENT",
    label: "Offer / Promotion / Event",
    short: "Verified offers, promotions, events, registrations",
    recommendedUse: "Only when a real offer, promotion, or event is verified.",
    accent: "#f5a524",
    requiresVerifiedOffer: true,
  },
  {
    id: "AUTHORITY_TRUST_PROOF",
    label: "Authority / Trust / Proof",
    short: "Expertise, credentials, technology, verified proof",
    recommendedUse: "Consideration / trust — only verified credibility signals.",
    accent: "#2dd4bf",
    requiresVerifiedOffer: false,
  },
  {
    id: "FAQ_EDUCATIONAL",
    label: "FAQ & Educational",
    short: "Customer questions, long-tail, voice & AI search",
    recommendedUse: "Answer one specific customer problem; informational / conversational.",
    accent: "#56b6f2",
    requiresVerifiedOffer: false,
  },
];

const PAGE_FILTERS = ["All", "Services", "Offers", "Blog", "About", "Other"] as const;

/** Perfect publish sizes (match backend PLATFORM_CONFIG) */
const PLATFORM_IMAGE_SIZE: Record<string, { w: number; h: number; label: string }> = {
  Facebook: { w: 1920, h: 1008, label: "1920×1008 · 16:9" },
  LinkedIn: { w: 1920, h: 1005, label: "1920×1005 · 16:9" },
  GMB: { w: 1200, h: 900, label: "1200×900 · 4:3" },
  Instagram: { w: 1080, h: 1080, label: "1080×1080 · 1:1" },
  X: { w: 1600, h: 900, label: "1600×900 · 16:9" },
  Pinterest: { w: 1000, h: 1500, label: "1000×1500 · 2:3" },
};

type ListFilter = "draft" | "published" | "scheduled";
type ImageSource = "auto" | "ai" | "free";
type MainTab = "active" | "archive";
type StudioStep = 1 | 2 | 3 | 4;

function platformIcon(platform: string, size = 16) {
  return <PlatformGlyph platform={platform} size={size} className="shrink-0" />;
}

const PLATFORM_ORDER = [
  "Facebook",
  "Instagram",
  "LinkedIn",
  "GMB",
  "X",
  "Pinterest",
] as const;

function platformLabel(platform: string) {
  return platform === "GMB"
    ? "Google Business"
    : platform === "X"
      ? "X (Twitter)"
      : platform;
}

/** Group published posts by their publish date (newest group first). */
function groupPostsByDate(
  posts: StudioPostRecord[]
): Array<[string, StudioPostRecord[]]> {
  const map = new Map<string, StudioPostRecord[]>();
  for (const p of posts) {
    const date = p.publishedAt
      ? new Date(p.publishedAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "Unknown date";
    const arr = map.get(date) || [];
    arr.push(p);
    map.set(date, arr);
  }
  return Array.from(map.entries());
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

/** Short host for a destination URL (CTA preview). */
function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
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
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectionSaveState, setSelectionSaveState] =
    useState<"idle" | "saving" | "saved" | "error">("idle");
  // Signature of the last-persisted selection — avoids redundant saves right
  // after hydration while still auto-saving genuine user changes.
  const savedSelectionSigRef = useRef<string>("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  // Batch 4: true while deferred images are being generated in the background.
  const [bgImageActive, setBgImageActive] = useState(false);
  const [imageSource, setImageSource] = useState<ImageSource>("auto");
  const [channels, setChannels] = useState<string[]>(["Facebook", "Instagram", "LinkedIn", "GMB"]);
  const [gmbCategory, setGmbCategory] = useState<string>("INTENT_PROXIMITY");
  const [gmbCategories, setGmbCategories] = useState(GMB_CATEGORY_FALLBACK);
  const [sourceFilter, setSourceFilter] = useState<(typeof PAGE_FILTERS)[number]>("All");
  const [sourceSearch, setSourceSearch] = useState("");
  const [seoOpen, setSeoOpen] = useState(false);
  const [generatePhase, setGeneratePhase] = useState("");
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
    api.getGmbRules().then((data) => {
      if (data.categories?.length) {
        setGmbCategories(
          data.categories.map((c) => ({
            id: c.id,
            label: c.label,
            short: c.short,
            recommendedUse: c.recommendedUse,
            accent: c.accent,
            requiresVerifiedOffer: !!c.requiresVerifiedOffer,
          }))
        );
      }
    }).catch(() => {
      /* keep fallback catalog — prompts stay on the server */
    });
  }, []);

  useEffect(() => {
    setGeneratedPosts([]);
    setAnalysis(null);
    setSelectedPages([]);
    setSelectedServices([]);
    savedSelectionSigRef.current = "";
    setSelectionSaveState("idle");
    setGenerateDone(false);
    setExpandedId(null);
    setArchiveTables([]);
    setArchiveTotal(0);
    setMainTab("active");
    setProviderDecision(null);
    setStep(1);
    const active = (state.workspaces || []).find((w) => w.id === state.activeWorkspaceId);
    setWebsiteUrl(active?.websiteUrl || state.sitemap?.url || "");
    setLocation(active?.sitemap?.location || state.sitemap?.location || "");
    loadRecords().then((posts) => {
      if (posts.length) setStep(4);
    });
    loadArchive();
  }, [state.activeWorkspaceId, state.email, state.sitemap?.location, state.sitemap?.url, loadRecords, loadArchive, state.workspaces]);

  const handleReanalyzeFresh = () => handleAnalyzeWebsite(true);

  const handleAnalyzeWebsite = async (forceRefresh = false) => {
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
        forceRefresh,
      });

      setAnalysis(result);
      // Hydrate selection from the persisted DB snapshot so refreshes /
      // re-login keep the user's choices; fall back to the top-N default.
      const sel = result.selection;
      let initPages: StudioPageAnalysis[];
      let initServices: string[];
      if (sel && sel.pages) {
        const selectedUrls = new Set(
          sel.pages.filter((p) => p.selected).map((p) => p.url)
        );
        initPages = (result.pages || []).filter((p) => selectedUrls.has(p.url));
        initServices = (sel.services || []).filter((s) => s.selected).map((s) => s.name);
      } else {
        initPages = (result.pages || []).slice(0, MAX_GEN_PAGES);
        initServices = (result.services || []).map((s) => s.name);
      }
      setSelectedPages(initPages);
      setSelectedServices(initServices);
      // Mark this hydrated state as already persisted (seeded server-side).
      savedSelectionSigRef.current = selectionSig(
        initPages.map((p) => p.url),
        initServices
      );
      setSelectionSaveState("idle");
      if (result.location && !location.trim()) {
        setLocation(result.location);
      }
      const inv = result.inventory;
      const msg = inv
        ? `${inv.discovered} discovered → ${inv.eligible} eligible → ${inv.analyzedSuccess} analyzed${
            inv.failed ? ` · ${inv.failed} failed` : ""
          }${result.cached ? " (cached)" : ""}`
        : `Found ${result.pageCount} pages — review intelligence, then continue`;
      showToast(msg, "success");
    } catch (err) {
      showToast(
        isApiError(err) ? err.error : "Website analysis failed",
        "error"
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Debounced auto-save of the page/service selection to the database.
  useEffect(() => {
    if (!analysis || !state.email) return;
    const sig = selectionSig(selectedPages.map((p) => p.url), selectedServices);
    if (sig === savedSelectionSigRef.current) return; // nothing changed
    setSelectionSaveState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await api.savePageSelection({
          email: state.email,
          workspaceId: state.activeWorkspaceId || undefined,
          websiteUrl: analysis.websiteUrl || websiteUrl.trim(),
          selectedUrls: selectedPages.map((p) => p.url),
          selectedServices,
        });
        savedSelectionSigRef.current = sig;
        setSelectionSaveState("saved");
      } catch {
        setSelectionSaveState("error");
      }
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPages, selectedServices, analysis, state.email, state.activeWorkspaceId]);

  const toggleService = (name: string) => {
    setSelectedServices((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const togglePage = (url: string) => {
    setSelectedPages((prev) => {
      const exists = prev.some((p) => p.url === url);
      if (exists) return prev.filter((p) => p.url !== url);
      const page = analysis?.pages.find((p) => p.url === url);
      if (!page) return prev;
      if (prev.length >= MAX_GEN_PAGES) {
        showToast(`Max ${MAX_GEN_PAGES} pages for post generation`, "error");
        return prev;
      }
      return [...prev, page];
    });
  };

  /** Persist the current selection NOW (used before generation to avoid a race
   *  with the debounced auto-save, since generation reads selection from DB). */
  const flushSelection = async () => {
    if (!analysis || !state.email) return;
    const sig = selectionSig(selectedPages.map((p) => p.url), selectedServices);
    if (sig === savedSelectionSigRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      await api.savePageSelection({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        websiteUrl: analysis.websiteUrl || websiteUrl.trim(),
        selectedUrls: selectedPages.map((p) => p.url),
        selectedServices,
      });
      savedSelectionSigRef.current = sig;
      setSelectionSaveState("saved");
    } catch {
      setSelectionSaveState("error");
    }
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
    if (!channels.length) {
      showToast("Select at least one social channel", "error");
      return;
    }
    if (channels.includes("GMB") && !gmbCategory) {
      showToast("Select a Google Business content type", "error");
      return;
    }
    if (!state.email) return;

    setIsScanning(true);
    setGenerateDone(false);
    setGeneratedPosts([]);
    setGeneratePhase("Analyzing");

    try {
      // Ensure the DB reflects the latest selection before the server reads it.
      await flushSelection();
      const result = await api.generateAutoPoster({
        email: state.email,
        workspaceId: state.activeWorkspaceId || undefined,
        location: location.trim(),
        tone: selectedTone,
        pages: selectedPages,
        masterIntent: analysis?.masterIntent,
        includeImages,
        imageSource,
        platforms: channels,
        websiteUrl: analysis?.websiteUrl || websiteUrl.trim() || undefined,
        gmbCategory: channels.includes("GMB") ? gmbCategory : undefined,
        // Batch 4: get the (fast) text drafts back immediately; images follow.
        deferImages: true,
      });

      const posts = result.posts || [];
      setGeneratedPosts(posts);
      setProviderDecision(result.providerDecision || null);
      setListFilter("draft");
      setGenerateDone(true);
      setMainTab("active");
      setStep(4);
      const pendingImages = result.imagesDeferred ? result.imagesPending || [] : [];
      if (result.archivedCount) {
        await loadArchive();
        showToast(
          `Complete — ${posts.length} posts. ${result.archivedCount} moved to Archive.`,
          "success"
        );
      } else {
        const writer = result.providerDecision?.writing?.label || "template";
        showToast(
          pendingImages.length
            ? `Drafts ready — ${posts.length} posts via ${writer}. Generating ${pendingImages.length} image(s) in the background…`
            : `Complete — ${posts.length} posts via ${writer}`,
          "success"
        );
      }
      // Images are already enqueued as durable server-side jobs; just poll for
      // completion. Drafts are already on screen and usable immediately.
      if (pendingImages.length) void pollPendingImages(pendingImages);
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
      setMainTab("archive");
      showToast(
        "Published & locked — moved to Archive (by platform & date)",
        "success"
      );
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

  // Feature A — persist edited content/heading. Returns the saved post so the
  // row can confirm success and reconcile; a monotonically-increasing guard in
  // the row prevents a stale response from overwriting a newer edit.
  const handleSaveEdit = useCallback(
    async (postId: string, content: string, heading: string) => {
      if (!state.email) return null;
      const result = await api.updateStudioPostContent({
        email: state.email,
        postId,
        content,
        heading,
      });
      setGeneratedPosts((prev) =>
        prev.map((p) => (p.id === result.post.id ? result.post : p))
      );
      return result.post;
    },
    [state.email]
  );

  // Feature B/C — delete / cancel a post. Scheduled posts are canceled so they
  // can never auto-publish; published posts are removed locally only.
  const handleDelete = useCallback(
    async (postId: string) => {
      if (!state.email) return;
      setActionBusyId(postId);
      try {
        const result = await api.deleteStudioPost({ email: state.email, postId });
        setGeneratedPosts((prev) => prev.filter((p) => p.id !== postId));
        setExpandedId((id) => (id === postId ? null : id));
        showToast(
          result.remoteNote ||
            (result.wasScheduled
              ? "Scheduled post canceled — it will not publish."
              : "Post deleted."),
          "success"
        );
      } catch (err) {
        // On failure the post stays visible and recoverable.
        showToast(isApiError(err) ? err.error : "Delete failed — the post is unchanged.", "error");
      } finally {
        setActionBusyId(null);
      }
    },
    [state.email, showToast]
  );

  // Feature D — persist the composited title-overlay image (preview == export).
  const handleApplyOverlay = useCallback(
    async (postId: string, overlayConfig: OverlayConfig, renderedImage: string) => {
      if (!state.email) return;
      const result = await api.applyStudioImageOverlay({
        email: state.email,
        postId,
        overlayConfig,
        renderedImage,
      });
      setGeneratedPosts((prev) => prev.map((p) => (p.id === result.post.id ? result.post : p)));
      showToast("Title overlay applied.", "success");
    },
    [state.email, showToast]
  );

  const handleRemoveOverlay = useCallback(
    async (postId: string) => {
      if (!state.email) return;
      const result = await api.applyStudioImageOverlay({
        email: state.email,
        postId,
        removeOverlay: true,
      });
      setGeneratedPosts((prev) => prev.map((p) => (p.id === result.post.id ? result.post : p)));
      showToast("Overlay removed — original image restored.", "success");
    },
    [state.email, showToast]
  );

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

  // Batch 5: images are generated by the DURABLE server-side job queue (enqueued
  // at generate time), so they complete even if this tab closes or the backend
  // restarts. The client just polls post state until each pending image resolves
  // (ready/failed). Nothing is lost if polling is interrupted — the job persists.
  const pollPendingImages = async (postIds: string[]) => {
    if (!state.email || !postIds.length) return;
    setBgImageActive(true);
    try {
      const pending = new Set(postIds);
      for (let i = 0; i < 60 && pending.size > 0; i++) {
        await sleep(3000);
        const posts = await loadRecords();
        for (const p of posts) {
          if (pending.has(p.id) && p.imageStatus !== "pending") pending.delete(p.id);
        }
      }
      const refreshed = await loadRecords();
      const stillFailed = refreshed.filter(
        (p) => postIds.includes(p.id) && p.imageStatus === "failed"
      ).length;
      const ready = postIds.length - pending.size - stillFailed;
      if (stillFailed) {
        showToast(
          `${ready} image(s) ready · ${stillFailed} failed — press Retry on the post`,
          ready ? "success" : "error"
        );
      } else if (ready) {
        showToast(`${ready} image(s) ready`, "success");
      }
    } finally {
      setBgImageActive(false);
    }
  };

  // Batch 5: re-arm a post's durable image job after a terminal failure.
  const handleRetryImage = async (postId: string) => {
    if (!state.email) return;
    setImageBusyId(postId);
    try {
      const result = await api.retryImageJob({ email: state.email, postId });
      setGeneratedPosts((prev) =>
        prev.map((p) => (p.id === result.post.id ? result.post : p))
      );
      showToast("Retrying image generation…", "success");
      void pollPendingImages([postId]);
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Retry failed", "error");
    } finally {
      setImageBusyId(null);
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

  // Active list never shows published posts — they live in the Archive menu.
  const filtered = generatedPosts.filter(
    (p) => p.status === listFilter && p.status !== "published"
  );
  const postsMissingImages = generatedPosts.filter(
    (p) => !p.image && p.status !== "published" && !p.locked
  ).length;

  // Published posts, grouped by platform then by publish date (for Archive).
  const publishedPosts = generatedPosts.filter((p) => p.status === "published");
  const publishedGroups = PLATFORM_ORDER.map((pf) => ({
    platform: pf as string,
    posts: publishedPosts
      .filter((p) => p.platform === pf)
      .sort(
        (a, b) =>
          new Date(b.publishedAt || 0).getTime() -
          new Date(a.publishedAt || 0).getTime()
      ),
  })).filter((g) => g.posts.length > 0);

  const intel = analysis?.intelligence;
  const visiblePages = (analysis?.pages || []).filter((p) => {
    const type = p.pageType || "Other";
    if (sourceFilter !== "All" && type !== sourceFilter) return false;
    if (sourceSearch.trim()) {
      const q = sourceSearch.toLowerCase();
      return `${p.title || ""} ${p.url} ${p.keywords?.primary || ""}`.toLowerCase().includes(q);
    }
    return true;
  });
  const offerLikely = selectedPages.some((p) =>
    /offer|promo|discount|event|deal/i.test(`${p.title} ${p.url} ${p.keywords?.primary}`)
  );
  const gmbOn = channels.includes("GMB");
  const canContinue3 = channels.length > 0 && (!gmbOn || !!gmbCategory);
  const canGenerate =
    !!analysis &&
    !!location.trim() &&
    selectedPages.length > 0 &&
    canContinue3 &&
    !isScanning;

  const STEPS = [
    { n: 1 as StudioStep, label: "Website & Location", hint: "Analyze the site" },
    { n: 2 as StudioStep, label: "Content Sources", hint: "Select crawled links" },
    { n: 3 as StudioStep, label: "Channels & Content", hint: "Platforms + GMB type" },
    { n: 4 as StudioStep, label: "Generate & Review", hint: "Create & validate" },
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
    if (n === 4 && (!channels.length || (channels.includes("GMB") && !gmbCategory))) {
      showToast("Select at least one channel, and a GMB type if Google Business is on", "error");
      return;
    }
    setStep(n);
    if (n === 4) setMainTab("active");
  };

  return (
    <div className="max-w-[824px] mx-auto flex flex-col gap-11 animate-fade-in text-left">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-[27px] font-extrabold tracking-[-0.02em] text-ink leading-tight">
          Content Studio
        </h1>
        <p className="mt-2 text-muted text-[14.5px]">
          Four simple steps — website, sources, channels, then generate.
        </p>
      </div>

      {/* Platform chip row */}
      <div className="flex flex-wrap justify-center gap-2.5">
        {(
          [
            ["Facebook", "Facebook"],
            ["Instagram", "Instagram"],
            ["LinkedIn", "LinkedIn"],
            ["GMB", "Google Business"],
            ["X", "X (Twitter)"],
            ["Pinterest", "Pinterest"],
          ] as const
        ).map(([key, label]) => (
          <span
            key={key}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-navy-800 border border-line text-xs font-bold text-ink"
          >
            <PlatformGlyph platform={key} size={15} />
            {label}
          </span>
        ))}
      </div>

      {/* Stepper */}
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const active = step === s.n;
          const done = step > s.n;
          const short = ["Website", "Sources", "Channels", "Generate"][i];
          return (
            <div key={s.n} className="flex items-center flex-1 last:flex-none">
              <button
                type="button"
                onClick={() => goStep(s.n)}
                className="flex items-center gap-2.5 shrink-0"
              >
                <span
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-extrabold ${
                    active
                      ? "bg-orange-500 text-white shadow-accent"
                      : done
                        ? "bg-accent-soft border border-accent-border text-accent"
                        : "bg-navy-800 border border-line text-dim"
                  }`}
                >
                  {done ? <Check className="w-4 h-4" /> : s.n}
                </span>
                <span
                  className={`text-[12.5px] ${
                    active ? "font-extrabold text-ink" : "font-bold text-muted"
                  }`}
                >
                  {short}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span
                  className={`flex-1 h-0.5 mx-3.5 ${done ? "bg-accent-border" : "bg-line"}`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* —— STEP 1: Website & Location —— */}
      {step === 1 && (
        <div className="glass-card p-5 sm:p-7 rounded-2xl border border-navy-800 space-y-5">
          <div>
            <h3 className="text-base font-bold text-ink">Website &amp; Location</h3>
            <p className="text-sm text-muted mt-1">
              Location drives local keywords, GMB content, and hashtags. Pre-filled from this client when saved.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-[11px] font-extrabold uppercase tracking-wider text-muted mb-2">
                Website
              </label>
              <div className="relative">
                <Globe className="absolute left-4 top-4 w-5 h-5 text-dim" />
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://yourbusiness.com"
                  className="w-full text-base font-semibold border border-navy-700 bg-navy-900 rounded-2xl pl-12 pr-4 py-4 text-ink focus:ring-2 focus:ring-orange-500 outline-none min-h-[56px]"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-extrabold uppercase tracking-wider text-muted mb-2">
                Location
              </label>
              <div className="relative">
                <MapPin className="absolute left-4 top-4 w-5 h-5 text-orange-400" />
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City, neighborhood, or service area"
                  className="w-full text-base font-semibold border border-navy-700 bg-navy-900 rounded-2xl pl-12 pr-4 py-4 text-ink focus:ring-2 focus:ring-orange-500 outline-none min-h-[56px]"
                />
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleAnalyzeWebsite()}
            disabled={isAnalyzing}
            className="w-full sm:w-auto bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3.5 px-7 rounded-xl text-sm inline-flex items-center justify-center gap-2 shadow-accent"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Analyzing website…
              </>
            ) : analysis ? (
              <>
                <Search className="w-4 h-4" /> Re-analyze website
              </>
            ) : (
              <>
                <Search className="w-4 h-4" /> Analyze website
              </>
            )}
          </button>
          {isAnalyzing && (
            <p className="text-xs text-muted">This can take up to a minute.</p>
          )}

          {analysis && intel && (
            <div className="rounded-2xl border border-navy-700 bg-navy-950/60 p-4 space-y-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Website intelligence
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <span className="block text-dim">Primary keywords</span>
                  <span className="text-ink font-semibold">
                    {intel.primaryKeywords.slice(0, 3).join(", ") || "—"}
                  </span>
                </div>
                <div>
                  <span className="block text-dim">Secondary keywords</span>
                  <span className="text-ink font-semibold">
                    {intel.secondaryKeywords.slice(0, 3).join(", ") || "—"}
                  </span>
                </div>
                <div>
                  <span className="block text-dim">Location</span>
                  <span className="text-ink font-semibold">{intel.location || location || "—"}</span>
                </div>
                <div>
                  <span className="block text-dim">Pages analyzed</span>
                  <span className="text-ink font-semibold">
                    {analysis.inventory?.analyzedSuccess ?? intel.pagesAnalyzed}
                    {analysis.inventory ? ` / ${analysis.inventory.eligible}` : ""}
                  </span>
                </div>
                <div>
                  <span className="block text-dim">Services found</span>
                  <span className="text-ink font-semibold">{intel.servicesFound}</span>
                </div>
                <div>
                  <span className="block text-dim">Links discovered</span>
                  <span className="text-ink font-semibold">
                    {analysis.inventory?.discovered ?? intel.linksFound}
                  </span>
                </div>
                {analysis.inventory && (analysis.inventory.failed > 0 || analysis.inventory.remaining > 0) && (
                  <>
                    <div>
                      <span className="block text-dim">Failed</span>
                      <span className="text-ink font-semibold">{analysis.inventory.failed}</span>
                    </div>
                    <div>
                      <span className="block text-dim">Remaining</span>
                      <span className="text-ink font-semibold">{analysis.inventory.remaining}</span>
                    </div>
                  </>
                )}
              </div>
              {analysis.services && analysis.services.length > 0 && (
                <div className="text-xs">
                  <span className="block text-dim mb-1">
                    Detected services ({analysis.services.length}) — aggregated across pages
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.services.slice(0, 12).map((s) => (
                      <span
                        key={s.name}
                        title={`${s.pageCount} page(s): ${s.pages.slice(0, 3).join(", ")}`}
                        className="border border-navy-700 rounded-lg px-2 py-0.5 text-ink"
                      >
                        {s.name}
                        <span className="text-dim"> · {s.pageCount}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {analysis.cached && (
                <p className="text-[11px] text-dim">
                  Reused a recent cached analysis.{" "}
                  <button
                    type="button"
                    className="text-orange-400 font-bold"
                    onClick={handleReanalyzeFresh}
                  >
                    Re-analyze fresh
                  </button>
                </p>
              )}
              <button
                type="button"
                onClick={() => setSeoOpen((v) => !v)}
                className="text-[11px] font-bold text-orange-400"
              >
                {seoOpen ? "Hide SEO intelligence" : "Show SEO intelligence"}
              </button>
              {seoOpen && (
                <div className="text-[11px] text-muted space-y-1 font-mono">
                  <p>Primary: {intel.primaryKeywords.join(" · ") || "—"}</p>
                  <p>Secondary: {intel.secondaryKeywords.join(" · ") || "—"}</p>
                  <p>Intent: {analysis.dominantIntent}</p>
                </div>
              )}
              <button
                type="button"
                onClick={() => setStep(2)}
                className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2.5 px-5 rounded-xl text-sm"
              >
                Continue
              </button>
            </div>
          )}

          {generatedPosts.length > 0 && (
            <button
              type="button"
              onClick={() => goStep(4)}
              className="block text-xs font-bold text-orange-400 hover:underline"
            >
              Skip to existing posts →
            </button>
          )}
        </div>
      )}

      {/* —— STEP 2: Content Sources —— */}
      {step === 2 && analysis && (
        <div className="glass-card p-5 sm:p-7 rounded-2xl border border-navy-800 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-ink">Content sources</h3>
              <p className="text-sm text-muted mt-1">
                Only selected links are used as content sources.{" "}
                <span className="text-ink font-bold">
                  {selectedPages.length} of {(analysis.pages || []).length} selected
                </span>
                {analysis.inventory?.failed ? (
                  <span className="text-dim"> · {analysis.inventory.failed} failed</span>
                ) : null}
              </p>
              <p className="text-[11px] mt-0.5 h-4">
                {selectionSaveState === "saving" && (
                  <span className="text-dim">Saving selection…</span>
                )}
                {selectionSaveState === "saved" && (
                  <span className="text-emerald-400">✓ Selection saved</span>
                )}
                {selectionSaveState === "error" && (
                  <span className="text-red-400">Could not save selection — retrying on next change</span>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-xs font-bold text-muted hover:text-ink"
            >
              ← Website
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedPages(analysis.pages.slice(0, MAX_GEN_PAGES))}
              className="text-[11px] font-bold border border-navy-700 px-3 py-1.5 rounded-lg text-muted"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelectedPages([])}
              className="text-[11px] font-bold border border-navy-700 px-3 py-1.5 rounded-lg text-muted"
            >
              Clear
            </button>
            <input
              value={sourceSearch}
              onChange={(e) => setSourceSearch(e.target.value)}
              placeholder="Search pages…"
              className="flex-1 min-w-[140px] text-xs border border-navy-700 bg-navy-900 rounded-lg px-3 py-1.5 text-ink"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PAGE_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSourceFilter(f)}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                  sourceFilter === f
                    ? "bg-orange-500 text-white"
                    : "bg-navy-900 text-muted border border-navy-700"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {!selectedPages.length && (
            <p className="text-xs text-[#d97706] bg-amber-50/30 border border-amber-500/20 rounded-xl px-3 py-2">
              Select at least one website page to generate content.
            </p>
          )}

          <ul className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {visiblePages.map((page) => {
              const checked = selectedPages.some((p) => p.url === page.url);
              return (
                <li key={page.url}>
                  <label
                    className={`flex items-start gap-3 rounded-xl border px-3 py-3 cursor-pointer min-h-[44px] ${
                      checked
                        ? "border-orange-500/50 bg-orange-950/20"
                        : "border-navy-700 bg-navy-900/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePage(page.url)}
                      className="mt-1 rounded border-navy-600 bg-navy-900 text-orange-500 focus:ring-orange-500 w-4 h-4"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-ink truncate">
                        {page.title || page.url.replace(/^https?:\/\//, "")}
                      </span>
                      <span className="block text-[11px] text-dim truncate mt-0.5 font-mono">
                        {page.url.replace(/^https?:\/\//, "")}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                        <span className="bg-navy-950 border border-navy-700 text-muted px-1.5 py-0.5 rounded font-semibold">
                          {page.pageType || page.writingIntent}
                        </span>
                        {page.keywords.primary && (
                          <span className="bg-navy-950 border border-navy-700 text-orange-300 px-1.5 py-0.5 rounded font-semibold truncate max-w-[200px]">
                            {page.keywords.primary}
                          </span>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          {analysis.services && analysis.services.length > 0 && (
            <div className="border-t border-navy-800 pt-4 space-y-2">
              <p className="text-xs font-bold text-ink">
                Detected services{" "}
                <span className="text-dim font-semibold">
                  ({selectedServices.length} of {analysis.services.length} selected)
                </span>
              </p>
              <p className="text-[11px] text-muted">
                Only selected services are used in generated content. Deselect any false positives.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {analysis.services.map((s) => {
                  const on = selectedServices.includes(s.name);
                  return (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => toggleService(s.name)}
                      title={`${s.pageCount} page(s): ${s.pages.slice(0, 3).join(", ")}`}
                      className={`text-[11px] font-semibold rounded-lg px-2 py-1 border transition ${
                        on
                          ? "border-orange-500/60 bg-orange-950/30 text-orange-200"
                          : "border-navy-700 bg-navy-900/40 text-muted"
                      }`}
                    >
                      {on ? "✓ " : ""}
                      {s.name}
                      <span className="text-dim"> · {s.pageCount}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={!selectedPages.length}
            onClick={() => setStep(3)}
            className="self-start bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3.5 px-6 rounded-xl text-sm shadow-accent"
          >
            Continue
          </button>
        </div>
      )}

      {/* —— STEP 3: Channels & Content —— */}
      {step === 3 && (
        <div className="glass-card p-5 sm:p-7 rounded-2xl border border-navy-800 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-ink">Channels &amp; content</h3>
              <p className="text-sm text-muted mt-1">
                Platform rules apply automatically. CTA is chosen by the system.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="text-xs font-bold text-muted hover:text-ink"
            >
              ← Sources
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.values(PLATFORM_RULE_SUMMARY).map((ch) => {
              const on = channels.includes(ch.key);
              return (
                <button
                  key={ch.key}
                  type="button"
                  onClick={() =>
                    setChannels((prev) =>
                      prev.includes(ch.key) ? prev.filter((x) => x !== ch.key) : [...prev, ch.key]
                    )
                  }
                  className={`text-left rounded-2xl border px-[18px] py-[18px] min-h-[44px] transition-colors ${
                    on
                      ? "border-accent-border bg-accent-soft"
                      : "border-line bg-navy-800 hover:border-accent-border"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-bold text-ink">
                    <PlatformGlyph platform={ch.key} size={17} />
                    {ch.key === "GMB" ? "Google Business" : ch.key === "X" ? "X (Twitter)" : ch.key}
                  </span>
                  <span className="block text-[11px] text-muted mt-2">{ch.spec}</span>
                  <span className="block text-[10px] text-dim font-mono mt-1">{ch.img}</span>
                </button>
              );
            })}
          </div>

          {gmbOn && (
            <div className="space-y-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                GMB content type
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {gmbCategories.map((cat) => {
                  const selected = gmbCategory === cat.id;
                  const blocked = cat.requiresVerifiedOffer && !offerLikely;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setGmbCategory(cat.id)}
                      className={`text-left rounded-2xl border px-4 py-4 ${
                        selected ? "bg-navy-900" : "bg-navy-900/40 border-navy-700"
                      }`}
                      style={{ borderColor: selected ? cat.accent : undefined }}
                    >
                      <span className="block text-sm font-bold text-ink">{cat.label}</span>
                      <span className="block text-[11px] text-muted mt-1">{cat.short}</span>
                      <span className="block text-[11px] mt-2" style={{ color: cat.accent }}>
                        {cat.recommendedUse}
                      </span>
                      {blocked && (
                        <span className="block text-[11px] text-[#d97706] mt-2">
                          No verified offer or event found for this content type.
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={!canContinue3}
            onClick={() => setStep(4)}
            className="self-start bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3.5 px-6 rounded-xl text-sm shadow-accent"
          >
            Continue
          </button>
        </div>
      )}

      {/* —— STEP 4: Generate & Review —— */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="glass-card p-5 sm:p-6 rounded-2xl border border-navy-800 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-ink">Generate &amp; review</h3>
                <p className="text-sm text-muted mt-1">
                  Image is optional. Generate, then edit, rewrite, schedule, or publish.
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

            <div className="space-y-3">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">Image</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(
                  [
                    { id: "none" as const, title: "No image", desc: "Text only" },
                    { id: "free" as const, title: "Free source", desc: "Relevant stock / free" },
                    { id: "ai" as const, title: "AI / Paid", desc: "Generated from the post" },
                  ] as const
                ).map((opt) => {
                  const active =
                    (opt.id === "none" && !includeImages) ||
                    (opt.id === "free" && includeImages && imageSource === "free") ||
                    (opt.id === "ai" && includeImages && (imageSource === "ai" || imageSource === "auto"));
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        if (opt.id === "none") setIncludeImages(false);
                        else {
                          setIncludeImages(true);
                          setImageSource(opt.id === "free" ? "free" : "ai");
                        }
                      }}
                      className={`text-left rounded-xl border px-3 py-3 ${
                        active ? "border-orange-500 bg-orange-950/30" : "border-navy-700 bg-navy-900/50"
                      }`}
                    >
                      <span className="block text-sm font-bold text-ink">{opt.title}</span>
                      <span className="block text-[11px] text-muted mt-0.5">{opt.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-navy-700 bg-navy-950/50 p-4 space-y-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-muted">
                Ready to generate
              </p>
              {[
                [!!analysis, "Website analyzed"],
                [!!location.trim(), "Location"],
                [selectedPages.length > 0, `${selectedPages.length} source(s) selected`],
                [channels.length > 0, `Channels: ${channels.join(", ") || "none"}`],
                [!gmbOn || !!gmbCategory, gmbOn ? `GMB type selected` : "GMB not selected"],
              ].map(([ok, label]) => (
                <p key={String(label)} className={`text-xs ${ok ? "text-[#16a34a]" : "text-[#d97706]"}`}>
                  {ok ? "✓" : "⚠"} {label}
                </p>
              ))}
              <button
                type="button"
                onClick={handleScanAndGenerate}
                disabled={!canGenerate}
                className={`mt-3 self-start w-full sm:w-auto text-white font-bold py-3.5 px-7 rounded-xl text-sm inline-flex items-center justify-center gap-2 ${
                  canGenerate
                    ? "bg-orange-500 hover:bg-orange-600 shadow-accent"
                    : "bg-[#b9bcd0] cursor-not-allowed"
                }`}
              >
                {isScanning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    {generatePhase || "Generating…"}
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Generate posts
                  </>
                )}
              </button>
            </div>

            {generateDone && (
              <div className="flex flex-wrap gap-2.5">
                {(["draft", "scheduled"] as ListFilter[]).map((f) => {
                  const on = mainTab === "active" && listFilter === f;
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setMainTab("active");
                        setListFilter(f);
                      }}
                      className={`px-[17px] py-2 rounded-full text-xs font-bold capitalize ${
                        on
                          ? "bg-orange-500 text-white"
                          : "bg-transparent text-muted border border-line hover:text-ink"
                      }`}
                    >
                      {f} ({generatedPosts.filter((p) => p.status === f).length})
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setMainTab("archive");
                    loadArchive();
                  }}
                  className={`px-[17px] py-2 rounded-full text-xs font-bold ${
                    mainTab === "archive"
                      ? "bg-orange-500 text-white"
                      : "bg-transparent text-muted border border-line hover:text-ink"
                  }`}
                >
                  Archive ({archiveTotal + publishedPosts.length})
                </button>
              </div>
            )}

            {mainTab === "active" && includeImages && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isAttachingImages || !postsMissingImages}
                  onClick={() => handleAttachAllImages(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold border border-accent-border text-accent bg-accent-soft px-3 py-2 rounded-xl disabled:opacity-50"
                >
                  {isAttachingImages ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ImageIcon className="w-3.5 h-3.5" />
                  )}
                  Add missing images ({postsMissingImages})
                </button>
                {bgImageActive && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-dim px-3 py-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Generating images in the background…
                  </span>
                )}
              </div>
            )}
          </div>

          {mainTab === "active" && (
            <>
              {filtered.length === 0 ? (
                <div className="bg-white border border-dashed border-line rounded-[18px] p-10 text-center text-muted text-[13.5px]">
                  {generateDone ? (
                    <>Nothing in this tab yet.</>
                  ) : (
                    <>
                      No posts yet — press{" "}
                      <span className="text-accent font-bold">Generate posts</span> to
                      create drafts across your selected channels.
                    </>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
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
                      onRetryImage={handleRetryImage}
                      onSaveEdit={handleSaveEdit}
                      onDelete={handleDelete}
                      onApplyOverlay={handleApplyOverlay}
                      onRemoveOverlay={handleRemoveOverlay}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {mainTab === "archive" && (
            <div className="space-y-5">
              {/* Published posts — grouped by platform, then publish date */}
              {publishedGroups.length > 0 && (
                <div className="space-y-3">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-dim">
                    Published posts
                  </p>
                  {publishedGroups.map((g) => (
                    <div
                      key={g.platform}
                      className="bg-white rounded-2xl border border-line shadow-card overflow-hidden"
                      style={{
                        borderTop: `3px solid ${
                          PLATFORM_BRAND_COLOR[
                            g.platform as keyof typeof PLATFORM_BRAND_COLOR
                          ] || "#6d4dff"
                        }`,
                      }}
                    >
                      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2.5 text-sm font-bold text-ink">
                          <PlatformGlyph platform={g.platform} size={18} />
                          {platformLabel(g.platform)}
                        </span>
                        <span className="text-[11px] font-bold text-dim">
                          {g.posts.length} published
                        </span>
                      </div>
                      <div className="divide-y divide-line">
                        {groupPostsByDate(g.posts).map(([date, posts]) => (
                          <div key={date} className="px-4 py-3">
                            <p className="text-[10px] font-extrabold uppercase tracking-[0.09em] text-dim mb-2">
                              {date}
                            </p>
                            <ul className="flex flex-col gap-2.5">
                              {posts.map((post) => (
                                <li
                                  key={post.id}
                                  className="flex items-center justify-between gap-3"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-[13px] font-semibold text-ink truncate">
                                      {post.heading}
                                    </span>
                                    <span className="block text-[11px] text-dim font-mono truncate">
                                      {post.publishedAt
                                        ? new Date(
                                            post.publishedAt
                                          ).toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          })
                                        : ""}
                                      {post.url
                                        ? ` · ${post.url.replace(/^https?:\/\//, "")}`
                                        : ""}
                                    </span>
                                  </span>
                                  <span className="flex items-center gap-2 shrink-0">
                                    <Lock className="w-3.5 h-3.5 text-[#16a34a]" />
                                    <button
                                      type="button"
                                      disabled={actionBusyId === post.id}
                                      onClick={() => handleRewrite(post.id)}
                                      className="text-[10px] font-bold text-muted border border-line px-2 py-1 rounded-lg hover:bg-navy-800 disabled:opacity-50"
                                    >
                                      {actionBusyId === post.id ? "…" : "Rewrite"}
                                    </button>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Regenerated / archived drafts (server archive) */}
              {isLoadingArchive ? (
                <p className="text-sm text-muted text-center py-6">Loading archive…</p>
              ) : archiveTables.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-dim">
                    Archived drafts
                  </p>
                  {archiveTables.map((table) => (
                    <div
                      key={table.websiteOrigin}
                      className="bg-white rounded-2xl border border-line shadow-card overflow-hidden"
                    >
                      <div className="px-4 py-3 border-b border-line flex flex-wrap justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-ink">{table.websiteOrigin}</p>
                          <p className="text-[11px] text-dim">
                            {table.count} posts · {table.lockedCount} locked
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setClearConfirmOrigin(table.websiteOrigin)}
                          className="text-[11px] font-bold text-[#dc2626] border border-red-200 px-2 py-1 rounded-lg hover:bg-red-50"
                        >
                          Clear
                        </button>
                      </div>
                      <ul className="divide-y divide-line">
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
                              <span className="min-w-0 truncate text-muted">
                                {platformIcon(post.platform)}{" "}
                                <span className="font-semibold text-ink">{post.heading}</span>
                                {locked && (
                                  <Lock className="inline w-3 h-3 text-[#16a34a] ml-1" />
                                )}
                              </span>
                              <button
                                type="button"
                                disabled={actionBusyId === post.id}
                                onClick={() => handleRewrite(post.id)}
                                className="shrink-0 text-[10px] font-bold text-muted border border-line px-2 py-1 rounded-lg hover:bg-navy-800 disabled:opacity-50"
                              >
                                Re-generate
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : publishedGroups.length === 0 ? (
                <div className="bg-white border border-dashed border-line rounded-[18px] p-10 text-center text-muted text-[13.5px]">
                  Archive is empty — publish a post to see it here, grouped by
                  platform and date.
                </div>
              ) : null}

              {clearConfirmOrigin && (
                <div className="glass-card p-5 rounded-2xl border border-red-900/40 bg-red-50/20 text-center space-y-3">
                  <p className="text-sm font-bold text-ink">Clear archive for this site?</p>
                  <div className="flex justify-center gap-2">
                    <button
                      type="button"
                      disabled={isClearingArchive}
                      onClick={() => handleClearArchive(clearConfirmOrigin)}
                      className="bg-red-600 text-ink text-xs font-bold px-4 py-2 rounded-xl"
                    >
                      Yes, clear
                    </button>
                    <button
                      type="button"
                      onClick={() => setClearConfirmOrigin(null)}
                      className="border border-navy-600 text-muted text-xs font-bold px-4 py-2 rounded-xl"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-dim text-center">
            Need accounts connected?{" "}
            <Link href="/dashboard/connections" className="text-orange-400 font-bold hover:underline">
              Connect Facebook / Instagram / LinkedIn / Google →
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Feature D — live title-overlay editor. The <canvas> preview is produced by
 * the exact same code path as the exported JPEG, so what the user sees is what
 * gets published. Compositing always uses the ORIGINAL source image
 * (imageSourceUrl) so overlays stay non-destructive and re-editable.
 */
function TitleOverlayEditor({
  post,
  onApplyOverlay,
  onRemoveOverlay,
}: {
  post: StudioPostRecord;
  onApplyOverlay: (id: string, config: OverlayConfig, renderedImage: string) => Promise<void>;
  onRemoveOverlay: (id: string) => Promise<void>;
}) {
  const sourceUrl = post.imageSourceUrl || post.image || "";
  const hasOverlay = !!post.overlay;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cfg, setCfg] = useState<OverlayDraftConfig>({
    enabled: true,
    title: post.overlay?.title || post.heading || "",
    anchorPct: post.overlay?.anchorPct ?? OVERLAY_DEFAULTS.anchorPct,
    fontSizePct: post.overlay?.fontSizePct ?? OVERLAY_DEFAULTS.fontSizePct,
    color: post.overlay?.color ?? OVERLAY_DEFAULTS.color,
    panel: post.overlay?.panel ?? OVERLAY_DEFAULTS.panel,
    panelOpacity: post.overlay?.panelOpacity ?? OVERLAY_DEFAULTS.panelOpacity,
  });

  // Load the source image once (CORS-enabled so the canvas export is untainted).
  useEffect(() => {
    if (!open || !sourceUrl) return;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setImgReady(true);
    };
    img.onerror = () => {
      setError("Could not load the source image for overlay rendering.");
      setImgReady(false);
    };
    img.src = sourceUrl;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [open, sourceUrl]);

  // Redraw the preview whenever the config changes.
  useEffect(() => {
    if (!open || !imgReady || !imgRef.current || !canvasRef.current) return;
    const img = imgRef.current;
    const iw = img.naturalWidth || 1080;
    const ih = img.naturalHeight || 1080;
    const previewW = 300;
    const previewH = Math.round(previewW * (ih / iw));
    drawTitleOverlay(canvasRef.current, img, previewW, previewH, cfg.title || "", cfg);
  }, [open, imgReady, cfg]);

  const apply = async () => {
    if (applying || !imgRef.current) return;
    setApplying(true);
    setError(null);
    try {
      const dataUrl = exportOverlayDataURL(imgRef.current, cfg.title || "", cfg);
      if (!dataUrl) {
        setError("This image can't be composited in the browser (cross-origin). Try regenerating it.");
        return;
      }
      await onApplyOverlay(post.id, cfg as OverlayConfig, dataUrl);
    } catch {
      setError("Overlay failed — your original image is unchanged.");
    } finally {
      setApplying(false);
    }
  };

  if (!sourceUrl) return null;

  return (
    <div className="rounded-xl border border-line bg-navy-800/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-dim">
          Title overlay
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-accent border border-accent-border bg-accent-soft rounded-lg px-2.5 py-1.5"
        >
          <Type className="w-3.5 h-3.5" />
          {open ? "Close" : hasOverlay ? "Edit overlay" : "Add title to image"}
        </button>
      </div>

      {open && (
        <div className="mt-3 flex flex-col md:flex-row gap-4">
          <div className="shrink-0">
            <canvas
              ref={canvasRef}
              className="rounded-lg border border-line max-w-[300px] w-[300px] h-auto bg-navy-900"
            />
            {!imgReady && !error && (
              <p className="text-[10px] text-dim mt-1">Loading preview…</p>
            )}
          </div>

          <div className="flex-1 flex flex-col gap-2.5 min-w-0">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-dim">Title text</span>
              <input
                type="text"
                value={cfg.title || ""}
                onChange={(e) => setCfg((c) => ({ ...c, title: e.target.value }))}
                className="w-full text-[12px] border border-line bg-white rounded-lg px-2.5 py-1.5 text-ink"
                placeholder="Short headline (not the full caption)"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-dim">
                Vertical position ({Math.round((cfg.anchorPct ?? 0.59) * 100)}% from top)
              </span>
              <input
                type="range"
                min={35}
                max={85}
                value={Math.round((cfg.anchorPct ?? 0.59) * 100)}
                onChange={(e) =>
                  setCfg((c) => ({ ...c, anchorPct: Number(e.target.value) / 100 }))
                }
              />
            </label>

            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex flex-col gap-1 flex-1 min-w-[120px]">
                <span className="text-[10px] font-bold text-dim">
                  Font size ({Math.round((cfg.fontSizePct ?? 0.062) * 100)}%)
                </span>
                <input
                  type="range"
                  min={40}
                  max={100}
                  value={Math.round((cfg.fontSizePct ?? 0.062) * 1000)}
                  onChange={(e) =>
                    setCfg((c) => ({ ...c, fontSizePct: Number(e.target.value) / 1000 }))
                  }
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-dim">Color</span>
                <input
                  type="color"
                  value={cfg.color || "#ffffff"}
                  onChange={(e) => setCfg((c) => ({ ...c, color: e.target.value }))}
                  className="w-7 h-7 rounded border border-line bg-transparent"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={cfg.panel ?? true}
                  onChange={(e) => setCfg((c) => ({ ...c, panel: e.target.checked }))}
                />
                <span className="text-[10px] font-bold text-dim">Contrast panel</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-1">
              <button
                type="button"
                disabled={applying || !imgReady || !(cfg.title || "").trim()}
                onClick={apply}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold disabled:opacity-50"
              >
                {applying ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Apply overlay
              </button>
              {hasOverlay && (
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => onRemoveOverlay(post.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] border border-line text-muted text-xs font-bold hover:bg-navy-800 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  Remove overlay
                </button>
              )}
              {error && (
                <span className="text-[11px] font-bold text-red-500">{error}</span>
              )}
            </div>
          </div>
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
  onRetryImage,
  onSaveEdit,
  onDelete,
  onApplyOverlay,
  onRemoveOverlay,
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
  onRetryImage: (id: string) => void;
  onSaveEdit: (id: string, content: string, heading: string) => Promise<StudioPostRecord | null>;
  onDelete: (id: string) => void;
  onApplyOverlay: (id: string, config: OverlayConfig, renderedImage: string) => Promise<void>;
  onRemoveOverlay: (id: string) => Promise<void>;
}) {
  const [scheduleDate, setScheduleDate] = useState("");
  const [showPicker, setShowPicker] = useState(false);

  // Feature A — local edit buffer. Seeded from the post; a monotonic save
  // counter guards against a stale response overwriting a newer edit.
  const [editHeading, setEditHeading] = useState(post.heading || "");
  const [editContent, setEditContent] = useState(post.content || "");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const saveSeqRef = useRef(0);
  // Re-seed the buffer only when a different post is shown or the server copy
  // changes while there are no unsaved local edits.
  const seededForRef = useRef<string>("");
  useEffect(() => {
    const sig = `${post.id}:${post.updatedAt || ""}`;
    const dirty =
      editHeading !== (post.heading || "") || editContent !== (post.content || "");
    if (seededForRef.current !== sig && !dirty) {
      setEditHeading(post.heading || "");
      setEditContent(post.content || "");
      seededForRef.current = sig;
    } else if (!seededForRef.current) {
      seededForRef.current = sig;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id, post.updatedAt]);

  const dirty =
    editHeading !== (post.heading || "") || editContent !== (post.content || "");

  // Feature B — two-step delete confirmation guards against accidental clicks.
  const [confirmDelete, setConfirmDelete] = useState(false);

  const locked = !!(post.publishLocked || (post.status === "published" && post.locked));
  const words =
    post.wordCount || countWords(post.contentHtml || post.content);
  const minWords = PLATFORM_MIN_WORDS[post.platform] || 80;
  const busy = !!(imageBusy || actionBusy);
  const sizeLabel = PLATFORM_IMAGE_SIZE[post.platform]?.label || "HD";

  const brandColor =
    PLATFORM_BRAND_COLOR[post.platform as keyof typeof PLATFORM_BRAND_COLOR] || "#6d4dff";

  const isGMB = post.platform === "GMB";
  const charCount = post.charCount ?? countWords(post.content);
  const countOk = isGMB
    ? charCount >= 1000 && charCount <= 1100
    : words >= minWords;
  const countLabel = isGMB
    ? `${charCount} / 1,000–1,100 chars`
    : `${words} / ${minWords}+ words`;

  const statusMeta =
    post.status === "published"
      ? { label: "Published", color: "#16a34a", bg: "rgba(22,163,74,0.12)" }
      : post.status === "scheduled"
        ? { label: "Scheduled", color: "#0a66c2", bg: "rgba(10,102,194,0.12)" }
        : { label: "Draft", color: "#d97706", bg: "rgba(217,119,6,0.12)" };

  let pathPart = "";
  try {
    pathPart = post.url ? new URL(post.url).pathname : "";
  } catch {
    pathPart = "";
  }
  const monoLine = [pathPart, post.keywords?.primary]
    .filter(Boolean)
    .join(" · ");

  const bodyText = String(post.content || post.contentHtml || "")
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();

  const square = post.platform === "Instagram";
  const tall = post.platform === "Pinterest";
  const boxW = square ? 112 : tall ? 120 : 172;
  const boxH = square ? 112 : tall ? 168 : 112;
  const stripe =
    "repeating-linear-gradient(135deg,#eef1f8,#eef1f8 8px,#e3e8f4 8px,#e3e8f4 16px)";

  const ghostBtn =
    "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-transparent border border-line text-muted text-xs font-bold hover:bg-navy-800 disabled:opacity-50";

  const handleSaveDraft = async () => {
    if (savingEdit || !dirty) return; // duplicate-click + no-op guard
    setSavingEdit(true);
    setEditError(null);
    const seq = ++saveSeqRef.current;
    try {
      await onSaveEdit(post.id, editContent, editHeading);
      // Ignore a response that is no longer the latest in-flight save.
      if (seq !== saveSeqRef.current) return;
    } catch (err) {
      if (seq === saveSeqRef.current) {
        setEditError(
          isApiError(err) ? err.error : "Could not save — your edits are kept, try again."
        );
      }
    } finally {
      if (seq === saveSeqRef.current) setSavingEdit(false);
    }
  };

  const handleDiscard = () => {
    setEditHeading(post.heading || "");
    setEditContent(post.content || "");
    setEditError(null);
  };

  return (
    <div
      className="bg-white rounded-[18px] border border-line shadow-card p-[22px] flex flex-col gap-4"
      style={{ borderTop: `3px solid ${brandColor}` }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <PlatformGlyph platform={post.platform} size={18} />
          <span className="text-sm font-bold text-ink">
            {post.platform === "GMB"
              ? "Google Business"
              : post.platform === "X"
                ? "X (Twitter)"
                : post.platform}
          </span>
          <span className="text-[10px] font-bold px-2.5 py-[3px] rounded-full bg-navy-800 border border-line text-muted">
            {post.gmbCategory || post.tone}
          </span>
          <span
            className="text-[10px] font-bold px-2.5 py-[3px] rounded-full"
            style={{ color: statusMeta.color, background: statusMeta.bg }}
          >
            {statusMeta.label}
          </span>
          {post.validation && (
            <span
              className="text-[10px] font-bold px-2.5 py-[3px] rounded-full"
              style={
                post.validation.ready || post.validation.status === "READY"
                  ? { color: "#16a34a", background: "rgba(22,163,74,0.12)" }
                  : { color: "#d97706", background: "rgba(217,119,6,0.12)" }
              }
            >
              {post.validation.ready || post.validation.status === "READY"
                ? "✓ Ready"
                : "⚠ Needs Review"}
            </span>
          )}
        </div>
        <span
          className="text-xs font-bold shrink-0"
          style={{ color: countOk ? "#16a34a" : "#d97706" }}
        >
          {post.status === "published" && post.publishedAt
            ? `Posted ${new Date(post.publishedAt).toLocaleDateString()}`
            : countLabel}
        </span>
      </div>

      {/* Body */}
      <div className="flex gap-[18px]">
        <div className="flex-1 min-w-0">
          {monoLine && (
            <div className="font-mono text-[11px] text-dim mb-2.5 truncate">
              {monoLine}
            </div>
          )}
          <p className="m-0 text-[13.5px] leading-[1.65] text-muted whitespace-pre-wrap">
            {bodyText}
          </p>
        </div>
        <div
          className="shrink-0 rounded-xl border border-line overflow-hidden flex items-center justify-center"
          style={{
            width: boxW,
            height: boxH,
            background: post.image ? undefined : stripe,
          }}
        >
          {post.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.image}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : post.imageStatus === "pending" ? (
            <div className="flex flex-col items-center gap-1 text-dim px-1 text-center">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span className="font-mono text-[9px] leading-tight">Generating image…</span>
            </div>
          ) : post.imageStatus === "failed" ? (
            <div className="flex flex-col items-center gap-1 px-1 text-center">
              <span className="font-mono text-[9px] leading-tight text-red-500">Image failed</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRetryImage(post.id)}
                className="inline-flex items-center gap-1 text-[9px] font-bold text-accent border border-accent-border rounded px-1.5 py-0.5 disabled:opacity-50"
              >
                {imageBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Retry
              </button>
            </div>
          ) : (
            <span className="font-mono text-[10px] text-dim">
              {sizeLabel.split(" · ")[0]}
            </span>
          )}
        </div>
      </div>

      {/* CTA — shows the REAL link capability, never a fake clickable phrase */}
      {post.ctaInfo && post.ctaInfo.linkCapability !== "none" && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-bold text-muted">CTA:</span>
          <span className="px-2 py-0.5 rounded-md bg-navy-800 border border-line text-ink font-semibold">
            {post.ctaInfo.ctaText}
            {post.ctaInfo.ctaType && post.ctaInfo.linkCapability === "native_button"
              ? ` · ${post.ctaInfo.ctaType}`
              : ""}
          </span>
          {post.ctaInfo.linkCapability === "native_button" ? (
            post.ctaInfo.validationStatus === "valid" ? (
              <span className="inline-flex items-center gap-1 text-[#16a34a] font-semibold">
                <LinkIcon className="w-3 h-3" /> Native button
                {post.ctaInfo.destinationUrl ? ` → ${hostOf(post.ctaInfo.destinationUrl)}` : ""}
              </span>
            ) : (
              <span className="text-amber-600 font-semibold">No valid destination — button disabled</span>
            )
          ) : post.ctaInfo.linkCapability === "profile_link" ? (
            <span className="text-dim font-semibold">Not clickable in caption — use profile link</span>
          ) : post.ctaInfo.linkCapability === "body_link" ? (
            post.ctaInfo.validationStatus === "valid" ? (
              <span className="inline-flex items-center gap-1 text-[#16a34a] font-semibold">
                <LinkIcon className="w-3 h-3" /> Clickable link → {hostOf(post.ctaInfo.destinationUrl)}
              </span>
            ) : (
              <span className="text-amber-600 font-semibold">No valid link destination</span>
            )
          ) : null}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2.5">
        {locked ? (
          <>
            <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-navy-800 border border-line text-muted text-xs font-bold">
              <Lock className="w-3.5 h-3.5 text-[#16a34a]" />
              Published &amp; locked
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRewrite(post.id)}
              className={ghostBtn}
            >
              {actionBusy ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Rewrite
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onToggle} className={ghostBtn}>
              <Pencil className="w-3.5 h-3.5" />
              {expanded ? "Done" : "Edit"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRewrite(post.id)}
              className={ghostBtn}
            >
              {actionBusy ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Rewrite
            </button>
            {post.status === "scheduled" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onUnschedule(post.id)}
                className={ghostBtn}
              >
                <X className="w-3.5 h-3.5" />
                Cancel schedule
              </button>
            ) : (
              <div className="relative">
                {showPicker && (
                  <div className="absolute bottom-full left-0 mb-2 bg-white border border-line rounded-xl p-3 z-20 w-[260px] shadow-[0_6px_18px_rgba(18,26,48,0.1)]">
                    <p className="text-[10px] text-muted font-bold mb-2">
                      Auto-post at
                    </p>
                    <input
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="w-full text-xs border border-line bg-navy-800 rounded-lg px-2 py-2 text-ink mb-2"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          onSchedule(post.id, scheduleDate);
                          setShowPicker(false);
                        }}
                        className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold py-2 rounded-lg disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPicker(false)}
                        className="flex-1 bg-navy-800 border border-line text-muted text-xs font-bold py-2 rounded-lg"
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
                  className={ghostBtn}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  Schedule
                </button>
              </div>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onPublish(post.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold shadow-accent disabled:opacity-50"
            >
              {actionBusy ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              {post.status === "scheduled" ? "Publish now" : "Publish"}
            </button>
          </>
        )}

        {/* Feature B/C — delete / cancel (two-step confirm, scheduled-aware) */}
        <div className="ml-auto flex items-center gap-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-muted">
                {post.status === "scheduled"
                  ? "Cancel future publishing & delete?"
                  : post.status === "published"
                    ? "Remove from library? (won't delete the live post)"
                    : "Delete this post?"}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmDelete(false);
                  onDelete(post.id);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50"
              >
                {actionBusy ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                {post.status === "scheduled" ? "Cancel & delete" : "Delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className={ghostBtn}
              >
                Keep
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-transparent border border-line text-red-500 text-xs font-bold hover:bg-red-50 disabled:opacity-50"
              title={
                post.status === "scheduled"
                  ? "Cancel scheduling and delete this post"
                  : "Delete this post"
              }
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Expanded tools: content editor, image + overlay, keywords, validation */}
      {expanded && !locked && (
        <div className="border-t border-line pt-4 flex flex-col gap-3">
          {/* Feature A — edit the post content before submitting/publishing */}
          <div className="flex flex-col gap-2">
            {isGMB && (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wide text-dim">
                  Headline
                </span>
                <input
                  type="text"
                  value={editHeading}
                  onChange={(e) => setEditHeading(e.target.value)}
                  className="w-full text-[13px] border border-line bg-white rounded-lg px-3 py-2 text-ink"
                  placeholder="Post headline"
                />
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wide text-dim">
                {isGMB ? "Post body" : "Caption / body"}
              </span>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={6}
                className="w-full text-[13px] leading-[1.6] border border-line bg-white rounded-lg px-3 py-2 text-ink resize-y font-sans"
                placeholder="Write the post content…"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={savingEdit || !dirty}
                onClick={handleSaveDraft}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] bg-accent text-white text-xs font-bold disabled:opacity-50"
              >
                {savingEdit ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                {savingEdit ? "Saving…" : dirty ? "Save draft" : "Saved"}
              </button>
              {dirty && (
                <button type="button" onClick={handleDiscard} className={ghostBtn}>
                  Discard changes
                </button>
              )}
              <span className="text-[10px] text-dim font-semibold">
                {isGMB
                  ? `${editContent.length} chars`
                  : `${countWords(editContent)} words`}
              </span>
              {editError && (
                <span className="text-[11px] font-bold text-red-500">{editError}</span>
              )}
            </div>
          </div>

          {/* Feature D — title overlay editor with a live preview (preview == export) */}
          {post.image && (
            <TitleOverlayEditor
              post={post}
              onApplyOverlay={onApplyOverlay}
              onRemoveOverlay={onRemoveOverlay}
            />
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onGenerateImage(post.id)}
              className="inline-flex items-center gap-1.5 border border-accent-border text-accent bg-accent-soft text-[11px] font-bold px-2.5 py-1.5 rounded-lg disabled:opacity-50"
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
                  className="inline-flex items-center gap-1.5 border border-line text-ink text-[11px] font-bold px-2.5 py-1.5 rounded-lg hover:bg-navy-800"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onClearImage(post.id)}
                  className="inline-flex items-center gap-1.5 border border-line text-muted text-[11px] font-bold px-2.5 py-1.5 rounded-lg hover:bg-navy-800 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Detach
                </button>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {post.keywords?.primary && (
              <span className="text-[10px] font-semibold text-accent bg-accent-soft border border-accent-border px-2 py-1 rounded">
                P: {post.keywords.primary}
              </span>
            )}
            {(post.keywords?.general?.length
              ? post.keywords.general
              : [post.keywords?.secondary].filter(Boolean)
            )
              .slice(0, 4)
              .map((kw, i) => (
                <span
                  key={i}
                  className="text-[10px] font-semibold text-[#0a66c2] bg-navy-800 border border-line px-2 py-1 rounded"
                >
                  S{i + 1}: {kw}
                </span>
              ))}
            {post.url && (
              <a
                href={post.url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] font-semibold text-muted bg-navy-800 border border-line px-2 py-1 rounded font-mono truncate max-w-full"
              >
                Based on: {post.sourceTitle || "Source"} ·{" "}
                {post.url.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
          {post.validation?.issues && post.validation.issues.length > 0 && (
            <div className="text-[11px] text-[#d97706] bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 space-y-1">
              {post.validation.issues.map((issue, i) => (
                <p key={i}>{issue}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
