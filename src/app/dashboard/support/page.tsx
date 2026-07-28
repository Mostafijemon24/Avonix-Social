"use client";

import Link from "next/link";
import { useWorkspace } from "@/context/WorkspaceContext";
import { SupportTicketForm } from "@/components/support/SupportTicketForm";

const QUICK = [
  { href: "/dashboard/connections", label: "Connections" },
  { href: "/dashboard/billing", label: "Plan & Price" },
  { href: "/dashboard/social-post", label: "Content Studio" },
  { href: "/support", label: "Public FAQ" },
];

export default function DashboardSupportPage() {
  const { state } = useWorkspace();
  const activeName =
    (state.workspaces || []).find((w) => w.id === state.activeWorkspaceId)?.name || "";

  return (
    <div className="space-y-6 max-w-3xl mx-auto animate-fade-in text-center sm:text-left">
      <div>
        <h1 className="text-xl font-black text-white mb-1">Support</h1>
        <p className="text-xs text-slate-400">
          Get help with your account
          {activeName ? (
            <>
              {" "}
              · active client: <span className="text-orange-400 font-bold">{activeName}</span>
            </>
          ) : null}
          .
        </p>
      </div>

      <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
        {QUICK.map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="text-[11px] font-bold px-3 py-1.5 rounded-xl border border-navy-700 text-slate-300 hover:border-orange-500/50 hover:text-orange-400"
          >
            {q.label}
          </Link>
        ))}
      </div>

      <div className="glass-card p-6 rounded-2xl border border-navy-800 text-left">
        <h2 className="text-sm font-bold text-white mb-1">Submit a ticket</h2>
        <p className="text-[11px] text-slate-400 mb-4">
          Prefills your login email. Tickets go to the support team (same inbox as Contact).
        </p>
        <SupportTicketForm
          source="dashboard_support"
          defaultEmail={state.email}
          defaultName={state.email?.split("@")[0] || ""}
        />
      </div>

      <p className="text-[11px] text-slate-500">
        Or email{" "}
        <a href="mailto:support@avonixsocial.com" className="text-orange-400 hover:underline">
          support@avonixsocial.com
        </a>
      </p>
    </div>
  );
}
