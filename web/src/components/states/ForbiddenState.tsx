import { ButtonLink } from "@/components/ui/Button";

/**
 * No access to this page (docs/build/design/D02.md, Surface 6). The copy is C01's,
 * verbatim. `homeHref` adds "Go to your home page" for a user with an organisation.
 */
export function ForbiddenState({
  homeHref,
  headingLevel = 1,
}: {
  homeHref?: string;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="max-w-prose py-12">
      <Heading className={headingLevel === 1 ? "heading-1" : "heading-2"}>No access</Heading>
      <p className="body-lg mt-4 text-ink-muted">
        Your account does not have access to this page. Ask a Wideline admin if you think you need
        it.
      </p>
      <div className="wl-row mt-6">
        {homeHref && (
          <ButtonLink variant="primary" href={homeHref}>
            Go to your home page
          </ButtonLink>
        )}
        <ButtonLink variant="secondary" href="/login">
          Sign in as someone else
        </ButtonLink>
      </div>
    </div>
  );
}
