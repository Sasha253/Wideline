import type { Metadata } from "next";
import type { ReactNode } from "react";

// The guardian consent frame (docs/build/design/C05.md, Surface 1): no app
// shell and the surface background. The referrer policy is same-origin, so the
// token in the URL never reaches another site in a Referer header. Not
// "no-referrer" (the design's choice): with it, browsers send "Origin: null" on
// a form post, which Next refuses as a cross-site Server Action, so the screens
// would not work without JavaScript. The page renders the wordmark, the step
// and the footer inside the DecisionFlow column.
export const metadata: Metadata = {
  title: "Consent",
  referrer: "same-origin",
};

export default function GuardianLayout({ children }: { children: ReactNode }) {
  return <main className="wl-guardian">{children}</main>;
}
