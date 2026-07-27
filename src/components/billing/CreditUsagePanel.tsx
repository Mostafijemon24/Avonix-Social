"use client";

import Link from "next/link";
import { useWorkspace, PLAN_CONFIG } from "@/context/WorkspaceContext";
import { CREDIT_COSTS, CREDIT_ACTION_LABELS, type CreditAction } from "@/lib/credits";

export function CreditUsagePanel() {
  const { state, refreshState, apiOnline } = useWorkspace();
  const plan = PLAN_CONFIG[state.planId] ?? PLAN_CONFIG.free;
  const used = Math.max(0, state.creditLimit - state.credits);
  const pct = state.creditLimit > 0 ? Math.round((state.credits / state.creditLimit) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${apiOnline ? "bg-emerald-400" : "bg-red-400"}`}
          />
          <span className="text-slate-400">
            Database API: {apiOnline ? "Connected" : "Offline (start backend)"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => refreshState()}
          className="text-[10px] font-bold text-orange-400 hover:text-orange-300"
        >
          Refresh Balance
        </button>
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h3 className="text-sm font-bold text-white mb-4">Credit Balance (from Database)</h3>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
          <div>
            <p className="text-4xl font-black text-orange-500">
              {state.credits}
              <span className="text-lg text-slate-500 font-normal"> / {state.creditLimit}</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Plan: <strong className="text-white">{plan.name}</strong> · User: {state.email}
            </p>
          </div>
          <div className="text-right text-xs text-slate-400">
            <p>{used} credits used</p>
            <p>{pct}% remaining</p>
          </div>
        </div>
        <div className="w-full bg-navy-800 rounded-full h-2 overflow-hidden">
          <div className="bg-orange-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h3 className="text-sm font-bold text-white mb-1">Credit Rules</h3>
        <p className="text-[10px] text-slate-500 mb-4">
          AI actions: OpenRouter USD cost × margin → credits. Configure in{" "}
          <code className="text-orange-400">backend/.env</code> (
          <code className="text-orange-400">CREDITS_PER_DOLLAR=100</code>,{" "}
          <code className="text-orange-400">MARGIN_MULTIPLIER=1.3</code>)
        </p>
        <div className="space-y-2">
          <div className="flex justify-between items-center bg-navy-900 px-4 py-2.5 rounded-xl border border-navy-800 text-xs">
            <span className="text-slate-300">Sitemap Parse (fixed)</span>
            <span className="font-black text-orange-500">1 credit</span>
          </div>
          <div className="flex justify-between items-center bg-navy-900 px-4 py-2.5 rounded-xl border border-navy-800 text-xs">
            <span className="text-slate-300">AI Generate (Social, GBP, Review)</span>
            <span className="font-black text-orange-500">
              USD cost-based (min 1 credit)
            </span>
          </div>
          <div className="bg-navy-950 border border-navy-800 rounded-xl p-3 text-[10px] text-slate-500 font-mono leading-relaxed">
            credits = max(1, ceil((promptTokens×inputPrice + completionTokens×outputPrice) ×
            margin × creditsPerDollar))
          </div>
          {(Object.keys(CREDIT_COSTS) as CreditAction[]).map((action) => (
            <div
              key={action}
              className="flex justify-between items-center bg-navy-900 px-4 py-2.5 rounded-xl border border-navy-800 text-xs"
            >
              <span className="text-slate-300">{CREDIT_ACTION_LABELS[action]}</span>
              <span className="font-black text-orange-500">{CREDIT_COSTS[action]} credits (UI est.)</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h3 className="text-sm font-bold text-white mb-4">Plan Credit Limits (Packages Table)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          {Object.values(PLAN_CONFIG).map((p) => (
            <div
              key={p.id}
              className={`p-3 rounded-xl border ${
                p.id === state.planId ? "border-orange-500 bg-orange-950/20" : "border-navy-800 bg-navy-900"
              }`}
            >
              <p className="font-bold text-white">{p.name}</p>
              <p className="text-orange-500 font-black text-lg mt-1">{p.creditLimit}</p>
              <p className="text-slate-500">credits / month</p>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h3 className="text-sm font-bold text-white mb-4">Usage Logs (from Database)</h3>
        {state.transactions.length === 0 ? (
          <p className="text-xs text-slate-500">No usage logs yet.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
            {state.transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex justify-between items-center bg-navy-900 px-4 py-2.5 rounded-xl border border-navy-800 text-xs"
              >
                <div>
                  <p className="text-slate-200 font-semibold">{tx.label}</p>
                  <p className="text-slate-500 text-[10px]">{new Date(tx.timestamp).toLocaleString()}</p>
                </div>
                <p className="font-black text-red-400">-{tx.amount}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {state.credits === 0 && (
        <div className="bg-amber-950/20 border border-amber-500/30 rounded-xl p-4 text-xs text-amber-300">
          Out of credits.{" "}
          <Link href="/dashboard/billing" className="text-orange-400 font-bold underline">
            Upgrade your package
          </Link>
        </div>
      )}
    </div>
  );
}
