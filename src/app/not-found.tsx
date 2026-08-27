import Link from "next/link";
import { BrandLogo } from "@/components/ui/BrandLogo";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-navy-950 flex flex-col">
      <header className="h-20 border-b border-navy-800 bg-navy-900/90 backdrop-blur-md px-4 lg:px-12 flex items-center">
        <BrandLogo />
      </header>

      <main className="flex-1 px-4 py-24 flex items-start justify-center">
        <div className="max-w-md w-full text-center">
          <p className="text-[11px] font-black uppercase tracking-widest text-orange-500 mb-3">
            404
          </p>
          <h1 className="text-3xl font-black text-white mb-3">Page not found</h1>
          <p className="text-sm text-slate-400 mb-8 leading-relaxed">
            This URL is not a valid Avonix Social page. Go home, sign in, or create an
            account.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-5 py-2.5 rounded-xl"
            >
              Go Home
            </Link>
            <Link
              href="/login"
              className="bg-navy-800 hover:bg-navy-700 text-slate-200 text-xs font-bold px-5 py-2.5 rounded-xl border border-navy-700"
            >
              Sign In
            </Link>
            <Link
              href="/register"
              className="bg-navy-800 hover:bg-navy-700 text-slate-200 text-xs font-bold px-5 py-2.5 rounded-xl border border-navy-700"
            >
              Register
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
