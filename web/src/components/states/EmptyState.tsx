import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { StateMessage } from "@/components/ui/StateMessage";

/**
 * There is nothing here yet, and what makes something appear (Floodlight, "State ·
 * empty"): the pitch-line mark with the lime bar, a title, one sentence, at most one primary
 * action. `headingLevel={1}` is for full-page states such as "Page not found".
 */
export function EmptyState({
  title,
  body,
  action,
  secondary,
  icon,
  art = true,
  headingLevel = 2,
  className,
}: {
  title: string;
  body?: ReactNode;
  /** The one primary action. */
  action?: ReactNode;
  /** A secondary action ("Import from a spreadsheet"). */
  secondary?: ReactNode;
  /** The icon in the mark (Users for an empty squad). */
  icon?: LucideIcon;
  /** false drops the pitch-line mark (full-page states with their own art). */
  art?: boolean;
  headingLevel?: 1 | 2;
  className?: string;
}) {
  if (!art) {
    const Heading = headingLevel === 1 ? "h1" : "h2";
    return (
      <section className={className ? `wl-state ${className}` : "wl-state"}>
        <Heading className="wl-state__title">{title}</Heading>
        {body && <p className="wl-state__body">{body}</p>}
        {(action || secondary) && (
          <div className="wl-state__actions">
            {action}
            {secondary}
          </div>
        )}
      </section>
    );
  }
  return (
    <StateMessage
      kind="empty"
      title={title}
      body={body}
      action={action}
      secondary={secondary}
      icon={icon}
      headingLevel={headingLevel}
      className={className}
    />
  );
}
