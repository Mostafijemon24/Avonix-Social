"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { adminApi, type UserDetail, type AdminPlan } from "@/lib/admin-api";
import { PasswordField } from "@/components/ui/PasswordField";

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [credits, setCredits] = useState("");
  const [reason, setReason] = useState("");
  const [planSlug, setPlanSlug] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const load = () =>
    Promise.all([adminApi.user(id), adminApi.plans()]).then(([u, p]) => {
      setUser(u);
      setPlans(p);
      setPlanSlug(u.planId);
    });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!user) return <p className="text-slate-400 text-sm">Loading user...</p>;

  const s = user.usageStats;
  const r = user.registration;

  const adjustCredits = async () => {
    try {
      await adminApi.adjustCredits(id, Number(credits), reason || "Admin adjustment");
      setErr("");
      setMsg("Credits updated");
      load();
    } catch {
      setMsg("");
      setErr("Failed to update credits");
    }
  };

  const toggleUnlimited = async () => {
    await adminApi.setUnlimited(id, !user.unlimitedCredits);
    setErr("");
    setMsg(user.unlimitedCredits ? "Unlimited revoked" : "Unlimited granted");
    load();
  };

  const changePlan = async () => {
    await adminApi.updateUser(id, { planSlug, resetCreditsOnPlanChange: true });
    setErr("");
    setMsg("Plan updated");
    load();
  };

  const savePassword = async () => {
    setMsg("");
    setErr("");
    if (!password) {
      setErr("Password is required");
      return;
    }
    if (password !== confirmPassword) {
      setErr("Password and confirmation do not match");
      return;
    }
    try {
      await adminApi.setUserPassword(id, password);
      setPassword("");
      setConfirmPassword("");
      setMsg("Password saved — user can sign in now");
      load();
    } catch (e: unknown) {
      setErr(
        e && typeof e === "object" && "error" in e
          ? String((e as { error: string }).error)
          : "Failed to set password"
      );
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${user.email}?`)) return;
    await adminApi.deleteUser(id);
    router.push("/admin/users");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white">{user.email}</h1>
          <p className="text-xs text-slate-400 mt-1">
            {user.planName} ·{" "}
            {user.unlimitedCredits ? (
              <span className="text-emerald-400 font-bold">Unlimited credits</span>
            ) : (
              `${user.credits}/${user.creditLimit} credits`
            )}
            {(user.hasPassword === false || r?.hasPassword === false) && (
              <span className="text-amber-400 font-bold"> · No password set</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggleUnlimited}
            className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2 rounded-xl text-xs"
          >
            {user.unlimitedCredits ? "Revoke Unlimited" : "Grant Unlimited"}
          </button>
          <button
            type="button"
            onClick={remove}
            className="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2 rounded-xl text-xs"
          >
            Delete User
          </button>
        </div>
      </div>

      {msg && (
        <div className="bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs p-3 rounded-xl">
          {msg}
        </div>
      )}
      {err && (
        <div className="bg-red-950/40 border border-red-500/40 text-red-300 text-xs p-3 rounded-xl">
          {err}
        </div>
      )}

      {r && (
        <div className="glass-card p-6 rounded-2xl border border-navy-800">
          <h2 className="text-sm font-bold text-white mb-4">Registration Data</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            {[
              ["Name", r.name || "—"],
              ["Phone", r.phone || "—"],
              ["Company", r.company || "—"],
              ["Source", r.source || "signup"],
              ["Plan", r.plan],
              ["Unlimited", r.unlimitedCredits ? "Yes" : "No"],
              ["Password", r.hasPassword ? "Set" : "Missing"],
              ["Email verified", r.emailVerified ? "Yes" : "No"],
              ["Status", r.accountStatus || "—"],
              ["Registered", new Date(r.registeredAt).toLocaleString()],
              ["Updated", new Date(r.lastUpdated).toLocaleString()],
            ].map(([label, val]) => (
              <div key={String(label)}>
                <p className="text-slate-500 font-bold uppercase text-[10px]">{label}</p>
                <p className="text-white mt-1">{val}</p>
              </div>
            ))}
          </div>
          {r.notes && <p className="text-xs text-slate-400 mt-4">Notes: {r.notes}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ["Sitemap Parses", s.sitemapParses],
          ["Social Posts", s.socialPosts],
          ["GBP Posts", s.gbpPosts],
          ["Review Replies", s.reviewReplies],
          ["Total Credits Used", s.totalCredits],
          ["Total Tokens", s.totalTokens],
          ["API Cost USD", `$${s.totalApiCost.toFixed(6)}`],
          ["Payments", user.paymentLogs.length],
        ].map(([label, val]) => (
          <div key={String(label)} className="glass-card p-4 rounded-xl border border-navy-800">
            <p className="text-[10px] text-slate-500 uppercase font-bold">{label}</p>
            <p className="text-xl font-black text-white mt-1">{val}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="glass-card p-6 rounded-2xl border border-navy-800">
          <h2 className="text-sm font-bold text-white mb-4">Set / Reset Password</h2>
          <div className="space-y-3 text-xs">
            <PasswordField
              label="New password"
              name="admin-set-password"
              autoComplete="new-password"
              showGenerate
              value={password}
              onChange={setPassword}
              onGenerate={(pwd) => {
                setPassword(pwd);
                setConfirmPassword(pwd);
              }}
            />
            <PasswordField
              label="Confirm password"
              name="admin-set-confirm"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
            <button
              type="button"
              onClick={savePassword}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl px-4 py-2.5"
            >
              Save Password
            </button>
            <p className="text-[10px] text-slate-500">
              Also activates email verification so the user can sign in immediately.
            </p>
          </div>
        </div>

        <div className="glass-card p-6 rounded-2xl border border-navy-800">
          <h2 className="text-sm font-bold text-white mb-4">Adjust Credits</h2>
          <div className="space-y-3 text-xs">
            <input
              type="number"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              placeholder={`Current: ${user.credits}`}
              className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white"
            />
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason"
              className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white"
            />
            <button
              type="button"
              onClick={adjustCredits}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl px-4 py-2.5"
            >
              Update Credits
            </button>
          </div>
        </div>

        <div className="glass-card p-6 rounded-2xl border border-navy-800">
          <h2 className="text-sm font-bold text-white mb-4">Change Plan</h2>
          <div className="space-y-3 text-xs">
            <select
              value={planSlug}
              onChange={(e) => setPlanSlug(e.target.value)}
              className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white"
            >
              {plans.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} — ${p.priceUsd} / {p.monthlyCredits} credits
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={changePlan}
              className="bg-navy-800 hover:bg-navy-700 text-white font-bold rounded-xl px-4 py-2.5"
            >
              Save Plan (reset credits to plan default)
            </button>
          </div>
        </div>
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h2 className="text-sm font-bold text-white mb-4">Usage Logs</h2>
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-navy-800">
                <th className="text-left py-2">Action</th>
                <th className="text-left py-2">Model</th>
                <th className="text-left py-2">Tokens</th>
                <th className="text-left py-2">USD</th>
                <th className="text-left py-2">Credits</th>
                <th className="text-left py-2">Date</th>
              </tr>
            </thead>
            <tbody>
              {user.usageLogs.map((log) => (
                <tr key={log.id} className="border-b border-navy-800/50 text-slate-300">
                  <td className="py-2">{log.action}</td>
                  <td className="py-2">{log.model?.split("/").pop() || "—"}</td>
                  <td className="py-2">{log.totalTokens}</td>
                  <td className="py-2">${log.apiCostUsd.toFixed(6)}</td>
                  <td className="py-2 text-orange-500 font-bold">-{log.creditsDeducted}</td>
                  <td className="py-2">{new Date(log.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
