import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

export type DataColumn = { id: string; header: ReactNode; numeric?: boolean };
export type DataRow = { id: string; cells: ReactNode[] };

/**
 * A table in a focusable, labelled scroll region (docs/build/design/D02.md, Surface 5).
 * Text left, numbers right in `data`, line dividers, no zebra stripes, sticky header.
 * `cards` is the phone layout (a `ul` of `wl-card`s); with it, the table shows from 768px.
 * Cards hold no id attributes, so ids stay unique (C01 rule).
 */
export function DataTable({
  caption,
  columns,
  rows,
  cards,
}: {
  caption: string;
  columns: DataColumn[];
  rows: DataRow[];
  cards?: ReactNode;
}) {
  return (
    <>
      <div
        role="region"
        aria-label={caption}
        tabIndex={0}
        className={cx("wl-card wl-table-wrap p-0", cards ? "hidden md:block" : undefined)}
      >
        <table className="wl-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.id} scope="col" className={cx("label", c.numeric && "num")}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {row.cells.map((cell, i) => (
                  <td
                    key={columns[i]?.id ?? i}
                    className={columns[i]?.numeric ? "data num" : "body"}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cards && (
        <ul role="list" className="flex flex-col gap-3 md:hidden">
          {cards}
        </ul>
      )}
    </>
  );
}

/** The placeholder for a missing value: an en dash in ink-muted (Lab convention). */
export function Missing() {
  return <span className="text-ink-muted">–</span>;
}
