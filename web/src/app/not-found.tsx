import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { StateMessage } from "@/components/ui/StateMessage";

export const metadata = { title: "Page not found" };

// Unmatched URLs, outside the shell (Floodlight, "Empty, loading, error, forbidden"): the
// logo, then the state message on the canvas.
export default function NotFound() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col gap-10 bg-canvas px-5 py-6 text-ink tablet:px-7 tablet:py-8"
    >
      <Link href="/" aria-label="Wideline home" className="self-start text-ink no-underline">
        <Logo />
      </Link>
      <div className="flex flex-1 items-center justify-center">
        <StateMessage
          kind="empty"
          headingLevel={1}
          title="Page not found"
          body="The page you asked for does not exist or has moved."
          action={
            <ButtonLink variant="secondary" href="/" icon={ArrowLeft}>
              Go to Wideline
            </ButtonLink>
          }
        />
      </div>
    </main>
  );
}
