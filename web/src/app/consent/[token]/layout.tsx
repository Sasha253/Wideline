import type { Metadata } from "next";
import type { ReactNode } from "react";

// The guardian consent frame (Floodlight, "Guardian consent"): no account and no app shell,
// only the club's name, Wideline's mark and the steps, in one phone-width column on the
// canvas. The referrer policy is same-origin, so the token in the URL never reaches another
// site in a Referer header. Not "no-referrer": with it, browsers send "Origin: null" on a
// form post, which Next refuses as a cross-site Server Action, so the screens would not
// work without JavaScript.
export const metadata: Metadata = {
  title: "Consent",
  referrer: "same-origin",
};

export default function GuardianLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-120 flex-col bg-canvas text-ink">
      {children}
    </main>
  );
}
