"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  ADMIN_IDLE_MS,
  isAdminLoggedIn,
  touchAdminActivity,
  wipeAdminSession,
} from "@/lib/admin-api";

/**
 * Enforces 30-minute idle logout and wipes browser session storage/cookies.
 */
export function AdminIdleGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (pathname === "/admin/login") return;

    const logoutIdle = () => {
      wipeAdminSession();
      router.replace("/admin/login?reason=idle");
    };

    const onActivity = () => {
      if (!isAdminLoggedIn()) {
        logoutIdle();
        return;
      }
      touchAdminActivity();
    };

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"] as const;
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));

    touchAdminActivity();

    timerRef.current = setInterval(() => {
      if (!isAdminLoggedIn()) {
        logoutIdle();
      }
    }, 15_000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [pathname, router]);

  // Visibility change: if tab hidden longer than idle, wipe
  useEffect(() => {
    if (pathname === "/admin/login") return;
    const onVis = () => {
      if (document.visibilityState === "visible" && !isAdminLoggedIn()) {
        wipeAdminSession();
        router.replace("/admin/login?reason=idle");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pathname, router]);

  return <>{children}</>;
}

export { ADMIN_IDLE_MS };
