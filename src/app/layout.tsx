import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui/Toast";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Avonix Social — Enterprise SEO & Social Publishing Automation",
    template: "%s | Avonix Social",
  },
  description:
    "Avonix Social scans XML sitemaps, extracts homepage keywords, generates zero-emoji social content, and automates Google Business Profile review management.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full bg-navy-950 text-ink">
      <body className="h-full bg-navy-950 text-ink antialiased font-sans selection:bg-orange-500 selection:text-white">
        <ToastProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
