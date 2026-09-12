import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ballantyne Title — Operations",
  description:
    "Ballantyne Title Company's local workspace for title operations, company onboarding, policy preparation, and reporting.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: {
      url: "/brand/ballantyne-title-logo.png",
      type: "image/png",
      sizes: "500x500",
    },
    shortcut: "/brand/ballantyne-title-logo.png",
    apple: "/brand/ballantyne-title-logo.png",
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
