// apps/site/app/layout.tsx
import "./globals.css";
import React from "react";
import LiveBadge from "../components/LiveBadge";
import PrivacyNote from "../components/PrivacyNote";

export const metadata = {
  title: process.env.NEXT_PUBLIC_SITE_NAME || "League One",
  description:
    process.env.NEXT_PUBLIC_TAGLINE ||
    "It’s the worst thing that’s ever happened to me",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-paper text-ink">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 bg-white text-ink border px-3 py-2 rounded"
        >
          Skip to main content
        </a>
        <header className="p-4 border-b">
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <a className="font-bold text-xl" href="/">
              {process.env.NEXT_PUBLIC_SITE_NAME || "League One"}
            </a>
            <div className="flex items-center">
              <nav className="text-sm">
                <a className="px-3 py-2 hover:underline" href="/standings">
                  Standings
                </a>
                <a className="px-3 py-2 hover:underline" href="/rivalries">
                  Rivalries
                </a>
                <a className="px-3 py-2 hover:underline" href="/history">
                  History
                </a>
                <a className="px-3 py-2 hover:underline" href="/owners">
                  Owners
                </a>
                <a className="px-3 py-2 hover:underline" href="/admin">
                  Admin
                </a>
              </nav>
              <LiveBadge />
            </div>
          </div>
        </header>
        <main id="main" className="max-w-5xl mx-auto p-4">
          {children}
        </main>
        <footer className="max-w-5xl mx-auto p-4 text-sm text-gray-500">
          © {new Date().getFullYear()} League One
          <PrivacyNote />
        </footer>
      </body>
    </html>
  );
}
