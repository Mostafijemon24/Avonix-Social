import { PublicLayout } from "@/components/public/PublicLayout";

export const metadata = { title: "Features" };

export default function FeaturesPage() {
  return (
    <PublicLayout>
      <div className="flex-1 px-4 py-16 max-w-5xl mx-auto text-center sm:text-left animate-fade-in">
        <h1 className="text-3xl font-black text-white mb-2">
          Comprehensive Platform Features & Architecture
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm mb-12">
          An in-depth breakdown of Avonix Social&apos;s sitemap scraper, intent engines,
          duplicate filtering, and reporting systems.
        </p>

        <div className="space-y-12 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <div className="glass-card p-8 rounded-2xl border border-navy-800">
            <span className="text-orange-500 font-bold uppercase tracking-widest text-[10px]">
              Module 01
            </span>
            <h2 className="text-xl font-bold text-white my-2">
              Intelligent XML Sitemap Parser & Keyword Scraper
            </h2>
            <p className="mb-4">
              Avonix Social connects directly to website XML sitemaps (sitemap.xml,
              post-sitemap.xml, page-sitemap.xml). The engine parses page trees, evaluates
              meta titles, H1 tags, and schema markup to isolate primary homepage keywords
              and secondary topical clusters.
            </p>
            <p className="text-slate-400">
              It also automatically extracts physical business addresses embedded within
              Schema JSON-LD markup, filling city and store location fields while allowing
              manual user edits.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl border border-navy-800">
            <span className="text-orange-500 font-bold uppercase tracking-widest text-[10px]">
              Module 02
            </span>
            <h2 className="text-xl font-bold text-white my-2">5-Intent AI Prompt Generator</h2>
            <p className="mb-4">
              Generates 100% unique, zero-emoji social posts formatted specifically for
              Facebook Pages and Google Business Profile. Users can select from 5 content
              intent modes:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-slate-300">
              {[
                ["Educational Intent", "Focused on delivering value, industry insights, and educational breakdown of complex services."],
                ["Commercial Intent", "Highlights service benefits, competitive positioning, and authority proof."],
                ["Problem-Solving Intent", "Directly addresses common customer pain points and provides actionable solutions."],
                ["Transactional Intent", "Drives direct service bookings, consultations, and sales conversions with link embeds."],
                ["Brand Storytelling Intent", "Shares mission statements, company history, and team dedication stories."],
              ].map(([title, desc], i) => (
                <div
                  key={title}
                  className={`bg-navy-900 p-4 rounded-xl border border-navy-800 ${i === 4 ? "md:col-span-2" : ""}`}
                >
                  <strong className="text-orange-500 block mb-1">{i + 1}. {title}</strong>
                  {desc}
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-8 rounded-2xl border border-navy-800">
            <span className="text-orange-500 font-bold uppercase tracking-widest text-[10px]">
              Module 03
            </span>
            <h2 className="text-xl font-bold text-white my-2">
              Cryptographic Duplicate Protection Filter
            </h2>
            <p>
              Avonix Social generates MD5/SHA256 cryptographic hashes for every generated
              post. If a new post overlaps significantly with previously published content,
              the system blocks the dispatch automatically, protecting your domain and social
              profiles.
            </p>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
