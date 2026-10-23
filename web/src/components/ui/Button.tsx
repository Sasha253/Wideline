import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cx } from "./cx";
import { iconProps } from "./icons";

/**
 * Buttons act; links navigate (ButtonLink). Use one primary button per view.
 * Labels are verb-first, sentence case, at most 4 words.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonLook = {
  variant: ButtonVariant;
  size?: "md" | "sm";
  /** Optional Lucide icon before the label. */
  icon?: LucideIcon;
  /** Keyboard shortcut shown inside the button, e.g. "Y" in the review workspace. */
  kbd?: string;
  /** Full width and 48px tall on phones (forms and consent flows); auto width and 40px from md. */
  block?: boolean;
};

function buttonClass({ variant, size = "md", block }: ButtonLook, className?: string) {
  return cx(
    "wl-btn",
    `wl-btn--${variant}`,
    size === "sm" && "wl-btn--sm",
    block && "w-full h-12 md:w-auto md:h-10",
    className,
  );
}

function ButtonContent({ icon: Icon, kbd, children }: ButtonLook & { children: ReactNode }) {
  return (
    <>
      {Icon && <Icon {...iconProps} />}
      {children}
      {kbd && <Kbd>{kbd}</Kbd>}
    </>
  );
}

type ButtonProps = ButtonLook & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant,
  size,
  icon,
  kbd,
  block,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const look = { variant, size, icon, kbd, block };
  return (
    <button type={type} className={buttonClass(look, className)} {...rest}>
      <ButtonContent {...look}>{children}</ButtonContent>
    </button>
  );
}

type ButtonLinkProps = ButtonLook & ComponentProps<typeof Link>;

/** A link styled as a button. It has no disabled state: render a disabled Button instead. */
export function ButtonLink({
  variant,
  size,
  icon,
  kbd,
  block,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const look = { variant, size, icon, kbd, block };
  return (
    <Link className={buttonClass(look, className)} {...rest}>
      <ButtonContent {...look}>{children as ReactNode}</ButtonContent>
    </Link>
  );
}

type IconButtonProps = Omit<ComponentProps<"button">, "children"> & {
  icon: LucideIcon;
  /** Required: the only text the button has. Name the shortcut, e.g. "Confirm (Y)". */
  "aria-label": string;
  tone?: "default" | "ok" | "no";
};

/** An icon-only button. The aria-label doubles as the tooltip, so mouse users see the shortcut. */
export function IconButton({
  icon: Icon,
  tone = "default",
  className,
  type = "button",
  title,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      title={title ?? rest["aria-label"]}
      className={cx("wl-iconbtn", tone !== "default" && `wl-iconbtn--${tone}`, className)}
      {...rest}
    >
      <Icon {...iconProps} />
    </button>
  );
}

/** A keyboard key, read as part of the button label ("Confirm Y"). */
export function Kbd({ children }: { children: ReactNode }) {
  return <span className="wl-kbd">{children}</span>;
}
