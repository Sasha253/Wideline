import { useId, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { ThemeScope } from "@/components/ui/theme";

export type WorkspacePane = { title: string; content: ReactNode };

/**
 * Two panes for focused work (docs/build/design/D02.md, Surface 5): C11's review
 * workspace, video left and events right. Side by side from 1280px (primary 8 columns,
 * side 4); stacked below that. `theme="dark"` forces the dark theme on the template.
 */
export function Workspace({
  theme,
  toolbar,
  primary,
  side,
  titleHidden = false,
}: {
  theme?: "dark";
  toolbar?: ReactNode;
  primary: WorkspacePane;
  side: WorkspacePane;
  /** Hides the pane headings visually; screen readers still get them. */
  titleHidden?: boolean;
}) {
  const id = useId();
  const heading = cx("heading-2", titleHidden && "sr-only");
  const body = (
    <>
      {toolbar && <div className="wl-workspace__toolbar">{toolbar}</div>}
      <div className="wl-workspace mt-4">
        <section aria-labelledby={`${id}-primary`} className="wl-workspace__primary min-w-0">
          <h2 id={`${id}-primary`} className={heading}>
            {primary.title}
          </h2>
          <div className={titleHidden ? undefined : "mt-4"}>{primary.content}</div>
        </section>
        <section aria-labelledby={`${id}-side`} className="wl-workspace__side min-w-0">
          <h2 id={`${id}-side`} className={heading}>
            {side.title}
          </h2>
          <div className={titleHidden ? undefined : "mt-4"}>{side.content}</div>
        </section>
      </div>
    </>
  );
  if (theme === "dark") {
    return (
      <ThemeScope theme="dark" className="rounded-lg p-4 md:p-6">
        {body}
      </ThemeScope>
    );
  }
  return body;
}
