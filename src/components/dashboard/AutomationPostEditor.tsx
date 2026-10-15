"use client";

/**
 * Rich editor drawer for a single sheet-generated post.
 * Lets the user SEE and EDIT the generated text + image immediately:
 *  - edit heading/content and Save (keeps the sheet fingerprint → re-sync safe)
 *  - generate / regenerate / remove the image
 *  - reschedule or publish
 *
 * Note: we intentionally do NOT expose "rewrite" here because that rotates the
 * post fingerprint and would make the next sheet sync create a duplicate.
 */
import { useEffect, useState } from "react";
import { X, ImagePlus, RefreshCw, Trash2, Save, Send, CalendarClock, Sparkles } from "lucide-react";
import { api, isApiError, type StudioPostRecord } from "@/lib/api-client";

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type ImageSource = "ai" | "free";

type Props = {
  post: StudioPostRecord;
  email: string;
  onClose: () => void;
  onChanged: () => void;
  showToast: (msg: string, kind?: "success" | "error" | "info") => void;
};

export default function AutomationPostEditor({ post, email, onClose, onChanged, showToast }: Props) {
  const [heading, setHeading] = useState(post.heading || "");
  const [content, setContent] = useState(post.content || "");
  const [imageSource, setImageSource] = useState<ImageSource>("ai");
  const [busy, setBusy] = useState<string | null>(null);
  const [when, setWhen] = useState(() => toLocalInput(post.scheduledDate || post.sheet?.plannedScheduleAt));

  // Re-sync local fields whenever the post is re-fetched after a server write
  // (keyed on updatedAt so we never clobber the user mid-typing).
  useEffect(() => {
    setHeading(post.heading || "");
    setContent(post.content || "");
    setWhen(toLocalInput(post.scheduledDate || post.sheet?.plannedScheduleAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id, post.updatedAt]);

  const dirty = heading !== (post.heading || "") || content !== (post.content || "");

  const run = async (tag: string, fn: () => Promise<void>, refresh = true) => {
    setBusy(tag);
    try {
      await fn();
      if (refresh) onChanged();
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const published = post.status === "published";
  const generated = post.sheet ? post.sheet.generated : !!post.content;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="h-full w-full max-w-lg overflow-y-auto bg-[color:var(--color-navy-900)] border-l border-line p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label-caps text-dim">Edit post</p>
            <p className="text-[11px] text-muted mt-1">
              {post.platform} · <span className="capitalize">{post.status}</span>
              {post.scheduledDate ? ` · ${new Date(post.scheduledDate).toLocaleString()}` : ""}
            </p>
          </div>
          <button type="button" className="btn-ghost p-2" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Generate full post (content + optional image) via AI */}
        {!published && (
          <button
            type="button"
            disabled={!!busy}
            className="btn-primary w-full mt-4 inline-flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            onClick={() =>
              run("gen", async () => {
                const res = await api.generateSheetPosts({ email, postId: post.id });
                const failed = res.outcomes?.some((o) => o.outcome === "generation_failed");
                showToast(failed ? "Generation failed" : generated ? "Post regenerated" : "Post generated", failed ? "error" : "success");
              })
            }
          >
            {busy === "gen" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {busy === "gen" ? "Generating…" : generated ? "Regenerate with AI" : "Generate with AI"}
          </button>
        )}

        {/* Image */}
        <div className="mt-4">
          <label className="label-caps text-dim">Image</label>
          <div className="mt-1 rounded-xl border border-line bg-[color:var(--color-card)] p-3">
            {post.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.image}
                alt={post.heading}
                className="w-full rounded-lg object-cover max-h-60"
              />
            ) : (
              <p className="text-[12px] text-dim py-6 text-center">No image yet.</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <select
                className="input-field text-[11px] py-1 w-auto"
                value={imageSource}
                onChange={(e) => setImageSource(e.target.value as ImageSource)}
                disabled={!!busy || published}
              >
                <option value="ai">AI (best quality)</option>
                <option value="free">Free</option>
              </select>
              <button
                type="button"
                disabled={!!busy || published}
                className="btn-secondary text-[11px] inline-flex items-center gap-1"
                onClick={() =>
                  run("img", async () => {
                    await api.setStudioPostImage({ email, postId: post.id, action: "generate", imageSource });
                    showToast(post.image ? "Image regenerated" : "Image generated", "success");
                  })
                }
              >
                {busy === "img" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : post.image ? <RefreshCw className="w-3.5 h-3.5" /> : <ImagePlus className="w-3.5 h-3.5" />}
                {post.image ? "Regenerate" : "Generate image"}
              </button>
              {post.image && (
                <button
                  type="button"
                  disabled={!!busy || published}
                  className="btn-ghost text-[11px] inline-flex items-center gap-1 text-red-300"
                  onClick={() =>
                    run("imgclear", async () => {
                      await api.setStudioPostImage({ email, postId: post.id, action: "clear" });
                      showToast("Image removed", "success");
                    })
                  }
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              )}
            </div>
            <p className="text-[10px] text-dim mt-1">
              Image only generates on demand here (regardless of the sheet&apos;s Generate_Image flag).
            </p>
          </div>
        </div>

        {/* Heading */}
        <div className="mt-4">
          <label className="label-caps text-dim">Title</label>
          <input
            className="input-field mt-1 w-full"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
            disabled={published}
          />
        </div>

        {/* Content */}
        <div className="mt-3">
          <label className="label-caps text-dim">Post content</label>
          <textarea
            className="input-field mt-1 w-full min-h-[220px] leading-relaxed"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={published}
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-dim">
              {content.trim() ? content.trim().split(/\s+/).length : 0} words · {content.length} chars
            </span>
            <button
              type="button"
              disabled={!!busy || !dirty || published}
              className="btn-primary text-[11px] inline-flex items-center gap-1 disabled:opacity-50"
              onClick={() =>
                run("save", async () => {
                  await api.updateStudioPostContent({ email, postId: post.id, content, heading });
                  showToast("Saved", "success");
                })
              }
            >
              {busy === "save" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save changes
            </button>
          </div>
        </div>

        {/* Schedule + publish */}
        <div className="mt-5 border-t border-line pt-4 space-y-2">
          <label className="label-caps text-dim inline-flex items-center gap-1">
            <CalendarClock className="w-3.5 h-3.5" /> Schedule
          </label>
          <input
            type="datetime-local"
            className="input-field w-full"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            disabled={published}
          />
          <p className="text-[10px] text-dim">
            Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!!busy || !when || published}
              className="btn-secondary text-[11px]"
              onClick={() =>
                run("sched", async () => {
                  await api.scheduleStudioPost({ email, postId: post.id, scheduledAt: new Date(when).toISOString() });
                  showToast("Rescheduled", "success");
                })
              }
            >
              Reschedule
            </button>
            <button
              type="button"
              disabled={!!busy || published}
              className="btn-primary text-[11px] inline-flex items-center gap-1"
              onClick={() =>
                run("pub", async () => {
                  await api.publishStudioPost({ email, postId: post.id, alsoLive: true });
                  showToast("Published", "success");
                })
              }
            >
              <Send className="w-3.5 h-3.5" /> Publish now
            </button>
          </div>
          {published && (
            <p className="text-[11px] text-emerald-300">This post is published and locked.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
