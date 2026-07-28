"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminApi,
  wipeAdminSession,
  type AdminPlan,
  type ApiConfig,
} from "@/lib/admin-api";
import { PasswordField } from "@/components/ui/PasswordField";

const CONFIG_FIELDS: { key: string; label: string }[] = [
  { key: "OPENROUTER_API_KEY", label: "OpenRouter API Key" },
  { key: "STRIPE_SECRET_KEY", label: "Stripe Secret Key" },
  { key: "STRIPE_WEBHOOK_SECRET", label: "Stripe Webhook Secret" },
  { key: "PAYPAL_CLIENT_ID", label: "PayPal Client ID" },
  { key: "PAYPAL_CLIENT_SECRET", label: "PayPal Client Secret" },
];

export default function AdminSettingsPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [savedConfig, setSavedConfig] = useState<ApiConfig>({});
  const [draftConfig, setDraftConfig] = useState<ApiConfig>({});
  const [adminEmail, setAdminEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([adminApi.plans(), adminApi.config(), adminApi.me()])
      .then(([p, c, me]) => {
        setPlans(p);
        setSavedConfig(c);
        setAdminEmail(me.email);
      })
      .finally(() => setLoading(false));
  }, []);

  const savePlan = async (slug: string, priceUsd: number, monthlyCredits: number) => {
    try {
      await adminApi.updatePlan(slug, { priceUsd, monthlyCredits });
      setErr("");
      setMsg(`Plan "${slug}" updated`);
      setPlans(await adminApi.plans());
    } catch {
      setMsg("");
      setErr("Failed to update plan");
    }
  };

  const saveConfig = async () => {
    const payload: Record<string, string> = {};
    for (const [key, value] of Object.entries(draftConfig)) {
      if (value && !value.includes("••••")) payload[key] = value;
    }
    if (Object.keys(payload).length === 0) {
      setErr("Enter at least one new key value to save");
      return;
    }
    try {
      await adminApi.saveConfig(payload);
      setSavedConfig(await adminApi.config());
      setDraftConfig({});
      setErr("");
      setMsg("API configuration saved");
    } catch {
      setMsg("");
      setErr("Failed to save config");
    }
  };

  if (loading) return <p className="text-slate-400 text-sm">Loading settings...</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black text-white">Settings & API Config</h1>
        <p className="text-xs text-slate-400 mt-1">
          Security, plan pricing, and payment/AI API keys.
        </p>
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

      <div className="glass-card p-6 rounded-2xl border border-navy-800 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-white">Admin Security</h2>
          <p className="text-[10px] text-slate-500 mt-1">
            Logged in as <span className="text-orange-400 font-bold">{adminEmail}</span>
            {" · "}2FA mandatory · Max 2 Super Admins · VPS CLI registration only
          </p>
        </div>
        <PasswordPanel
          onDone={() => {
            wipeAdminSession();
            router.push("/admin/login");
          }}
          onMessage={(ok, text) => {
            if (ok) {
              setErr("");
              setMsg(text);
            } else {
              setMsg("");
              setErr(text);
            }
          }}
        />
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h2 className="text-sm font-bold text-white mb-4">Subscription Plans</h2>
        <div className="space-y-4">
          {plans.map((plan) => (
            <PlanEditor
              key={plan.slug}
              plan={plan}
              onSave={savePlan}
              onDelete={async (slug) => {
                try {
                  await adminApi.deletePlan(slug);
                  setErr("");
                  setMsg(`Plan "${slug}" deleted/deactivated`);
                  setPlans(await adminApi.plans());
                } catch (e: unknown) {
                  setMsg("");
                  setErr(
                    e && typeof e === "object" && "error" in e
                      ? String((e as { error: string }).error)
                      : "Failed to delete plan"
                  );
                }
              }}
            />
          ))}
        </div>
        <CreatePlanForm
          onCreated={async () => {
            setPlans(await adminApi.plans());
            setMsg("Plan created");
          }}
          onError={(t) => {
            setMsg("");
            setErr(t);
          }}
        />
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h2 className="text-sm font-bold text-white mb-4">API Keys & Payment Config</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {CONFIG_FIELDS.map(({ key, label }) => (
            <div key={key}>
              <label className="block font-bold text-slate-400 mb-1">{label}</label>
              <input
                type="password"
                placeholder={savedConfig[key] ? `${savedConfig[key]} (saved)` : "Enter key..."}
                value={draftConfig[key] ?? ""}
                onChange={(e) => setDraftConfig((c) => ({ ...c, [key]: e.target.value }))}
                className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white"
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={saveConfig}
          className="mt-4 bg-orange-500 hover:bg-orange-600 text-white font-bold px-6 py-2.5 rounded-xl text-xs"
        >
          Save API Configuration
        </button>
      </div>
    </div>
  );
}

function PasswordPanel({
  onDone,
  onMessage,
}: {
  onDone: () => void;
  onMessage: (ok: boolean, text: string) => void;
}) {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirm: "",
    totpCode: "",
  });

  const changePassword = async () => {
    if (form.newPassword !== form.confirm) {
      onMessage(false, "New password and confirmation do not match");
      return;
    }
    try {
      await adminApi.changePassword(form.currentPassword, form.newPassword, form.totpCode);
      onMessage(true, "Password updated — signing out");
      setTimeout(onDone, 800);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "error" in e
          ? String((e as { error: string }).error)
          : "Failed to update password";
      onMessage(false, msg);
    }
  };

  return (
    <div className="space-y-3 text-xs max-w-md">
      <p className="font-bold text-slate-300">Change Password (requires 2FA code)</p>
      <PasswordField
        label="Current password"
        name="currentPassword"
        autoComplete="current-password"
        value={form.currentPassword}
        onChange={(v) => setForm((f) => ({ ...f, currentPassword: v }))}
      />
      <PasswordField
        label="New password"
        name="newPassword"
        autoComplete="new-password"
        showGenerate
        value={form.newPassword}
        onChange={(v) => setForm((f) => ({ ...f, newPassword: v }))}
        onGenerate={(pwd) => setForm((f) => ({ ...f, newPassword: pwd, confirm: pwd }))}
      />
      <PasswordField
        label="Confirm new password"
        name="confirmPassword"
        autoComplete="new-password"
        value={form.confirm}
        onChange={(v) => setForm((f) => ({ ...f, confirm: v }))}
      />
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        placeholder="Authenticator code"
        value={form.totpCode}
        onChange={(e) => setForm((f) => ({ ...f, totpCode: e.target.value }))}
        className="w-full border border-navy-700 bg-navy-950 rounded-xl p-3 text-white tracking-widest"
      />
      <button
        type="button"
        onClick={changePassword}
        className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-2.5 rounded-xl"
      >
        Update Password
      </button>
      <p className="text-[10px] text-slate-600">
        Email / new admin creation: VPS only — `npm run admin:create` (max 2).
      </p>
    </div>
  );
}

function PlanEditor({
  plan,
  onSave,
  onDelete,
}: {
  plan: AdminPlan;
  onSave: (slug: string, priceUsd: number, monthlyCredits: number) => void;
  onDelete: (slug: string) => void;
}) {
  const [price, setPrice] = useState(String(plan.priceUsd));
  const [credits, setCredits] = useState(String(plan.monthlyCredits));
  const [name, setName] = useState(plan.name);

  return (
    <div className="flex flex-wrap items-end gap-3 p-4 bg-navy-900/50 rounded-xl border border-navy-800">
      <div className="flex-1 min-w-[140px]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-transparent text-white font-bold border-b border-navy-700 pb-1"
        />
        <p className="text-[10px] text-slate-500 mt-1">
          {plan.slug}
          {!plan.isActive && <span className="text-red-400"> · inactive</span>}
        </p>
      </div>
      <div>
        <label className="text-[10px] text-slate-500 block mb-1">Price (USD)</label>
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-24 border border-navy-700 bg-navy-950 rounded-lg p-2 text-white text-xs"
        />
      </div>
      <div>
        <label className="text-[10px] text-slate-500 block mb-1">Credits</label>
        <input
          type="number"
          value={credits}
          onChange={(e) => setCredits(e.target.value)}
          className="w-24 border border-navy-700 bg-navy-950 rounded-lg p-2 text-white text-xs"
        />
      </div>
      <button
        type="button"
        onClick={() => {
          adminApi.updatePlan(plan.slug, {
            name,
            priceUsd: Number(price),
            monthlyCredits: Number(credits),
          });
          onSave(plan.slug, Number(price), Number(credits));
        }}
        className="bg-navy-800 hover:bg-navy-700 text-white font-bold px-4 py-2 rounded-lg text-xs"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm(`Delete/deactivate plan "${plan.slug}"?`)) onDelete(plan.slug);
        }}
        className="bg-red-950/50 hover:bg-red-900/50 text-red-300 font-bold px-3 py-2 rounded-lg text-xs"
      >
        Delete
      </button>
    </div>
  );
}

function CreatePlanForm({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (t: string) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    slug: "",
    priceUsd: "19",
    monthlyCredits: "100",
  });

  const create = async () => {
    try {
      await adminApi.createPlan({
        name: form.name,
        slug: form.slug || undefined,
        priceUsd: Number(form.priceUsd),
        monthlyCredits: Number(form.monthlyCredits),
      });
      setForm({ name: "", slug: "", priceUsd: "19", monthlyCredits: "100" });
      onCreated();
    } catch (e: unknown) {
      onError(
        e && typeof e === "object" && "error" in e
          ? String((e as { error: string }).error)
          : "Failed to create plan"
      );
    }
  };

  return (
    <div className="mt-6 pt-6 border-t border-navy-800">
      <p className="text-xs font-bold text-slate-300 mb-3">Create New Plan</p>
      <div className="flex flex-wrap gap-3 text-xs">
        <input
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="border border-navy-700 bg-navy-950 rounded-lg p-2 text-white w-36"
        />
        <input
          placeholder="slug (optional)"
          value={form.slug}
          onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
          className="border border-navy-700 bg-navy-950 rounded-lg p-2 text-white w-32"
        />
        <input
          type="number"
          placeholder="Price"
          value={form.priceUsd}
          onChange={(e) => setForm((f) => ({ ...f, priceUsd: e.target.value }))}
          className="border border-navy-700 bg-navy-950 rounded-lg p-2 text-white w-24"
        />
        <input
          type="number"
          placeholder="Credits"
          value={form.monthlyCredits}
          onChange={(e) => setForm((f) => ({ ...f, monthlyCredits: e.target.value }))}
          className="border border-navy-700 bg-navy-950 rounded-lg p-2 text-white w-24"
        />
        <button
          type="button"
          onClick={create}
          className="bg-orange-500 hover:bg-orange-600 text-white font-bold px-4 py-2 rounded-lg"
        >
          Create Plan
        </button>
      </div>
    </div>
  );
}
