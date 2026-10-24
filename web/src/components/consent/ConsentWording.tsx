import { cx } from "@/components/ui/cx";
import { consentWording, type ConsentAudience } from "@/server/consent/wording";

/**
 * The consent wording of one version (CONS04, NFR09, NFR12;
 * docs/build/design/C05.md, "Component: ConsentWording"). The text lives in
 * src/server/consent/wording.ts only. Headings in body-strong, bodies in
 * body-lg, then the version line. No inner scroll box: the page scrolls.
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
    return <p className="body text-ink-muted">The text of this version is not available.</p>;
  }
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className={cx("wl-terms", framed && "wl-card", className)}>
      {parts.map((p) => (
        <div key={p.part}>
          <Heading className="body-strong">{p.heading}</Heading>
          <p className="body-lg">{p.body}</p>
        </div>
      ))}
      <p className="caption text-ink-muted">
        Wording version <span className="data">{version}</span>
      </p>
    </div>
  );
}
