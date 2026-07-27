"use client";

import { useEffect, useState } from "react";
import { adminApi, type Lead } from "@/lib/admin-api";

const STATUSES = ["new", "contacted", "qualified", "won", "lost"];

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState("");

  const load = () => adminApi.leads(filter || undefined).then(setLeads);

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const setStatus = async (id: string, status: string) => {
    await adminApi.updateLead(id, { status });
    setMsg(`Lead marked as ${status}`);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this lead?")) return;
    await adminApi.deleteLead(id);
    load();
  };

  if (loading) return <p className="text-slate-400 text-sm">Loading leads...</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">Leads ({leads.length})</h1>
          <p className="text-xs text-slate-400 mt-1">
            Contact form submissions and manually added leads.
          </p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-navy-700 bg-navy-950 text-white text-xs rounded-xl px-3 py-2"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {msg && (
        <div className="bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs p-3 rounded-xl">
          {msg}
        </div>
      )}

      <div className="space-y-3">
        {leads.length === 0 ? (
          <div className="glass-card p-8 rounded-2xl border border-navy-800 text-center text-slate-500 text-sm">
            No leads yet. They appear when someone submits the contact form.
          </div>
        ) : (
          leads.map((lead) => (
            <div
              key={lead.id}
              className="glass-card p-5 rounded-2xl border border-navy-800 text-xs space-y-2"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <p className="text-white font-bold text-sm">{lead.name}</p>
                  <p className="text-orange-400">{lead.email}</p>
                </div>
                <span className="bg-navy-800 text-slate-300 px-2 py-1 rounded-lg capitalize h-fit">
                  {lead.status}
                </span>
              </div>
              <p className="text-slate-400">
                {lead.company || "—"} · {lead.phone || "no phone"} · source: {lead.source}
              </p>
              {lead.message && (
                <p className="text-slate-300 bg-navy-950/60 p-3 rounded-xl">{lead.message}</p>
              )}
              <p className="text-slate-600">{new Date(lead.createdAt).toLocaleString()}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(lead.id, s)}
                    className={`px-2.5 py-1 rounded-lg font-bold capitalize ${
                      lead.status === s
                        ? "bg-orange-500 text-white"
                        : "bg-navy-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    {s}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => remove(lead.id)}
                  className="px-2.5 py-1 rounded-lg font-bold text-red-400 hover:bg-red-950/40"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
