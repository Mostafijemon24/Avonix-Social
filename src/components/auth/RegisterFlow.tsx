"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { PasswordField } from "@/components/ui/PasswordField";
import { useWorkspace } from "@/context/WorkspaceContext";
import { api } from "@/lib/api-client";

type Step = "signin" | "register" | "verify" | "card";

const PASSWORD_HINT =
  "Min 12 characters, with uppercase, lowercase, number, and special character (!@#$…).";

function stepFromNext(next?: string): Step {
  if (next === "verify_codes") return "verify";
  if (next === "add_card") return "card";
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
  sms?: string;
  emailError?: string | null;
  smsError?: string | null;
};

function deliveryToastMessage(delivery?: DeliveryInfo): { text: string; ok: boolean } {
  const emailStatus = delivery?.email;
  const smsStatus = delivery?.sms;
  const emailOk = emailStatus === "sent";
  const smsOk = smsStatus === "sent";

  if (emailOk && smsOk) {
    return { text: "Codes sent to your email and phone.", ok: true };
  }

  const parts: string[] = [];
  if (!emailOk) {
    parts.push(
      `Email: ${delivery?.emailError || emailStatus || "not sent"} (check spam / SMTP)`
    );
  }
  if (!smsOk) {
    parts.push(
      `SMS: ${delivery?.smsError || smsStatus || "not sent"} (BD needs BulkSMSBD keys)`
    );
  }
  return {
    text: `OTP delivery issue — ${parts.join(" · ")}. You can Resend, or ask admin to check pm2 logs for codes.`,
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
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const paramEmail = searchParams.get("email")?.trim().toLowerCase() || "";
    const paramStep = searchParams.get("step") as Step | null;

    if (paramEmail) setEmail(paramEmail);
    if (paramStep && ["signin", "register", "verify", "card"].includes(paramStep)) {
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

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    try {
      await api.verify({
        email,
        emailCode: form.get("emailCode") as string,
        phoneCode: form.get("phoneCode") as string,
      });
      setStep("card");
      showToast("Email and phone verified. Add a card to activate Free Trial.", "success");
    } catch (err: unknown) {
      showToast(
        err && typeof err === "object" && "error" in err
          ? String((err as { error: string }).error)
          : "Verification failed",
        "error"
      );
    } finally {
      setLoading(false);
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
          {step === "verify" && "Verify Email & Phone"}
          {step === "card" && "Add Card (Required)"}
        </h1>
        <p className="text-xs text-slate-400 mb-6">
          {step === "signin" && "Sign in with email and password every time."}
          {step === "register" &&
            "Set a strong password, then verify email & phone before Free Trial."}
          {step === "verify" &&
            "Enter the 6-digit codes sent to your email and mobile phone."}
          {step === "card" &&
            "Free Trial requires a valid payment card on file for security."}
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

        {step === "register" && (
          <form onSubmit={handleRegister} className="space-y-3 text-xs">
            <Field label="Full Name" name="name" required />
            <Field label="Work Email" name="email" type="email" defaultValue={email} required />
            <Field
              label="Mobile Phone"
              name="phone"
              type="tel"
              placeholder="+880 1712 345678"
              required
            />
            <p className="text-[10px] text-slate-500 -mt-1">
              Any country. Include country code (e.g. +880… BD, +1… US, +44… UK). SMS OTP will be
              sent here.
            </p>
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
              {loading ? "Sending codes..." : "Send Verification Codes"}
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
          <form onSubmit={handleVerify} className="space-y-3 text-xs">
            <p className="text-[10px] text-slate-500">Verifying: {email}</p>
            <Field label="Email Code" name="emailCode" required maxLength={6} />
            <Field label="Phone / SMS Code" name="phoneCode" required maxLength={6} />
            <p className="text-[10px] text-slate-500">
              BD numbers: use +880… Check spam for email. If SMS does not arrive, tap Resend
              after the admin configures BulkSMSBD.
            </p>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl"
            >
              {loading ? "Verifying..." : "Verify Codes"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleResendOtp}
              className="w-full text-slate-400 hover:text-white font-bold py-2"
            >
              Resend codes
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
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  maxLength?: number;
  defaultValue?: string;
  autoComplete?: string;
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
        className="w-full border border-navy-700 rounded-xl p-3 bg-navy-950 font-bold text-white"
      />
    </div>
  );
}
