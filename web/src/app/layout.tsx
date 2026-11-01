import type { Metadata } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { ThemeScript } from "@/components/ui/theme";
import "./globals.css";

// Floodlight type (docs/design-handoff/README.md): Archivo with its width axis
// (wdth 62..125, so font-stretch 100%, 112.5% and 125% all work) and weight 300..900,
// and JetBrains Mono for data. Both are variable fonts, so every weight in range loads.
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Wideline", template: "%s · Wideline" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Dark is the default. ThemeScript swaps in the stored choice before first paint,
    // so React must not warn about the data-theme attribute.
    <html
      lang="en-ZA"
      data-theme="dark"
      className={`${archivo.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body>{children}</body>
    </html>
  );
}
