"use client";

import { Suspense } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { RegisterFlow } from "@/components/auth/RegisterFlow";

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-navy-950 flex flex-col">
      <header className="h-20 border-b border-navy-800 bg-navy-900/90 backdrop-blur-md px-4 lg:px-12 flex items-center justify-between">
        <BrandLogo />
        <Link
          href="/"
          className="text-xs font-bold text-slate-400 hover:text-orange-400 transition-colors"
        >
          Home
        </Link>
      </header>

      <main className="flex-1 px-4 py-12 flex items-start justify-center">
        <Suspense
          fallback={
            <div className="text-slate-400 text-sm pt-20">Loading registration...</div>
          }
        >
          <RegisterFlow />
        </Suspense>
      </main>
    </div>
  );
}
