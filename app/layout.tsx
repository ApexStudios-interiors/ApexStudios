import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/context/AppContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Toast } from "@/components/ui/Toast";
import { DialogHost } from "@/components/dialogs/DialogHost";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Apex Projects",
  description: "Apex Projects dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans text-sm leading-relaxed">
        <AppProvider>
          <div className="grid grid-cols-[250px_1fr] min-h-screen">
            <Sidebar />
            <div className="min-w-0">
              <Header />
              <div className="p-7 max-w-[1280px]">{children}</div>
            </div>
          </div>
          <DialogHost />
          <Toast />
        </AppProvider>
      </body>
    </html>
  );
}
