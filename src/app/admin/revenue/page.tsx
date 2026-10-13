"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, type PaymentLog } from "@/lib/admin-api";

function monthlyTotal(payments: PaymentLog[]) {
  const now = new Date();
  return payments
    .filter((p) => {
      const d = new Date(p.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, p) => s + p.amountUsd, 0);
}

export default function AdminRevenuePage() {
  const [data, setData] = useState<{
    total: number;
    payments: PaymentLog[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.revenue().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted text-sm">Loading revenue...</p>;
  if (!data) return <p className="text-[#dc2626] text-sm">Failed to load revenue data.</p>;

  const monthlyRevenue = Math.round(monthlyTotal(data.payments) * 100) / 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink">Revenue & Payments</h1>
        <p className="text-xs text-muted mt-1">All payment transactions from Stripe and PayPal.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="glass-card p-5 rounded-2xl border border-navy-800">
          <p className="text-[10px] font-bold text-dim uppercase">Total Revenue</p>
          <p className="text-3xl font-black text-orange-500 mt-1">${data.total}</p>
        </div>
        <div className="glass-card p-5 rounded-2xl border border-navy-800">
          <p className="text-[10px] font-bold text-dim uppercase">This Month</p>
          <p className="text-3xl font-black text-[#16a34a] mt-1">${monthlyRevenue}</p>
        </div>
      </div>

      <div className="glass-card rounded-2xl border border-navy-800 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-dim border-b border-navy-800 bg-navy-900/50">
              <th className="text-left p-4">User</th>
              <th className="text-left p-4">Plan</th>
              <th className="text-left p-4">Amount</th>
              <th className="text-left p-4">Gateway</th>
              <th className="text-left p-4">Date</th>
            </tr>
          </thead>
          <tbody>
            {data.payments.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-dim">
                  No payments recorded yet. Payments appear when users subscribe.
                </td>
              </tr>
            ) : (
              data.payments.map((p) => (
                <tr key={p.id} className="border-b border-navy-800/50 text-muted">
                  <td className="p-4 text-orange-400">{p.email}</td>
                  <td className="p-4">{p.plan}</td>
                  <td className="p-4 text-[#16a34a] font-bold">${p.amountUsd}</td>
                  <td className="p-4 capitalize">{p.gateway}</td>
                  <td className="p-4">{new Date(p.createdAt).toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
