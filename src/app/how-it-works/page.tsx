import { PublicLayout } from "@/components/public/PublicLayout";

export const metadata = { title: "How It Works" };

const phases = [
  {
    phase: "Phase 01",
    title: "Submit Website Sitemap XML",
    desc: "Paste your website's sitemap URL. The engine parses all listed URLs within seconds, mapping out page hierarchies, blog posts, and category structures.",
  },
  {
    phase: "Phase 02",
    title: "Verify Homepage Keywords & Auto-Detected Address",
    desc: "The AI engine analyzes homepage content and presents extracted Primary and Secondary keywords. Review the auto-detected location and physical address, adjusting if necessary.",
  },
  {
    phase: "Phase 03",
    title: "Select Content Intent & Generate Unique Posts",
    desc: "Choose from 5 content intent modes. The AI generates 2 unique posts (Facebook & GBP) plus a custom AI visual graphic with primary keyword overlays.",
  },
  {
    phase: "Phase 04",
    title: "Dispatch & Automate Review Replies",
    desc: "Approve posts for immediate dispatch or schedule them on the visual calendar. Activate the GBP Review Hub to automatically draft or send personalized replies to customer reviews.",
  },
];

export default function HowItWorksPage() {
  return (
    <PublicLayout>
      <div className="flex-1 px-4 py-16 max-w-5xl mx-auto text-center sm:text-left animate-fade-in">
        <h1 className="text-3xl font-black text-white mb-2">
          How Avonix Social Automates Your Content Pipeline
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm mb-12">
          Step-by-step breakdown of sitemap submission, keyword confirmation, post
          generation, and calendar scheduling.
        </p>

        <div className="space-y-8 text-xs sm:text-sm text-slate-300 leading-relaxed">
          {phases.map((item) => (
            <div key={item.phase} className="glass-card p-6 rounded-2xl border border-navy-800">
              <span className="text-orange-500 font-black text-xl">{item.phase}</span>
              <h3 className="text-lg font-bold text-white my-2">{item.title}</h3>
              <p>{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </PublicLayout>
  );
}
