"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { isAdminLoggedIn, wipeAdminSession } from "@/lib/admin-api";
import { AdminIdleGuard } from "@/components/admin/AdminIdleGuard";

export function AdminAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  // Prevent hydration mismatch:
  // server render doesn't have access to sessionStorage/localStorage,
  // so we delay token-based rendering until after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const loggedIn = mounted ? isAdminLoggedIn() : false;

  useEffect(() => {
    if (pathname === "/admin/login") return;
    if (!mounted) return;

    if (!loggedIn) {
      wipeAdminSession();
      router.replace("/admin/login");
    }
  }, [pathname, router, mounted, loggedIn]);

  if (pathname === "/admin/login") return <>{children}</>;
  if (!loggedIn) return null;

  return <AdminIdleGuard>{children}</AdminIdleGuard>;
}
