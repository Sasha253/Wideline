import type { ReactNode } from "react";
import { PageHeader, type PageHeaderProps } from "./PageHeader";

/**
 * A list of things with filters on top (docs/build/design/D02.md, Surface 5). With
 * `isEmpty`, the `empty` node (an EmptyState) replaces the content and the footer.
 */
export function ListPage({
  header,
  toolbar,
  isEmpty = false,
  empty,
  footer,
  children,
}: {
  header: PageHeaderProps;
  toolbar?: ReactNode;
  isEmpty?: boolean;
  empty?: ReactNode;
  /** Pagination, for example. */
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <PageHeader {...header} />
      {toolbar && <div className="wl-row mt-6">{toolbar}</div>}
      {isEmpty ? (
        <div className="mt-6">{empty}</div>
      ) : (
        <>
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-4">{footer}</div>}
        </>
      )}
    </>
  );
}
