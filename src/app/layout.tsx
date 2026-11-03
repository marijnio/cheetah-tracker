import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trading Performance Tracker",
  description:
    "Self-hosted Trading Performance & Risk Management Tracker",
  icons: {
    icon: "/logo.svg",
    shortcut: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="min-h-screen bg-[#f8fafc] text-slate-900 antialiased"
      >
        {children}
      </body>
    </html>
  );
}
