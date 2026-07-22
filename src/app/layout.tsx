import type { Metadata, Viewport } from "next";
import { Familjen_Grotesk, Inter } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import "./landing.css";
import "../features/investigation/incident-card.css";

const displayFont = Familjen_Grotesk({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-display",
  weight: "variable",
});

const uiFont = Inter({
  axes: ["opsz"],
  display: "swap",
  subsets: ["latin"],
  variable: "--font-ui",
  weight: "variable",
});

export const metadata: Metadata = {
  description: "Ask why a metric moved and get one compact, evidence-backed incident.",
  title: {
    default: "DeployLens — Evidence-first incident investigation",
    template: "%s | DeployLens",
  },
};

export const viewport: Viewport = {
  initialScale: 1,
  viewportFit: "cover",
  width: "device-width",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${displayFont.variable} ${uiFont.variable}`}>{children}</body>
    </html>
  );
}
