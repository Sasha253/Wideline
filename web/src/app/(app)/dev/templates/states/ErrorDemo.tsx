"use client";

import { ErrorState } from "@/components/states/ErrorState";

/** ErrorState with a no-op reset: a server page cannot pass a function to a client component. */
export function ErrorDemo() {
  return <ErrorState reset={() => {}} digest="a1b2c3" headingLevel={2} focusOnMount={false} />;
}
