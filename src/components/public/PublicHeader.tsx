"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "@/components/ui/BrandLogo";
import { PUBLIC_NAV } from "@/lib/constants";

export function PublicHeader() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <>
      <nav className="h-20 border-b border-navy-800 bg-navy-900/90 backdrop-blur-md sticky top-0 z-40 px-4 lg:px-12 flex items-center justify-between">
        <BrandLogo />

        <div className="hidden xl:flex items-center space-x-6 text-xs font-bold text-slate-300">
          {PUBLIC_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`hover:text-orange-500 transition-colors ${
                isActive(item.href) ? "text-orange-500" : ""
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center space-x-3">
          <Link
            href="/register"
            className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-lg shadow-orange-500/25 transition-all"
          >
            Register / Sign In
          </Link>
        </div>
      </nav>

      <div className="xl:hidden bg-navy-900 border-b border-navy-800 px-4 py-2 flex flex-wrap justify-around gap-2 text-[11px] font-bold text-slate-300">
        {PUBLIC_NAV.map((item) => (
          <Link key={item.href} href={item.href} className="hover:text-orange-500">
            {item.label === "Pricing & Plans"
              ? "Pricing"
              : item.label === "API Integrations"
                ? "API"
                : item.label === "How It Works"
                  ? "How It Works"
                  : item.label === "GBP Automation"
                    ? "GBP"
                    : item.label}
          </Link>
        ))}
      </div>
    </>
  );
}
