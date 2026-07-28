"use client";

import { useEffect, useState } from "react";
import { PricingCards } from "@/components/pricing/PricingCards";
import { PaymentModal } from "@/components/payment/PaymentModal";
import { CreditUsagePanel } from "@/components/billing/CreditUsagePanel";
import { useWorkspace, PLAN_CONFIG } from "@/context/WorkspaceContext";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api-client";
import type { PlanId } from "@/lib/credits";

export default function BillingPage() {
  const { state, refreshState } = useWorkspace();
  const { showToast } = useToast();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<{
    id: PlanId;
    name: string;
    price: number;
  } | null>(null);
  const [amount, setAmount] = useState("25");
  const [wallet, setWallet] = useState<number>(state.walletBalanceUsd || 0);
  const [txns, setTxns] = useState<
    Array<{ id: string; type: string; amountUsd: number; balanceAfter: number; createdAt: string }>
  >([]);

  const activePlanName = PLAN_CONFIG[state.planId].name;
  const frozen = state.accountStatus === "frozen";

  const loadWallet = async () => {
    if (!state.email) return;
    try {
      const w = await api.getWallet(state.email);
      setWallet(w.walletBalanceUsd);
      setTxns(w.transactions || []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.email]);

  const topUp = async (gateway: string) => {
    if (!state.email) return;
    try {
      const result = await api.topUp({
        email: state.email,
        amountUsd: Number(amount),
        gateway,
      });
      setWallet(result.walletBalanceUsd);
      await refreshState();
      await loadWallet();
      showToast(result.message || "Top-up successful", "success");
    } catch (err: unknown) {
      showToast(
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Top-up failed",
        "error"
      );
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      {frozen && (
        <div className="bg-red-950/50 border border-red-500/40 text-red-200 text-xs p-4 rounded-2xl">
          Subscription frozen — wallet empty. Top up below to reactivate. Notifications were sent
          to your email / WhatsApp / Telegram.
        </div>
      )}

      <CreditUsagePanel />

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h2 className="text-base font-bold text-white mb-1">Wallet Balance (USD)</h2>
        <p className="text-xs text-slate-400 mb-4">
          Custom top-up via Stripe/PayPal. Usage auto-debits this balance. Plan freezes at $0.
        </p>
        <p className="text-3xl font-black text-orange-500 mb-4">${wallet.toFixed(2)}</p>
        {state.cardOnFile && (
          <p className="text-[10px] text-slate-500 mb-4">
            Card on file: {state.cardBrand || "card"} ···· {state.cardLast4}
          </p>
        )}
        <div className="flex flex-wrap gap-3 items-end text-xs max-w-md">
          <div className="flex-1">
            <label className="block text-slate-500 font-bold mb-1">Custom amount (USD)</label>
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white"
            />
          </div>
          <button
            type="button"
            onClick={() => topUp("stripe")}
            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 py-3 rounded-xl"
          >
            Top-Up Stripe
          </button>
          <button
            type="button"
            onClick={() => topUp("paypal")}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-4 py-3 rounded-xl"
          >
            Top-Up PayPal
          </button>
        </div>

        {txns.length > 0 && (
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-navy-800">
                  <th className="text-left py-2">Type</th>
                  <th className="text-left py-2">Amount</th>
                  <th className="text-left py-2">Balance</th>
                  <th className="text-left py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {txns.slice(0, 10).map((t) => (
                  <tr key={t.id} className="border-b border-navy-800/50 text-slate-300">
                    <td className="py-2 capitalize">{t.type.replace("_", " ")}</td>
                    <td className={`py-2 font-bold ${t.amountUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {t.amountUsd >= 0 ? "+" : ""}
                      ${t.amountUsd.toFixed(4)}
                    </td>
                    <td className="py-2">${t.balanceAfter.toFixed(2)}</td>
                    <td className="py-2">{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h2 className="text-base font-bold text-white mb-1">Service Plans</h2>
        <p className="text-xs text-slate-400 mb-6">
          Email verification and a valid card are required before joining any plan
          (including Free Trial).
        </p>

        <PricingCards
          activePlan={activePlanName}
          onSelectPlan={(name, price, id) => {
            setSelectedPlan({ id: id as PlanId, name, price });
            setPaymentOpen(true);
          }}
        />
      </div>

      {selectedPlan && (
        <PaymentModal
          open={paymentOpen}
          planId={selectedPlan.id}
          planTitle={`${selectedPlan.name} Subscription - $${selectedPlan.price}/mo`}
          onClose={() => setPaymentOpen(false)}
        />
      )}
    </div>
  );
}
