"use client";

import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { getCreditCost, type CreditAction } from "@/lib/credits";

export function useCreditAction(action: CreditAction) {
  const { state } = useWorkspace();
  const { showToast } = useToast();
  const router = useRouter();
  const cost = getCreditCost(action);

  const canAfford = state.credits >= cost;

  const requireCredits = (): boolean => {
    if (!canAfford) {
      showToast(
        `Insufficient credits! Need ~${cost}, you have ${state.credits}. Upgrade your plan.`,
        "error"
      );
      router.push("/dashboard/billing");
      return false;
    }
    return true;
  };

  return { canAfford, cost, credits: state.credits, requireCredits };
}
