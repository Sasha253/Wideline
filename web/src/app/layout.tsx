import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { ThemeScript } from "@/components/ui/theme";
import "./globals.css";

const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow",
});
const instrument = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-instrument",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: { default: "Wideline", template: "%s · Wideline" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // ThemeScript sets data-theme before hydration, so React must not warn about it.
    <html
      lang="en-ZA"
      className={`${barlow.variable} ${instrument.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
