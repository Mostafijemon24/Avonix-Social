"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api, clearSession, getSessionToken, getStoredEmail } from "@/lib/api-client";

function redirectForStatus(
  router: ReturnType<typeof useRouter>,
  email: string,
  next?: string
) {
  const step = next === "verify_codes" ? "verify" : next === "add_card" ? "card" : "signin";
  router.replace(`/register?email=${encodeURIComponent(email)}&step=${step}`);
}

export function DashboardAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { state, logout, refreshState } = useWorkspace();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function guard() {
      const email = state.email || getStoredEmail();
      const token = getSessionToken();

      if (!email || !token) {
        clearSession();
        router.replace("/register?step=signin");
        return;
      }

      if (state.loggedIn && state.fullyVerified) {
        if (!cancelled) setReady(true);
        return;
      }

      try {
        const apiState = await api.getCredits(email);
        await refreshState();
        if (!apiState.fullyVerified) {
          logout();
          redirectForStatus(router, email);
          return;
        }
        if (!cancelled) setReady(true);
      } catch (err: unknown) {
        const payload =
          err && typeof err === "object"
            ? (err as { status?: number; emailVerified?: boolean; phoneVerified?: boolean })
            : {};

        if (payload.status === 403) {
          logout();
          const next =
            !payload.emailVerified || !payload.phoneVerified ? "verify_codes" : "add_card";
          redirectForStatus(router, email, next);
          return;
        }

        logout();
        router.replace("/register?step=signin");
      }
    }

    guard();
    return () => {
      cancelled = true;
    };
  }, [state.email, state.loggedIn, state.fullyVerified, router, logout, refreshState]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-navy-950 flex items-center justify-center text-slate-400 text-sm">
        Verifying account access...
      </div>
    );
  }

  return <>{children}</>;
}
