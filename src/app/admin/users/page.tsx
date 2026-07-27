"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminApi, type AdminUser, type AdminPlan } from "@/lib/admin-api";

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({
    email: "",
    name: "",
    phone: "",
    company: "",
    planSlug: "free",
    credits: "",
    unlimitedCredits: false,
    notes: "",
  });

  const load = () =>
    Promise.all([adminApi.users(), adminApi.plans()]).then(([u, p]) => {
      setUsers(u);
      setPlans(p.filter((x) => x.isActive));
    });

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const create = async () => {
    try {
      await adminApi.createUser({
        email: form.email,
        name: form.name || undefined,
        phone: form.phone || undefined,
        company: form.company || undefined,
        planSlug: form.planSlug,
        credits: form.credits ? Number(form.credits) : undefined,
        unlimitedCredits: form.unlimitedCredits,
        notes: form.notes || undefined,
      });
      setMsg("User created");
      setShowCreate(false);
      setForm({
        email: "",
        name: "",
        phone: "",
        company: "",
        planSlug: "free",
        credits: "",
        unlimitedCredits: false,
        notes: "",
      });
      await load();
    } catch (e: unknown) {
      setMsg(
        e && typeof e === "object" && "error" in e
          ? String((e as { error: string }).error)
          : "Failed to create user"
      );
    }
  };

  const remove = async (id: string, email: string) => {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    try {
      await adminApi.deleteUser(id);
      setMsg(`Deleted ${email}`);
      await load();
    } catch {
      setMsg("Failed to delete user");
    }
  };

  const toggleUnlimited = async (u: AdminUser) => {
    try {
      await adminApi.setUnlimited(u.id, !u.unlimitedCredits, "Admin toggle");
      await load();
    } catch {
      setMsg("Failed to update unlimited flag");
    }
  };

  if (loading) return <p className="text-slate-400 text-sm">Loading users...</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">All Users ({users.length})</h1>
          <p className="text-xs text-slate-400 mt-1">
            Create, delete, grant unlimited credits, view registration data.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-2 rounded-xl text-xs"
        >
          {showCreate ? "Cancel" : "+ Create User"}
        </button>
      </div>

      {msg && (
        <div className="bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs p-3 rounded-xl">
          {msg}
        </div>
      )}

      {showCreate && (
        <div className="glass-card p-5 rounded-2xl border border-navy-800 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          {(
            [
              ["email", "Email *"],
              ["name", "Name"],
              ["phone", "Phone"],
              ["company", "Company"],
              ["notes", "Notes"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className="text-slate-500 font-bold block mb-1">{label}</label>
              <input
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full border border-navy-700 bg-navy-950 rounded-xl p-2.5 text-white"
              />
            </div>
          ))}
          <div>
            <label className="text-slate-500 font-bold block mb-1">Plan</label>
            <select
              value={form.planSlug}
              onChange={(e) => setForm((f) => ({ ...f, planSlug: e.target.value }))}
              className="w-full border border-navy-700 bg-navy-950 rounded-xl p-2.5 text-white"
            >
              {plans.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} (${p.priceUsd})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-slate-500 font-bold block mb-1">Credits (optional)</label>
            <input
              type="number"
              value={form.credits}
              onChange={(e) => setForm((f) => ({ ...f, credits: e.target.value }))}
              className="w-full border border-navy-700 bg-navy-950 rounded-xl p-2.5 text-white"
            />
          </div>
          <label className="flex items-center gap-2 text-slate-300 font-bold mt-6">
            <input
              type="checkbox"
              checked={form.unlimitedCredits}
              onChange={(e) => setForm((f) => ({ ...f, unlimitedCredits: e.target.checked }))}
            />
            Unlimited credits
          </label>
          <button
            type="button"
            onClick={create}
            className="md:col-span-3 bg-orange-500 hover:bg-orange-600 text-white font-bold py-2.5 rounded-xl"
          >
            Create User
          </button>
        </div>
      )}

      <div className="glass-card rounded-2xl border border-navy-800 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-navy-800 bg-navy-900/50">
              <th className="text-left p-4">Email / Name</th>
              <th className="text-left p-4">Plan</th>
              <th className="text-left p-4">Credits</th>
              <th className="text-left p-4">Source</th>
              <th className="text-left p-4">Joined</th>
              <th className="text-left p-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-navy-800/50 text-slate-300 hover:bg-navy-900/30">
                <td className="p-4">
                  <Link href={`/admin/users/${u.id}`} className="text-orange-400 font-bold hover:underline">
                    {u.email}
                  </Link>
                  <p className="text-slate-500">{u.name || "—"}</p>
                </td>
                <td className="p-4">
                  <span className="bg-navy-800 px-2 py-0.5 rounded-lg">{u.planName}</span>
                </td>
                <td className="p-4">
                  {u.unlimitedCredits ? (
                    <span className="text-emerald-400 font-bold">Unlimited</span>
                  ) : (
                    <>
                      <span className="text-orange-500 font-bold">{u.credits}</span>
                      <span className="text-slate-600">/{u.creditLimit}</span>
                    </>
                  )}
                </td>
                <td className="p-4 capitalize">{u.source || "signup"}</td>
                <td className="p-4">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="p-4 space-x-2 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleUnlimited(u)}
                    className="text-emerald-400 hover:underline font-bold"
                  >
                    {u.unlimitedCredits ? "Revoke ∞" : "Grant ∞"}
                  </button>
                  <Link href={`/admin/users/${u.id}`} className="text-slate-400 hover:text-white font-bold">
                    View
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(u.id, u.email)}
                    className="text-red-400 hover:underline font-bold"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
