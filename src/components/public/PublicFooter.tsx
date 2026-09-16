import Link from "next/link";

export function PublicFooter() {
  return (
    <footer className="border-t border-navy-800 bg-navy-900/80 py-8 px-4 text-center text-xs text-slate-500">
      <p>
        © 2026 Avonix Social. Enterprise SEO & Social Automation Platform. All rights
        reserved.
      </p>
      <p className="mt-3 space-x-4">
        <Link href="/privacy-policy" className="text-slate-400 hover:text-orange-400">
          Privacy Policy
        </Link>
        <Link href="/terms-of-service" className="text-slate-400 hover:text-orange-400">
          Terms of Service
        </Link>
      </p>
    </footer>
  );
}
