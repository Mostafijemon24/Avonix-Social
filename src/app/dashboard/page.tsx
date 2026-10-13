"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWorkspace } from "@/context/WorkspaceContext";
import { PLAN_CONFIG } from "@/lib/credits";
import { api, type ConnectedAccount, type StudioPostRecord } from "@/lib/api-client";

export default function DashboardPage() {
  const { state } = useWorkspace();
  const plan = PLAN_CONFIG[state.planId];
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [posts, setPosts] = useState<StudioPostRecord[]>([]);

  useEffect(() => {
    if (!state.email) return;
    api
      .getConnections(state.email, state.activeWorkspaceId || undefined)
      .then((d) => setAccounts(d.accounts || []))
      .catch(() => setAccounts([]));
    api
      .listStudioPosts(state.email, state.activeWorkspaceId || undefined)
      .then((d) => setPosts(d.posts || []))
      .catch(() => setPosts([]));
  }, [state.email, state.activeWorkspaceId]);

  const ready = accounts.filter((a) => a.publishReady).length;
  const scheduled = posts.filter((p) => p.status === "scheduled").length;
  const drafts = posts.filter((p) => p.status === "draft" && !p.locked).length;
  const attention = accounts.filter((a) => a && !a.publishReady);
  const needs = attention.length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-left">
      <div>
        <h1 className="text-2xl font-black text-ink tracking-tight">Dashboard</h1>
        <p className="text-muted text-sm mt-1">
          What is happening, what needs attention, and what is ready to publish.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="bg-navy-800 border border-navy-700 px-3 py-1.5 rounded-full text-muted">
            Plan: <strong className="text-ink">{plan.name}</strong>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Connections ready", value: `${ready} of ${accounts.length || 0}` },
          { label: "Scheduled posts", value: scheduled },
          { label: "Ready to publish", value: drafts },
          { label: "Needs attention", value: needs },
        ].map((stat) => (
          <div key={stat.label} className="glass-card p-5 rounded-2xl border border-navy-800">
            <span className="text-xs font-bold text-muted uppercase tracking-wider">
              {stat.label}
            </span>
            <p className="text-3xl font-black mt-2 text-ink">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="glass-card p-6 rounded-2xl border border-navy-800">
          <h2 className="text-sm font-bold text-ink mb-3">Needs attention</h2>
          {attention.length === 0 ? (
            <p className="text-xs text-dim">No connection issues right now.</p>
          ) : (
            <ul className="space-y-2">
              {attention.map((a) => (
                <li key={a.id} className="flex items-center justify-between text-xs">
                  <span className="text-[#d97706]">
                    P1 — {a.accountName || a.provider} needs reauthorization
                  </span>
                  <Link href="/dashboard/connections" className="text-orange-400 font-bold">
                    Fix
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="glass-card p-6 rounded-2xl border border-navy-800">
          <h2 className="text-sm font-bold text-ink mb-3">Connection readiness</h2>
          {(["facebook", "instagram", "linkedin", "google_business", "x", "pinterest"] as const).map((p) => {
            const group = accounts.filter((a) => a.provider === p);
            const ok = group.filter((a) => a.publishReady).length;
            return (
              <p key={p} className="text-xs text-muted mb-1 capitalize">
                {p.replace("_", " ")}:{" "}
                <span className="text-ink font-bold">
                  {ok}/{group.length}
                </span>
              </p>
            );
          })}
        </div>
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h2 className="text-sm font-bold text-ink mb-2">Performance analytics</h2>
        <p className="text-xs text-muted">
          Performance analytics not connected. Connect reporting to show real impressions and
          reach — invented numbers are never shown.
        </p>
        <Link
          href="/dashboard/connections"
          className="inline-block mt-3 text-xs font-bold text-orange-400"
        >
          Connect →
        </Link>
      </div>
    </div>
  );
}
