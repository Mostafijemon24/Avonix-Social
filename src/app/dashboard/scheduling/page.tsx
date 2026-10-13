"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useToast } from "@/components/ui/Toast";
import { api, type StudioPostRecord } from "@/lib/api-client";
import PostDetailsDrawer from "@/components/dashboard/PostDetailsDrawer";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function startOfWeek(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function SchedulingPage() {
  const { state } = useWorkspace();
  const { showToast } = useToast();
  const [posts, setPosts] = useState<StudioPostRecord[]>([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [detail, setDetail] = useState<StudioPostRecord | null>(null);

  const load = useCallback(async () => {
    if (!state.email) return;
    try {
      const data = await api.listStudioPosts(state.email, state.activeWorkspaceId || undefined);
      setPosts((data.posts || []).filter((p) => p.status === "scheduled" && p.scheduledDate));
    } catch {
      setPosts([]);
    }
  }, [state.email, state.activeWorkspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const weekDays = useMemo(() => DAYS.map((label, i) => ({ label, date: addDays(weekStart, i) })), [weekStart]);
  const weekEnd = addDays(weekStart, 7);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const byDay = useMemo(() => {
    return weekDays.map((day) => ({
      ...day,
      posts: posts.filter((p) => p.scheduledDate && sameDay(new Date(p.scheduledDate), day.date)),
    }));
  }, [posts, weekDays]);

  const upcoming = useMemo(() => {
    return [...posts]
      .sort((a, b) => new Date(a.scheduledDate || 0).getTime() - new Date(b.scheduledDate || 0).getTime())
      .filter((p) => new Date(p.scheduledDate || 0).getTime() >= Date.now());
  }, [posts]);

  return (
    <div className="space-y-5 max-w-6xl mx-auto animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">Scheduling</h1>
          <p className="text-xs text-[color:var(--color-text-muted)] mt-1">
            Weekly queue using existing scheduled posts. Timezone: {tz}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost p-2 min-h-[44px]"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            aria-label="Previous week"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <p className="text-[12px] font-bold text-ink min-w-[160px] text-center">
            {weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
            {addDays(weekStart, 6).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </p>
          <button
            type="button"
            className="btn-ghost p-2 min-h-[44px]"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            aria-label="Next week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button type="button" className="btn-secondary text-[11px]" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            This week
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 min-[900px]:grid-cols-2 min-[1120px]:grid-cols-7 gap-2">
        {byDay.map((day) => (
          <div key={day.label} className="glass-card rounded-xl p-2 min-h-[120px] min-[1120px]:min-h-[180px] min-w-0">
            <p className="label-caps text-dim">{day.label}</p>
            <p className="text-[11px] text-muted mb-2">{day.date.getDate()}</p>
            <div className="space-y-1.5">
              {day.posts.length === 0 ? (
                <p className="text-[11px] text-dim">No scheduled posts</p>
              ) : (
                day.posts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDetail(p)}
                    className="w-full text-left rounded-lg border border-line bg-[color:var(--color-card-inner)] px-2 py-1.5 hover:border-orange-500/40 min-h-[44px]"
                  >
                    <p className="text-[10px] font-bold text-orange-400">{p.platform}</p>
                    <p className="text-[11px] text-ink font-semibold line-clamp-2">{p.heading}</p>
                    <p className="text-[10px] text-muted mt-0.5">
                      {new Date(p.scheduledDate || "").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
                      {p.status}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-dim">
          Nothing is scheduled this week.{" "}
          <Link href="/dashboard/social-post" className="text-orange-400 font-bold">
            Generate in Content Studio
          </Link>
        </p>
      ) : (
        <section>
            <h2 className="text-sm font-bold text-ink mb-2">Upcoming</h2>
            {upcoming.length === 0 ? (
              <p className="text-xs text-dim">Nothing remaining after {weekEnd.toLocaleDateString()}.</p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="w-full text-left glass-card rounded-xl px-4 py-3"
                      onClick={() => setDetail(p)}
                    >
                      <p className="text-sm font-bold text-ink">{p.heading}</p>
                      <p className="text-[11px] text-muted mt-1">
                        {p.platform} · {p.scheduledDate ? new Date(p.scheduledDate).toLocaleString() : "—"} · {p.status}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>
      )}

      {detail && state.email && (
        <PostDetailsDrawer
          post={detail}
          email={state.email}
          onClose={() => setDetail(null)}
          onChanged={() => {
            load();
            setDetail(null);
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}
