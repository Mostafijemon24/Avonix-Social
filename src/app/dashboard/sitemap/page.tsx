"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Keywords merged into Content Studio */
export default function SitemapRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/social-post");
  }, [router]);
  return <p className="text-sm text-slate-500 p-6">Redirecting to Content Studio…</p>;
}
