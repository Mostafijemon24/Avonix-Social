"use client";

import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { getPlanCredits, type PlanId } from "@/lib/credits";

export function PaymentModal({
  open,
  planTitle,
  planId,
  onClose,
}: {
  open: boolean;
  planTitle: string;
  planId: PlanId;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const { subscribeToPlan } = useWorkspace();
  const plan = getPlanCredits(planId);

  if (!open) return null;

  const processPayment = async (method: string) => {
    try {
      await subscribeToPlan(planId, method);
      onClose();
      showToast(
        `Payment via ${method} successful! ${plan.initialCredits} credits activated (${plan.name}).`,
        "success"
      );
    } catch {
      showToast("Payment processing failed. Please try again.", "error");
    }
  };

  return (
    <div className="fixed inset-0 bg-navy-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass-card bg-navy-900 rounded-3xl max-w-md w-full p-6 border border-navy-800 shadow-2xl relative text-center sm:text-left">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white font-bold p-1"
          aria-label="Close"
        >
          ✕
        </button>
        <h3 className="text-base font-bold text-white mb-1">Complete Plan Payment</h3>
        <p className="text-xs text-slate-400 mb-2">{planTitle}</p>
        <p className="text-xs text-orange-400 font-bold mb-6">
          You will receive {plan.initialCredits} credits on activation.
        </p>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => processPayment("PayPal")}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold p-3.5 rounded-2xl flex items-center justify-between shadow-md transition-all"
          >
            <span className="text-xs">PayPal Checkout</span>
            <span className="text-[10px] bg-blue-900/80 px-2 py-0.5 rounded font-extrabold">
              SECURE
            </span>
          </button>
          <button
            type="button"
            onClick={() => processPayment("Stripe")}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold p-3.5 rounded-2xl flex items-center justify-between shadow-md transition-all"
          >
            <span className="text-xs">Credit Card (Stripe)</span>
            <span className="text-[10px] bg-indigo-900/80 px-2 py-0.5 rounded font-extrabold">
              VISA / MC / AMEX
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
