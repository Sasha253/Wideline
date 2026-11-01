import { notFound } from "next/navigation";
import { EmptyState } from "@/components/states/EmptyState";
import { PageHeader } from "@/components/templates/PageHeader";
import { ButtonLink } from "@/components/ui/Button";
import { fixtureText, formatDate } from "@/lib/labels";
import { CLUB_ROLES, requirePageRole } from "@/server/auth/session";
import { limitFor } from "@/server/entitlements";
import { requireSquadOrgPage } from "@/server/matches/access";
import { uploadStatus, type UploadInfo } from "@/server/matches/upload";
import { loadMatch } from "../load";
import { UploadSteps } from "../UploadSteps";
import { UploadPanel } from "./UploadPanel";

export const metadata = { title: "Upload footage" };

/**
 * The upload screen (MATCH02, NFR26; docs/build/design/C06.md, Surface 3; Floodlight
 * Screens A, "Upload" step 1). The server says whether an upload is open (ListParts), so
 * another device or a reload resumes it. The cap is read from entitlements for the copy
 * only; the server enforces it with hasCapacity().
 */
export default async function UploadPage({ params }: { params: Promise<{ matchId: string }> }) {
  const ctx = requireSquadOrgPage(await requirePageRole(CLUB_ROLES));
  const match = await loadMatch(ctx, (await params).matchId);
  if (!match) notFound();
  const limit = await limitFor(ctx.organisationId, "upload_max_bytes");
  const header = (
    <PageHeader
      back={{ href: `/matches/${match.id}`, label: "Match" }}
      eyebrow="Step 1 of 3 · Recording"
      title="Upload footage"
      intro={
        <span className="font-mono text-body-s tabular-nums">
          {fixtureText(match)} · {formatDate(match.playedAt)}
        </span>
      }
    >
      <UploadSteps match={match} current={1} />
    </PageHeader>
  );
  const back = (
    <ButtonLink variant="primary" href={`/matches/${match.id}`}>
      Back to match
    </ButtonLink>
  );

  const live = match.video?.status;
  if (live === "accepted" || !["draft", "uploading"].includes(match.status)) {
    return (
      <>
        {header}
        <div className="mt-6 max-w-2xl">
          <EmptyState
            art={false}
            title="Footage already uploaded"
            body="This match has accepted footage. To use a different recording, an owner or admin deletes the match and you create it again."
            action={back}
          />
        </div>
      </>
    );
  }
  if (live === "probing") {
    return (
      <>
        {header}
        <section aria-labelledby="upload-done" className="mt-6 max-w-2xl">
          <h2 id="upload-done" className="font-display text-heading-section stretch-wide uppercase">
            Upload complete
          </h2>
          <div className="mt-3 border border-line bg-panel p-4">
            <p>We are checking the footage. This usually takes a minute or two.</p>
            <div className="mt-4">{back}</div>
          </div>
        </section>
      </>
    );
  }

  let open: UploadInfo | null = null;
  if (live === "uploading") open = await uploadStatus(ctx, match.id);

  return (
    <>
      {header}
      <UploadPanel
        matchId={match.id}
        limitBytes={limit}
        open={
          open && {
            videoId: open.videoId,
            fileName: open.fileName,
            sizeBytes: open.sizeBytes,
            fingerprint: open.fingerprint,
            percent: open.sizeBytes ? Math.floor((open.uploadedBytes / open.sizeBytes) * 100) : 0,
          }
        }
      />
    </>
  );
}
