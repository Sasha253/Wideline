"use client";

import { useEffect, useState } from "react";
import { shortClaimId, watermarkStart, WATERMARK_POSITIONS } from "@/lib/review-workspace";

const DRIFT_MS = 20_000;
const FADE_MS = 200;

/**
 * The reviewer watermark over the video (REVIEW11, Q-068;
 * docs/build/design/C11.md, "Watermark"): "{scout} · Claim 4F7K2Q", plus
 * "Wideline staff" in a "Log in as" session. It moves to the next of six
 * positions every 20 s, from a start set by the claim id, fading out and in
 * (an instant jump under reduced motion, by CSS). Decorative to assistive
 * technology, and it never takes a click.
 */
export function ReviewWatermark({
  scoutName,
  claimId,
  staff = false,
}: {
  scoutName: string;
  claimId: string;
  staff?: boolean;
}) {
  const [step, setStep] = useState(() => watermarkStart(claimId));
  const [fading, setFading] = useState(false);

  useEffect(() => {
    let fade: number | undefined;
    const timer = window.setInterval(() => {
      setFading(true);
      fade = window.setTimeout(() => {
        setStep((s) => s + 1);
        setFading(false);
      }, FADE_MS);
    }, DRIFT_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(fade);
    };
  }, []);

  const position = WATERMARK_POSITIONS[step % WATERMARK_POSITIONS.length];
  const text = [scoutName, `Claim ${shortClaimId(claimId)}`, staff ? "Wideline staff" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      aria-hidden="true"
      className={`wl-watermark wl-watermark--${position} text-label`}
      data-fading={fading || undefined}
      data-testid="review-watermark"
    >
      {text}
    </div>
  );
}
