"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { StateMessage } from "@/components/ui/StateMessage";

/**
 * A page that failed to load (Floodlight, "State · error"): what happened, that nothing was
 * lost, "Try again", and a reference code for support. Focus moves to the heading on mount,
 * so screen readers hear it. `digest` is the Next.js error reference.
 */
export function ErrorState({
  reset,
  digest,
  what = "this page",
  headingLevel = 1,
  focusOnMount = true,
}: {
  reset: () => void;
  digest?: string;
  /** What failed to load, for the title: "the squad" gives "We couldn't load the squad". */
  what?: string;
  headingLevel?: 1 | 2;
  /** Off only where the state is one example among others (the template showcase). */
  focusOnMount?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);
  return (
    <StateMessage
      kind="error"
      headingLevel={headingLevel}
      headingRef={heading}
      title={`We couldn't load ${what}`}
      body="Something went wrong on our side. Nothing you entered has been lost."
      action={
        <Button variant="secondary" icon={RefreshCw} onClick={() => reset()}>
          Try again
        </Button>
      }
      code={digest ? `Reference ${digest}` : undefined}
    />
  );
}
