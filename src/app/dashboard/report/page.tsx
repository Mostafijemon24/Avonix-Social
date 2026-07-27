"use client";

import { useToast } from "@/components/ui/Toast";

export default function ReportPage() {
  const { showToast } = useToast();

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <div className="flex flex-col sm:flex-row justify-between items-center mb-6 pb-4 border-b border-navy-800 gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Performance Reports</h2>
            <p className="text-xs text-slate-400">
              Download White-label PDF reports for your clients.
            </p>
          </div>
          <button
            type="button"
            onClick={() => showToast("Downloading White-Label PDF Report...", "info")}
            className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-lg"
          >
            Export PDF Report
          </button>
        </div>

        <div className="bg-navy-900 p-4 rounded-xl border border-navy-800 text-xs font-mono text-slate-300">
          Client Report Logs: Nexa_Digital_SEO_Performance_July2026.pdf
        </div>
      </div>
    </div>
  );
}
