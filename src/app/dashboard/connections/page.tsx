"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link2, Unplug } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  api,
  isApiError,
  type ConnectedAccount,
  type ConnectionsSetup,
} from "@/lib/api-client";

const PLATFORMS: Array<{
  id: "facebook" | "instagram" | "google_business" | "linkedin";
  title: string;
  blurb: string;
}> = [
  {
    id: "facebook",
    title: "Facebook Page",
    blurb: "Connect a Facebook Business Page to publish social posts.",
  },
  {
    id: "instagram",
    title: "Instagram Business",
    blurb: "Requires an Instagram Business account linked to a Facebook Page.",
  },
  {
    id: "google_business",
    title: "Google Business Profile",
    blurb: "Connect GBP for local posts and review replies.",
  },
  {
    id: "linkedin",
    title: "LinkedIn Page",
    blurb: "Connect a LinkedIn Company Page for B2B posts.",
  },
];

function ConnectionsInner() {
  const { showToast } = useToast();
  const { state } = useWorkspace();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [byProvider, setByProvider] = useState<Record<string, ConnectedAccount | null>>({});
  const [setup, setSetup] = useState<ConnectionsSetup | null>(null);

  const load = useCallback(async () => {
    if (!state.email) return;
    setLoading(true);
    try {
      const data = await api.getConnections(state.email, state.activeWorkspaceId || undefined);
      setAccounts(data.accounts || []);
      setByProvider(data.byProvider || {});
      setSetup(data.setup || null);
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Failed to load connections", "error");
    } finally {
      setLoading(false);
    }
  }, [state.email, state.activeWorkspaceId, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected) {
      showToast(`${connected.replace(/_/g, " ")} connected successfully`, "success");
      load();
    }
    if (error) showToast(error, "error");
  }, [searchParams, showToast, load]);

  const connectOAuth = async (provider: string) => {
    if (!state.email) return;
    setBusy(provider);
    try {
      const result = await api.startConnectionOAuth(
        state.email,
        provider,
        state.activeWorkspaceId || undefined
      );
      if (!result.authUrl) throw new Error("No auth URL returned");
      window.location.href = result.authUrl;
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Could not start OAuth", "error");
      setBusy(null);
    }
  };

  const disconnect = async (id: string) => {
    if (!state.email) return;
    setBusy(id);
    try {
      await api.disconnectConnection(state.email, id);
      showToast("Disconnected", "success");
      await load();
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Disconnect failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const statusLabel = (acc: ConnectedAccount | null | undefined) => {
    if (!acc) return { text: "Not connected", className: "text-slate-500" };
    if (acc.publishReady)
      return { text: "Connected · Publish ready", className: "text-emerald-400" };
    if (acc.status === "linked")
      return { text: "URL linked · OAuth pending", className: "text-amber-400" };
    if (acc.status === "expired")
      return { text: "Expired — reconnect", className: "text-red-400" };
    return { text: acc.status, className: "text-slate-300" };
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-fade-in text-center sm:text-left">
      <div>
        <h1 className="text-xl font-black text-white mb-1">Connections</h1>
        <p className="text-xs text-slate-400">
          Connect accounts for{" "}
          <span className="text-orange-400 font-bold">
            {(state.workspaces || []).find((w) => w.id === state.activeWorkspaceId)?.name ||
              "this client"}
          </span>
          . Each client workspace has its own Facebook, Instagram, GBP, and LinkedIn links.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading connections…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PLATFORMS.map((p) => {
            const acc = byProvider[p.id];
            const st = statusLabel(acc);
            const oauthReady = !!setup?.[p.id];
            return (
              <div
                key={p.id}
                className="glass-card p-5 rounded-2xl border border-navy-800 text-left flex flex-col gap-4"
              >
                <div className="flex-1">
                  <h2 className="text-sm font-bold text-white">{p.title}</h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">{p.blurb}</p>
                  <p className={`text-[11px] font-bold mt-2 ${st.className}`}>{st.text}</p>
                  {acc?.accountName && (
                    <p className="text-[11px] text-slate-300 mt-1">
                      {acc.accountName}
                      {acc.accountUrl ? (
                        <>
                          {" · "}
                          <a
                            href={acc.accountUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-orange-400 hover:underline"
                          >
                            Open
                          </a>
                        </>
                      ) : null}
                    </p>
                  )}
                  {!oauthReady && (
                    <p className="text-[10px] text-amber-400/90 mt-3 bg-amber-950/20 border border-amber-500/20 rounded-lg px-3 py-2">
                      Server OAuth keys for {p.title} are not set yet. Add API credentials on
                      the VPS to enable connect & publish.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => connectOAuth(p.id)}
                    className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-[11px] font-bold px-3 py-2 rounded-xl"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    {busy === p.id
                      ? "Redirecting…"
                      : oauthReady
                        ? "Connect with OAuth"
                        : "Try OAuth"}
                  </button>
                  {acc && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => disconnect(acc.id)}
                      className="inline-flex items-center gap-1.5 border border-navy-700 hover:border-red-500/50 text-slate-300 hover:text-red-300 text-[11px] font-bold px-3 py-2 rounded-xl"
                    >
                      <Unplug className="w-3.5 h-3.5" />
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {accounts.length > 1 && (
        <p className="text-[10px] text-slate-500">
          {accounts.length} connection records stored for this workspace.
        </p>
      )}
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500 p-6">Loading connections…</p>}>
      <ConnectionsInner />
    </Suspense>
  );
}
