import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HlsPlayer, seekValueText } from "@/components/video/HlsPlayer";

// C07 (MATCH06, NFR25; docs/build/design/C07.md, Surface 1): the player's
// server-rendered markup. A labelled group, a seek slider with a spoken
// value, the time in `data`, and a captions control and tracks only when
// captions are passed. Controls are disabled until the video loads.

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const source = { kind: "hls" as const, url: "/api/matches/m1/hls/master.m3u8" };

describe("HlsPlayer", () => {
  it("renders a labelled group with seek, time and play, disabled while loading", () => {
    const out = renderToStaticMarkup(
      <HlsPlayer source={source} title="Match video: Home FC v Away FC" />,
    );
    expect(out).toMatch(
      /^<div role="group" aria-label="Match video: Home FC v Away FC" aria-roledescription="video player" aria-busy="true" class="wl-videoplayer"/,
    );
    expect(out).toMatch(
      /<input type="range" class="wl-videoplayer__seek" aria-label="Seek" aria-valuetext="0:00 of 0:00"[^>]*disabled=""/,
    );
    expect(out).toContain('<span class="data wl-videoplayer__time">0:00 / 0:00</span>');
    expect(out).toMatch(/<button[^>]*aria-label="Play"[^>]*disabled=""/);
    expect(out).toContain('title="Play (K)"');
    expect(out).toContain('<span class="sr-only">Loading video…</span>');
    expect(out).toContain('class="wl-skeleton wl-skeleton--video');
    expect(out).toMatch(/<video[^>]*playsInline=""|<video[^>]*playsinline=""/);
    // Custom controls only: the native ones are off.
    expect(out).not.toMatch(/<video[^>]*\scontrols/);
    // No captions passed: no captions control and no track.
    expect(out).not.toContain('aria-label="Captions"');
    expect(out).not.toContain("<track");
  });

  it("adds caption tracks and the captions button when captions are passed", () => {
    const out = renderToStaticMarkup(
      <HlsPlayer
        source={source}
        title="Match video"
        captions={[{ src: "/captions.vtt", label: "English", lang: "en", default: true }]}
      />,
    );
    expect(out).toMatch(
      /<track kind="captions" src="\/captions.vtt" label="English" srcLang="en"/i,
    );
    expect(out).toMatch(/<button[^>]*aria-label="Captions"[^>]*aria-pressed="false"/);
  });

  it("names no shortcuts in host mode", () => {
    const out = renderToStaticMarkup(
      <HlsPlayer source={source} title="Match video" keyboard="host" />,
    );
    expect(out).toContain('title="Play"');
    expect(out).not.toContain("(K)");
  });

  it("speaks the seek value as current of duration, minutes not capped at 59", () => {
    expect(seekValueText(754_000, 5_530_000)).toBe("12:34 of 92:10");
    expect(seekValueText(6_751_000, 7_082_000)).toBe("112:31 of 118:02");
  });
});
