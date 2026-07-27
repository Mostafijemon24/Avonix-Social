"use client";

import { CREDIT_COSTS, CREDIT_ACTION_LABELS, type CreditAction } from "@/lib/credits";

export function CreditCostBadge({ action }: { action: CreditAction }) {
  const cost = CREDIT_COSTS[action];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-400 bg-orange-950/50 border border-orange-800/50 px-2 py-0.5 rounded-full">
      {cost} credit{cost !== 1 ? "s" : ""} — {CREDIT_ACTION_LABELS[action]}
    </span>
  );
}

export function InsufficientCreditsBanner({
  required,
  available,
}: {
  required: number;
  available: number;
}) {
  return (
    <div className="bg-red-950/30 border border-red-500/40 rounded-xl p-4 text-xs text-red-300">
      <strong className="text-red-400 block mb-1">Insufficient Credits</strong>
      This action requires <strong>{required}</strong> credits but you only have{" "}
      <strong>{available}</strong>. Upgrade your plan or top up from Plan & Price.
    </div>
  );
}
