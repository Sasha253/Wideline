"use client";

import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { GuardianFrame, GuardianText, GuardianTitle } from "./GuardianFrame";

/** An unexpected failure on a guardian screen (Floodlight, "State · error"), in the guardian frame. */
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
    <GuardianFrame
      club={null}
      actions={
        <Button variant="secondary" size="xl" block icon={RefreshCw} onClick={reset}>
          Try again
        </Button>
      }
    >
      <div role="alert" className="flex flex-col gap-4.5">
        <GuardianTitle>Something went wrong</GuardianTitle>
        <GuardianText>Something went wrong on our side. Try again in a few minutes.</GuardianText>
        {error.digest && (
          <p className="m-0 font-mono text-mono-m text-ink-muted">Reference {error.digest}</p>
        )}
      </div>
    </GuardianFrame>
  );
}
