import { Kbd } from "@/components/ui/Button";

/**
 * The own-mode player shortcuts under the match page's player (C07, Surface 1). The C row
 * shows only when the player has captions, as the captions control does.
 */
export function PlayerShortcuts({ captions = false }: { captions?: boolean }) {
  const rows: [React.ReactNode, string][] = [
    [
      <>
        <Kbd>Space</Kbd> <Kbd>K</Kbd>
      </>,
      "Play or pause",
    ],
    [
      <>
        <Kbd>←</Kbd> <Kbd>→</Kbd>
      </>,
      "Move 5 s",
    ],
    [
      <>
        <Kbd>Home</Kbd> <Kbd>End</Kbd>
      </>,
      "Go to the start or the end",
    ],
    [<Kbd key="m">M</Kbd>, "Mute or unmute"],
    ...(captions
      ? ([[<Kbd key="c">C</Kbd>, "Captions on or off"]] as [React.ReactNode, string][])
      : []),
    [<Kbd key="f">F</Kbd>, "Full screen"],
  ];
  return (
    <details className="mt-3">
      <summary className="inline-flex min-h-control-l cursor-pointer items-center text-label tablet:min-h-0">
        Keyboard shortcuts
      </summary>
      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
        {rows.map(([keys, what]) => (
          <div key={what} className="contents">
            <dt>{keys}</dt>
            <dd className="m-0">{what}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
