"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

const TOPICS = [
  { value: "account", label: "Account / password / login" },
  { value: "connections", label: "Social / GBP connections" },
  { value: "publishing", label: "Post publish / review reply" },
  { value: "workspaces", label: "Client workspaces" },
  { value: "billing", label: "Credits / billing / plans" },
  { value: "other", label: "Other" },
];

export function SupportTicketForm({
  source = "support",
  defaultEmail = "",
  defaultName = "",
  defaultCompany = "",
}: {
  source?: string;
  defaultEmail?: string;
  defaultName?: string;
  defaultCompany?: string;
}) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const topic = String(data.get("topic") || "other");
    const topicLabel = TOPICS.find((t) => t.value === topic)?.label || topic;
    const body = String(data.get("message") || "").trim();

    try {
      const res = await fetch(`${API}/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          phone: data.get("phone") || undefined,
          company: data.get("company") || undefined,
          message: `[Support · ${topicLabel}]\n\n${body}`,
          source,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to send");
      showToast("Support ticket sent. We’ll reply soon.", "success");
      form.reset();
    } catch {
      showToast("Could not send ticket. Email support@avonixsocial.com", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-xs">
      <div>
        <label className="block font-bold text-slate-300 mb-1">Topic</label>
        <select
          name="topic"
          required
          defaultValue="account"
          className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
        >
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block font-bold text-slate-300 mb-1">Your name</label>
        <input
          name="name"
          type="text"
          required
          defaultValue={defaultName}
          className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>
      <div>
        <label className="block font-bold text-slate-300 mb-1">Email</label>
        <input
          name="email"
          type="email"
          required
          defaultValue={defaultEmail}
          className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>
      <div>
        <label className="block font-bold text-slate-300 mb-1">Company (optional)</label>
        <input
          name="company"
          type="text"
          defaultValue={defaultCompany}
          className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>
      <div>
        <label className="block font-bold text-slate-300 mb-1">Phone (optional)</label>
        <input
          name="phone"
          type="tel"
          placeholder="+880 ..."
          className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>
      <div>
        <label className="block font-bold text-slate-300 mb-1">Describe the issue</label>
        <textarea
          name="message"
          rows={5}
          required
          placeholder="What were you trying to do? Any error message?"
          className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white outline-none focus:ring-2 focus:ring-orange-500"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
      >
        {loading ? "Sending…" : "Submit support ticket"}
      </button>
    </form>
  );
}
