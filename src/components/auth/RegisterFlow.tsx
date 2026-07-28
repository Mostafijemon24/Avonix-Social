"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { PasswordField } from "@/components/ui/PasswordField";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api } from "@/lib/api-client";

type Step = "signin" | "register" | "verify" | "card" | "forgot" | "reset";

const PASSWORD_HINT =
  "Min 12 characters, with uppercase, lowercase, number, and special character (!@#$…).";

function stepFromNext(next?: string): Step {
  if (next === "verify_codes") return "verify";
  if (next === "add_card") return "card";
  if (next === "reset_password") return "reset";
  return "signin";
}

function clientPasswordOk(password: string): string | null {
  if (!password || password.length < 12) return "Password must be at least 12 characters";
  if (!/[A-Z]/.test(password)) return "Include an uppercase letter";
  if (!/[a-z]/.test(password)) return "Include a lowercase letter";
  if (!/[0-9]/.test(password)) return "Include a number";
  if (!/[^A-Za-z0-9]/.test(password)) return "Include a special character";
  return null;
}

type DeliveryInfo = {
  email?: string;
  emailError?: string | null;
};

function deliveryToastMessage(delivery?: DeliveryInfo): { text: string; ok: boolean } {
  const emailStatus = delivery?.email;
  const emailOk = emailStatus === "sent";

  if (emailOk) {
    return { text: "Verification code sent to your email.", ok: true };
  }

  return {
    text: `Email OTP not sent: ${delivery?.emailError || emailStatus || "unknown error"}. Check spam or tap Resend.`,
    ok: false,
  };
}

export function RegisterFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const { establishSession, refreshState } = useWorkspace();

  const [step, setStep] = useState<Step>("signin");
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [initialized, setInitialized] = useState(false);
  const verifyingRef = useRef(false);
  const emailCodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "verify") {
      setEmailCode("");
      requestAnimationFrame(() => emailCodeRef.current?.focus());
    }
    if (step === "reset") {
      setResetCode("");
      setPassword("");
      setConfirmPassword("");
    }
  }, [step]);

  useEffect(() => {
    const paramEmail = searchParams.get("email")?.trim().toLowerCase() || "";
    const paramStep = searchParams.get("step") as Step | null;

    if (paramEmail) setEmail(paramEmail);
    if (
      paramStep &&
      ["signin", "register", "verify", "card", "forgot", "reset"].includes(paramStep)
    ) {
      setStep(paramStep);
      setInitialized(true);
      return;
    }

    if (paramEmail) {
      api
        .getAuthStatus(paramEmail)
        .then((status) => {
          // Never auto-enter dashboard without password login
          if (status.fullyVerified) {
            setStep("signin");
            return;
          }
          setStep(stepFromNext(status.next));
        })
        .catch(() => setStep("register"))
        .finally(() => setInitialized(true));
      return;
    }

    setInitialized(true);
  }, [searchParams, router]);

  const finish = async (msg: string, userEmail: string, pwd: string) => {
    await establishSession(userEmail, pwd);
    await refreshState();
    setPassword("");
    showToast(msg, "success");
    router.push("/dashboard");
  };

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const em = (form.get("email") as string).trim().toLowerCase();
    const pwd = form.get("password") as string;
    setEmail(em);
    try {
      const { user } = await api.login(em, pwd);
      await finish(`Welcome back! ${user.credits} credits available.`, em, pwd);
    } catch (err: unknown) {
      const payload =
        err && typeof err === "object"
          ? (err as { error?: string; next?: string; status?: number })
          : {};
      if (payload.status === 403 && payload.next) {
        setPassword(pwd);
        setStep(stepFromNext(payload.next));
        showToast("Complete verification to access the dashboard.", "success");
        return;
      }
      showToast(payload.error || "Invalid email or password.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const em = (form.get("email") as string).trim().toLowerCase();
    const pwd = form.get("password") as string;
    const confirm = form.get("confirmPassword") as string;
    setEmail(em);

    const strengthErr = clientPasswordOk(pwd);
    if (strengthErr) {
      showToast(`${strengthErr}. ${PASSWORD_HINT}`, "error");
      setLoading(false);
      return;
    }
    if (pwd !== confirm) {
      showToast("Password and confirmation do not match", "error");
      setLoading(false);
      return;
    }

    try {
      const result = await api.register({
        email: em,
        phone: form.get("phone") as string,
        name: form.get("name") as string,
        company: (form.get("company") as string) || undefined,
        password: pwd,
        confirmPassword: confirm,
      });
      setPassword(pwd);
      setStep("verify");
      const toast = deliveryToastMessage(result.delivery);
      showToast(toast.text, toast.ok ? "success" : "error");
    } catch (err: unknown) {
      showToast(
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Registration failed",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (!email) {
      showToast("Email missing. Go back and register again.", "error");
      return;
    }
    setLoading(true);
    try {
      const result = await api.resendOtp(email);
      const toast = deliveryToastMessage(result.delivery);
      showToast(toast.text, toast.ok ? "success" : "error");
    } catch (err: unknown) {
      showToast(
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Resend failed",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const em = (form.get("email") as string).trim().toLowerCase();
    setEmail(em);
    try {
      const result = await api.forgotPassword(em);
      setStep("reset");
      const toast = deliveryToastMessage(result.delivery);
      if (result.delivery) {
        showToast(
          toast.ok
            ? "Reset code sent to your email (check spam)."
            : toast.text,
          toast.ok ? "success" : "error"
        );
      } else {
        showToast(result.message || "If that email exists, a reset code was sent.", "success");
      }
    } catch (err: unknown) {
      showToast(
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Could not send reset code",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResendPasswordReset = async () => {
    if (!email) {
      showToast("Enter your email first.", "error");
      return;
    }
    setLoading(true);
    try {
      const result = await api.resendPasswordReset(email);
      const toast = deliveryToastMessage(result.delivery);
      showToast(
        toast.ok ? "Reset code resent. Check inbox and spam." : toast.text,
        toast.ok ? "success" : "error"
      );
    } catch (err: unknown) {
      showToast(
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Resend failed",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      const strengthErr = clientPasswordOk(password);
      if (strengthErr) {
        showToast(`${strengthErr}. ${PASSWORD_HINT}`, "error");
        return;
      }
      if (password !== confirmPassword) {
        showToast("Password and confirmation do not match", "error");
        return;
      }
      const result = await api.resetPassword({
        email,
        code: resetCode,
        password,
        confirmPassword,
      });
      setPassword("");
      setConfirmPassword("");
      setResetCode("");
      setStep("signin");
      showToast(result.message || "Password updated. Sign in now.", "success");
    } catch (err: unknown) {
      showToast(
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Password reset failed",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  const submitEmailVerify = useCallback(
    async (code: string) => {
      const digits = code.replace(/\D/g, "").slice(0, 6);
      if (digits.length !== 6 || verifyingRef.current || !email) return;

      verifyingRef.current = true;
      setLoading(true);
      try {
        await api.verify({ email, emailCode: digits });
        setStep("card");
        showToast("Email verified. Add a card to activate Free Trial.", "success");
      } catch (err: unknown) {
        showToast(
          err && typeof err === "object" && "error" in err
            ? String((err as { error: string }).error)
            : "Verification failed",
          "error"
        );
        setEmailCode("");
        requestAnimationFrame(() => emailCodeRef.current?.focus());
      } finally {
        verifyingRef.current = false;
        setLoading(false);
      }
    },
    [email, showToast]
  );

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await submitEmailVerify(emailCode);
  };

  const handleEmailCodeChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setEmailCode(digits);
    if (digits.length === 6) {
      void submitEmailVerify(digits);
    }
  };

  const handleCard = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      const result = await api.attachCard({
        email,
        cardNumber: form.get("cardNumber") as string,
        expMonth: form.get("expMonth") as string,
        expYear: form.get("expYear") as string,
        cvc: form.get("cvc") as string,
      });
      if (!password) {
        showToast("Card saved. Please sign in with your password.", "success");
        setStep("signin");
        return;
      }
      await finish(result.message || "Free Trial activated!", email, password);
    } catch (err: unknown) {
      showToast(
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Card validation failed",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  if (!initialized) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-400 text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="max-w-md w-full mx-auto">
      <div className="glass-card bg-navy-900 rounded-3xl p-6 border border-navy-800 shadow-2xl text-center sm:text-left">
        <h1 className="text-xl font-black text-white mb-1">
          {step === "signin" && "Sign In"}
          {step === "register" && "Create Account"}
          {step === "verify" && "Verify Email"}
          {step === "card" && "Add Card (Required)"}
          {step === "forgot" && "Forgot Password"}
          {step === "reset" && "Reset Password"}
        </h1>
        <p className="text-xs text-slate-400 mb-6">
          {step === "signin" && "Sign in with email and password every time."}
          {step === "register" &&
            "Set a strong password, then verify your email before Free Trial."}
          {step === "verify" && "Enter the 6-digit code sent to your email."}
          {step === "card" &&
            "Free Trial requires a valid payment card on file for security."}
          {step === "forgot" && "We will email a 6-digit code to reset your password."}
          {step === "reset" &&
            "Enter the email code and choose a new strong password."}
        </p>

        {step === "signin" && (
          <form onSubmit={handleSignIn} className="space-y-4 text-xs">
            <Field label="Email" name="email" type="email" defaultValue={email} required />
            <PasswordField
              label="Password"
              name="password"
              required
              autoComplete="current-password"
            />
            <div className="flex justify-end -mt-2">
              <button
                type="button"
                onClick={() => setStep("forgot")}
                className="text-[10px] font-bold text-orange-400 hover:text-orange-300"
              >
                Forgot password?
              </button>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
            <button
              type="button"
              onClick={() => setStep("register")}
              className="w-full text-slate-400 hover:text-white font-bold py-2"
            >
              New account? Register →
            </button>
          </form>
        )}

        {step === "forgot" && (
          <form onSubmit={handleForgot} className="space-y-4 text-xs">
            <Field label="Account Email" name="email" type="email" defaultValue={email} required />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Sending..." : "Send Reset Code"}
            </button>
            <button
              type="button"
              onClick={() => setStep("signin")}
              className="w-full text-slate-500 font-bold py-2"
            >
              ← Back to sign in
            </button>
          </form>
        )}

        {step === "reset" && (
          <form onSubmit={handleResetPassword} className="space-y-3 text-xs" autoComplete="off">
            <p className="text-[10px] text-slate-500">Account: {email}</p>
            <div>
              <label className="block font-bold text-slate-300 mb-1">Email Reset Code</label>
              <input
                type="text"
                name="reset-code"
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
                showToast("Strong password generated. Copy it somewhere safe.", "success");
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
              disabled={loading || resetCode.length !== 6}
              className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Updating..." : "Update Password"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleResendPasswordReset}
              className="w-full text-slate-400 hover:text-white font-bold py-2"
            >
              Resend reset code
            </button>
            <button
              type="button"
              onClick={() => setStep("signin")}
              className="w-full text-slate-500 font-bold py-2"
            >
              ← Back to sign in
            </button>
          </form>
        )}

        {step === "register" && (
          <form onSubmit={handleRegister} className="space-y-3 text-xs">
            <Field label="Full Name" name="name" required />
            <Field label="Work Email" name="email" type="email" defaultValue={email} required />
            <Field
              label="Mobile Phone (optional)"
              name="phone"
              type="tel"
              placeholder="+880 1712 345678"
            />
            <Field label="Company (optional)" name="company" />
            <PasswordField
              label="Password"
              name="password"
              required
              autoComplete="new-password"
              showGenerate
              value={password}
              onChange={setPassword}
              onGenerate={(pwd) => {
                setPassword(pwd);
                setConfirmPassword(pwd);
                showToast("Strong password generated. Copy it somewhere safe.", "success");
              }}
            />
            <PasswordField
              label="Confirm Password"
              name="confirmPassword"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />
            <p className="text-[10px] text-slate-500 -mt-1">{PASSWORD_HINT}</p>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Sending code..." : "Send Email Verification Code"}
            </button>
            <button
              type="button"
              onClick={() => setStep("signin")}
              className="w-full text-slate-500 font-bold py-2"
            >
              ← Back to sign in
            </button>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={handleVerify} className="space-y-3 text-xs" autoComplete="off">
            <p className="text-[10px] text-slate-500">Account: {email}</p>
            <div>
              <label className="block font-bold text-slate-300 mb-1">Email Code</label>
              <input
                ref={emailCodeRef}
                type="text"
                name="register-email-code"
                id="register-email-code"
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={emailCode}
                onChange={(e) => handleEmailCodeChange(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore
                placeholder=""
                className="w-full border border-navy-700 rounded-xl p-3 bg-navy-950 font-bold text-white text-center text-lg tracking-[0.4em] font-mono"
              />
            </div>
            <p className="text-[10px] text-slate-500">
              Check inbox and spam. Code expires in 10 minutes. Auto-verifies at 6 digits.
            </p>
            <button
              type="submit"
              disabled={loading || emailCode.length !== 6}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl disabled:opacity-50"
            >
              {loading ? "Verifying..." : "Verify Email"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleResendOtp}
              className="w-full text-slate-400 hover:text-white font-bold py-2"
            >
              Resend email code
            </button>
          </form>
        )}

        {step === "card" && (
          <form onSubmit={handleCard} className="space-y-3 text-xs">
            <p className="text-[10px] text-slate-500">Account: {email}</p>
            <Field label="Card Number" name="cardNumber" required />
            <div className="grid grid-cols-3 gap-2">
              <Field label="MM" name="expMonth" placeholder="12" required />
              <Field label="YYYY" name="expYear" placeholder="2030" required />
              <Field label="CVC" name="cvc" required />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Validating..." : "Save Card & Start Free Trial"}
            </button>
          </form>
        )}

        <p className="text-[10px] text-slate-500 mt-6 text-center">
          <Link href="/" className="hover:text-orange-400">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  maxLength,
  defaultValue,
  autoComplete,
  inputMode,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  defaultValue?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <div>
      <label className="block font-bold text-slate-300 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className="w-full border border-navy-700 rounded-xl p-3 bg-navy-950 font-bold text-white"
      />
    </div>
  );
}
