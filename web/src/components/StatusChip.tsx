import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Clock,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";

// Statuses always pair a colour with a word and an icon (NFR-27).
type Tone = "ok" | "warn" | "danger" | "neutral";

const MATCH_STATUS: Record<string, { label: string; tone: Tone; Icon: LucideIcon }> = {
  draft: { label: "Draft", tone: "neutral", Icon: CircleDashed },
  uploading: { label: "Uploading", tone: "neutral", Icon: LoaderCircle },
  processing: { label: "Processing", tone: "neutral", Icon: LoaderCircle },
  awaiting_review: { label: "Awaiting review", tone: "warn", Icon: Clock },
  in_review: { label: "In review", tone: "warn", Icon: Clock },
  published: { label: "Published", tone: "ok", Icon: CircleCheck },
  failed: { label: "Failed", tone: "danger", Icon: CircleAlert },
};

export function MatchStatusChip({ status }: { status: string }) {
  const s = MATCH_STATUS[status] ?? { label: status, tone: "neutral" as Tone, Icon: CircleDashed };
  return (
    <span className={`wl-chip wl-chip--${s.tone}`}>
      <s.Icon aria-hidden />
      {s.label}
    </span>
  );
}
