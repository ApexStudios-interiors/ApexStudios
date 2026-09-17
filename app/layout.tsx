import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

// Geist replaced Inter with the shadcn adoption (D51). `--font-inter` is
// referenced nowhere in globals.css, so the old face is not loaded at all
// rather than downloaded and unused on every page.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Apex Projects",
  description: "Apex Projects dashboard",
};

const THEME_INIT_SCRIPT = `
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
`;

/**
 * Deliberately thin. The Sidebar/Header/AppProvider shell moved to
 * app/(app)/layout.tsx (build/03-auth-and-rbac.md §2.7) so that app/(auth)/**
 * can render outside it — an auth screen has no session to show a sidebar
 * user card for, and no project to scope a header to.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans text-sm leading-relaxed">{children}</body>
    </html>
  );
}
