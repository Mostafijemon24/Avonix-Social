"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
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
  const [totpCode, setTotpCode] = useState("");
  const verifyingRef = useRef(false);
  const totpInputRef = useRef<HTMLInputElement>(null);

  const idleReason = searchParams.get("reason") === "idle";

  useEffect(() => {
    if (step === "2fa") {
      setTotpCode("");
      setError("");
      requestAnimationFrame(() => totpInputRef.current?.focus());
    }
  }, [step]);

  const verifyTotp = useCallback(
    async (code: string) => {
      const digits = code.replace(/\D/g, "").slice(0, 6);
      if (digits.length !== 6 || verifyingRef.current) return;

      const preAuthToken = getPreAuthToken();
      if (!preAuthToken) {
        setError("2FA session expired. Sign in again.");
        setStep("password");
        return;
      }

      verifyingRef.current = true;
      setLoading(true);
      setError("");

      try {
        const result = await adminApi.verify2fa(preAuthToken, digits);
        clearPreAuthToken();
        saveAdminToken(result.token);
        router.push("/admin");
      } catch (err: unknown) {
        const msg =
          err && typeof err === "object" && "error" in err
            ? String((err as { error: string }).error)
            : "Invalid authenticator code";
        setError(msg);
        setTotpCode("");
        requestAnimationFrame(() => totpInputRef.current?.focus());
      } finally {
        verifyingRef.current = false;
        setLoading(false);
      }
    },
    [router]
  );

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
    await verifyTotp(totpCode);
  };

  const handleTotpChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setTotpCode(digits);
    if (digits.length === 6) {
      void verifyTotp(digits);
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
                ref={totpInputRef}
                type="text"
                name="admin-totp-code"
                id="admin-totp-code"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => handleTotpChange(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore
                placeholder=""
                className="w-full border border-navy-700 rounded-xl p-3 bg-navy-950 text-white text-center text-lg tracking-[0.4em] font-mono placeholder:text-slate-600"
              />
            </div>
            <button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Verifying..." : "Verify & Sign In"}
            </button>
            <button
              type="button"
              onClick={() => {
                clearPreAuthToken();
                setTotpCode("");
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
