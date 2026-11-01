"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { ErrorState } from "@/components/states/ErrorState";
import { PageHeader } from "@/components/templates/PageHeader";

// The squad when it fails to load (Floodlight, "State · error"): the header stays, then
// "We couldn't load the squad", a secondary Try again and the reference code. The squad's
// sub-pages (players, teams, import) get the general page error. Sentry is off unless its
// DSN is set, so the SDK loads lazily, as in (app)/error.tsx.
export default function SquadError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();
  useEffect(() => {
    void import("@sentry/nextjs").then((Sentry) => Sentry.captureException(error));
  }, [error]);
  if (pathname !== "/squad") return <ErrorState reset={reset} digest={error.digest} />;
  return (
    <>
      <PageHeader title="Squad" />
      <div className="mt-6">
        <ErrorState reset={reset} digest={error.digest} what="the squad" headingLevel={2} />
      </div>
    </>
  );
}
