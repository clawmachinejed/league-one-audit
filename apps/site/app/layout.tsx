// apps/site/app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "League One",
  description: "It's the worst thing that's ever happened to me.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Sticky, blurred header that reads well on mobile */}
        <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur">
          <div className="mx-auto max-w-5xl px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              {/* Title + tagline stack on mobile */}
              <div className="leading-none">
                <Link
                  href="/"
                  className="block text-2xl font-semibold tracking-tight text-gray-900"
                >
                  League One
                </Link>
                <p className="mt-1 max-w-[18rem] text-xs leading-snug text-gray-500 sm:max-w-none sm:text-sm">
                  It’s the worst thing that’s ever happened to me.
                </p>
              </div>

              {/* Horizontally scrollable nav on small screens (no scrollbar) */}
              <nav className="-mx-4 overflow-x-auto px-4 no-scrollbar sm:m-0 sm:px-0">
                <ul className="flex items-center gap-5 whitespace-nowrap text-[15px] text-gray-700">
                  <li>
                    <Link href="/standings" className="hover:text-black">
                      Standings
                    </Link>
                  </li>
                  <li>
                    <Link href="/rivalries" className="hover:text-black">
                      Rivalries
                    </Link>
                  </li>
                  <li>
                    <Link href="/history" className="hover:text-black">
                      History
                    </Link>
                  </li>
                  <li>
                    <Link href="/owners" className="hover:text-black">
                      Owners
                    </Link>
                  </li>
                  <li>
                    <Link href="/admin" className="hover:text-black">
                      Admin
                    </Link>
                  </li>
                </ul>
              </nav>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

        <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-gray-500">
          © {new Date().getFullYear()} League One
        </footer>
      </body>
    </html>
  );
}
