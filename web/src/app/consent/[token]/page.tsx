import Link from "next/link";
import type { ReactNode } from "react";
import { ConsentWording } from "@/components/consent/ConsentWording";
import { Banner, SubmitButton } from "@/components/forms";
import { EmptyState } from "@/components/states/EmptyState";
import { DecisionChoice, DecisionFlow } from "@/components/templates/DecisionFlow";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Check } from "lucide-react";
import { iconProps } from "@/components/ui/icons";
import {
  CONSENT_LINK_DAYS,
  CONSENT_NAME_MAX,
  GUARDIAN_RELATIONSHIPS,
  isGranted,
  RELATIONSHIP_LABELS,
  yesNo,
} from "@/lib/consent-rules";
import { formatDate } from "@/lib/labels";
import { guardianView, type GuardianView } from "@/server/consent/guardian";
import { CONSENT_WORDING_VERSION } from "@/server/consent/wording";
import { guardianDecisionAction, guardianWithdrawAction } from "./actions";
import { Logo } from "@/components/ui/Logo";

type SearchParams = {
  step?: string;
  club?: string;
  scouts?: string;
  error?: string;
  wording?: string;
};
type OpenView = Exclude<GuardianView, { reason: "unknown" }>;

const answer = (v: string | undefined) => (v === "yes" || v === "no" ? v : null);

/**
 * The guardian consent screens (CONS02 to CONS04, NFR11, NFR12;
 * docs/build/design/C05.md, Surface 1). Public: the token is the capability.
 * Stateless: each step is a GET form back here carrying earlier answers, and
 * only the last step posts to a server action, so every step works without
 * JavaScript. One decision per screen, body-lg, 48px targets. The page never
 * trusts the carried answers: guardianDecisionAction validates them again.
 *
 * The about step's form carries the wording version it showed (`wording`)
 * through every later step as a hidden field or URL parameter, and the
 * decision is refused without the current one (NFR09). A question step reached
 * without it shows the about step instead.
 */
export default async function GuardianConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const view = await guardianView(token);
  const self = `/consent/${encodeURIComponent(token)}`;

  if (view.reason === "unknown") {
    return (
      <Frame club={null}>
        <EmptyState
          headingLevel={1}
          art={false}
          title="This link does not work"
          body="Check that you opened the whole link. If it still does not work, ask the club for a new one."
        />
      </Frame>
    );
  }
  const v = view as OpenView;
  return (
    <Frame club={v.clubName}>
      <Step view={v} sp={sp} self={self} token={token} />
    </Frame>
  );
}

function Frame({ club, children }: { club: string | null; children: ReactNode }) {
  return (
    <>
      <div className="wl-guardian__head">
        <p className="heading-2">
          <Logo />
        </p>
        {club && <p className="eyebrow text-ink-muted break-words">{club}</p>}
      </div>
      <div className="wl-decision">
        {children}
        <p className="caption mt-12 text-ink-muted">
          {club ? `Questions? Ask ${club}.` : "Questions? Ask the club that sent you this link."}
        </p>
      </div>
    </>
  );
}

function Step({
  view,
  sp,
  self,
  token,
}: {
  view: OpenView;
  sp: SearchParams;
  self: string;
  token: string;
}) {
  const first = view.firstName;
  const club = view.clubName;
  const decide = view.mode === "decide";
  const granted = isGranted(view.state);
  const clubAnswer = answer(sp.club);
  const scoutsAnswer = answer(sp.scouts);
  // The wording the about step showed, carried through the steps (NFR09).
  const wording = sp.wording === CONSENT_WORDING_VERSION ? CONSENT_WORDING_VERSION : null;
  const withWording = (params: Record<string, string>) =>
    `${self}?${new URLSearchParams({ ...params, wording: wording ?? "" })}`;

  // After a withdrawal through an expired link the link is closed, but the
  // confirmation still shows.
  if (sp.step === "stopped" && view.state === "withdrawn" && view.reason !== "revoked") {
    return (
      <>
        <h1 className="heading-1 break-words">{first}&apos;s stats are no longer shared</h1>
        <p className="body-lg mt-3">
          {club} and scouts can no longer see them.{" "}
          {decide
            ? "If you change your mind, you can use this link again."
            : `If you change your mind, ask ${club}.`}
        </p>
      </>
    );
  }

  if (view.mode === "closed") return <Closed view={view} />;

  let step = sp.step;
  if (step === "answered-club")
    step = clubAnswer === "yes" ? "scouts" : clubAnswer === "no" ? "you" : undefined;
  if (decide && (step === "club" || step === "scouts" || step === "you") && !wording) {
    step = "about";
  }
  if (decide && step === "about") return <About view={view} self={self} />;

  if (decide && step === "club") {
    return (
      <DecisionFlow
        step="Step 2 of 4"
        question={`Can ${club} record ${first}'s stats?`}
        explainer={`We record goals, shots and where ${first} ran during matches. Only ${first}'s coaches and club staff can see them, unless you also say yes to scouts.`}
        action={self}
        submitLabel="Continue"
        secondary={{ href: `${self}?step=about`, label: "Back" }}
        error={
          sp.error === "answers" ? (
            <Banner tone="danger">
              Your answers were not clear. Please answer the questions again.
            </Banner>
          ) : undefined
        }
      >
        <input type="hidden" name="step" value="answered-club" />
        <input type="hidden" name="wording" value={wording!} />
        <DecisionChoice name="club" value="yes" label="Yes, the club can record them" />
        <DecisionChoice
          name="club"
          value="no"
          label="No, do not record them"
          hint={`We will keep no stats about ${first}.`}
        />
      </DecisionFlow>
    );
  }

  if (decide && step === "scouts" && clubAnswer === "yes") {
    return (
      <DecisionFlow
        step="Step 3 of 4"
        question={`Can scouts see ${first}'s stats?`}
        explainer={`Scouts look for players for other clubs and academies. They can only see ${first}'s stats if you say yes.`}
        action={self}
        submitLabel="Continue"
        secondary={{ href: withWording({ step: "club" }), label: "Back" }}
      >
        <input type="hidden" name="step" value="you" />
        <input type="hidden" name="wording" value={wording!} />
        <input type="hidden" name="club" value="yes" />
        <DecisionChoice name="scouts" value="yes" label="Yes, scouts can see them" />
        <DecisionChoice name="scouts" value="no" label="No, keep them inside the club" />
      </DecisionFlow>
    );
  }

  if (decide && step === "you" && clubAnswer && (clubAnswer === "no" || scoutsAnswer)) {
    const scouts = clubAnswer === "no" ? "no" : scoutsAnswer!;
    const errors: Record<string, string> = {
      name: "Enter your full name.",
      relationship: `Choose how you are related to ${first}.`,
      confirm: `Tick the box to confirm you are ${first}'s parent or guardian and 18 or over.`,
    };
    const error = sp.error && errors[sp.error];
    const errorId = "guardian-error";
    return (
      <DecisionFlow
        step={clubAnswer === "no" ? "Step 3 of 3" : "Step 4 of 4"}
        question="Who is answering?"
        explainer={`We keep your name with your answer, so ${club} knows who decided.`}
        action={guardianDecisionAction}
        submitLabel="Save my answer"
        pendingLabel="Saving…"
        secondary={{
          href:
            clubAnswer === "yes"
              ? withWording({ step: "scouts", club: "yes" })
              : withWording({ step: "club" }),
          label: "Back",
        }}
        error={
          error ? (
            <div id={errorId}>
              <Banner tone="danger">{error}</Banner>
            </div>
          ) : undefined
        }
      >
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="wording" value={wording!} />
        <input type="hidden" name="club" value={clubAnswer} />
        <input type="hidden" name="scouts" value={scouts} />
        <div className="wl-card">
          <p className="label text-ink-muted">Your answers</p>
          <p className="body-lg">Club stats: {clubAnswer === "yes" ? "Yes" : "No"}</p>
          {clubAnswer === "yes" && (
            <p className="body-lg">Scouts: {scouts === "yes" ? "Yes" : "No"}</p>
          )}
          <Link href={withWording({ step: "club" })} className="body text-pitch underline">
            Change my answers
          </Link>
        </div>
        <div className="wl-field">
          <label htmlFor="guardian-name" className="body-lg">
            Your full name
          </label>
          <input
            id="guardian-name"
            name="guardianName"
            className="wl-input wl-decision__input body-lg"
            autoComplete="name"
            maxLength={CONSENT_NAME_MAX}
            required
            aria-invalid={sp.error === "name" ? true : undefined}
            aria-describedby={sp.error === "name" ? errorId : undefined}
          />
        </div>
        <fieldset
          className="flex flex-col gap-3"
          aria-describedby={sp.error === "relationship" ? errorId : undefined}
        >
          <legend className="body-lg mb-3">How are you related to {first}?</legend>
          {GUARDIAN_RELATIONSHIPS.map((r) => (
            <DecisionChoice key={r} name="relationship" value={r} label={RELATIONSHIP_LABELS[r]} />
          ))}
        </fieldset>
        <label className="wl-decision__choice wl-decision__choice--top body-lg">
          <input
            type="checkbox"
            name="confirm"
            required
            aria-invalid={sp.error === "confirm" ? true : undefined}
            aria-describedby={sp.error === "confirm" ? errorId : undefined}
          />
          <span className="min-w-0 break-words">
            I am {first}&apos;s parent or guardian and I am 18 or over.
          </span>
          <Check {...iconProps} />
        </label>
      </DecisionFlow>
    );
  }

  if (step === "done" && view.lastDecision) {
    return (
      <>
        <h1 className="heading-1 break-words">Thank you. Your answer is saved.</h1>
        <Summary view={view} label="Saved on" />
        <p className="body-lg mt-6">
          Keep this link. You can use it to change your mind at any time.
        </p>
        <AnswerButtons view={view} self={self} />
      </>
    );
  }

  if (step === "withdraw" && granted) {
    return (
      <>
        <h1 className="heading-1 break-words">Stop sharing {first}&apos;s stats?</h1>
        <p className="body-lg mt-3">
          The club and scouts stop seeing {first}&apos;s stats straight away. We keep no new stats,
          and we remove {first} from clips, searches and saved lists within 24 hours.
        </p>
        <form action={guardianWithdrawAction} className="mt-6 flex flex-col gap-2">
          <input type="hidden" name="token" value={token} />
          <SubmitButton variant="danger" block className="justify-center" pendingLabel="Stopping…">
            Stop sharing
          </SubmitButton>
          <ButtonLink variant="ghost" block className="justify-center" href={self}>
            Keep sharing
          </ButtonLink>
        </form>
      </>
    );
  }

  // The entry view: the answer when there is a grant, otherwise the about step.
  if (granted) {
    return (
      <>
        <h1 className="heading-1 break-words">Your answer for {first}</h1>
        <Summary view={view} label="Answered on" />
        <p className="body-lg mt-6">
          {decide
            ? "You can change your answer or stop sharing at any time."
            : `You can stop sharing at any time. To change anything else, ask ${club} for a new link.`}
        </p>
        <AnswerButtons view={view} self={self} />
      </>
    );
  }
  return <About view={view} self={self} />;
}

/**
 * The about step (Step 1): the consent wording. Its form starts the questions
 * and carries the wording version it showed (NFR09).
 */
function About({ view, self }: { view: OpenView; self: string }) {
  const first = view.firstName;
  const club = view.clubName;
  return (
    <>
      <p className="caption text-ink-muted">Step 1 of 4</p>
      <h1 className="heading-1 break-words">
        {club} would like to record {first}&apos;s match stats
      </h1>
      <p className="body-lg mt-3">
        Please read this, then answer 2 questions. It takes about 2 minutes.
      </p>
      <div className="mt-6">
        <ConsentWording
          version={CONSENT_WORDING_VERSION}
          audience="guardian"
          headingLevel={2}
          framed={false}
        />
      </div>
      <form action={self} className="mt-6">
        <input type="hidden" name="step" value="club" />
        <input type="hidden" name="wording" value={CONSENT_WORDING_VERSION} />
        <Button variant="primary" type="submit" block className="justify-center">
          Continue
        </Button>
      </form>
    </>
  );
}

/** The answer summary card of the done and your-answer views. */
function Summary({ view, label }: { view: OpenView; label: string }) {
  const d = view.lastDecision;
  if (!d) return null;
  return (
    <div className="wl-card mt-6">
      <dl className="wl-facts">
        <dt className="label">Club stats</dt>
        <dd className="body-lg">{yesNo(d.clubStats)}</dd>
        {d.clubStats && (
          <>
            <dt className="label">Scouts</dt>
            <dd className="body-lg">{yesNo(d.scoutVisible)}</dd>
          </>
        )}
        <dt className="label">{label}</dt>
        <dd className="body-lg">{formatDate(d.at)}</dd>
      </dl>
    </div>
  );
}

function AnswerButtons({ view, self }: { view: OpenView; self: string }) {
  const decide = view.mode === "decide";
  const granted = isGranted(view.state);
  if (!decide && !granted) return null;
  return (
    <div className="mt-6 flex flex-col gap-2">
      {decide && (
        <ButtonLink
          variant="secondary"
          className="h-12 w-full justify-center"
          href={`${self}?step=about`}
        >
          Change my answer
        </ButtonLink>
      )}
      {granted && (
        <ButtonLink
          variant="danger"
          className="h-12 w-full justify-center"
          href={`${self}?step=withdraw`}
        >
          Stop sharing {view.firstName}&apos;s stats
        </ButtonLink>
      )}
    </div>
  );
}

function Closed({ view }: { view: OpenView }) {
  const first = view.firstName;
  const club = view.clubName;
  const copy: Record<string, [string, string]> = {
    expired: [
      "This link has expired",
      `Consent links work for ${CONSENT_LINK_DAYS} days. Ask ${club} to send you a new one.`,
    ],
    revoked: [
      "This link no longer works",
      `${club} turned off this link or sent a newer one. Use the newest link from ${club}, or ask them for a new one.`,
    ],
    inactive: [
      "This link no longer works",
      `${club} cannot take answers on Wideline right now. If you have questions, ask ${club}.`,
    ],
    adult: [
      `${first} is now 18`,
      `${first} can now decide for themselves. Ask ${club} to record ${first}'s own answer.`,
    ],
    departed: [
      "This link no longer works",
      `${first} is no longer with ${club}. If you have questions, ask ${club}.`,
    ],
  };
  const [title, body] = copy[view.reason ?? "revoked"] ?? copy.revoked!;
  return <EmptyState headingLevel={1} art={false} title={title} body={body} />;
}
