"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/states/ErrorState";

// The shell stays; the content shows the error state. Sentry is off unless its DSN is set,
// so the SDK loads lazily, as in instrumentation-client.ts.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);
  return <ErrorState reset={reset} digest={error.digest} />;
}
