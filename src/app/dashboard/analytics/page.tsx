"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Analytics merged into Dashboard */
export default function AnalyticsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return <p className="text-sm text-dim p-6">Redirecting to Dashboard…</p>;
}
