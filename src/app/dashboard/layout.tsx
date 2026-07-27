import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DashboardAuthGuard } from "@/components/dashboard/DashboardAuthGuard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardAuthGuard>
      <DashboardShell>{children}</DashboardShell>
    </DashboardAuthGuard>
  );
}
