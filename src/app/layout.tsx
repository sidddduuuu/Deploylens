import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";
import "./landing.css";
import "../features/investigation/incident-card.css";

const displayFont = Fraunces({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const uiFont = Plus_Jakarta_Sans({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-ui",
  weight: ["400", "500", "600", "700", "800"],
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
