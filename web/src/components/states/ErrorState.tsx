"use client";

import { useEffect, useRef } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";

/**
 * A page that failed to load (docs/build/design/D02.md, Surface 6). Focus moves to the
 * heading on mount, so screen readers hear it. `digest` is the Next.js error reference.
 */
export function ErrorState({
  reset,
  digest,
  headingLevel = 1,
  focusOnMount = true,
}: {
  reset: () => void;
  digest?: string;
  headingLevel?: 1 | 2;
  /** Off only where the state is one example among others (the template showcase). */
  focusOnMount?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="max-w-prose py-12">
      <Heading
        ref={heading}
        tabIndex={-1}
        className={headingLevel === 1 ? "heading-1 outline-none" : "heading-2 outline-none"}
      >
        Something went wrong
      </Heading>
      <p className="body-lg mt-3 text-ink-muted">
        We could not load this page. Try again, or come back in a few minutes.
      </p>
      {digest && (
        <p className="caption mt-3 text-ink-muted">
          Reference: <span className="data">{digest}</span>
        </p>
      )}
      <div className="wl-row mt-6">
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <ButtonLink variant="secondary" href="/">
          Go to your home page
        </ButtonLink>
      </div>
    </div>
  );
}
