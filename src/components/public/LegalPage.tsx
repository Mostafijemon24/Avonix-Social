import { PublicLayout } from "@/components/public/PublicLayout";

type Section = { id?: string; title: string; body: string[] };

export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: Section[];
}) {
  return (
    <PublicLayout>
      <div className="flex-1 px-4 py-16 max-w-3xl mx-auto text-left animate-fade-in">
        <h1 className="text-3xl font-black text-white mb-2">{title}</h1>
        <p className="text-slate-500 text-[11px] mb-4">Last updated: {updated}</p>
        <p className="text-slate-400 text-xs sm:text-sm mb-10 leading-relaxed">{intro}</p>
        <div className="space-y-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
          {sections.map((section) => (
            <section
              key={section.title}
              id={section.id}
              className="glass-card p-6 sm:p-8 rounded-2xl border border-navy-800"
            >
              <h2 className="text-lg font-bold text-white mb-3">{section.title}</h2>
              {section.body.map((p, i) => (
                <p key={`${section.title}-${i}`} className="mb-3 last:mb-0">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
