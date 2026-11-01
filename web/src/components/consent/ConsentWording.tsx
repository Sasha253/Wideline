import { cx } from "@/components/ui/cx";
import { consentWording, type ConsentAudience } from "@/server/consent/wording";

/**
 * The consent wording of one version (CONS04, NFR09, NFR12). The text lives in
 * src/server/consent/wording.ts only. Headings semibold, bodies in body-guardian for
 * guardians and body for staff, then the version line in mono. No inner scroll box: the
 * page scrolls. `framed` puts it on a panel with a hairline.
 */
export function ConsentWording({
  version,
  audience,
  headingLevel,
  framed = true,
  className,
}: {
  version: string;
  audience: ConsentAudience;
  headingLevel: 2 | 3;
  framed?: boolean;
  className?: string;
}) {
  const parts = consentWording(version, audience);
  if (!parts) {
    return <p className="m-0 text-ink-muted">The text of this version is not available.</p>;
  }
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const guardian = audience === "guardian";
  return (
    <div
      className={cx("flex flex-col gap-4", framed && "border border-line bg-panel p-4", className)}
    >
      {parts.map((p) => (
        <div key={p.part} className="flex flex-col gap-1">
          <Heading className="m-0 text-body font-semibold">{p.heading}</Heading>
          <p className={cx("m-0 text-pretty", guardian ? "text-body-guardian" : undefined)}>
            {p.body}
          </p>
        </div>
      ))}
      <p className="m-0 text-body-s text-ink-muted">
        Wording version <span className="font-mono tabular-nums">{version}</span>
      </p>
    </div>
  );
}
