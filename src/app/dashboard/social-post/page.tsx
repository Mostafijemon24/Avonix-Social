"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Globe,
  LayoutDashboard,
  CalendarClock,
  Play,
  FileText,
  Image as ImageIcon,
  CheckCircle2,
  RefreshCw,
  Clock,
  Facebook,
  Instagram,
  Linkedin,
  MapPin,
  Search,
  Lock,
  PlusCircle,
  Calendar,
  Settings2,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api, isApiError, type StudioPostRecord } from "@/lib/api-client";

const COLORS = {
  primary: "#ff6600",
  secondary: "#0a192f",
};

const TONE_PRESETS = [
  "Professional",
  "Enthusiastic",
  "Empathetic",
  "Authoritative",
  "Storytelling",
] as const;

type TabId = "generator" | "dashboard" | "scheduled";

type AnalyzedKeyword = {
  url: string;
  reachable?: boolean;
  keywords: {
    primary: string;
    secondary: string;
    general: string[];
  };
};

function getPlatformIcon(platform: string) {
  switch (platform) {
    case "Facebook":
      return <Facebook className="w-5 h-5 text-blue-400" />;
    case "Instagram":
      return <Instagram className="w-5 h-5 text-pink-400" />;
    case "LinkedIn":
      return <Linkedin className="w-5 h-5 text-sky-400" />;
    case "GMB":
      return <Globe className="w-5 h-5 text-emerald-400" />;
    default:
      return <Globe className="w-5 h-5" />;
  }
}

export default function SocialPostPage() {
  const { showToast } = useToast();
  const { state } = useWorkspace();

  const [activeTab, setActiveTab] = useState<TabId>("generator");
  const [urlsInput, setUrlsInput] = useState("");
  const [location, setLocation] = useState("");
  const [selectedTone, setSelectedTone] =
    useState<(typeof TONE_PRESETS)[number]>("Professional");
  const [isScanning, setIsScanning] = useState(false);

  const [analyzedKeywords, setAnalyzedKeywords] = useState<AnalyzedKeyword[]>([]);
  const [generatedPosts, setGeneratedPosts] = useState<StudioPostRecord[]>([]);
  const [localToast, setLocalToast] = useState("");

  const showLocalToast = (message: string) => {
    setLocalToast(message);
    setTimeout(() => setLocalToast(""), 3000);
  };

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
      /* keep local state */
    }
  }, [state.email, state.activeWorkspaceId]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    const loc = state.sitemap?.location;
    if (loc && !location) setLocation(loc);
  }, [state.sitemap?.location, location]);

  const handleScanAndGenerate = async () => {
    if (!urlsInput.trim() || !location.trim()) {
      showLocalToast("Please provide both Website URLs and Target Location!");
      showToast("URLs and location are required", "error");
      return;
    }
    if (!state.email) {
      showToast("Sign in required", "error");
      return;
    }

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
      // Replace drafts from this run; keep published/scheduled from server reload
      await loadRecords();
      if (result.posts?.length) {
        mergePosts(result.posts);
      }

      const skipped = result.skippedLocked?.length || 0;
      showLocalToast(
        skipped
          ? `Done! Generated posts (${skipped} locked duplicates skipped).`
          : "Scan complete! AI has successfully generated your posts."
      );
      showToast(
        `Generated ${result.posts?.length || 0} posts from ${result.analyzed?.length || 0} pages`,
        "success"
      );
      setActiveTab("generator");
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Generation failed", "error");
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
        alsoLive: false,
      });
      mergePosts([result.post]);
      showLocalToast("Post published successfully and locked in the Dashboard!");
      showToast("Published & locked", "success");
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Publish failed", "error");
    }
  };

  const handleSchedule = async (postId: string, date: string) => {
    if (!date) {
      showLocalToast("Please select a valid date and time!");
      return;
    }
    if (!state.email) return;
    try {
      const result = await api.scheduleStudioPost({
        email: state.email,
        postId,
        scheduledAt: new Date(date).toISOString(),
      });
      mergePosts([result.post]);
      showLocalToast("Post scheduled successfully!");
      showToast("Scheduled", "success");
      setActiveTab("scheduled");
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
      showLocalToast("Post rewritten successfully! Ready to schedule or publish.");
      showToast("Rewritten — back to draft", "success");
      setActiveTab("generator");
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Rewrite failed", "error");
    }
  };

  const drafts = generatedPosts.filter((p) => p.status === "draft");
  const published = generatedPosts.filter((p) => p.status === "published");
  const scheduled = generatedPosts.filter((p) => p.status === "scheduled");

  return (
    <div className="w-full flex flex-col items-center pb-10 animate-fade-in">
      {localToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-emerald-500 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 w-[90%] sm:w-auto justify-center text-center">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span className="font-medium text-sm sm:text-base">{localToast}</span>
        </div>
      )}

      {/* Liquid sub-nav */}
      <div
        className="w-full rounded-2xl shadow-md mb-6 sm:mb-8 flex justify-center py-3 px-3"
        style={{ backgroundColor: COLORS.secondary }}
      >
        <div className="w-full max-w-[1600px] flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-xl shadow-inner"
              style={{ backgroundColor: COLORS.primary }}
            >
              <LayoutDashboard className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <span className="font-bold text-lg sm:text-xl tracking-wide text-white whitespace-nowrap">
              Avonix Social
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 w-full sm:w-auto">
            {(
              [
                { id: "generator" as const, icon: FileText, label: "Generator" },
                { id: "dashboard" as const, icon: LayoutDashboard, label: "Dashboard" },
                { id: "scheduled" as const, icon: CalendarClock, label: "Scheduled" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 sm:px-5 sm:py-2.5 rounded-lg font-medium transition-all flex items-center gap-2 text-sm sm:text-base flex-1 sm:flex-none justify-center ${
                  activeTab === tab.id
                    ? "bg-[#ff6600] text-white shadow-md"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="whitespace-nowrap">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <main className="w-full max-w-[1600px] flex flex-col items-center">
        {activeTab === "generator" && (
          <div className="w-full flex flex-col items-center gap-8">
            <div className="w-full glass-card rounded-2xl p-5 sm:p-8 border border-navy-800 flex flex-col items-center">
              <div className="w-full flex justify-center mb-8">
                <h2
                  className="text-2xl sm:text-3xl font-bold flex items-center gap-3 text-center text-white"
                >
                  <Search className="w-7 h-7 sm:w-8 sm:h-8" style={{ color: COLORS.primary }} />
                  URL Scanner & Content Generator
                </h2>
              </div>

              <div className="w-full flex flex-col lg:flex-row gap-6 lg:gap-10">
                <div className="flex-1 flex flex-col gap-6">
                  <div className="w-full flex flex-col gap-2">
                    <label className="font-semibold text-slate-300 text-sm sm:text-base text-center lg:text-left">
                      Website URLs (Max 15, one per line):
                    </label>
                    <textarea
                      value={urlsInput}
                      onChange={(e) => setUrlsInput(e.target.value)}
                      placeholder={"https://example1.com/page\nhttps://example2.com/services"}
                      className="w-full min-h-[160px] p-4 border border-navy-700 rounded-xl focus:ring-4 focus:ring-orange-500/20 focus:border-[#ff6600] transition-all resize-y text-slate-200 bg-navy-900/60"
                    />
                    <p className="text-[11px] text-slate-500 text-center lg:text-left">
                      {urlsInput.split("\n").filter((l) => l.trim()).length}/15 URLs · scans page
                      content → 1 primary, 1 secondary, 4 general keywords each
                    </p>
                  </div>

                  <div className="w-full bg-navy-900/50 p-5 rounded-xl border border-navy-700 flex flex-col items-center lg:items-start">
                    <label className="font-semibold text-slate-300 flex items-center gap-2 mb-3 text-sm sm:text-base">
                      <Settings2 className="w-5 h-5 text-slate-400" />
                      Select Post Tone / Preset:
                    </label>
                    <div className="w-full flex flex-wrap justify-center lg:justify-start gap-2 sm:gap-3">
                      {TONE_PRESETS.map((tone) => (
                        <button
                          key={tone}
                          type="button"
                          onClick={() => setSelectedTone(tone)}
                          className={`px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-sm font-medium transition-all flex-grow sm:flex-grow-0 text-center ${
                            selectedTone === tone
                              ? "bg-[#0a192f] text-white shadow-lg scale-105 ring-2 ring-[#ff6600]"
                              : "bg-navy-800 text-slate-300 border border-navy-600 hover:border-[#ff6600] hover:text-white"
                          }`}
                        >
                          {tone}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-3 text-center lg:text-left">
                      5 professional &amp; engaged presets — applied before writing starts
                    </p>
                  </div>
                </div>

                <div className="w-full lg:w-[35%] xl:w-[30%] flex flex-col gap-6 justify-end">
                  <div className="w-full flex flex-col gap-2">
                    <label className="font-semibold text-slate-300 text-sm sm:text-base text-center lg:text-left">
                      Target Location:
                    </label>
                    <div className="relative w-full">
                      <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="e.g. New York, USA"
                        className="w-full pl-12 pr-4 py-4 border border-navy-700 rounded-xl focus:ring-4 focus:ring-orange-500/20 focus:border-[#ff6600] transition-all bg-navy-900/60 text-slate-200"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleScanAndGenerate}
                    disabled={isScanning}
                    style={{ backgroundColor: isScanning ? "#475569" : COLORS.primary }}
                    className="w-full text-white font-bold py-4 sm:py-5 px-6 rounded-xl flex items-center justify-center gap-3 hover:opacity-95 hover:shadow-lg transition-all text-lg sm:text-xl shadow-md mt-auto disabled:cursor-not-allowed"
                  >
                    {isScanning ? (
                      <>
                        <RefreshCw className="w-6 h-6 sm:w-7 sm:h-7 animate-spin" /> Generating AI
                        Content...
                      </>
                    ) : (
                      <>
                        <Play className="w-6 h-6 sm:w-7 sm:h-7" /> Analyze &amp; Generate
                      </>
                    )}
                  </button>
                </div>
              </div>

              {analyzedKeywords.length > 0 && (
                <div className="w-full mt-10 pt-8 border-t border-navy-700 flex flex-col items-center">
                  <h3 className="text-lg sm:text-xl font-bold mb-6 text-slate-200 text-center">
                    Extracted Keywords ({analyzedKeywords.length} pages)
                  </h3>
                  <div className="w-full flex flex-wrap justify-center gap-4">
                    {analyzedKeywords.slice(0, 4).map((item, idx) => (
                      <div
                        key={idx}
                        className="flex-1 min-w-[250px] max-w-[320px] bg-orange-950/30 border border-orange-500/30 p-4 rounded-xl text-sm shadow-sm flex flex-col items-center text-center"
                      >
                        <p
                          className="font-bold text-[#ff6600] truncate w-full"
                          title={item.url}
                        >
                          {item.url}
                        </p>
                        <p className="text-slate-300 mt-2 font-medium">
                          Pri:{" "}
                          <span className="font-normal text-slate-400">
                            {item.keywords.primary}
                          </span>
                        </p>
                        <p className="text-slate-300 mt-1 font-medium">
                          Sec:{" "}
                          <span className="font-normal text-slate-400">
                            {item.keywords.secondary}
                          </span>
                        </p>
                        <p className="text-[10px] text-slate-500 mt-2">
                          + {item.keywords.general?.length || 0} general
                        </p>
                      </div>
                    ))}
                    {analyzedKeywords.length > 4 && (
                      <div className="flex-1 min-w-[200px] max-w-[250px] bg-navy-900 border border-navy-700 p-4 rounded-xl text-sm flex items-center justify-center font-bold text-slate-400 shadow-sm">
                        + {analyzedKeywords.length - 4} more URLs...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {drafts.length > 0 && (
              <div className="w-full flex flex-col items-center mt-2">
                <div
                  className="w-full flex flex-col sm:flex-row justify-between items-center mb-8 border-l-4 pl-4 gap-4 sm:gap-0"
                  style={{ borderColor: COLORS.primary }}
                >
                  <h2 className="text-2xl sm:text-3xl font-bold text-white text-center sm:text-left">
                    Newly Generated Posts
                  </h2>
                  <span className="text-sm font-medium text-slate-300 bg-navy-900 px-4 py-2 rounded-full border border-navy-700 shadow-sm flex items-center gap-2">
                    Current Tone:{" "}
                    <strong className="text-[#ff6600]">{selectedTone}</strong>
                  </span>
                </div>

                <div className="w-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 sm:gap-8">
                  {drafts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      onPublish={handlePublish}
                      onSchedule={handleSchedule}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "dashboard" && (
          <div className="w-full flex flex-col items-center">
            <div
              className="w-full flex justify-center sm:justify-start mb-8 border-l-4 pl-4"
              style={{ borderColor: COLORS.primary }}
            >
              <h2 className="text-2xl sm:text-3xl font-bold text-white text-center sm:text-left">
                Published Posts Archive (Locked)
              </h2>
            </div>

            {published.length === 0 ? (
              <div className="w-full max-w-3xl glass-card rounded-2xl p-16 text-center border border-navy-800 flex flex-col items-center justify-center">
                <Lock className="w-20 h-20 text-slate-600 mb-6" />
                <h3 className="text-2xl font-bold text-slate-500">
                  No posts have been published yet.
                </h3>
                <p className="text-slate-500 mt-3 text-lg">
                  Go to the Generator tab to create and publish new content.
                </p>
              </div>
            ) : (
              <div className="w-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 sm:gap-8">
                {published.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onRewrite={handleRewrite}
                    isLocked
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "scheduled" && (
          <div className="w-full flex flex-col items-center">
            <div
              className="w-full flex justify-center sm:justify-start mb-8 border-l-4 pl-4"
              style={{ borderColor: COLORS.primary }}
            >
              <h2 className="text-2xl sm:text-3xl font-bold text-white text-center sm:text-left">
                Scheduled Posts
              </h2>
            </div>

            {scheduled.length === 0 ? (
              <div className="w-full max-w-3xl glass-card rounded-2xl p-16 text-center border border-navy-800 flex flex-col items-center justify-center">
                <CalendarClock className="w-20 h-20 text-slate-600 mb-6" />
                <h3 className="text-2xl font-bold text-slate-500">
                  No posts are currently scheduled.
                </h3>
              </div>
            ) : (
              <div className="w-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 sm:gap-8">
                {scheduled.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onPublish={handlePublish}
                    isScheduled
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function PostCard({
  post,
  onPublish,
  onSchedule,
  onRewrite,
  isLocked = false,
  isScheduled = false,
}: {
  post: StudioPostRecord;
  onPublish?: (id: string) => void;
  onSchedule?: (id: string, date: string) => void;
  onRewrite?: (id: string) => void;
  isLocked?: boolean;
  isScheduled?: boolean;
}) {
  const [scheduleDate, setScheduleDate] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);

  const platformHint =
    post.platform === "Instagram"
      ? "No links in caption · hashtags OK · Link in bio"
      : post.platform === "GMB"
        ? "No URLs · no hashtags · keywords in prose"
        : post.platform === "LinkedIn"
          ? "Links OK · light hashtags · professional"
          : "Links OK · hashtags OK";

  return (
    <div
      className={`w-full flex flex-col glass-card rounded-2xl overflow-hidden border ${
        isLocked
          ? "border-navy-700 opacity-95"
          : "border-navy-800 hover:border-orange-500/40 hover:shadow-xl"
      } transition-all duration-300 group`}
    >
      <div className="w-full px-5 py-4 border-b border-navy-700 flex flex-wrap justify-between items-center bg-navy-900/60 gap-2">
        <div className="flex items-center gap-2">
          {getPlatformIcon(post.platform)}
          <span className="font-bold text-white tracking-tight">{post.platform}</span>
          <span className="ml-2 px-2.5 py-1 bg-navy-800 text-slate-400 rounded-md text-[10px] uppercase font-bold tracking-widest border border-navy-600">
            {post.tone}
          </span>
        </div>
        {isLocked && (
          <span className="bg-emerald-950/60 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ml-auto">
            <Lock className="w-3.5 h-3.5" /> Locked
          </span>
        )}
        {isScheduled && post.scheduledDate && (
          <span className="bg-sky-950/60 text-sky-300 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ml-auto text-center">
            <Clock className="w-3.5 h-3.5 flex-shrink-0" />{" "}
            {new Date(post.scheduledDate).toLocaleString("en-US")}
          </span>
        )}
      </div>

      <div className="w-full aspect-[16/9] relative bg-navy-900 overflow-hidden">
        {post.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.image}
            alt={post.heading}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600">
            No image
          </div>
        )}
        <div className="absolute top-3 right-3 bg-black/60 text-white text-xs px-2.5 py-1.5 rounded-md backdrop-blur-md shadow-lg flex items-center font-medium">
          <ImageIcon className="w-3.5 h-3.5 mr-1.5" />
          {post.platform === "Instagram"
            ? "1080×1080"
            : post.platform === "GMB"
              ? "1024×576"
              : post.platform === "LinkedIn"
                ? "1200×627"
                : "1200×630"}
        </div>
      </div>

      <div className="w-full p-5 sm:p-6 flex flex-col flex-grow">
        <h3 className="text-xl font-bold mb-2 text-white leading-snug">{post.heading}</h3>
        <p className="text-[10px] text-slate-500 mb-3">{platformHint}</p>

        <div
          className="text-slate-300 whitespace-pre-wrap text-sm sm:text-base leading-relaxed mb-6 flex-grow [&_a]:text-[#ff6600] [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: post.contentHtml || post.content }}
        />

        <div className="w-full flex flex-wrap gap-2 mb-6">
          <span
            className="bg-orange-950/40 text-[#ff6600] px-3 py-1.5 rounded-lg text-xs font-semibold border border-orange-500/30 shadow-sm flex-1 text-center truncate"
            title={post.keywords.primary}
          >
            P: {post.keywords.primary}
          </span>
          <span
            className="bg-sky-950/40 text-sky-300 px-3 py-1.5 rounded-lg text-xs font-semibold border border-sky-500/30 shadow-sm flex-1 text-center truncate"
            title={post.keywords.secondary}
          >
            S: {post.keywords.secondary}
          </span>
        </div>

        <p className="text-[10px] text-slate-500 mb-4 truncate" title={post.url}>
          Source: {post.url}
        </p>

        <div className="w-full pt-5 border-t border-navy-700 flex flex-wrap justify-between gap-3 relative mt-auto">
          {!isLocked ? (
            <>
              <div className="relative flex-1">
                {showDatePicker && onSchedule && (
                  <div className="absolute bottom-[110%] left-0 bg-navy-900 p-5 rounded-2xl shadow-2xl border border-navy-600 z-20 w-[280px]">
                    <label className="block text-sm font-bold text-slate-200 mb-3 text-center">
                      Select Date &amp; Time
                    </label>
                    <input
                      type="datetime-local"
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="w-full border border-navy-600 rounded-xl p-3 text-sm mb-4 focus:ring-4 focus:ring-sky-500/20 focus:border-sky-500 outline-none transition-all bg-navy-950 text-slate-200"
                    />
                    <div className="w-full flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          onSchedule(post.id, scheduleDate);
                          setShowDatePicker(false);
                        }}
                        className="flex-1 bg-sky-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-sky-700 transition-colors shadow-md"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDatePicker(false)}
                        className="flex-1 bg-navy-800 text-slate-300 py-2.5 rounded-xl text-sm font-bold hover:bg-navy-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {onSchedule && (
                  <button
                    type="button"
                    onClick={() => setShowDatePicker(!showDatePicker)}
                    className="w-full px-4 py-3 text-sky-300 font-bold rounded-xl bg-sky-950/40 hover:bg-sky-950/70 transition-all flex items-center justify-center gap-2 border border-sky-800/50"
                  >
                    <Calendar className="w-4 h-4" />
                    Schedule
                  </button>
                )}
              </div>

              {onPublish && (
                <button
                  type="button"
                  onClick={() => onPublish(post.id)}
                  style={{ backgroundColor: COLORS.primary }}
                  className="flex-1 px-4 py-3 text-white font-bold rounded-xl hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
                >
                  <PlusCircle className="w-5 h-5" />
                  Publish Now
                </button>
              )}
            </>
          ) : (
            onRewrite && (
              <button
                type="button"
                onClick={() => onRewrite(post.id)}
                style={{ color: "#93c5fd", borderColor: COLORS.secondary }}
                className="w-full px-6 py-3 font-bold rounded-xl border-2 border-navy-600 hover:bg-navy-900 transition-all flex items-center justify-center gap-2 text-slate-200"
              >
                <RefreshCw className="w-5 h-5" />
                Rewrite &amp; Reuse Template
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
