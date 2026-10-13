"use client";

import { useState } from "react";
import { Plus, Trash2, Building2 } from "lucide-react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { useToast } from "@/components/ui/Toast";
import { isApiError } from "@/lib/api-client";

export function ClientWorkspaceSwitcher() {
  const { state, switchWorkspace, createClientWorkspace, removeClientWorkspace } =
    useWorkspace();
  const { showToast } = useToast();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const workspaces = state.workspaces || [];
  const activeId = state.activeWorkspaceId || "";
  const limit = state.workspaceLimit ?? 1;

  const onSwitch = async (id: string) => {
    if (!id || id === activeId) return;
    try {
      await switchWorkspace(id);
      const ws = workspaces.find((w) => w.id === id);
      showToast(
        `Switched to ${ws?.name || "client"} — connections & studio content updated`,
        "success"
      );
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Could not switch workspace", "error");
    }
  };

  const onCreate = async () => {
    if (!name.trim()) {
      showToast("Enter a client name", "error");
      return;
    }
    setBusy(true);
    try {
      const ws = await createClientWorkspace({
        name: name.trim(),
        websiteUrl: websiteUrl.trim() || undefined,
      });
      showToast(`Client “${ws.name}” created`, "success");
      setName("");
      setWebsiteUrl("");
      setAdding(false);
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Could not create client", "error");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!activeId || workspaces.length <= 1) {
      showToast("Keep at least one client workspace", "error");
      return;
    }
    const current = workspaces.find((w) => w.id === activeId);
    if (!confirm(`Delete client “${current?.name}”? Connections for this client will be removed.`)) {
      return;
    }
    setBusy(true);
    try {
      await removeClientWorkspace(activeId);
      showToast("Client workspace deleted", "success");
    } catch (err) {
      showToast(isApiError(err) ? err.error : "Delete failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hidden md:flex items-center gap-2 relative">
      <div className="flex items-center gap-2 bg-navy-800 border border-line rounded-[11px] pl-3 pr-2 py-1.5">
        <Building2 className="w-[15px] h-[15px] text-accent shrink-0" />
        <select
          id="workspaceSelect"
          aria-label="Client workspace"
          value={activeId}
          onChange={(e) => onSwitch(e.target.value)}
          className="bg-transparent text-ink text-[13px] font-bold focus:outline-none cursor-pointer max-w-[200px]"
        >
          {workspaces.length === 0 && <option value="">Loading…</option>}
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.domain ? ` · ${w.domain}` : ""}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        title="Add client"
        disabled={busy || workspaces.length >= limit}
        onClick={() => setAdding((v) => !v)}
        className="p-1.5 rounded-lg text-accent hover:bg-navy-800 disabled:opacity-40"
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Delete active client"
        disabled={busy || workspaces.length <= 1}
        onClick={onDelete}
        className="p-1.5 rounded-lg text-dim hover:text-red-500 hover:bg-navy-800 disabled:opacity-40"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <span className="text-[10px] text-dim font-bold">
        {workspaces.length}/{limit}
      </span>

      {adding && (
        <div className="absolute top-14 left-0 z-40 w-[360px] max-w-[90vw] bg-white border border-line rounded-2xl p-4 shadow-[0_14px_34px_rgba(18,26,48,0.18)]">
          <p className="text-xs font-bold text-ink mb-3">Add client workspace</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Client / brand name"
            className="w-full mb-2 bg-navy-800 border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-dim"
          />
          <input
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            placeholder="Website (optional) e.g. client.com"
            className="w-full mb-3 bg-navy-800 border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-dim"
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-[11px] font-bold text-muted px-3 py-2"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCreate}
              className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-[11px] font-bold px-3 py-2 rounded-xl"
            >
              {busy ? "Saving…" : "Create"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
