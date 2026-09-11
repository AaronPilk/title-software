import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TitleOS — Title Operations",
  description:
    "A local workspace for title operations, company onboarding, policy preparation, and reporting.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
