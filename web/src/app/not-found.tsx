import Link from "next/link";
import { EmptyState } from "@/components/states/EmptyState";
import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";

export const metadata = { title: "Page not found" };

// Unmatched URLs, outside the shell (docs/build/design/D02.md, Surface 6).
export default function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-8 lg:px-8">
      <Link href="/" className="wl-brand heading-2">
        <Logo />
      </Link>
      <EmptyState
        headingLevel={1}
        title="Page not found"
        body="The page you asked for does not exist or has moved."
        action={
          <ButtonLink variant="secondary" href="/">
            Go to Wideline
          </ButtonLink>
        }
      />
    </main>
  );
}
