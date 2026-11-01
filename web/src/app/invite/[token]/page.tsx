import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/SignOutButton";
import { ButtonLink } from "@/components/ui/Button";
import { formatDate, ROLE_LABELS, roleInText } from "@/lib/labels";
import { findInvitationByToken, type InvitationView } from "@/server/auth/invitations";
import { getUserContext } from "@/server/auth/session";
import { AcceptForm } from "./AcceptForm";
import { Logo } from "@/components/ui/Logo";

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
            <p className="m-0 mt-4 text-body-s text-ink-muted">
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
  // The auth pattern (Floodlight, Screens A "Sign in", form column): the logo, an
  // overline, the title in title-guardian (sentence case, never caps), one muted line,
  // then the content in a column of at most 400px.
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-100 flex-col justify-center px-5 py-12">
      <Logo />
      <p className="m-0 mt-10 font-mono text-overline uppercase text-ink-muted">Invitation</p>
      <h1 className="m-0 mt-2 text-title-guardian stretch-semi break-words">{title}</h1>
      <p className="m-0 mt-3 text-ink-muted">{children}</p>
      {content && <div className="mt-6">{content}</div>}
      {signInLine && (
        <p className="m-0 mt-6 text-body-s text-ink-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-brand-text underline underline-offset-3">
            Sign in
          </Link>
        </p>
      )}
    </main>
  );
}

function Summary({ inv }: { inv: InvitationView }) {
  const row =
    "flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0";
  const term = "font-mono text-overline uppercase text-ink-muted";
  return (
    <dl className="m-0 border border-line bg-panel px-4 py-1.5">
      <div className={row}>
        <dt className={term}>Organisation</dt>
        <dd className="m-0 text-right font-semibold break-words">{inv.orgName}</dd>
      </div>
      <div className={row}>
        <dt className={term}>Role</dt>
        <dd className="m-0 text-right font-semibold">{ROLE_LABELS[inv.role]}</dd>
      </div>
      {inv.inviterName && (
        <div className={row}>
          <dt className={term}>Invited by</dt>
          <dd className="m-0 text-right font-semibold break-words">{inv.inviterName}</dd>
        </div>
      )}
      <div className={row}>
        <dt className={term}>Expires</dt>
        <dd className="m-0 text-right font-mono text-mono-m tabular-nums">
          {formatDate(inv.expiresAt)}
        </dd>
      </div>
    </dl>
  );
}
