import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Captions, Settings2 } from "lucide-react";
import { HlsPlayer, PlayerMenu, qualityTrigger, seekValueText } from "@/components/video/HlsPlayer";

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
    // Floodlight: the time is mono-l, the duration muted.
    expect(out).toMatch(
      /<span class="wl-videoplayer__time font-mono text-mono-l tabular-nums">0:00<span class="font-normal text-ink-muted"> \/ 0:00<\/span><\/span>/,
    );
    // IconButton renders disabled as aria-disabled (stays focusable, clicks
    // ignored; src/components/ui/Button.tsx), so Play is aria-disabled here.
    expect(out).toMatch(/<button aria-disabled="true"[^>]*aria-label="Play"/);
    expect(out).toContain('title="Play (K)"');
    expect(out).toContain('<span class="sr-only">Loading video…</span>');
    expect(out).toContain('class="wl-skeleton wl-skeleton--video');
    expect(out).toMatch(/<video[^>]*playsInline=""|<video[^>]*playsinline=""/);
    // Custom controls only: the native ones are off (controlsList is not controls).
    expect(out).not.toMatch(/<video[^>]*\scontrols(?![A-Za-z])/);
    // C11 (REVIEW11): stream only, no download, picture-in-picture or speed menu.
    expect(out).toMatch(/<video[^>]*controlsList="nodownload noplaybackrate"/i);
    expect(out).toMatch(/<video[^>]*disablePictureInPicture=""/i);
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

  it("names the quality trigger with its visible text, including the level Auto picked", () => {
    expect(qualityTrigger("Auto", "720p")).toEqual({
      name: "Auto",
      detail: " · 720p",
      label: "Quality: Auto · 720p",
    });
    expect(qualityTrigger("Auto", null).label).toBe("Quality: Auto");
    expect(qualityTrigger("1080p", null).label).toBe("Quality: 1080p");
    // WCAG 2.5.3: the accessible name contains every piece of visible text.
    const q = qualityTrigger("Auto", "480p");
    expect(q.label).toContain(`${q.name}${q.detail}`);
  });

  it("gives the multi-track captions trigger the shortcut title, and the quality trigger its full name", () => {
    const captions = renderToStaticMarkup(
      <PlayerMenu
        heading="Captions"
        label="Captions"
        title="Captions (C)"
        text={null}
        icon={Captions}
        disabled={false}
        items={[
          { value: -1, label: "Off" },
          { value: 0, label: "English" },
          { value: 1, label: "Afrikaans" },
        ]}
        current={-1}
        pressed={false}
        onChoose={() => {}}
      />,
    );
    expect(captions).toMatch(/<button[^>]*aria-label="Captions"[^>]*title="Captions \(C\)"/);

    const q = qualityTrigger("Auto", "720p");
    const quality = renderToStaticMarkup(
      <PlayerMenu
        heading="Quality"
        label={q.label}
        text={
          <>
            {q.name}
            <span className="hidden tablet:inline">{q.detail}</span>
          </>
        }
        icon={Settings2}
        disabled={false}
        items={[{ value: -1, label: "Auto" }]}
        current={-1}
        onChoose={() => {}}
      />,
    );
    expect(quality).toContain('aria-label="Quality: Auto · 720p"');
    expect(quality).toContain("Auto<span");
    expect(quality).toContain(" · 720p</span>");
  });
});
