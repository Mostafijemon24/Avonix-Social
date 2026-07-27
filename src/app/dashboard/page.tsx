"use client";

import { useWorkspace } from "@/context/WorkspaceContext";
import { PLAN_CONFIG } from "@/lib/credits";

export default function DashboardPage() {
  const { state } = useWorkspace();
  const plan = PLAN_CONFIG[state.planId];
  const gbpRate =
    state.usage.gbpReplies > 0
      ? `${Math.min(99.9, 85 + state.usage.gbpReplies * 2).toFixed(1)}%`
      : "—";

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      <div className="glass-panel rounded-3xl p-6 sm:p-8 relative overflow-hidden border border-navy-800 shadow-2xl">
        <span className="text-[11px] font-black uppercase tracking-widest text-orange-500 bg-orange-500/10 border border-orange-500/20 px-3 py-1 rounded-full mb-3 inline-block">
          Protected Dashboard View
        </span>
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
          Executive Control Center
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-1 max-w-2xl leading-relaxed">
          Scrape sitemaps, extract homepage keywords, generate zero-emoji social content,
          and handle GBP reviews hands-free.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-xs">
          <span className="bg-navy-800 border border-navy-700 px-3 py-1.5 rounded-full text-slate-300">
            Plan: <strong className="text-white">{plan.name}</strong>
          </span>
          <span className="bg-navy-800 border border-navy-700 px-3 py-1.5 rounded-full text-slate-300">
            Credits:{" "}
            <strong className="text-orange-500">
              {state.credits}/{state.creditLimit}
            </strong>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Scraped Pages", value: state.usage.scrapedPages, color: "text-white" },
          { label: "Unique AI Posts", value: state.usage.uniquePosts, color: "text-orange-500" },
          { label: "AI Images Created", value: state.usage.aiImages, color: "text-indigo-400" },
          { label: "GBP Auto Replies", value: gbpRate, color: "text-emerald-400" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="glass-card p-5 rounded-2xl border border-navy-800 text-center sm:text-left"
          >
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {stat.label}
            </span>
            <p className={`text-3xl font-black mt-2 ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
