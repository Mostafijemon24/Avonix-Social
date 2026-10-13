"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  PenLine,
  MapPin,
  MessageSquare,
  Bell,
  FileText,
  CreditCard,
  Menu,
  X,
  Link2,
  LifeBuoy,
  ChevronDown,
  Library,
  CalendarClock,
  ClipboardCheck,
  Layers,
  LogOut,
} from "lucide-react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import PlatformGlyph from "@/components/ui/PlatformGlyph";
import { DASHBOARD_MORE_NAV, DASHBOARD_PRIMARY_NAV } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace, PLAN_CONFIG } from "@/context/WorkspaceContext";
import { api } from "@/lib/api-client";
import { ClientWorkspaceSwitcher } from "@/components/dashboard/ClientWorkspaceSwitcher";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  socialpost: PenLine,
  connections: Link2,
  gbppost: MapPin,
  library: Library,
  scheduling: CalendarClock,
  reviewreply: MessageSquare,
  notification: Bell,
  report: FileText,
  billing: CreditCard,
  support: LifeBuoy,
  audit: ClipboardCheck,
};

type ConnKey =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "google_business"
  | "x"
  | "pinterest";
type ConnState = Record<ConnKey, "Connected" | "Linked" | "Off">;

const CONN_KEYS: ConnKey[] = [
  "facebook",
  "instagram",
  "linkedin",
  "google_business",
  "x",
  "pinterest",
];

const LIVE_STATUS_ROWS: Array<{ key: ConnKey; label: string }> = [
  { key: "facebook", label: "Facebook Page" },
  { key: "instagram", label: "Instagram" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "google_business", label: "Google Business" },
  { key: "x", label: "X (Twitter)" },
  { key: "pinterest", label: "Pinterest" },
];

const emptyConn = (): ConnState => ({
  facebook: "Off",
  instagram: "Off",
  linkedin: "Off",
  google_business: "Off",
  x: "Off",
  pinterest: "Off",
});

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const { state, logout: workspaceLogout, switchWorkspace } = useWorkspace();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnState>(emptyConn);

  useEffect(() => {
    // Reset immediately so UI reflects the newly selected client before fetch returns
    setConnStatus(emptyConn());
    if (!state.email || !state.activeWorkspaceId) return;

    let cancelled = false;
    api
      .getConnections(state.email, state.activeWorkspaceId)
      .then((data) => {
        if (cancelled) return;
        const next = emptyConn();
        CONN_KEYS.forEach((key) => {
          const acc = data.byProvider?.[key];
          next[key] = acc?.publishReady ? "Connected" : acc ? "Linked" : "Off";
        });
        setConnStatus(next);
      })
      .catch(() => {
        if (!cancelled) setConnStatus(emptyConn());
      });
    return () => {
      cancelled = true;
    };
  }, [state.email, state.activeWorkspaceId]);

  const moreActive = DASHBOARD_MORE_NAV.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );

  useEffect(() => {
    if (moreActive) setMoreOpen(true);
  }, [moreActive]);

  const plan = PLAN_CONFIG[state.planId];
  const unlimited = !!state.unlimitedCredits;
  const hasWallet =
    (state.planId === "pro" || state.planId === "agency") &&
    (state.walletBalanceUsd ?? 0) > 0;
  const creditPct =
    unlimited || state.creditLimit <= 0
      ? 100
      : Math.round((state.credits / state.creditLimit) * 100);
  const isLowCredits =
    !unlimited && state.credits <= Math.ceil(state.creditLimit * 0.1) && !hasWallet;

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const handleLogout = () => {
    workspaceLogout();
    showToast("Signed out of Dashboard workspace.", "info");
    router.push("/");
  };

  const navItemClass = (active: boolean, indented = false) =>
    `w-full flex items-center gap-3 rounded-xl text-[13px] transition-all text-left ${
      indented ? "pl-10 pr-3 py-2" : "px-3.5 py-2.5"
    } ${
      active
        ? "bg-orange-500 text-white font-bold shadow-accent"
        : "text-muted hover:text-ink hover:bg-navy-800 font-semibold"
    }`;

  return (
    <div className="h-full min-h-screen min-w-0 flex bg-navy-950 text-ink">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-ink/40 z-40 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 inset-y-0 left-0 w-[244px] shrink-0 h-screen bg-white border-r border-line flex flex-col justify-between z-50 px-[18px] py-[22px] transform transition-transform duration-200 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex flex-col gap-6 overflow-y-auto custom-scrollbar">
          <BrandLogo href="/dashboard" size="sm" />

          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] font-extrabold text-dim px-2 pb-1.5 uppercase tracking-[0.09em]">
              Workspace
            </div>
            {DASHBOARD_PRIMARY_NAV.map((item) => {
              const Icon = ICONS[item.id];
              const active = isActive(item.href);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={navItemClass(active)}
                >
                  {Icon && <Icon className="w-[17px] h-[17px] shrink-0" />}
                  <span>{item.label}</span>
                </Link>
              );
            })}

            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[13px] font-semibold text-muted hover:text-ink hover:bg-navy-800 transition-all"
            >
              <span className="flex items-center gap-3">
                <Layers className="w-[17px] h-[17px] shrink-0" />
                More
              </span>
              <ChevronDown
                className={`w-4 h-4 text-dim transition-transform ${moreOpen ? "rotate-180" : ""}`}
              />
            </button>
            {moreOpen &&
              DASHBOARD_MORE_NAV.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`w-full block pl-10 pr-3 py-2 rounded-lg text-[12.5px] text-left transition-all ${
                      active
                        ? "bg-accent-soft text-accent font-bold"
                        : "text-muted hover:text-ink hover:bg-navy-800 font-semibold"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
          </div>
        </div>

        {/* Live Status */}
        <div className="border-t border-line pt-[18px] flex flex-col gap-2.5">
          {/* Mobile-only client switcher */}
          <div className="md:hidden mb-1">
            <label className="text-[10px] font-extrabold text-dim uppercase tracking-[0.09em] mb-1.5 block">
              Client Workspace
            </label>
            <select
              value={state.activeWorkspaceId || ""}
              onChange={async (e) => {
                try {
                  await switchWorkspace(e.target.value);
                  setSidebarOpen(false);
                  showToast("Client workspace switched", "success");
                } catch {
                  showToast("Could not switch workspace", "error");
                }
              }}
              className="w-full bg-navy-800 text-ink text-xs font-bold rounded-xl px-3 py-2 border border-line"
            >
              {(state.workspaces || []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="text-[10px] font-extrabold text-dim uppercase tracking-[0.09em]">
            Live Status
          </div>
          {LIVE_STATUS_ROWS.map(({ key, label }) => {
            const status = connStatus[key];
            return (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-muted">
                  <PlatformGlyph platform={key} size={14} />
                  {label}
                </span>
                <span
                  className={`font-bold ${
                    status === "Connected"
                      ? "text-[#16a34a]"
                      : status === "Linked"
                        ? "text-[#d97706]"
                        : "text-dim"
                  }`}
                >
                  {status === "Off" ? "Off" : status}
                </span>
              </div>
            );
          })}

          <div className="w-full bg-navy-800 rounded-full h-1.5 overflow-hidden mt-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${
                unlimited ? "bg-emerald-500" : isLowCredits ? "bg-red-500" : "bg-orange-500"
              }`}
              style={{ width: `${creditPct}%` }}
            />
          </div>
          <p className="text-[11px] text-dim">
            {unlimited ? "Unlimited credits" : `${state.credits} credits left`}
          </p>
          <Link
            href="/dashboard/connections"
            onClick={() => setSidebarOpen(false)}
            className="text-[10px] text-accent hover:opacity-80 font-bold"
          >
            Manage connections →
          </Link>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-[66px] shrink-0 border-b border-line bg-white sticky top-0 z-30 flex items-center justify-between gap-2 px-4 sm:px-6 lg:px-[26px] min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden text-muted hover:text-ink p-2 rounded-xl hover:bg-navy-800"
              aria-label="Toggle sidebar"
            >
              {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
            <ClientWorkspaceSwitcher />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3.5 shrink-0">
            <Link
              href="/dashboard/billing"
              className={`hidden sm:flex items-center gap-1.5 border px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${
                unlimited
                  ? "bg-emerald-50 border-emerald-200"
                  : isLowCredits
                    ? "bg-red-50 border-red-200"
                    : "bg-navy-800 border-line hover:border-accent-border"
              }`}
            >
              <span className="text-dim">Credits</span>
              {unlimited ? (
                <span className="font-extrabold text-emerald-600">Unlimited</span>
              ) : (
                <>
                  <span className={`font-extrabold ${isLowCredits ? "text-red-500" : "text-accent"}`}>
                    {state.credits}
                  </span>
                  <span className="text-dim">/ {state.creditLimit}</span>
                </>
              )}
              <span className="text-dim">·</span>
              <span className="text-muted">{plan.name}</span>
              {hasWallet && (
                <>
                  <span className="text-dim">·</span>
                  <span className="text-emerald-600 font-extrabold">
                    ${state.walletBalanceUsd!.toFixed(2)}
                  </span>
                </>
              )}
            </Link>
            <Link
              href="/dashboard/notification"
              className="relative p-2 rounded-xl text-muted hover:text-ink hover:bg-navy-800"
              aria-label="Notifications"
            >
              <Bell className="w-[18px] h-[18px]" />
            </Link>
            <Link
              href="/dashboard/billing"
              className="px-2.5 sm:px-4 py-2 text-xs font-bold rounded-xl text-white bg-orange-500 hover:bg-orange-600 transition-all shadow-accent whitespace-nowrap"
            >
              <span className="sm:hidden">Top-Up</span>
              <span className="hidden sm:inline">Top-Up / Upgrade</span>
            </Link>
            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((v) => !v)}
                className="w-[34px] h-[34px] rounded-full bg-accent-soft border border-accent-border text-[13px] font-extrabold text-accent"
                aria-label="Profile"
              >
                {(state.email || "U").slice(0, 1).toUpperCase()}
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-[210px] bg-white border border-line rounded-xl shadow-[0_6px_18px_rgba(18,26,48,0.1)] z-40 p-2">
                  <p className="text-[11px] text-dim px-2.5 py-1.5 truncate">{state.email}</p>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 text-left text-[13px] font-bold text-ink hover:bg-navy-800 px-2.5 py-2 rounded-lg"
                  >
                    <LogOut className="w-[15px] h-[15px] text-muted" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Credit warning bars */}
        {!unlimited && isLowCredits && state.credits > 0 && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-[11px] text-amber-700">
            Low credits ({creditPct}% remaining).{" "}
            <Link href="/dashboard/billing" className="text-accent font-bold underline">
              Upgrade now
            </Link>
          </div>
        )}
        {!unlimited && state.credits === 0 && state.accountStatus !== "frozen" && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-center text-[11px] text-red-600">
            No credits remaining.{" "}
            <Link href="/dashboard/billing" className="text-accent font-bold underline">
              Subscribe to continue
            </Link>
          </div>
        )}
        {state.accountStatus === "frozen" && (
          <div className="bg-red-100 border-b border-red-200 px-4 py-2 text-center text-[11px] text-red-700">
            Subscription frozen — wallet empty.{" "}
            <Link href="/dashboard/billing" className="text-accent font-bold underline">
              Top up to reactivate
            </Link>
          </div>
        )}

        <main className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-4 sm:p-6 lg:p-8 bg-navy-950 text-ink">
          {children}
        </main>
      </div>
    </div>
  );
}
