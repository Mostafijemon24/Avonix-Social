import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

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
    <html lang="en" className="h-full bg-navy-950 text-slate-100">
      <body
        className={`${plusJakarta.variable} h-full bg-navy-950 text-slate-200 antialiased font-sans selection:bg-orange-500 selection:text-white`}
      >
        <ToastProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
