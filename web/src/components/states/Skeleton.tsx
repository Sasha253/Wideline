import { cx } from "@/components/ui/cx";

type Shape = "title" | "line" | "row" | "hero" | "video";

/** One placeholder block. Hidden from screen readers; the preset wrapper says "Loading…". */
export function Skeleton({ shape, className }: { shape: Shape; className?: string }) {
  return (
    <span aria-hidden="true" className={cx("wl-skeleton", `wl-skeleton--${shape}`, className)} />
  );
}

function Loading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}

const ROWS = [0, 1, 2, 3, 4, 5];

/** A page header and a table card (docs/build/design/D02.md, Surface 6). */
export function ListSkeleton() {
  return (
    <Loading>
      <Skeleton shape="title" className="w-1/2" />
      <Skeleton shape="line" className="mt-2 w-2/3" />
      <div className="wl-card mt-6 flex flex-col gap-2">
        {ROWS.map((i) => (
          <Skeleton key={i} shape="row" className="w-full" />
        ))}
      </div>
    </Loading>
  );
}

/** A back link, a hero and two sections. */
export function DetailSkeleton() {
  return (
    <Loading>
      <Skeleton shape="line" className="w-1/4" />
      <Skeleton shape="hero" className="mt-4 w-full" />
      {[0, 1].map((s) => (
        <div key={s} className="mt-8 flex flex-col gap-2">
          <Skeleton shape="title" className="w-1/3" />
          <Skeleton shape="line" className="w-full" />
          <Skeleton shape="line" className="w-full" />
          <Skeleton shape="line" className="w-2/3" />
        </div>
      ))}
    </Loading>
  );
}

/** A video well and an event column, laid out like the Workspace template. */
export function WorkspaceSkeleton() {
  return (
    <Loading className="wl-workspace">
      <div className="wl-workspace__primary">
        <Skeleton shape="video" className="w-full" />
      </div>
      <div className="wl-workspace__side flex flex-col gap-2">
        {ROWS.map((i) => (
          <Skeleton key={i} shape="row" className="w-full" />
        ))}
      </div>
    </Loading>
  );
}
