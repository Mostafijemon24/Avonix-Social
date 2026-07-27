"use client";

import { AdminAuthGuard } from "@/components/admin/AdminAuthGuard";
import { AdminShell } from "@/components/admin/AdminShell";
import { usePathname } from "next/navigation";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/admin/login";

  return (
    <AdminAuthGuard>
      {isLogin ? children : <AdminShell>{children}</AdminShell>}
    </AdminAuthGuard>
  );
}
