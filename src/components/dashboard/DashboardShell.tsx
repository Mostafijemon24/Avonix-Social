"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  BarChart3,
  Search,
  PenLine,
  MapPin,
  MessageSquare,
  Bell,
  FileText,
  CreditCard,
  Menu,
  X,
} from "lucide-react";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { DASHBOARD_NAV } from "@/lib/constants";
import { useToast } from "@/components/ui/Toast";
import { useWorkspace, PLAN_CONFIG } from "@/context/WorkspaceContext";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  analytics: BarChart3,
  sitemap: Search,
  socialpost: PenLine,
  gbppost: MapPin,
  reviewreply: MessageSquare,
  notification: Bell,
  report: FileText,
  billing: CreditCard,
};

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const { state, logout: workspaceLogout } = useWorkspace();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const plan = PLAN_CONFIG[state.planId];
  const unlimited = !!state.unlimitedCredits;
  const creditPct =
    unlimited || state.creditLimit <= 0
      ? 100
      : Math.round((state.credits / state.creditLimit) * 100);
  const isLowCredits =
    !unlimited && state.credits <= Math.ceil(state.creditLimit * 0.1);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const handleLogout = () => {
    workspaceLogout();
    showToast("Signed out of Dashboard workspace.", "info");
    router.push("/");
  };

  return (
    <div className="h-full min-h-screen flex flex-col bg-navy-950">
      <header className="h-16 border-b border-navy-800 bg-navy-900/90 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-4 lg:px-8">
        <div className="flex items-center space-x-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden text-slate-400 hover:text-white p-2 rounded-xl hover:bg-navy-800"
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          <BrandLogo href="/dashboard" size="sm" />

          <div className="hidden xl:flex items-center pl-6 border-l border-navy-800">
            <label htmlFor="workspaceSelect" className="text-xs text-slate-400 font-semibold mr-2">
              Client Workspace:
            </label>
            <select
              id="workspaceSelect"
              onChange={(e) =>
                showToast(`Switched active client workspace to ${e.target.value.toUpperCase()}`, "info")
              }
              className="bg-navy-800 text-slate-200 text-xs font-bold rounded-xl px-3 py-1.5 focus:outline-none border border-navy-700 cursor-pointer"
              defaultValue="nexadigital"
            >
              <option value="nexadigital">Nexa Digital Marketing Inc.</option>
              <option value="dhali">Dhali Hospitality Group</option>
              <option value="apex">Apex Global Tech</option>
            </select>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div
            className={`hidden sm:flex items-center border px-3.5 py-1.5 rounded-full text-xs font-bold ${
              unlimited
                ? "bg-emerald-950/40 border-emerald-500/40"
                : isLowCredits
                  ? "bg-red-950/40 border-red-500/40"
                  : "bg-navy-800 border-navy-700/80"
            }`}
          >
            <span className="text-slate-400 mr-2">Credits:</span>
            {unlimited ? (
              <span className="font-black text-emerald-400">Unlimited</span>
            ) : (
              <>
                <span className={`font-black ${isLowCredits ? "text-red-400" : "text-orange-500"}`}>
                  {state.credits}
                </span>
                <span className="text-slate-600 mx-1">/</span>
                <span className="text-slate-400">{state.creditLimit}</span>
              </>
            )}
            <span className="text-slate-600 mx-1.5">·</span>
            <span className="text-slate-500">{plan.name}</span>
          </div>
          <Link
            href="/dashboard/billing"
            className="px-3.5 py-1.5 text-xs font-bold rounded-xl text-white bg-orange-500 hover:bg-orange-600 transition-all shadow-md shadow-orange-500/20"
          >
            Top-Up / Upgrade
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="text-xs font-bold text-slate-400 hover:text-white px-3 py-1.5 rounded-xl border border-navy-800 bg-navy-900"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Low credit warning bar */}
      {!unlimited && isLowCredits && state.credits > 0 && (
        <div className="bg-amber-950/40 border-b border-amber-500/30 px-4 py-2 text-center text-[11px] text-amber-300">
          Low credits ({creditPct}% remaining).{" "}
          <Link href="/dashboard/billing" className="text-orange-400 font-bold underline">
            Upgrade now
          </Link>
        </div>
      )}
      {!unlimited && state.credits === 0 && state.accountStatus !== "frozen" && (
        <div className="bg-red-950/40 border-b border-red-500/30 px-4 py-2 text-center text-[11px] text-red-300">
          No credits remaining.{" "}
          <Link href="/dashboard/billing" className="text-orange-400 font-bold underline">
            Subscribe to continue
          </Link>
        </div>
      )}
      {state.accountStatus === "frozen" && (
        <div className="bg-red-950/50 border-b border-red-500/40 px-4 py-2 text-center text-[11px] text-red-200">
          Subscription frozen — wallet empty.{" "}
          <Link href="/dashboard/billing" className="text-orange-400 font-bold underline">
            Top up to reactivate
          </Link>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-navy-950/80 z-40 lg:hidden backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        )}

        <aside
          className={`fixed lg:static inset-y-0 left-0 w-64 bg-navy-900 border-r border-navy-800 flex flex-col justify-between z-50 transform transition-transform duration-200 ease-in-out ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="p-4 space-y-1 overflow-y-auto custom-scrollbar">
            <div className="text-[10px] font-extrabold text-slate-500 px-3 uppercase tracking-wider mb-2">
              Main Navigation
            </div>
            {DASHBOARD_NAV.map((item) => {
              const Icon = ICONS[item.id];
              const active = isActive(item.href);
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`w-full flex items-center space-x-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    active
                      ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
                      : "text-slate-400 hover:text-white hover:bg-navy-800 font-semibold"
                  }`}
                >
                  {Icon && <Icon className="w-4 h-4" />}
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="p-4 border-t border-navy-800 bg-navy-950/60 text-center sm:text-left">
            <div className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">
              Live Status
            </div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-slate-400">Facebook Page</span>
              <span className="text-emerald-400 font-bold">Active</span>
            </div>
            <div className="flex items-center justify-between text-[11px] mb-2">
              <span className="text-slate-400">Google Business</span>
              <span className="text-emerald-400 font-bold">Active</span>
            </div>
            <div className="w-full bg-navy-800 rounded-full h-1.5 overflow-hidden mt-1">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  unlimited ? "bg-emerald-500" : isLowCredits ? "bg-red-500" : "bg-orange-500"
                }`}
                style={{ width: `${creditPct}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              {unlimited ? "Unlimited credits" : `${state.credits} credits left`}
            </p>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 lg:p-8 bg-navy-950 text-slate-200">
          {children}
        </main>
      </div>
    </div>
  );
}
