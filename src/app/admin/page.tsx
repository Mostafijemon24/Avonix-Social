"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, type DashboardStats } from "@/lib/admin-api";

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi
      .dashboard()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-slate-400 text-sm">Loading dashboard...</p>;
  }

  if (!stats) {
    return (
      <p className="text-red-400 text-sm">
        Failed to load. Is backend running on port 4000?
      </p>
    );
  }

  const cards = [
    { label: "Total Users", value: stats.userCount, color: "text-white" },
    { label: "Active Subscriptions", value: stats.activeSubscriptions, color: "text-emerald-400" },
    { label: "Monthly Revenue", value: `$${stats.monthlyRevenue}`, color: "text-orange-500" },
    { label: "Total Revenue", value: `$${stats.totalRevenue}`, color: "text-orange-400" },
    { label: "API Cost (USD)", value: `$${stats.totalApiCostUsd}`, color: "text-red-400" },
    { label: "Profit Estimate", value: `$${stats.profitEstimate}`, color: "text-emerald-400" },
    { label: "Credits Used", value: stats.totalCreditsUsed, color: "text-indigo-400" },
    { label: "Total AI Requests", value: stats.totalRequests, color: "text-slate-300" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">Executive Dashboard</h1>
        <p className="text-xs text-slate-400 mt-1">
          Users, revenue, API costs, and platform usage at a glance.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="glass-card p-5 rounded-2xl border border-navy-800">
            <p className="text-[10px] font-bold text-slate-500 uppercase">{c.label}</p>
            <p className={`text-2xl font-black mt-1 ${c.color}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h2 className="text-sm font-bold text-white mb-4">Recent Users</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-navy-800">
                <th className="text-left py-2">Email</th>
                <th className="text-left py-2">Plan</th>
                <th className="text-left py-2">Credits</th>
                <th className="text-left py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentUsers.map((u) => (
                <tr key={u.id} className="border-b border-navy-800/50 text-slate-300">
                  <td className="py-2">
                    <Link href={`/admin/users/${u.id}`} className="text-orange-400 hover:underline">
                      {u.email}
                    </Link>
                  </td>
                  <td className="py-2">{u.planName}</td>
                  <td className="py-2">
                    {u.credits}/{u.creditLimit}
                  </td>
                  <td className="py-2">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
