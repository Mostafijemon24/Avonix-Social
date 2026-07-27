"use client";

import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

export function HomeContent() {
  const { showToast } = useToast();
  const [sitemapResult, setSitemapResult] = useState(false);

  const testSitemap = () => {
    setSitemapResult(true);
    showToast("Public Sitemap Engine Test Completed!", "success");
  };

  return (
    <div className="animate-fade-in">
      <section className="px-4 py-16 sm:py-24 text-center max-w-5xl mx-auto">
        <span className="text-[11px] font-black uppercase tracking-widest text-orange-500 bg-orange-500/10 border border-orange-500/20 px-4 py-1.5 rounded-full mb-6 inline-block">
          Enterprise SEO & Automated Social Publishing Engine
        </span>
        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight mb-6">
          Automate Your Sitemaps, Keyword Mapping &{" "}
          <span className="text-orange-500">Social Dispatches</span>
        </h1>
        <p className="text-slate-400 text-xs sm:text-base max-w-3xl mx-auto mb-8 leading-relaxed">
          Avonix Social scans XML website sitemaps, extracts homepage focus keywords,
          auto-detects business physical locations, generates 100% unique zero-emoji
          social content with primary keyword overlay graphics, and automates Google
          Business Profile review management hands-free.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto justify-center">
          <Link
            href="/register"
            className="bg-orange-500 hover:bg-orange-600 text-white font-black text-xs sm:text-sm px-8 py-4 rounded-xl shadow-xl shadow-orange-500/30 transition-all"
          >
            Register & Launch Dashboard
          </Link>
          <Link
            href="/how-it-works"
            className="bg-navy-800 hover:bg-navy-700 text-slate-200 font-bold text-xs sm:text-sm px-8 py-4 rounded-xl border border-navy-700 transition-all"
          >
            Explore Automation Workflow
          </Link>
        </div>

        <div className="mt-16 w-full glass-panel rounded-3xl p-6 sm:p-10 border border-navy-800 shadow-2xl text-center sm:text-left">
          <h3 className="text-lg font-black text-white mb-2">
            Test Live Sitemap Scraper & Keyword Engine
          </h3>
          <p className="text-xs text-slate-400 mb-6">
            Enter any website XML sitemap to test live homepage keyword extraction and
            location detection.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="url"
              defaultValue="https://nexadigital.com/sitemap.xml"
              className="sm:col-span-3 text-xs bg-navy-950 border border-navy-700 text-white rounded-xl px-4 py-3 font-semibold focus:ring-2 focus:ring-orange-500 outline-none"
            />
            <button
              type="button"
              onClick={testSitemap}
              className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs rounded-xl py-3 px-4 shadow-lg shadow-orange-500/20"
            >
              Extract Keywords
            </button>
          </div>
          {sitemapResult && (
            <div className="mt-6 p-4 bg-navy-900 rounded-2xl border border-navy-800 text-xs text-slate-300">
              <p className="text-emerald-400 font-bold mb-1">Sitemap Parsed Successfully!</p>
              <p>
                <strong>Homepage Focus Primary Keyword:</strong> Enterprise Local SEO
                Services
              </p>
              <p>
                <strong>Secondary Keyword Cluster:</strong> Organic Keyword Ranking,
                Google Business Profile Optimization
              </p>
              <p>
                <strong>Detected Physical Location:</strong> Manhattan, New York, USA
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="px-4 py-16 bg-navy-900/60 border-t border-navy-800 text-center sm:text-left">
        <div className="max-w-5xl mx-auto space-y-12 text-xs sm:text-sm text-slate-300 leading-relaxed">
          <div>
            <h2 className="text-2xl font-black text-white mb-4">
              1. The Evolution of Sitemap-Driven Social Media Publishing
            </h2>
            <p className="mb-4">
              In the modern digital ecosystem, maintaining search engine visibility and
              active social media presence requires continuous synergy. Traditional social
              media management tools operate in silos—requiring manual copy generation,
              manual keyword tag selection, and manual link insertion. Avonix Social
              changes this paradigm by placing your website&apos;s XML sitemap at the
              center of your social content distribution pipeline.
            </p>
            <p>
              By reading your website structure directly from sitemap.xml, Avonix Social
              understands your core content hierarchy. The system extracts primary target
              keywords from your homepage, secondary topical clusters from service landing
              pages, and physical location data from Schema JSON-LD markup.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-black text-white mb-4">
              2. Why Zero-Emoji Corporate Formatting Matters for SEO Brands
            </h2>
            <p className="mb-4">
              While consumer brands often flood social channels with emojis and icons,
              corporate B2B entities, digital agencies, and professional service providers
              require a clean, authoritative, and direct tone of voice.
            </p>
            <p>
              Avonix Social enforces a strict Zero-Emoji Protocol. Generated posts rely on
              compelling storytelling, structured paragraphs, embedded target page links,
              physical store addresses, and precise hashtag matrices.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-black text-white mb-4">
              3. Custom AI Visual Graphics with Primary Keyword Tags
            </h2>
            <p>
              Social algorithms prioritize visual content. Avonix Social dynamically
              synthesizes custom visual graphic concepts featuring your primary keyword
              tags embedded directly into the graphic metadata and alt-text layers.
            </p>
          </div>

          <div>
            <h2 className="text-2xl font-black text-white mb-4">
              4. Hands-Free Google Business Profile Review Response Automation
            </h2>
            <p>
              Local search rankings depend heavily on Google Business Profile activity and
              review response velocity. Avonix Social integrates natively with Google APIs
              to monitor incoming reviews with Confirm-to-Reply and Full Auto-Reply modes.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
