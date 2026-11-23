import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ColdStartBanner } from "@/components/layout/ColdStartBanner";
import { CurrencyProvider } from "@/components/layout/CurrencyProvider";
import { Navbar } from "@/components/layout/Navbar";
import { PinGateModal } from "@/components/layout/PinGateModal";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2563eb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "FinScope — Analyse Fondamentale & Investissement",
  description:
    "Plateforme personnelle d'analyse fondamentale, scoring /100, comparaison sectorielle et suivi de portefeuille.",
  applicationName: "FinScope",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FinScope",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-screen antialiased">
        <ThemeProvider>
          <CurrencyProvider>
            <Navbar />
            <ColdStartBanner />
            <PinGateModal />
            <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </CurrencyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
