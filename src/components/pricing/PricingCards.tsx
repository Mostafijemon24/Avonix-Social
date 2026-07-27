"use client";

import { PRICING_PLANS } from "@/lib/constants";

export function PricingCards({
  onSelectPlan,
  activePlan,
}: {
  onSelectPlan?: (name: string, price: number, id: string) => void;
  activePlan?: string;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {PRICING_PLANS.map((plan) => (
        <div
          key={plan.id}
          className={`glass-card p-6 rounded-2xl text-center flex flex-col justify-between ${
            plan.recommended
              ? "border-2 border-orange-500 bg-orange-950/20 relative shadow-xl shadow-orange-500/10"
              : "border border-navy-800"
          }`}
        >
          {plan.recommended && (
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-[10px] font-black uppercase tracking-wider px-3 py-0.5 rounded-full">
              Recommended
            </span>
          )}
          <div>
            <h3 className="font-bold text-white text-sm">{plan.name}</h3>
            <p
              className={`text-3xl font-black my-3 ${
                plan.recommended ? "text-orange-500" : "text-white"
              }`}
            >
              ${plan.price}{" "}
              <span className="text-xs text-slate-500 font-normal">/ month</span>
            </p>
            <p className="text-xs text-slate-400 mb-4">{plan.description}</p>
          </div>
          {activePlan === plan.name ? (
            <button
              type="button"
              disabled
              className="w-full bg-navy-800 text-slate-500 font-bold text-xs py-2.5 rounded-xl cursor-not-allowed"
            >
              Active Plan
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSelectPlan?.(plan.name, plan.price, plan.id)}
              className={`w-full font-bold text-xs py-3 rounded-xl transition-all ${
                plan.recommended
                  ? "bg-orange-500 hover:bg-orange-600 text-white shadow-lg"
                  : "bg-navy-800 hover:bg-navy-700 text-white border border-navy-700"
              }`}
            >
              {plan.cta}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
