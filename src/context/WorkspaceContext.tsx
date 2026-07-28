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
import { api, type ApiUserState, isApiError, setSession, clearSession, getStoredEmail, getSessionToken } from "@/lib/api-client";
import { PLAN_CONFIG, type PlanId } from "@/lib/credits";
import type {
  ClientWorkspaceSummary,
  SitemapData,
  WorkspaceState,
} from "@/lib/types";

const STORAGE_KEY = "avonix-social-email";

function toWorkspaceState(
  apiState: ApiUserState,
  sitemap: SitemapData | null,
  extras?: {
    activeWorkspaceId?: string | null;
    workspaces?: ClientWorkspaceSummary[];
    workspaceLimit?: number;
  }
): WorkspaceState {
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
    activeWorkspaceId: extras?.activeWorkspaceId ?? null,
    workspaces: extras?.workspaces ?? [],
    workspaceLimit: extras?.workspaceLimit,
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
  activeWorkspaceId: null,
  workspaces: [],
};

type WorkspaceContextValue = {
  state: WorkspaceState;
  apiOnline: boolean;
  establishSession: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshState: () => Promise<void>;
  subscribeToPlan: (planId: PlanId, gateway: string) => Promise<void>;
  setSitemapData: (data: SitemapData) => Promise<void>;
  applyApiCredits: (creditsLeft: number) => void;
  switchWorkspace: (workspaceId: string) => Promise<void>;
  createClientWorkspace: (payload: {
    name: string;
    websiteUrl?: string;
  }) => Promise<ClientWorkspaceSummary>;
  removeClientWorkspace: (workspaceId: string) => Promise<void>;
  reloadWorkspaces: () => Promise<void>;
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

  const loadWorkspacesInto = useCallback(async (email: string, apiState: ApiUserState) => {
    const ws = await api.listWorkspaces(email);
    const active =
      ws.workspaces.find((w) => w.id === ws.activeWorkspaceId) || ws.workspaces[0] || null;
    setApiOnline(true);
    setState(
      toWorkspaceState(apiState, active?.sitemap || null, {
        activeWorkspaceId: ws.activeWorkspaceId,
        workspaces: ws.workspaces,
        workspaceLimit: ws.limit,
      })
    );
  }, []);

  const refreshState = useCallback(async () => {
    const email = state.email || getStoredEmail();
    if (!email || !getSessionToken()) return;

    const apiState = await api.getCredits(email);
    if (!apiState.fullyVerified) {
      clearSession();
      setState(defaultState);
      throw new Error("Verification required");
    }
    await loadWorkspacesInto(email, apiState);
  }, [state.email, loadWorkspacesInto]);

  useEffect(() => {
    const savedEmail = getStoredEmail() || localStorage.getItem(STORAGE_KEY);
    const token = getSessionToken();
    if (!savedEmail || !token) {
      clearSession();
      return;
    }

    api
      .getCredits(savedEmail)
      .then(async (apiState) => {
        if (!apiState.fullyVerified) {
          clearSession();
          return;
        }
        await loadWorkspacesInto(savedEmail, apiState);
      })
      .catch(() => {
        clearSession();
        setApiOnline(false);
        setState(defaultState);
      });
  }, [loadWorkspacesInto]);

  const establishSession = useCallback(
    async (email: string, password: string) => {
      const normalized = email.trim().toLowerCase();
      const { user, sessionToken } = await api.login(normalized, password);
      if (!user.fullyVerified) {
        throw new Error("Account not fully verified");
      }
      if (!sessionToken) {
        throw new Error("Login succeeded but no session token returned — update backend");
      }
      setSession(normalized, sessionToken);
      await loadWorkspacesInto(normalized, user);
    },
    [loadWorkspacesInto]
  );

  const logout = useCallback(() => {
    clearSession();
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
        await loadWorkspacesInto(state.email, result.user);
      } catch (err) {
        if (isApiError(err)) throw err;
        throw new Error("Subscription failed");
      }
    },
    [state.email, loadWorkspacesInto]
  );

  const setSitemapData = useCallback(
    async (data: SitemapData) => {
      if (!state.email || !state.activeWorkspaceId) {
        setState((prev) => ({ ...prev, sitemap: data }));
        return;
      }
      const result = await api.saveWorkspaceSitemap(
        state.email,
        state.activeWorkspaceId,
        data
      );
      setState((prev) => ({
        ...prev,
        sitemap: result.workspace.sitemap,
        activeWorkspaceId: result.activeWorkspaceId,
        workspaces: (prev.workspaces || []).map((w) =>
          w.id === result.workspace.id ? result.workspace : w
        ),
      }));
    },
    [state.email, state.activeWorkspaceId]
  );

  const applyApiCredits = useCallback((creditsLeft: number) => {
    setState((prev) => ({ ...prev, credits: creditsLeft }));
  }, []);

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!state.email) return;
      const result = await api.activateWorkspace(state.email, workspaceId);
      setState((prev) => ({
        ...prev,
        activeWorkspaceId: result.activeWorkspaceId,
        sitemap: result.workspace.sitemap,
        workspaces: (prev.workspaces || []).map((w) => ({
          ...w,
          isActive: w.id === result.activeWorkspaceId,
          ...(w.id === result.workspace.id ? result.workspace : {}),
        })),
      }));
    },
    [state.email]
  );

  const createClientWorkspace = useCallback(
    async (payload: { name: string; websiteUrl?: string }) => {
      if (!state.email) throw new Error("Not logged in");
      const result = await api.createWorkspace({ email: state.email, ...payload });
      setState((prev) => ({
        ...prev,
        activeWorkspaceId: result.activeWorkspaceId,
        sitemap: result.workspace.sitemap,
        workspaces: [
          ...(prev.workspaces || []).map((w) => ({ ...w, isActive: false })),
          { ...result.workspace, isActive: true },
        ],
      }));
      return result.workspace;
    },
    [state.email]
  );

  const removeClientWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!state.email) return;
      await api.deleteWorkspace(state.email, workspaceId);
      const apiState = await api.getCredits(state.email);
      await loadWorkspacesInto(state.email, apiState);
    },
    [state.email, loadWorkspacesInto]
  );

  const reloadWorkspaces = useCallback(async () => {
    if (!state.email) return;
    const apiState = await api.getCredits(state.email);
    await loadWorkspacesInto(state.email, apiState);
  }, [state.email, loadWorkspacesInto]);

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
      switchWorkspace,
      createClientWorkspace,
      removeClientWorkspace,
      reloadWorkspaces,
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
      switchWorkspace,
      createClientWorkspace,
      removeClientWorkspace,
      reloadWorkspaces,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export { PLAN_CONFIG };
