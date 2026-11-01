import type { ReactNode } from "react";
import { EmptyState } from "@/components/states/EmptyState";
import { ForbiddenState } from "@/components/states/ForbiddenState";
import { DetailSkeleton, ListSkeleton, WorkspaceSkeleton } from "@/components/states/Skeleton";
import { PageHeader } from "@/components/templates/PageHeader";
import { DEV_ROLES, requirePageRole } from "@/server/auth/session";
import { SHOWCASE_BACK } from "../fixtures";
import { ErrorDemo } from "./ErrorDemo";

export const metadata = { title: "States" };

function Example({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="font-display text-heading-section stretch-wide uppercase">
        {title}
      </h2>
      <div className="wl-card mt-4">{children}</div>
    </section>
  );
}

export default async function StatesTemplatePage() {
  await requirePageRole(DEV_ROLES);
  return (
    <>
      <PageHeader back={SHOWCASE_BACK} title="States" />
      <Example id="state-empty" title="Empty state">
        <EmptyState
          title="No matches waiting"
          body="New matches appear here as clubs upload them."
        />
      </Example>
      <Example id="state-list" title="Loading: list">
        <ListSkeleton />
      </Example>
      <Example id="state-detail" title="Loading: detail">
        <DetailSkeleton />
      </Example>
      <Example id="state-workspace" title="Loading: workspace">
        <WorkspaceSkeleton />
      </Example>
      <Example id="state-error" title="Error">
        <ErrorDemo />
      </Example>
      <Example id="state-forbidden" title="No access">
        <ForbiddenState headingLevel={2} homeHref="/" />
      </Example>
    </>
  );
}
