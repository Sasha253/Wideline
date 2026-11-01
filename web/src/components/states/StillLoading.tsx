"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { iconProps } from "@/components/ui/icons";

/** After 8 seconds of loading, one line explains the wait (Floodlight, "State · loading"). */
export const STILL_LOADING_MS = 8000;

export function StillLoading({
  text = "Still loading. This can take a moment on mobile data.",
  after = STILL_LOADING_MS,
}: {
  text?: string;
  after?: number;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), after);
    return () => clearTimeout(t);
  }, [after]);
  if (!show) return null;
  return (
    <div className="wl-loading__still">
      <LoaderCircle {...iconProps} />
      {text}
    </div>
  );
}
