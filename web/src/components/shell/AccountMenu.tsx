"use client";

import { CircleUser } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { IconButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { usePopover } from "./usePopover";

type Account = { name: string; email: string };

/**
 * Who is signed in, and Sign out (docs/build/design/D02.md, Surface 4). Inline in the
 * full sidebar; an Account icon button with a popover in the rail and the phone top bar.
 */
export function AccountMenu({
  user,
  variant,
}: {
  user: Account;
  variant: "inline" | "rail" | "topbar";
}) {
  if (variant === "inline") {
    return (
      <div className="flex flex-col gap-1">
        <p className="body-strong truncate" title={user.name}>
          {user.name}
        </p>
        <p className="caption truncate text-ink-muted" title={user.email}>
          {user.email}
        </p>
        <Link href="/organisations" className="wl-link-row body self-start text-pitch underline">
          Your organisations
        </Link>
        <div>
          <SignOutButton />
        </div>
      </div>
    );
  }
  return <AccountPopover user={user} variant={variant} />;
}

function AccountPopover({ user, variant }: { user: Account; variant: "rail" | "topbar" }) {
  const { open, wrapperProps, triggerProps, panelProps } = usePopover();
  return (
    <div
      {...wrapperProps}
      className={cx("relative", variant === "rail" ? "flex justify-center" : "shrink-0")}
    >
      <IconButton icon={CircleUser} aria-label="Account" {...triggerProps} />
      {open && (
        <div
          {...panelProps}
          role="region"
          aria-label="Account"
          className={cx(
            "wl-popover",
            variant === "rail" ? "wl-popover--beside-end" : "wl-popover--below-end",
          )}
        >
          <div className="px-3 pb-2 pt-2">
            <p className="label break-words">{user.name}</p>
            <p className="caption break-all text-ink-muted">{user.email}</p>
          </div>
          <Link href="/organisations" className="wl-popover__item body">
            Your organisations
          </Link>
          <div className="wl-popover__footer">
            <SignOutButton className="w-full" />
          </div>
        </div>
      )}
    </div>
  );
}
