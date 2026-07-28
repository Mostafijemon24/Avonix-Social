"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  adminApi,
  saveAdminToken,
  savePreAuthToken,
  getPreAuthToken,
  clearPreAuthToken,
  wipeAdminSession,
} from "@/lib/admin-api";
import { PasswordField } from "@/components/ui/PasswordField";

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<"password" | "2fa">("password");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailHint, setEmailHint] = useState("");

  const idleReason = searchParams.get("reason") === "idle";

  const handlePassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    wipeAdminSession();

    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const password = form.get("password") as string;

    try {
      const result = await adminApi.login(email, password);
      if (!result.requires2fa || !result.preAuthToken) {
        setError("2FA is mandatory. Contact system operator.");
        return;
      }
      savePreAuthToken(result.preAuthToken);
      setEmailHint(result.email);
      setStep("2fa");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Invalid credentials";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handle2fa = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const code = form.get("code") as string;
    const preAuthToken = getPreAuthToken();

    if (!preAuthToken) {
      setError("2FA session expired. Sign in again.");
      setStep("password");
      setLoading(false);
      return;
    }

    try {
      const result = await adminApi.verify2fa(preAuthToken, code);
      clearPreAuthToken();
      saveAdminToken(result.token);
      router.push("/admin");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Invalid authenticator code";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4">
      <div className="glass-card bg-navy-900 rounded-3xl max-w-md w-full p-8 border border-navy-800 shadow-2xl">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-orange-500 flex items-center justify-center mx-auto mb-4 font-black text-white text-xl">
            AX
          </div>
          <h1 className="text-xl font-black text-white">Super Admin Login</h1>
          <p className="text-xs text-slate-400 mt-1">
            {step === "password"
              ? "Password + mandatory 2FA · Max 2 admins"
              : `Authenticator code for ${emailHint}`}
          </p>
        </div>

        {idleReason && (
          <div className="bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs p-3 rounded-xl mb-4">
            Session ended after 30 minutes of inactivity. Login data cleared.
          </div>
        )}

        {error && (
          <div className="bg-red-950/40 border border-red-500/40 text-red-300 text-xs p-3 rounded-xl mb-4">
            {error}
          </div>
        )}

        {step === "password" ? (
          <form onSubmit={handlePassword} className="space-y-4 text-xs" autoComplete="off">
            <div>
              <label className="block font-bold text-slate-300 mb-1">Admin Email</label>
              <input
                type="email"
                name="email"
                required
                autoComplete="off"
                placeholder="admin@yourdomain.com"
                className="w-full border border-navy-700 rounded-xl p-3 bg-navy-950 text-white"
              />
            </div>
            <PasswordField
              label="Password"
              name="password"
              required
              autoComplete="off"
              placeholder="Enter password"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Verifying..." : "Continue to 2FA"}
            </button>
          </form>
        ) : (
          <form onSubmit={handle2fa} className="space-y-4 text-xs" autoComplete="off">
            <div>
              <label className="block font-bold text-slate-300 mb-1">
                6-digit Authenticator Code
              </label>
              <input
                type="text"
                name="code"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="000000"
                className="w-full border border-navy-700 rounded-xl p-3 bg-navy-950 text-white text-center text-lg tracking-[0.4em] font-mono"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Verifying..." : "Verify & Sign In"}
            </button>
            <button
              type="button"
              onClick={() => {
                clearPreAuthToken();
                setStep("password");
                setError("");
              }}
              className="w-full text-slate-500 hover:text-white font-bold py-2"
            >
              ← Back
            </button>
          </form>
        )}

        <p className="text-[10px] text-slate-600 text-center mt-4 leading-relaxed">
          Admins are created only via VPS terminal (`npm run admin:create`).
          <br />
          Session auto-wipes after 30 min idle.
        </p>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-navy-950" />}>
      <AdminLoginForm />
    </Suspense>
  );
}
