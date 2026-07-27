export default function AnalyticsPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-fade-in text-center sm:text-left">
      <div className="glass-card p-6 rounded-2xl border border-navy-800">
        <h2 className="text-base font-bold text-white mb-2">
          Organic Search & Keyword Analytics
        </h2>
        <p className="text-xs text-slate-400 mb-6">
          Track keyword rankings, organic search visibility, and impressions.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-navy-900 p-4 rounded-xl border border-navy-800">
            <span className="text-slate-400 text-xs font-bold block mb-1">
              Avg Keyword Rank
            </span>
            <span className="text-2xl font-black text-emerald-400">#2.8</span>
          </div>
          <div className="bg-navy-900 p-4 rounded-xl border border-navy-800">
            <span className="text-slate-400 text-xs font-bold block mb-1">
              Monthly Organic Impressions
            </span>
            <span className="text-2xl font-black text-orange-500">62,400</span>
          </div>
          <div className="bg-navy-900 p-4 rounded-xl border border-navy-800">
            <span className="text-slate-400 text-xs font-bold block mb-1">
              GBP Map Interactions
            </span>
            <span className="text-2xl font-black text-indigo-400">2,150</span>
          </div>
        </div>
      </div>
    </div>
  );
}
