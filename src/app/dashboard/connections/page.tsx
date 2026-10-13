"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Link2, ShieldCheck, Star, Unplug } from "lucide-react";
import PlatformGlyph from "@/components/ui/PlatformGlyph";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  api,
  isApiError,
  type ConnectedAccount,
  type ConnectionsSetup,
} from "@/lib/api-client";

const PLATFORMS: Array<{
  id: "facebook" | "instagram" | "google_business" | "linkedin" | "x" | "pinterest";
  title: string;
  selectTitle: string;
  blurb: string;
}> = [
  {
    id: "facebook",
    title: "Facebook",
    selectTitle: "Select Facebook Pages",
    blurb: "Connect Facebook Business Pages. Existing connections stay connected.",
  },
  {
    id: "instagram",
    title: "Instagram",
    selectTitle: "Select Instagram Profiles",
    blurb: "Requires an Instagram Business account linked to a Facebook Page.",
  },
  {
    id: "linkedin",
    title: "LinkedIn",
    selectTitle: "Select LinkedIn Pages",
    blurb: "Connect your LinkedIn profile to publish posts (Sign In + Share on LinkedIn).",
  },
  {
    id: "google_business",
    title: "Google Business Profile",
    selectTitle: "Select Google Business Locations",
    blurb: "Connect one or more locations. NAP is never mixed across locations.",
  },
  {
    id: "x",
    title: "X (Twitter)",
    selectTitle: "Select X Account",
    blurb: "Connect your X account to publish tweets (link included automatically).",
  },
  {
    id: "pinterest",
    title: "Pinterest",
    selectTitle: "Select Pinterest Board",
    blurb: "Connect a Pinterest board to publish keyword-rich pins (image required).",
  },
];

type PendingItem = {
  accountId: string;
  accountName: string;
  accountUrl: string | null;
  alreadyConnected: boolean;
  metadata?: {
    address?: string | null;
    phone?: string | null;
    hours?: string | null;
    note?: string | null;
  } | null;
};

function health(acc: ConnectedAccount) {
  const key = acc.healthStatus || (acc.publishReady ? "publishing_ready" : acc.status);
  if (key === "publishing_ready" || acc.publishReady) {
    return { label: "Publishing Ready", className: "status-pill status-pill-ready" };
  }
  if (key === "needs_reauthorization" || acc.status === "expired") {
    return { label: "Needs Reauthorization", className: "status-pill status-pill-warn" };
  }
  if (key === "permission_issue" || acc.status === "error" || acc.status === "linked") {
    return { label: "Permission Issue", className: "status-pill status-pill-error" };
  }
  return { label: "Disconnected", className: "status-pill status-pill-muted" };
}

function ConnectionsInner() {
  const { showToast } = useToast();
  const { state } = useWorkspace();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [setup, setSetup] = useState<ConnectionsSetup | null>(null);
  const [pickerProvider, setPickerProvider] = useState<string | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const load = useCallback(async () => {
    if (!state.email) return;
    setLoading(true);
    try {
      const data = await api.getConnections(state.email, state.activeWorkspaceId || undefined);
      setAccounts(data.accounts || []);
      setSetup(data.setup || null);
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Failed to load connections", "error");
    } finally {
      setLoading(false);
    }
  }, [state.email, state.activeWorkspaceId, showToast]);

  const openPicker = useCallback(
    async (provider: string) => {
      if (!state.email) return;
      setPickerLoading(true);
      setPickerProvider(provider);
      try {
        const data = await api.getPendingConnections(
          state.email,
          provider,
          state.activeWorkspaceId || undefined
        );
        const items = data.items || [];
        setPendingItems(items);
        setSelectedIds([]);
        if (!data.pending || !items.length) {
          showToast("No pending accounts to select. Start Connect another again.", "error");
          setPickerProvider(null);
        }
      } catch (err) {
        showToast(isApiError(err) ? err.error : "Could not load eligible accounts", "error");
        setPickerProvider(null);
      } finally {
        setPickerLoading(false);
      }
    },
    [state.email, state.activeWorkspaceId, showToast]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const select = searchParams.get("select");
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (select) {
      openPicker(select);
      router.replace("/dashboard/connections");
    }
    if (connected) {
      showToast(`${connected.replace(/_/g, " ")} connected successfully`, "success");
      load();
    }
    if (error) showToast(error, "error");
  }, [searchParams, showToast, load, openPicker, router]);

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

  const connectSelected = async () => {
    if (!state.email || !pickerProvider) return;
    const available = selectedIds.filter((id) => {
      const item = pendingItems.find((p) => p.accountId === id);
      return item && !item.alreadyConnected;
    });
    if (!available.length) {
      showToast("Select at least one available account", "error");
      return;
    }
    setBusy("connect-selected");
    try {
      const result = await api.connectSelectedAccounts({
        email: state.email,
        provider: pickerProvider,
        accountIds: available,
        workspaceId: state.activeWorkspaceId || undefined,
      });
      showToast(
        `Connected ${result.connected?.length || 0} ${pickerProvider.replace(/_/g, " ")} account(s)`,
        "success"
      );
      setPickerProvider(null);
      setPendingItems([]);
      await load();
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Could not connect selected accounts", "error");
    } finally {
      setBusy(null);
    }
  };

  const discardPicker = async () => {
    if (!state.email || !pickerProvider) {
      setPickerProvider(null);
      return;
    }
    try {
      await api.discardPendingConnections({
        email: state.email,
        provider: pickerProvider,
        workspaceId: state.activeWorkspaceId || undefined,
      });
    } catch {
      /* still close */
    }
    setPickerProvider(null);
    setPendingItems([]);
  };

  const disconnect = async (id: string) => {
    if (!state.email) return;
    if (!window.confirm("Disconnect this account? Existing posts are not deleted.")) return;
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

  const verify = async (id: string) => {
    if (!state.email) return;
    setBusy(`verify-${id}`);
    try {
      const result = await api.verifyConnection(state.email, id);
      showToast(result.message || (result.verified ? "Verified" : "Needs attention"), result.verified ? "success" : "error");
      await load();
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Verify failed", "error");
    } finally {
      setBusy(null);
    }
  };

  const setDefault = async (id: string) => {
    if (!state.email) return;
    setBusy(`default-${id}`);
    try {
      await api.setDefaultConnection(state.email, id);
      showToast("Default updated", "success");
      await load();
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Could not set default", "error");
    } finally {
      setBusy(null);
    }
  };

  const pickerMeta = useMemo(
    () => PLATFORMS.find((p) => p.id === pickerProvider),
    [pickerProvider]
  );
  const availableCount = pendingItems.filter((i) => !i.alreadyConnected).length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-fade-in text-left">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink mb-1">Connections</h1>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          Multiple accounts per platform stay connected at the same time. Use Connect another —
          never disconnect to add a new destination.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-dim">Loading connections…</p>
      ) : (
        <div className="space-y-5">
          {PLATFORMS.map((p) => {
            const group = accounts.filter((a) => a.provider === p.id);
            const ready = group.filter((a) => a.publishReady).length;
            const oauthReady = !!setup?.[p.id];
            const countLabel =
              p.id === "google_business"
                ? `${group.length} Location${group.length === 1 ? "" : "s"} Connected`
                : `${group.length} Connected`;
            return (
              <section key={p.id} className="glass-card p-5 rounded-2xl">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-bold text-ink uppercase tracking-wide">
                      <PlatformGlyph platform={p.id} size={18} />
                      {p.title}
                    </h2>
                    <p className="text-[11px] text-muted mt-0.5">
                      {countLabel}
                      {group.length > 0 ? ` · ${ready} of ${group.length} publishing ready` : ""}
                    </p>
                    <p className="text-[11px] text-dim mt-1">
                      {p.id === "linkedin" && setup?.linkedinMode === "community"
                        ? "Connect LinkedIn Company Pages. The LinkedIn user must be a Page admin."
                        : p.blurb}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => connectOAuth(p.id)}
                    className="btn-primary inline-flex items-center gap-1.5 text-[11px] min-h-[44px]"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    {busy === p.id ? "Redirecting…" : "Connect Another"}
                  </button>
                </div>
                {!oauthReady && (
                  <p className="text-[10px] text-[#d97706]/90 mb-3 bg-amber-50/20 border border-amber-500/20 rounded-lg px-3 py-2">
                    Server OAuth keys for {p.title} are not set yet.
                  </p>
                )}
                {group.length === 0 ? (
                  <p className="text-xs text-dim">No accounts connected yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {group.map((acc) => {
                      const st = health(acc);
                      const meta = acc.metadata || {};
                      return (
                        <li
                          key={acc.id}
                          className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-line bg-[color:var(--color-card-inner)] px-3 py-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-ink">
                              {acc.accountName || acc.provider}
                              {(acc.isDefault ||
                                (group[0]?.id === acc.id && !group.some((g) => g.isDefault))) && (
                                <span className="ml-2 text-[10px] uppercase tracking-wide text-orange-300 border border-orange-800/50 px-1.5 py-0.5 rounded">
                                  Default
                                </span>
                              )}
                            </p>
                            <p className={`mt-1 ${st.className}`}>
                              {st.label === "Publishing Ready" ? "✓ " : st.label.startsWith("Needs") ? "⚠ " : ""}
                              {st.label}
                            </p>
                            {typeof meta.address === "string" && meta.address && (
                              <p className="text-[11px] text-muted mt-1">{meta.address}</p>
                            )}
                            {typeof meta.phone === "string" && meta.phone && (
                              <p className="text-[11px] text-dim font-mono">{meta.phone}</p>
                            )}
                            {acc.accountUrl && (
                              <a
                                href={acc.accountUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-orange-400 font-mono break-all"
                              >
                                {acc.accountUrl.replace(/^https?:\/\//, "")}
                              </a>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {acc.accountUrl && (
                              <a
                                href={acc.accountUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="btn-ghost text-[11px]"
                              >
                                View
                              </a>
                            )}
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() => verify(acc.id)}
                              className="btn-ghost text-[11px] inline-flex items-center gap-1"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              Verify
                            </button>
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() => connectOAuth(acc.provider)}
                              className="btn-ghost text-[11px]"
                            >
                              Reauthorize
                            </button>
                            <button
                              type="button"
                              disabled={!!busy || acc.isDefault}
                              onClick={() => setDefault(acc.id)}
                              className="btn-ghost text-[11px] inline-flex items-center gap-1"
                            >
                              <Star className="w-3.5 h-3.5" />
                              Default
                            </button>
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() => disconnect(acc.id)}
                              className="btn-ghost text-[11px] inline-flex items-center gap-1 text-[#dc2626] hover:text-red-200"
                            >
                              <Unplug className="w-3.5 h-3.5" />
                              Disconnect
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {pickerProvider && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[color:var(--color-card)] border border-line p-5">
            <h3 className="text-base font-extrabold text-ink">
              {pickerMeta?.selectTitle || "Select accounts"}
            </h3>
            <p className="text-[11px] text-muted mt-1">
              Already connected accounts stay untouched. Tokens never leave the server.
            </p>
            {pickerLoading ? (
              <p className="text-sm text-dim mt-4">Loading eligible accounts…</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {pendingItems.map((item) => {
                  const checked = selectedIds.includes(item.accountId);
                  return (
                    <li key={item.accountId}>
                      <label
                        className={`flex items-start gap-3 rounded-xl border px-3 py-3 ${
                          item.alreadyConnected
                            ? "border-line bg-navy-950/40 opacity-70"
                            : "border-line bg-[color:var(--color-card-inner)] cursor-pointer"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1"
                          disabled={item.alreadyConnected}
                          checked={item.alreadyConnected ? true : checked}
                          onChange={() => {
                            setSelectedIds((prev) =>
                              prev.includes(item.accountId)
                                ? prev.filter((id) => id !== item.accountId)
                                : [...prev, item.accountId]
                            );
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-ink">{item.accountName}</span>
                          <span className="block text-[11px] font-semibold mt-0.5">
                            {item.alreadyConnected ? (
                              <span className="text-[color:var(--color-ready)]">Already Connected</span>
                            ) : (
                              <span className="text-muted">Available</span>
                            )}
                          </span>
                          {item.metadata?.address && (
                            <span className="block text-[11px] text-dim">{item.metadata.address}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-5 flex flex-wrap gap-2 justify-end">
              <button type="button" className="btn-secondary text-[12px]" onClick={discardPicker}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-[12px] inline-flex items-center gap-1.5 min-h-[44px]"
                disabled={!!busy || availableCount === 0}
                onClick={connectSelected}
              >
                <Check className="w-3.5 h-3.5" />
                {busy === "connect-selected" ? "Connecting…" : "Connect Selected"}
              </button>
            </div>
            {availableCount === 0 && !pickerLoading && (
              <p className="text-[11px] text-dim mt-3">
                All returned accounts are already connected. Existing tokens were refreshed.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-dim p-6">Loading connections…</p>}>
      <ConnectionsInner />
    </Suspense>
  );
}
