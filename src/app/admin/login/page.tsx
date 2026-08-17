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

type Step = "password" | "2fa" | "forgot" | "reset";

const PASSWORD_HINT =
  "Min 12 characters, with uppercase, lowercase, number, and special character (!@#$…).";

function clientPasswordOk(password: string): string | null {
  if (!password || password.length < 12) return "Password must be at least 12 characters";
  if (!/[A-Z]/.test(password)) return "Include an uppercase letter";
  if (!/[a-z]/.test(password)) return "Include a lowercase letter";
  if (!/[0-9]/.test(password)) return "Include a number";
  if (!/[^A-Za-z0-9]/.test(password)) return "Include a special character";
  return null;
}

function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("password");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailHint, setEmailHint] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetTotp, setResetTotp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const verifyingRef = useRef(false);
  const totpInputRef = useRef<HTMLInputElement>(null);

  const idleReason = searchParams.get("reason") === "idle";

  useEffect(() => {
    if (step === "2fa") {
      setTotpCode("");
      setError("");
      requestAnimationFrame(() => totpInputRef.current?.focus());
    }
    if (step === "reset") {
      setResetCode("");
      setResetTotp("");
      setPassword("");
      setConfirmPassword("");
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
    setInfo("");
    wipeAdminSession();

    const form = new FormData(e.currentTarget);
    const email = form.get("email") as string;
    const nextPassword = form.get("password") as string;

    try {
      const result = await adminApi.login(email, nextPassword);
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

  const handleForgot = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    const form = new FormData(e.currentTarget);
    const email = (form.get("email") as string).trim().toLowerCase();
    setEmailHint(email);
    try {
      const result = await adminApi.forgotPassword(email);
      setStep("reset");
      const emailStatus = result.delivery?.email;
      if (result.delivery && emailStatus !== "sent") {
        setError(
          result.delivery.emailError ||
            "Reset email could not be sent. Check SMTP in Admin Settings or VPS CLI."
        );
      } else {
        setInfo(
          emailStatus === "sent"
            ? "Reset code emailed. Check inbox, Spam, and Promotions. Code is also in VPS logs (pm2 logs avonix-social-api)."
            : result.message || "If that email exists, a reset code was sent."
        );
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Could not send reset code";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResendReset = async () => {
    if (!emailHint) {
      setError("Enter your admin email first.");
      return;
    }
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const result = await adminApi.resendPasswordReset(emailHint);
      const emailStatus = result.delivery?.email;
      if (result.delivery && emailStatus !== "sent") {
        setError(result.delivery.emailError || "Reset email could not be sent.");
      } else {
        setInfo("Reset code resent. Check inbox and spam.");
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Resend failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setInfo("");
    const strengthErr = clientPasswordOk(password);
    if (strengthErr) {
      setError(`${strengthErr}. ${PASSWORD_HINT}`);
      setLoading(false);
      return;
    }
    if (password !== confirmPassword) {
      setError("Password and confirmation do not match");
      setLoading(false);
      return;
    }
    try {
      const result = await adminApi.resetPassword({
        email: emailHint,
        code: resetCode,
        totpCode: resetTotp,
        password,
        confirmPassword,
      });
      setPassword("");
      setConfirmPassword("");
      setResetCode("");
      setResetTotp("");
      setStep("password");
      setInfo(result.message || "Password updated. Sign in with your new password.");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Password reset failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const subtitle =
    step === "password"
      ? "Password + mandatory 2FA · Max 2 admins"
      : step === "2fa"
        ? `Authenticator code for ${emailHint}`
        : step === "forgot"
          ? "We email a 6-digit code. Authenticator is still required."
          : `Reset code + authenticator for ${emailHint}`;

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4">
      <div className="glass-card bg-navy-900 rounded-3xl max-w-md w-full p-8 border border-navy-800 shadow-2xl">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-orange-500 flex items-center justify-center mx-auto mb-4 font-black text-white text-xl">
            AX
          </div>
          <h1 className="text-xl font-black text-white">
            {step === "forgot" || step === "reset" ? "Forgot Password" : "Super Admin Login"}
          </h1>
          <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
        </div>

        {idleReason && step === "password" && (
          <div className="bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs p-3 rounded-xl mb-4">
            Session ended after 30 minutes of inactivity. Login data cleared.
          </div>
        )}

        {error && (
          <div className="bg-red-950/40 border border-red-500/40 text-red-300 text-xs p-3 rounded-xl mb-4">
            {error}
          </div>
        )}

        {info && (
          <div className="bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 text-xs p-3 rounded-xl mb-4">
            {info}
          </div>
        )}

        {step === "password" && (
          <form onSubmit={handlePassword} className="space-y-4 text-xs" autoComplete="off">
            <div>
              <label className="block font-bold text-slate-300 mb-1">Admin Email</label>
              <input
                type="email"
                name="email"
                required
                autoComplete="off"
                defaultValue={emailHint}
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
              type="button"
              onClick={() => {
                setError("");
                setInfo("");
                setStep("forgot");
              }}
              className="w-full text-orange-400 hover:text-orange-300 font-bold py-2"
            >
              Forgot password?
            </button>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Verifying..." : "Continue to 2FA"}
            </button>
          </form>
        )}

        {step === "2fa" && (
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

        {step === "forgot" && (
          <form onSubmit={handleForgot} className="space-y-4 text-xs" autoComplete="off">
            <div>
              <label className="block font-bold text-slate-300 mb-1">Admin Email</label>
              <input
                type="email"
                name="email"
                required
                autoComplete="off"
                defaultValue={emailHint}
                placeholder="admin@yourdomain.com"
                className="w-full border border-navy-700 rounded-xl p-3 bg-navy-950 text-white"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Sending..." : "Send Reset Code"}
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                setInfo("");
                setStep("password");
              }}
              className="w-full text-slate-500 hover:text-white font-bold py-2"
            >
              ← Back to sign in
            </button>
          </form>
        )}

        {step === "reset" && (
          <form onSubmit={handleResetPassword} className="space-y-3 text-xs" autoComplete="off">
            <p className="text-[10px] text-slate-500">Account: {emailHint}</p>
            <div>
              <label className="block font-bold text-slate-300 mb-1">Email Reset Code</label>
              <input
                type="text"
                name="admin-reset-code"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoComplete="off"
                className="w-full border border-navy-700 rounded-xl p-3 bg-navy-950 font-bold text-white text-center text-lg tracking-[0.4em] font-mono"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-300 mb-1">Authenticator Code</label>
              <input
                type="text"
                name="admin-reset-totp"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={resetTotp}
                onChange={(e) => setResetTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                autoComplete="off"
                className="w-full border border-navy-700 rounded-xl p-3 bg-navy-950 font-bold text-white text-center text-lg tracking-[0.4em] font-mono"
              />
            </div>
            <PasswordField
              label="New Password"
              name="password"
              required
              autoComplete="new-password"
              showGenerate
              value={password}
              onChange={setPassword}
              onGenerate={(pwd) => {
                setPassword(pwd);
                setConfirmPassword(pwd);
                setInfo("Strong password generated. Copy it somewhere safe.");
              }}
            />
            <PasswordField
              label="Confirm New Password"
              name="confirmPassword"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
            <p className="text-[10px] text-slate-500 -mt-1">{PASSWORD_HINT}</p>
            <button
              type="submit"
              disabled={loading || resetCode.length !== 6 || resetTotp.length !== 6}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Updating..." : "Update Password"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleResendReset}
              className="w-full text-slate-400 hover:text-white font-bold py-2"
            >
              Resend reset code
            </button>
            <button
              type="button"
              onClick={() => {
                setError("");
                setInfo("");
                setStep("password");
              }}
              className="w-full text-slate-500 hover:text-white font-bold py-2"
            >
              ← Back to sign in
            </button>
          </form>
        )}

        <p className="text-[10px] text-slate-600 text-center mt-4 leading-relaxed">
          Admins are created only via VPS terminal (`npm run admin:create`).
          <br />
          Lost authenticator? Recreate the admin from the VPS CLI.
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
