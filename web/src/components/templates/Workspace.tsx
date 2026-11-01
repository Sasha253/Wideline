import { useId, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { ThemeScope } from "@/components/ui/theme";

export type WorkspacePane = { title: string; content: ReactNode };

/**
 * Two panes for focused work (Floodlight): the review workspace, video left and events
 * right. Side by side from 1280px (primary 8 columns, side 4); stacked below that.
 * `theme="dark"` forces the dark theme on the template (the review workspace should move to
 * ReviewThemeScope from ui/theme-server: dark unless the user chose Light).
 * C11: `headingLevel={3}` when the workspace sits inside a page section (the
 * claimed match's Review h2), and `notice` above the toolbar, inside the theme.
 */
export function Workspace({
  theme,
  toolbar,
  primary,
  side,
  titleHidden = false,
  headingLevel = 2,
  notice,
}: {
  theme?: "dark";
  toolbar?: ReactNode;
  primary: WorkspacePane;
  side: WorkspacePane;
  /** Hides the pane headings visually; screen readers still get them. */
  titleHidden?: boolean;
  /** The pane headings' level: 3 inside a page section that has its own h2. */
  headingLevel?: 2 | 3;
  /** Above the toolbar, inside the theme scope (C11's message region). */
  notice?: ReactNode;
}) {
  const id = useId();
  const heading = cx("wl-section-title", titleHidden && "sr-only");
  const H = headingLevel === 3 ? "h3" : "h2";
  const body = (
    <>
      {notice}
      {toolbar && <div className="wl-workspace__toolbar">{toolbar}</div>}
      <div className="wl-workspace mt-4">
        <section aria-labelledby={`${id}-primary`} className="wl-workspace__primary min-w-0">
          <H id={`${id}-primary`} className={heading}>
            {primary.title}
          </H>
          <div className={titleHidden ? undefined : "mt-4"}>{primary.content}</div>
        </section>
        <section aria-labelledby={`${id}-side`} className="wl-workspace__side min-w-0">
          <H id={`${id}-side`} className={heading}>
            {side.title}
          </H>
          <div className={titleHidden ? undefined : "mt-4"}>{side.content}</div>
        </section>
      </div>
    </>
  );
  if (theme === "dark") {
    return (
      <ThemeScope theme="dark" className="p-4 tablet:p-6">
        {body}
      </ThemeScope>
    );
  }
  return body;
}
