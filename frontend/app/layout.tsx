import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { HeaderLogo, HeaderSteps } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Data Quality Assistant",
  description: "Check and improve your data's quality with AI — no technical expertise required.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <HeaderLogo />
            {/* useSearchParams requires a Suspense boundary during static rendering */}
            <Suspense fallback={null}>
              <HeaderSteps />
            </Suspense>
          </div>
        </header>
        <div className="mx-auto flex max-w-6xl">
          <Sidebar />
          <main className="min-w-0 flex-1 px-6 py-8">{children}</main>
        </div>
        <footer className="mx-auto max-w-6xl px-6 pb-10 pt-2 text-center text-xs text-slate-400">
          Not sure where to start? Open any table and click{" "}
          <span className="font-medium text-slate-500">“✨ Suggest rules with AI.”</span>
        </footer>
      </body>
    </html>
  );
}
