import { PublicLayout } from "@/components/public/PublicLayout";

export const metadata = { title: "About Us" };

export default function AboutPage() {
  return (
    <PublicLayout>
      <div className="flex-1 px-4 py-16 max-w-5xl mx-auto text-center sm:text-left animate-fade-in">
        <h1 className="text-3xl font-black text-white mb-2">About Avonix Social</h1>
        <p className="text-slate-400 text-xs sm:text-sm mb-12">
          Empowering digital agencies and local brands through intelligent sitemap-driven
          content automation.
        </p>

        <div className="space-y-8 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <div className="glass-card p-8 rounded-2xl border border-navy-800">
            <h2 className="text-xl font-bold text-white mb-3">Our Vision & Philosophy</h2>
            <p className="mb-4">
              Avonix Social was founded with a singular mission: to bridge the gap between
              website SEO strategy and social media content execution. We recognized that
              digital agencies were wasting thousands of hours manually copying website
              details into social posts.
            </p>
            <p>
              By engineering an automated pipeline that connects XML sitemaps directly to AI
              prompt engines, we allow brands to scale their digital footprint without
              sacrificing content quality or brand integrity.
            </p>
          </div>

          <div className="glass-card p-8 rounded-2xl border border-navy-800">
            <h2 className="text-xl font-bold text-white mb-3">Engineering Excellence</h2>
            <p>
              Our platform is hosted on high-performance infrastructure, ensuring sub-second
              API execution, strict tenant isolation, and cryptographic duplicate protection.
              We are committed to maintaining 99.9% uptime and providing transparent local
              and global billing options.
            </p>
          </div>
        </div>
      </div>
    </PublicLayout>
  );
}
