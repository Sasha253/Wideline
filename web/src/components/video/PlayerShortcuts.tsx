import { Kbd } from "@/components/ui/Button";

/**
 * The own-mode player shortcuts under the match page's player
 * (docs/build/design/C07.md, Surface 1). The C row shows only when the player
 * has captions, as the captions control does.
 */
export function PlayerShortcuts({ captions = false }: { captions?: boolean }) {
  return (
    <details className="mt-3">
      <summary className="label">Keyboard shortcuts</summary>
      <dl className="wl-facts mt-2">
        <dt>
          <Kbd>Space</Kbd> <Kbd>K</Kbd>
        </dt>
        <dd className="body">Play or pause</dd>
        <dt>
          <Kbd>←</Kbd> <Kbd>→</Kbd>
        </dt>
        <dd className="body">Move 5 s</dd>
        <dt>
          <Kbd>Home</Kbd> <Kbd>End</Kbd>
        </dt>
        <dd className="body">Go to the start or the end</dd>
        <dt>
          <Kbd>M</Kbd>
        </dt>
        <dd className="body">Mute or unmute</dd>
        {captions && (
          <>
            <dt>
              <Kbd>C</Kbd>
            </dt>
            <dd className="body">Captions on or off</dd>
          </>
        )}
        <dt>
          <Kbd>F</Kbd>
        </dt>
        <dd className="body">Full screen</dd>
      </dl>
    </details>
  );
}
