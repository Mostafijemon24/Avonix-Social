"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { getCreditCost, canAffordUsage, type CreditAction } from "@/lib/credits";

export function useCreditAction(action: CreditAction) {
  const { state } = useWorkspace();
  const { showToast } = useToast();
  const router = useRouter();
  const cost = getCreditCost(action);

  const canAfford = canAffordUsage(state, cost);

  const requireCredits = (): boolean => {
    if (!canAfford) {
      showToast(
        `Insufficient balance! Need ~${cost} credits or wallet top-up. You have ${state.credits} credits and $${(state.walletBalanceUsd ?? 0).toFixed(2)} wallet.`,
        "error"
      );
      router.push("/dashboard/billing");
      return false;
    }
    return true;
  };

  return { canAfford, cost, credits: state.credits, requireCredits };
}
