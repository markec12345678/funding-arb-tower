import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "funding-arb · command center",
  description:
    "funding-arb paper-validation command center: pipeline status, backtest verdict, live paper funnel, phase-3 safety certification.",
  keywords: ["funding rate arbitrage", "paper trading", "Next.js", "TypeScript", "Tailwind CSS", "dashboard"],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "funding-arb · command center",
    description: "funding arbitrage validation dashboard",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "funding-arb · command center",
    description: "funding arbitrage validation dashboard",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
