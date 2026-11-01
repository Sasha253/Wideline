"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { authClient } from "@/lib/auth-client";

/**
 * Signs out, then goes to redirectTo. `block` gives the full-width secondary
 * button used in single-column flows (the accept-invitation page); the default
 * is the small ghost button of headers.
 */
export function SignOutButton({
  redirectTo = "/login",
  block = false,
  className,
}: {
  redirectTo?: string;
  block?: boolean;
  className?: string;
}) {
  const router = useRouter();
  return (
    <Button
      variant={block ? "secondary" : "ghost"}
      size={block ? "m" : "s"}
      block={block}
      icon={LogOut}
      className={className}
      onClick={async () => {
        await authClient.signOut();
        router.replace(redirectTo);
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
