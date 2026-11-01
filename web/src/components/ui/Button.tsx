import { LoaderCircle, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ButtonElement } from "./ButtonElement";
import { cx } from "./cx";
import { iconProps } from "./icons";

/**
 * Buttons act; links navigate (ButtonLink). Floodlight, "Button" in
 * docs/design-handoff/README.md and design/Wideline Components.dc.html.
 *
 * - primary: the one next step in a view (Confirm, Add event, Continue). One per view.
 * - secondary: alternatives beside it. ghost: toolbars and dense rows.
 * - danger: only to confirm something that deletes or revokes, inside a confirm dialog.
 *
 * Labels are verb phrases in sentence case, with an icon where one of the fixed icon
 * meanings applies (check = confirm, x = reject, pencil = edit, plus = add…).
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/**
 * s 32 (desktop table rows only), m 36 (desktop default), l 44 (touch minimum),
 * xl 56 (phone primary, guardian). Below 768px s and m grow to l.
 */
export type ButtonSize = "s" | "m" | "l" | "xl";

/** @deprecated Use "s" and "m". "sm" maps to s, "md" to m. */
export type LegacyButtonSize = "sm" | "md";

/** The label a loading button shows, by variant, unless `loadingLabel` says otherwise. */
export const LOADING_LABEL: Record<ButtonVariant, string> = {
  primary: "Saving",
  secondary: "Saving",
  ghost: "Loading",
  danger: "Deleting",
};

export function buttonSize(size: ButtonSize | LegacyButtonSize | undefined): ButtonSize {
  if (size === "sm") return "s";
  if (size === "md" || size === undefined) return "m";
  return size;
}

type ButtonLook = {
  variant: ButtonVariant;
  size?: ButtonSize | LegacyButtonSize;
  /** Optional Lucide icon before the label. */
  icon?: LucideIcon;
  /** Keyboard shortcut shown inside the button, e.g. "Y" in the review workspace. */
  kbd?: string;
  /**
   * Full width below 768px (forms and consent flows), where a primary also grows to the
   * 56px phone primary; auto width from 768px.
   */
  block?: boolean;
};

/** The class list of a button, for the rare element that can't be a Button (a summary). */
export function buttonClass(
  { variant, size, block }: Pick<ButtonLook, "variant" | "size" | "block">,
  className?: string,
) {
  return cx(
    "wl-btn",
    `wl-btn--${variant}`,
    `wl-btn--${buttonSize(size)}`,
    block && "wl-btn--block",
    className,
  );
}

function ButtonContent({
  icon: Icon,
  kbd,
  loading,
  loadingLabel,
  children,
}: Pick<ButtonLook, "icon" | "kbd"> & {
  loading?: boolean;
  loadingLabel: string;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <>
        <LoaderCircle {...iconProps} className="wl-spin" />
        {loadingLabel}
      </>
    );
  }
  return (
    <>
      {Icon && <Icon {...iconProps} />}
      {children}
      {kbd && <Kbd>{kbd}</Kbd>}
    </>
  );
}

// ComponentProps includes ref (a plain prop in React 19), so a dialog can focus a Button.
type ButtonProps = ButtonLook &
  ComponentProps<"button"> & {
    /**
     * Busy: a spinner replaces the icon, the label becomes `loadingLabel` ("Saving" by
     * default) and the button keeps its width. Clicks are ignored while loading.
     */
    loading?: boolean;
    /** The busy label, e.g. "Deleting" or "Sending". Defaults by variant (LOADING_LABEL). */
    loadingLabel?: string;
    /**
     * Rendered as aria-disabled, so the button stays focusable; clicks are ignored. Put
     * the reason in nearby text ("Set full time to continue").
     */
    disabled?: boolean;
  };

export function Button({
  variant,
  size,
  icon,
  kbd,
  block,
  loading = false,
  loadingLabel,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <ButtonElement
      type={type}
      loading={loading}
      className={buttonClass({ variant, size, block }, className)}
      {...rest}
    >
      <ButtonContent
        icon={icon}
        kbd={kbd}
        loading={loading}
        loadingLabel={loadingLabel ?? LOADING_LABEL[variant]}
      >
        {children}
      </ButtonContent>
    </ButtonElement>
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
  return (
    <Link className={buttonClass({ variant, size, block }, className)} {...rest}>
      <ButtonContent icon={icon} kbd={kbd} loadingLabel="">
        {children as ReactNode}
      </ButtonContent>
    </Link>
  );
}

type IconButtonProps = Omit<ComponentProps<"button">, "children"> & {
  icon: LucideIcon;
  /** Required: the only text the button has. Name the shortcut, e.g. "Confirm (Y)". */
  "aria-label": string;
  /** secondary: control border (the default). ghost: no border, for toolbars, toasts and dialog headers. */
  variant?: "secondary" | "ghost";
  /** Same heights as Button: s 32, m 36, l 44, xl 56. Below 768px s and m grow to l. */
  size?: ButtonSize;
  /** ok / no colour the icon confirmed / rejected (review row actions). */
  tone?: "default" | "ok" | "no" | "muted";
  /** Rendered as aria-disabled, like Button. */
  disabled?: boolean;
  loading?: boolean;
};

/** An icon-only button. The aria-label doubles as the tooltip, so mouse users see the shortcut. */
export function IconButton({
  icon: Icon,
  variant = "secondary",
  size = "m",
  tone = "default",
  loading = false,
  className,
  type = "button",
  title,
  ...rest
}: IconButtonProps) {
  return (
    <ButtonElement
      type={type}
      loading={loading}
      title={title ?? rest["aria-label"]}
      className={cx(
        "wl-iconbtn",
        variant === "ghost" && "wl-iconbtn--ghost",
        size !== "m" && `wl-iconbtn--${size}`,
        tone !== "default" && `wl-iconbtn--${tone}`,
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle {...iconProps} className="wl-spin" /> : <Icon {...iconProps} />}
    </ButtonElement>
  );
}

/**
 * A keyboard key. Inside a button it is read as part of the label ("Confirm Y") and drawn
 * plain; elsewhere (dialog footers, menus) it sits on a sunken chip.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx("wl-kbd", className)}>{children}</kbd>;
}
