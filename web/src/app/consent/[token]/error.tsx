"use client";

import { useEffect } from "react";
import { EmptyState } from "@/components/states/EmptyState";
import { Button } from "@/components/ui/Button";

/** An unexpected failure on a guardian screen (docs/build/design/C05.md, Surface 1, "Closed views"). */
export default function GuardianError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry is off unless its DSN is set; loaded on demand, as in (app)/error.tsx.
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);
  return (
    <>
      <div className="wl-guardian__head">
        <p className="font-display heading-2">Wideline</p>
      </div>
      <div className="wl-decision">
        <EmptyState
          headingLevel={1}
          art={false}
          title="Something went wrong"
          body="Your answer was not saved. Try again in a few minutes."
          action={
            <Button variant="primary" block className="justify-center" onClick={reset}>
              Try again
            </Button>
          }
        />
        <p className="caption mt-12 text-ink-muted">
          Questions? Ask the club that sent you this link.
        </p>
      </div>
    </>
  );
}
