"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api } from "@/lib/api-client";

export default function NotificationPage() {
  const { showToast } = useToast();
  const { state, refreshState } = useWorkspace();
  const [prefs, setPrefs] = useState({
    notifyEmail: true,
    notifyWhatsapp: true,
    notifyTelegram: false,
    whatsappNumber: "",
    telegramChatId: "",
  });
  const [logs, setLogs] = useState<
    Array<{
      id: string;
      channel: string;
      type: string;
      title: string;
      body: string;
      status: string;
      createdAt: string;
    }>
  >([]);

  useEffect(() => {
    if (!state.email) return;
    api.getCredits(state.email).then((u) => {
      setPrefs({
        notifyEmail: u.notifyEmail !== false,
        notifyWhatsapp: !!u.notifyWhatsapp,
        notifyTelegram: !!u.notifyTelegram,
        whatsappNumber: u.whatsappNumber || u.phone || "",
        telegramChatId: u.telegramChatId || "",
      });
    });
    api.getNotificationLogs(state.email).then(setLogs).catch(() => setLogs([]));
  }, [state.email]);

  const save = async () => {
    if (!state.email) return;
    try {
      await api.saveNotificationPrefs(state.email, prefs);
      await refreshState();
      showToast("Notification channels saved!", "success");
    } catch {
      showToast("Failed to save preferences", "error");
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h2 className="text-base font-bold text-white mb-2">
          Email, WhatsApp & Telegram Alerts
        </h2>
        <p className="text-xs text-slate-400 mb-6">
          Get notified if you miss a social/GBP post or forget to reply to Google Business
          reviews. Also alerts when wallet is low or subscription freezes.
        </p>

        <div className="space-y-4 max-w-lg mx-auto sm:mx-0 text-xs">
          <Toggle
            label="Email alerts"
            checked={prefs.notifyEmail}
            onChange={(v) => setPrefs((p) => ({ ...p, notifyEmail: v }))}
          />
          <Toggle
            label="WhatsApp notifications"
            checked={prefs.notifyWhatsapp}
            onChange={(v) => setPrefs((p) => ({ ...p, notifyWhatsapp: v }))}
          />
          <div>
            <label className="block font-bold text-slate-400 mb-1">WhatsApp number</label>
            <input
              value={prefs.whatsappNumber}
              onChange={(e) => setPrefs((p) => ({ ...p, whatsappNumber: e.target.value }))}
              className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white"
              placeholder="+1..."
            />
          </div>
          <Toggle
            label="Telegram notifications"
            checked={prefs.notifyTelegram}
            onChange={(v) => setPrefs((p) => ({ ...p, notifyTelegram: v }))}
          />
          <div>
            <label className="block font-bold text-slate-400 mb-1">Telegram Chat ID</label>
            <input
              value={prefs.telegramChatId}
              onChange={(e) => setPrefs((p) => ({ ...p, telegramChatId: e.target.value }))}
              className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white"
              placeholder="From @userinfobot"
            />
          </div>
          <button
            type="button"
            onClick={save}
            className="bg-orange-500 text-white font-bold px-4 py-2.5 rounded-xl"
          >
            Save Preferences
          </button>
        </div>
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h2 className="text-sm font-bold text-white mb-4">Recent Notifications</h2>
        {logs.length === 0 ? (
          <p className="text-xs text-slate-500">No notifications yet.</p>
        ) : (
          <div className="space-y-2 text-xs">
            {logs.map((l) => (
              <div
                key={l.id}
                className="p-3 bg-navy-900 rounded-xl border border-navy-800 text-left"
              >
                <div className="flex justify-between gap-2">
                  <span className="text-white font-bold">{l.title}</span>
                  <span className="text-slate-500 capitalize">
                    {l.channel} · {l.status}
                  </span>
                </div>
                <p className="text-slate-400 mt-1">{l.body}</p>
                <p className="text-slate-600 mt-1">{new Date(l.createdAt).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="p-4 bg-navy-900 rounded-xl border border-navy-800 flex items-center justify-between">
      <span className="font-bold text-white">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 accent-orange-500"
      />
    </div>
  );
}
