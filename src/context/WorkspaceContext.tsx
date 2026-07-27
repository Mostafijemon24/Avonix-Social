"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type ApiUserState, isApiError } from "@/lib/api-client";
import { PLAN_CONFIG, type PlanId } from "@/lib/credits";
import type { SitemapData, WorkspaceState } from "@/lib/types";

const STORAGE_KEY = "avonix-social-email";

function toWorkspaceState(apiState: ApiUserState, sitemap: SitemapData | null): WorkspaceState {
  return {
    email: apiState.email,
    planId: (apiState.planId as PlanId) || "free",
    credits: apiState.credits,
    creditLimit: apiState.creditLimit,
    unlimitedCredits: !!apiState.unlimitedCredits,
    walletBalanceUsd: apiState.walletBalanceUsd ?? 0,
    accountStatus: apiState.accountStatus,
    emailVerified: !!apiState.emailVerified,
    phoneVerified: !!apiState.phoneVerified,
    cardOnFile: !!apiState.cardOnFile,
    cardLast4: apiState.cardLast4,
    fullyVerified: !!apiState.fullyVerified,
    usage: apiState.usage,
    sitemap,
    transactions: apiState.transactions.map((t) => ({
      id: t.id,
      type: t.type as "debit" | "credit",
      amount: t.amount,
      label: t.label,
      balanceAfter: 0,
      timestamp: t.timestamp,
    })),
    loggedIn: true,
  };
}

const defaultState: WorkspaceState = {
  email: "",
  planId: "free",
  credits: 0,
  creditLimit: 10,
  usage: { scrapedPages: 0, uniquePosts: 0, aiImages: 0, gbpReplies: 0 },
  sitemap: null,
  transactions: [],
  loggedIn: false,
};

type WorkspaceContextValue = {
  state: WorkspaceState;
  apiOnline: boolean;
  establishSession: (email: string) => Promise<void>;
  logout: () => void;
  refreshState: () => Promise<void>;
  subscribeToPlan: (planId: PlanId, gateway: string) => Promise<void>;
  setSitemapData: (data: SitemapData) => void;
  applyApiCredits: (creditsLeft: number) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkspaceState>(defaultState);
  const [apiOnline, setApiOnline] = useState(true);

  const refreshState = useCallback(async () => {
    const email = state.email || localStorage.getItem(STORAGE_KEY);
    if (!email) return;

    const apiState = await api.getCredits(email);
    if (!apiState.fullyVerified) {
      localStorage.removeItem(STORAGE_KEY);
      setState(defaultState);
      throw new Error("Verification required");
    }
    setApiOnline(true);
    setState((prev) => toWorkspaceState(apiState, prev.sitemap));
  }, [state.email]);

  useEffect(() => {
    const savedEmail = localStorage.getItem(STORAGE_KEY);
    if (!savedEmail) return;

    api
      .getCredits(savedEmail)
      .then((apiState) => {
        if (!apiState.fullyVerified) {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        setApiOnline(true);
        setState(toWorkspaceState(apiState, null));
      })
      .catch(() => {
        localStorage.removeItem(STORAGE_KEY);
        setApiOnline(false);
      });
  }, []);

  const establishSession = useCallback(async (email: string) => {
    const normalized = email.trim().toLowerCase();
    const { user } = await api.login(normalized);
    if (!user.fullyVerified) {
      throw new Error("Account not fully verified");
    }
    localStorage.setItem(STORAGE_KEY, normalized);
    setApiOnline(true);
    setState(toWorkspaceState(user, null));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(defaultState);
  }, []);

  const subscribeToPlan = useCallback(
    async (planId: PlanId, gateway: string) => {
      if (!state.email) return;
      try {
        const result = await api.subscribe({
          email: state.email,
          plan: planId,
          gateway,
        });
        setApiOnline(true);
        setState((prev) => toWorkspaceState(result.user, prev.sitemap));
      } catch (err) {
        if (isApiError(err)) throw err;
        throw new Error("Subscription failed");
      }
    },
    [state.email]
  );

  const setSitemapData = useCallback((data: SitemapData) => {
    setState((prev) => ({ ...prev, sitemap: data }));
  }, []);

  const applyApiCredits = useCallback((creditsLeft: number) => {
    setState((prev) => ({ ...prev, credits: creditsLeft }));
  }, []);

  const value = useMemo(
    () => ({
      state,
      apiOnline,
      establishSession,
      logout,
      refreshState,
      subscribeToPlan,
      setSitemapData,
      applyApiCredits,
    }),
    [
      state,
      apiOnline,
      establishSession,
      logout,
      refreshState,
      subscribeToPlan,
      setSitemapData,
      applyApiCredits,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export { PLAN_CONFIG };
