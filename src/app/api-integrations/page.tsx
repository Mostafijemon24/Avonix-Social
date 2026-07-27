import { PublicLayout } from "@/components/public/PublicLayout";

export const metadata = { title: "API Integrations" };

const integrations = [
  {
    title: "Facebook Graph API",
    desc: "Direct OAuth token integration for publishing scheduled posts to Facebook Business Pages with rate-limiting protection.",
  },
  {
    title: "Google Profile API",
    desc: "Native API endpoints for publishing local GBP update posts and retrieving customer reviews in real-time.",
  },
  {
    title: "Gemini AI Engine",
    desc: "Sub-second Natural Language Processing for keyword mapping and zero-emoji post generation.",
  },
];

export default function ApiIntegrationsPage() {
  return (
    <PublicLayout>
      <div className="flex-1 px-4 py-16 max-w-5xl mx-auto text-center sm:text-left animate-fade-in">
        <h1 className="text-3xl font-black text-white mb-2">
          Native API Integrations & Technology Stack
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm mb-12">
          Seamless direct API connections with Meta Graph, Google Business Profile, and
          Gemini AI Engine.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs sm:text-sm text-slate-300 leading-relaxed">
          {integrations.map((item) => (
            <div key={item.title} className="glass-card p-6 rounded-2xl border border-navy-800">
              <h3 className="text-base font-bold text-white mb-2">{item.title}</h3>
              <p>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
