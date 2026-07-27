"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, type AdminSubscription } from "@/lib/admin-api";

export default function AdminSubscriptionsPage() {
  const [subs, setSubs] = useState<AdminSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.subscriptions().then(setSubs).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-slate-400 text-sm">Loading subscriptions...</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">Active Subscriptions ({subs.length})</h1>
        <p className="text-xs text-slate-400 mt-1">Who bought which plan and via which gateway.</p>
      </div>

      <div className="glass-card rounded-2xl border border-navy-800 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-navy-800 bg-navy-900/50">
              <th className="text-left p-4">User</th>
              <th className="text-left p-4">Plan</th>
              <th className="text-left p-4">Status</th>
              <th className="text-left p-4">Gateway</th>
              <th className="text-left p-4">Started</th>
              <th className="text-left p-4">Renews</th>
            </tr>
          </thead>
          <tbody>
            {subs.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-slate-500">
                  No active subscriptions yet.
                </td>
              </tr>
            ) : (
              subs.map((s) => (
                <tr key={s.id} className="border-b border-navy-800/50 text-slate-300">
                  <td className="p-4">
                    <Link
                      href={`/admin/users/${s.userId}`}
                      className="text-orange-400 font-bold hover:underline"
                    >
                      {s.user.email}
                    </Link>
                  </td>
                  <td className="p-4">
                    <span className="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-lg font-bold">
                      {s.package.name}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className="text-emerald-400 capitalize">{s.status}</span>
                  </td>
                  <td className="p-4 capitalize">{s.gateway}</td>
                  <td className="p-4">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="p-4">
                    {s.currentPeriodEnd
                      ? new Date(s.currentPeriodEnd).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
