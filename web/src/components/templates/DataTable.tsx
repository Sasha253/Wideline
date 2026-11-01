import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { iconProps } from "@/components/ui/icons";

export type SortDirection = "ascending" | "descending";

export type DataColumn = {
  id: string;
  header: ReactNode;
  /** Numbers: right-aligned in mono with tabular figures. */
  numeric?: boolean;
  /** This column is the sort: shows its direction and sets `aria-sort`. */
  sort?: SortDirection;
  /** Makes the header a link that sorts by this column (server-rendered sorting). */
  sortHref?: string;
  /** A fixed width, as a CSS length ("48px", "12rem"). */
  width?: string;
  /** Hidden from screen readers' column header (an actions column). */
  label?: string;
};

export type DataRow = {
  id: string;
  cells: ReactNode[];
  /** Part of the current selection: the selected fill and `aria-selected`. */
  selected?: boolean;
  /** Muted, kept for the record (a departed player). */
  muted?: boolean;
};

/**
 * A table in a focusable, labelled scroll region (Floodlight, "Data table"): the header
 * stays fixed with an ink underline, rows are divided by hairlines (never zebra stripes),
 * text is left-aligned and numbers right-aligned in mono, and the sorted column shows its
 * direction with `aria-sort`.
 *
 * - `toolbar` sits above the table; `bulkBar`, when set (rows are selected), replaces it.
 * - `footer` sits under it (DataTablePagination).
 * - `loadingRows` adds static placeholder rows while the next page loads.
 * - `cards` (or DataListRow items) is the phone layout: a list of 56px rows. With it, the
 *   table shows from 768px.
 *
 * Cards hold no id attributes, so ids stay unique (C01 rule).
 */
export function DataTable({
  caption,
  columns,
  rows,
  cards,
  toolbar,
  bulkBar,
  footer,
  loadingRows = 0,
  className,
}: {
  caption: string;
  columns: DataColumn[];
  rows: DataRow[];
  /** The phone layout: DataListRow items (or legacy `li.wl-card`s). */
  cards?: ReactNode;
  toolbar?: ReactNode;
  /** Replaces the toolbar while rows are selected: "2 selected", actions, "Clear selection". */
  bulkBar?: ReactNode;
  footer?: ReactNode;
  loadingRows?: number;
  className?: string;
}) {
  const bar = bulkBar ?? toolbar;
  return (
    <>
      <div className={cx(cards ? "hidden tablet:block" : undefined, className)}>
        {bar && (
          <div className={cx("wl-table__bar", bulkBar ? "wl-table__bar--bulk" : undefined)}>
            {bar}
          </div>
        )}
        <div role="region" aria-label={caption} tabIndex={0} className="wl-table-wrap">
          <table className="wl-table">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.id}
                    scope="col"
                    className={c.numeric ? "num" : undefined}
                    aria-sort={c.sort}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    <HeaderCell column={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  aria-selected={row.selected === undefined ? undefined : row.selected}
                  data-muted={row.muted ? "" : undefined}
                >
                  {row.cells.map((cell, i) => (
                    <td
                      key={columns[i]?.id ?? i}
                      className={columns[i]?.numeric ? "num" : undefined}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
              {Array.from({ length: loadingRows }, (_, i) => (
                <tr key={`loading-${i}`} className="wl-table__skel" aria-hidden="true">
                  {columns.map((c, j) => (
                    <td key={c.id} className={c.numeric ? "num" : undefined}>
                      <span
                        className={cx(
                          "wl-block",
                          c.numeric ? "ml-auto w-9" : j === 0 ? "w-[60%]" : "w-[70%]",
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {footer && <div className="wl-table__foot">{footer}</div>}
      </div>
      {cards && (
        <div className="tablet:hidden">
          {bar && (
            <div className={cx("wl-table__bar", bulkBar ? "wl-table__bar--bulk" : undefined)}>
              {bar}
            </div>
          )}
          <ul role="list" className="wl-listrows">
            {cards}
          </ul>
          {footer && <div className="wl-table__foot">{footer}</div>}
        </div>
      )}
    </>
  );
}

function HeaderCell({ column: c }: { column: DataColumn }) {
  const Arrow = c.sort === "ascending" ? ArrowUp : c.sort === "descending" ? ArrowDown : null;
  const inner = (
    <>
      {c.label ? <span className="sr-only">{c.label}</span> : null}
      {c.header}
      {Arrow && <Arrow {...iconProps} />}
    </>
  );
  if (c.sortHref) return <Link href={c.sortHref}>{inner}</Link>;
  if (c.numeric && Arrow) return <span className="inline-flex items-center gap-1">{inner}</span>;
  return inner;
}

/**
 * One phone row in a DataTable's `cards` (Floodlight, "Phone · list rows"): 56px, an
 * initials square, the name over a mono meta line, a status icon and a chevron. The whole
 * row is the link.
 */
export function DataListRow({
  href,
  initials,
  title,
  meta,
  status,
}: {
  href?: string;
  /** Never a photo. Leave out for rows that aren't people. */
  initials?: string;
  title: ReactNode;
  /** "CM · No. 8 · 612 min". */
  meta?: ReactNode;
  /** A status icon with its own accessible name, or a chip. */
  status?: ReactNode;
}) {
  const body = (
    <>
      {initials !== undefined && (
        <span className="wl-avatar wl-avatar--m" aria-hidden="true">
          {initials}
        </span>
      )}
      <span className="wl-listrow__text">
        <span className="wl-listrow__title">{title}</span>
        {meta && <span className="wl-listrow__meta">{meta}</span>}
      </span>
      <span className="wl-listrow__end">{status}</span>
      {href ? <ChevronRight {...iconProps} className="wl-listrow__chev" /> : <span />}
    </>
  );
  const cls = cx("wl-listrow", initials === undefined && "wl-listrow--plain");
  return (
    <li>
      {href ? (
        <Link href={href} className={cls}>
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/**
 * The table footer: "Showing 1–7 of 24 players", previous and next, "1 / 4". Links, so it
 * works without JavaScript; the ends are `aria-disabled`.
 */
export function DataTablePagination({
  from,
  to,
  total,
  noun,
  page,
  pages,
  prevHref,
  nextHref,
}: {
  from: number;
  to: number;
  total: number;
  /** Plural: "players", "matches". */
  noun: string;
  page: number;
  pages: number;
  prevHref?: string;
  nextHref?: string;
}) {
  return (
    <>
      <span className="flex-1">
        Showing{" "}
        <span className="mono">
          {from}–{to}
        </span>{" "}
        of <span className="mono">{total}</span> {noun}
      </span>
      <PagerLink href={prevHref} label="Previous page" icon={ChevronLeft} />
      <span className="page">
        {page} / {pages}
      </span>
      <PagerLink href={nextHref} label="Next page" icon={ChevronRight} />
    </>
  );
}

function PagerLink({
  href,
  label,
  icon: Icon,
}: {
  href?: string;
  label: string;
  icon: typeof ChevronLeft;
}) {
  if (!href) {
    return (
      <span role="link" aria-disabled="true" aria-label={label} className="wl-pager">
        <Icon {...iconProps} />
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className="wl-pager">
      <Icon {...iconProps} />
    </Link>
  );
}

/** The placeholder for a missing value: an en dash in ink-muted. */
export function Missing() {
  return <span className="text-ink-muted">–</span>;
}
