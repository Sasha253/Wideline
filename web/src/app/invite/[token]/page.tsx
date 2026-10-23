import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/SignOutButton";
import { ButtonLink } from "@/components/ui/Button";
import { formatDate, ROLE_LABELS, roleInText } from "@/lib/labels";
import { findInvitationByToken, type InvitationView } from "@/server/auth/invitations";
import { getUserContext } from "@/server/auth/session";
import { AcceptForm } from "./AcceptForm";

export const metadata = { title: "Invitation" };

/**
 * The accept-invitation page (AUTH04). Public: the token is the capability.
 * Shows exactly one state; see docs/build/design/C01.md, Surface 2.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [inv, ctx] = await Promise.all([findInvitationByToken(token), getUserContext()]);
  const signedIn = Boolean(ctx);

  if (!inv) {
    return (
      <Frame title="This invitation link does not work">
        Check that you opened the whole link from the email. If it still does not work, ask for a
        new invitation.
      </Frame>
    );
  }

  const role = roleInText(inv.role);
  const byline = inv.inviterName
    ? `${inv.inviterName} invited you to join as ${role}.`
    : `You are invited to join as ${role}.`;

  switch (inv.state) {
    case "expired":
      return (
        <Frame title="This invitation has expired">
          Invitations last 14 days.{" "}
          {inv.fromPlatform
            ? "Reply to the email from Wideline and we will send you a new one."
            : inv.inviterName
              ? `Ask ${inv.inviterName} at ${inv.orgName} to send a new one.`
              : `Ask ${inv.orgName} to send a new one.`}
        </Frame>
      );
    case "revoked":
      return (
        <Frame title="This invitation was cancelled">
          {inv.fromPlatform
            ? "We sent you a newer invitation, so this link no longer works. Use the link in the most recent email from Wideline."
            : `${inv.orgName} cancelled this invitation, so the link no longer works. If you think this is a mistake, contact the person who invited you.`}
        </Frame>
      );
    case "used":
      return (
        <Frame
          title="This invitation has already been used"
          content={
            signedIn ? (
              <ButtonLink href="/organisations" variant="secondary" block>
                Go to your organisations
              </ButtonLink>
            ) : (
              <ButtonLink href="/login" variant="secondary" block>
                Sign in
              </ButtonLink>
            )
          }
          signInLine={signedIn}
        >
          {signedIn ? "You may already be a member." : "If you accepted it, sign in to continue."}
        </Frame>
      );
    case "org_inactive":
      return (
        <Frame title={`${inv.orgName} is not active`}>
          {inv.orgName} is not active on Wideline at the moment, so you cannot join it yet. Contact
          the person who invited you.
        </Frame>
      );
  }

  if (ctx && ctx.user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return (
      <Frame
        title="This invitation is for another email"
        content={<SignOutButton redirectTo={`/invite/${token}`} block />}
        signInLine={false}
      >
        You are signed in as <span className="break-all">{ctx.user.email}</span>, but this
        invitation was sent to <span className="break-all">{inv.email}</span>. Sign out, then open
        the link again.
      </Frame>
    );
  }

  if (ctx) {
    return (
      <Frame
        title={`Join ${inv.orgName}`}
        content={
          <>
            <Summary inv={inv} />
            <AcceptForm
              token={token}
              mode="join"
              joinLabel={`Join as ${ROLE_LABELS[inv.role].toLowerCase()}`}
            />
            <p className="caption mt-4 text-ink-muted">
              Signed in as <span className="break-all">{ctx.user.email}</span>.
            </p>
          </>
        }
        signInLine={false}
      >
        {byline}
      </Frame>
    );
  }

  if (inv.userExists) {
    return (
      <Frame
        title={`Join ${inv.orgName}`}
        content={
          <>
            <Summary inv={inv} />
            <ButtonLink
              href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
              variant="primary"
              block
              className="mt-6 justify-center"
            >
              Sign in to accept
            </ButtonLink>
          </>
        }
        signInLine={false}
      >
        {inv.inviterName ? `${inv.inviterName} invited ` : null}
        <span className="break-all">{inv.email}</span>
        {inv.inviterName ? " " : " is invited "}to join as {role}. Sign in with that email to
        accept.
      </Frame>
    );
  }

  return (
    <Frame
      title={`Join ${inv.orgName}`}
      content={
        <>
          <Summary inv={inv} />
          <AcceptForm token={token} mode="new" email={inv.email} name={inv.inviteeName ?? ""} />
        </>
      }
      signInLine
    >
      {byline} Create your account to accept.
    </Frame>
  );
}

function Frame({
  title,
  children,
  content,
  signInLine = true,
}: {
  title: string;
  children: ReactNode;
  content?: ReactNode;
  signInLine?: boolean;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12">
      <p className="font-display heading-2">Wideline</p>
      <p className="eyebrow mt-6 text-ink-muted">Invitation</p>
      <h1 className="heading-2 mt-1 break-words">{title}</h1>
      <p className="body mt-2 text-ink-muted">{children}</p>
      {content && <div className="mt-6">{content}</div>}
      {signInLine && (
        <p className="caption mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-pitch underline">
            Sign in
          </Link>
        </p>
      )}
    </main>
  );
}

function Summary({ inv }: { inv: InvitationView }) {
  return (
    <dl className="wl-card grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      <dt className="label text-ink-muted">Organisation</dt>
      <dd className="body-strong break-words">{inv.orgName}</dd>
      <dt className="label text-ink-muted">Role</dt>
      <dd className="body-strong">{ROLE_LABELS[inv.role]}</dd>
      {inv.inviterName && (
        <>
          <dt className="label text-ink-muted">Invited by</dt>
          <dd className="body-strong break-words">{inv.inviterName}</dd>
        </>
      )}
      <dt className="label text-ink-muted">Expires</dt>
      <dd className="data">{formatDate(inv.expiresAt)}</dd>
    </dl>
  );
}
