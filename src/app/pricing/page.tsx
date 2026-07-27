"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PublicLayout } from "@/components/public/PublicLayout";
import { PricingCards } from "@/components/pricing/PricingCards";

export default function PricingPage() {
  const router = useRouter();

  return (
    <PublicLayout>
      <div className="flex-1 px-4 py-16 max-w-5xl mx-auto text-center sm:text-left animate-fade-in">
        <h1 className="text-3xl font-black text-white mb-2">
          Transparent Service Plans & Top-Up Rates
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm mb-12">
          Create a verified account first, then select a plan or top up credits.
        </p>

        <PricingCards onSelectPlan={() => router.push("/register")} />

        <div className="glass-card p-8 rounded-2xl border border-navy-800 text-xs text-slate-300 leading-relaxed mt-12">
          <h3 className="text-base font-bold text-white mb-2">Supported Payment Gateways</h3>
          <p>
            We accept PayPal for fast checkout and Stripe for Visa, MasterCard, and American
            Express payments — secure billing built for US businesses.
          </p>
          <p className="mt-4">
            <Link href="/register" className="text-orange-400 font-bold hover:underline">
              Register with verification →
            </Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}
