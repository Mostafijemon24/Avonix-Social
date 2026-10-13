"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { api, isApiError, type StudioPostRecord } from "@/lib/api-client";

type Props = {
  post: StudioPostRecord;
  email: string;
  onClose: () => void;
  onChanged: () => void;
          showToast: (msg: string, kind?: "success" | "error" | "info") => void;
};

export default function PostDetailsDrawer({ post, email, onClose, onChanged, showToast }: Props) {
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState(() => {
    if (!post.scheduledDate) return "";
    const d = new Date(post.scheduledDate);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <aside
        className="h-full w-full max-w-md overflow-y-auto bg-[color:var(--color-navy-900)] border-l border-line p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label-caps text-dim">Post details</p>
            <h3 className="text-base font-extrabold text-ink mt-1">{post.heading}</h3>
          </div>
          <button type="button" className="btn-ghost p-2" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-[12px]">
          <p>
            <span className="text-dim">Platform</span>{" "}
            <span className="font-bold text-ink">{post.platform}</span>
          </p>
          <p>
            <span className="text-dim">Status</span>{" "}
            <span className="status-pill status-pill-muted capitalize">{post.archived ? "archived" : post.status}</span>
          </p>
          {post.gmbCategory && (
            <p>
              <span className="text-dim">Content type</span>{" "}
              <span className="text-ink">{post.gmbCategory}</span>
            </p>
          )}
          {post.cta && (
            <p>
              <span className="text-dim">CTA</span>{" "}
              <span className="font-bold text-orange-400">CTA · {post.cta}</span>
            </p>
          )}
          <p>
            <span className="text-dim">Source page</span>{" "}
            <span className="text-ink">{post.sourceTitle || post.heading}</span>
          </p>
          {post.url && (
            <p className="break-all">
              <span className="text-dim">Source URL</span>{" "}
              <a href={post.url} target="_blank" rel="noreferrer" className="font-mono text-orange-400">
                {post.url}
              </a>
            </p>
          )}
          {post.scheduledDate && (
            <p>
              <span className="text-dim">Scheduled</span>{" "}
              <span className="text-ink">{new Date(post.scheduledDate).toLocaleString()}</span>
            </p>
          )}
          {post.publishedAt && (
            <p>
              <span className="text-dim">Published</span>{" "}
              <span className="text-ink">{new Date(post.publishedAt).toLocaleString()}</span>
            </p>
          )}
          {post.ruleset && (
            <p>
              <span className="text-dim">Ruleset</span>{" "}
              <span className="font-mono text-muted">{post.ruleset}</span>
            </p>
          )}
          <p className="text-muted whitespace-pre-wrap leading-relaxed border border-line rounded-xl p-3 bg-[color:var(--color-card)]">
            {post.content}
          </p>
        </div>

        <div className="mt-5 space-y-2">
          <label className="label-caps text-dim">Reschedule</label>
          <input
            type="datetime-local"
            className="input-field w-full"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
          <p className="text-[10px] text-dim">Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !when}
              className="btn-secondary text-[11px]"
              onClick={() =>
                run(async () => {
                  await api.scheduleStudioPost({
                    email,
                    postId: post.id,
                    scheduledAt: new Date(when).toISOString(),
                  });
                  showToast("Rescheduled", "success");
                })
              }
            >
              Reschedule
            </button>
            <button
              type="button"
              disabled={busy || post.status === "published"}
              className="btn-primary text-[11px]"
              onClick={() =>
                run(async () => {
                  await api.publishStudioPost({ email, postId: post.id, alsoLive: true });
                  showToast("Published", "success");
                })
              }
            >
              Publish
            </button>
            <button
              type="button"
              disabled={busy}
              className="btn-ghost text-[11px]"
              onClick={() =>
                run(async () => {
                  await api.rewriteStudioPost({ email, postId: post.id });
                  showToast("Regenerated", "success");
                })
              }
            >
              Regenerate
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
