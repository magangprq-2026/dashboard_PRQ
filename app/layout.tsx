import type { Metadata } from "next";
import { SessionTabGuard } from "@/features/shared/dashboard/session-tab-guard";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRQ Performance Hub",
  description: "PRQ Performance Hub: integrated dashboards for HSI, WMS, LTS, and MetaBright.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.png?v=3",
    shortcut: "/favicon.png?v=3",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body className="antialiased">
        <SessionTabGuard />
        {children}
      </body>
    </html>
  );
}
