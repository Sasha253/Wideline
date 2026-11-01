import {
  ChevronRight,
  Lock,
  ShieldCheck,
  ShieldHalf,
  ShieldOff,
  Trash2,
  Check,
} from "lucide-react";
import Link from "next/link";
import { ConsentWording } from "@/components/consent/ConsentWording";
import { Banner, SubmitButton } from "@/components/forms";
import { DecisionChoice } from "@/components/templates/DecisionFlow";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ConsentBadge } from "@/components/ui/ConsentBadge";
import { iconProps } from "@/components/ui/icons";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  CONSENT_LINK_DAYS,
  CONSENT_NAME_MAX,
  GUARDIAN_RELATIONSHIPS,
  isGranted,
  RELATIONSHIP_LABELS,
  yesNo,
} from "@/lib/consent-rules";
import { guardianView, type GuardianView } from "@/server/consent/guardian";
import { CONSENT_WORDING_VERSION } from "@/server/consent/wording";
import { guardianDecisionAction, guardianWithdrawAction } from "./actions";
import {
  AnswerButton,
  GuardianFacts,
  GuardianFrame,
  GuardianPoint,
  GuardianText,
  GuardianTitle,
  guardianLinkClass,
} from "./GuardianFrame";

type SearchParams = {
  step?: string;
  club?: string;
  scouts?: string;
  error?: string;
  wording?: string;
};
type OpenView = Exclude<GuardianView, { reason: "unknown" }>;

const answer = (v: string | undefined) => (v === "yes" || v === "no" ? v : null);

/** The full date in guardian copy: "30 October 2026". */
const longDate = (d: Date) =>
  d.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

/**
 * The guardian consent screens (CONS02 to CONS04, NFR11, NFR12; Floodlight, "Guardian
 * consent"). Public: the token is the capability. Stateless: each step is a GET form back
 * here carrying earlier answers, and only the last step posts to a server action, so every
 * step works without JavaScript. Each question gets its own screen with two equal 64px
 * answer buttons that submit the step. The page never trusts the carried answers:
 * guardianDecisionAction validates them again. It never asks why.
 *
 * The about step's form carries the wording version it showed (`wording`) through every
 * later step as a hidden field or URL parameter, and the decision is refused without the
 * current one (NFR09). A question step reached without it shows the about step instead.
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
      <GuardianFrame club={null}>
        <GuardianTitle>This link does not work</GuardianTitle>
        <GuardianText>
          Check that you opened the whole link. If it still does not work, ask the club for a new
          one.
        </GuardianText>
      </GuardianFrame>
    );
  }
  return <Step view={view as OpenView} sp={sp} self={self} token={token} />;
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
      <GuardianFrame club={club}>
        <span className="self-start">
          <ConsentBadge state="withdrawn" />
        </span>
        <GuardianTitle>{first}&apos;s stats are no longer shared</GuardianTitle>
        <GuardianText>
          {club} and scouts can no longer see them. This happened straight away. If a scout had
          saved {first} on a list, they now see &ldquo;No longer available&rdquo;.
        </GuardianText>
        <GuardianText muted>
          {decide
            ? "You can say yes again later from the same link."
            : `If you change your mind, ask ${club}.`}
        </GuardianText>
      </GuardianFrame>
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
      <form action={self} className="contents">
        <input type="hidden" name="step" value="answered-club" />
        <input type="hidden" name="wording" value={wording!} />
        <GuardianFrame
          club={club}
          step={{ n: 2, of: 4 }}
          actions={
            <>
              <AnswerButton name="club" value="yes" icon={ShieldCheck} tone="text-confirmed">
                Yes, the club can record them
              </AnswerButton>
              <AnswerButton
                name="club"
                value="no"
                icon={ShieldOff}
                tone="text-ink-muted"
                hint={`We will keep no stats about ${first}.`}
              >
                No, do not record them
              </AnswerButton>
              <Link href={`${self}?step=about`} className={guardianLinkClass}>
                Go back
              </Link>
            </>
          }
        >
          <GuardianTitle>
            Can {club} record {first}&apos;s stats?
          </GuardianTitle>
          <GuardianText muted>
            We record goals, shots and where {first} ran during matches. Only {first}&apos;s coaches
            and club staff can see them, unless you also say yes to scouts.
          </GuardianText>
          {sp.error === "answers" && (
            <Banner tone="danger">
              Your answers were not clear. Please answer the questions again.
            </Banner>
          )}
        </GuardianFrame>
      </form>
    );
  }

  if (decide && step === "scouts" && clubAnswer === "yes") {
    return (
      <form action={self} className="contents">
        <input type="hidden" name="step" value="you" />
        <input type="hidden" name="wording" value={wording!} />
        <input type="hidden" name="club" value="yes" />
        <GuardianFrame
          club={club}
          step={{ n: 3, of: 4 }}
          actions={
            <>
              <AnswerButton name="scouts" value="yes" icon={ShieldCheck} tone="text-confirmed">
                Yes, scouts can see them
              </AnswerButton>
              <AnswerButton name="scouts" value="no" icon={ShieldOff} tone="text-ink-muted">
                No, keep them inside the club
              </AnswerButton>
              <Link href={withWording({ step: "club" })} className={guardianLinkClass}>
                Go back
              </Link>
            </>
          }
        >
          <GuardianTitle>Can scouts see {first}&apos;s stats?</GuardianTitle>
          <GuardianText muted>You can change your answer at any time.</GuardianText>
        </GuardianFrame>
      </form>
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
    const back =
      clubAnswer === "yes"
        ? withWording({ step: "scouts", club: "yes" })
        : withWording({ step: "club" });
    return (
      <form action={guardianDecisionAction} className="contents">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="wording" value={wording!} />
        <input type="hidden" name="club" value={clubAnswer} />
        <input type="hidden" name="scouts" value={scouts} />
        <GuardianFrame
          club={club}
          step={clubAnswer === "no" ? { n: 3, of: 3 } : { n: 4, of: 4 }}
          actions={
            <>
              <SubmitButton variant="primary" size="xl" block pendingLabel="Saving">
                Save my answer
              </SubmitButton>
              <Link href={back} className={guardianLinkClass}>
                Go back
              </Link>
            </>
          }
        >
          <GuardianTitle>Who is answering?</GuardianTitle>
          <GuardianText muted>
            We keep your name with your answer, so {club} knows who decided.
          </GuardianText>
          {error && (
            <div id={errorId}>
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
          <div className="flex flex-col gap-1 border border-line bg-panel p-4">
            <p className="m-0 font-semibold">Your answers</p>
            <p className="m-0 text-body-guardian">
              Club stats: {clubAnswer === "yes" ? "Yes" : "No"}
            </p>
            {clubAnswer === "yes" && (
              <p className="m-0 text-body-guardian">Scouts: {scouts === "yes" ? "Yes" : "No"}</p>
            )}
            <Link
              href={withWording({ step: "club" })}
              className="flex min-h-control-l items-center self-start font-medium text-brand-text"
            >
              Change my answers
            </Link>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="guardian-name" className="font-semibold">
              Your full name
            </label>
            <input
              id="guardian-name"
              name="guardianName"
              className="wl-input h-12 text-body-guardian"
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
            <legend className="mb-3 font-semibold">How are you related to {first}?</legend>
            {GUARDIAN_RELATIONSHIPS.map((r) => (
              <DecisionChoice
                key={r}
                name="relationship"
                value={r}
                label={RELATIONSHIP_LABELS[r]}
              />
            ))}
          </fieldset>
          <label className="wl-decision__choice wl-decision__choice--top">
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
        </GuardianFrame>
      </form>
    );
  }

  const d = view.lastDecision;

  if (step === "done" && d) {
    const scouts = d.clubStats && d.scoutVisible;
    return (
      <GuardianFrame club={club}>
        <span className="self-start">
          {d.clubStats ? (
            <ConsentBadge state={scouts ? "given" : "club_only"} />
          ) : (
            <StatusChip tone="neutral" icon={ShieldOff} label="No stats kept" />
          )}
        </span>
        <GuardianTitle>
          {scouts
            ? `Scouts can now see ${first}'s stats`
            : d.clubStats
              ? `${first}'s stats stay inside the club`
              : `${club} will keep no stats about ${first}`}
        </GuardianTitle>
        <GuardianText>Thank you. Your answer is saved.</GuardianText>
        <GuardianFacts
          items={[
            ["Child", first],
            ["Club", club],
            ["Club stats", yesNo(d.clubStats)],
            ...(d.clubStats ? ([["Scouts", yesNo(d.scoutVisible)]] as [string, string][]) : []),
            ["Saved on", longDate(d.at)],
          ]}
        />
        <GuardianText muted>
          Keep this link. You can use it to change your mind at any time.
        </GuardianText>
        <AnswerButtons view={view} self={self} />
      </GuardianFrame>
    );
  }

  if (step === "withdraw" && granted) {
    return (
      <form action={guardianWithdrawAction} className="contents">
        <input type="hidden" name="token" value={token} />
        <GuardianFrame
          club={club}
          actions={
            <>
              <SubmitButton
                variant="danger"
                size="xl"
                block
                icon={ShieldOff}
                pendingLabel="Stopping"
              >
                Stop sharing
              </SubmitButton>
              <ButtonLink variant="ghost" size="l" block href={self}>
                Keep sharing
              </ButtonLink>
            </>
          }
        >
          <GuardianTitle>Stop sharing {first}&apos;s stats?</GuardianTitle>
          <ul className="m-0 list-none p-0">
            <GuardianPoint icon={Lock}>
              The club and scouts stop seeing {first}&apos;s stats straight away.
            </GuardianPoint>
            <GuardianPoint icon={Trash2}>
              We keep no new stats, and we remove {first} from clips, searches and saved lists
              within 24 hours.
            </GuardianPoint>
          </ul>
        </GuardianFrame>
      </form>
    );
  }

  // The entry view: the answer when there is a grant, otherwise the about step.
  if (granted) {
    const scouts = view.state === "scout_visible" || Boolean(d?.clubStats && d.scoutVisible);
    return (
      <GuardianFrame club={club} actions={<AnswerButtons view={view} self={self} />}>
        <GuardianTitle>{first}&apos;s stats</GuardianTitle>
        <div className="flex flex-col gap-3 border border-line bg-panel p-4">
          <span className="self-start">
            {scouts ? (
              <StatusChip tone="ok" icon={ShieldCheck} label="Scouts can see them" />
            ) : (
              <StatusChip tone="ok" icon={ShieldHalf} label="Only the club can see them" />
            )}
          </span>
          {d && <span className="text-body-guardian">You answered on {longDate(d.at)}.</span>}
        </div>
        <div className="flex flex-col gap-2.5">
          <p className="m-0 font-semibold">If you stop sharing</p>
          <ul className="m-0 list-none p-0">
            <GuardianPoint icon={Lock}>
              {scouts ? "Scouts and the club" : "The club"} can&apos;t see {first}&apos;s stats any
              more. This happens straight away.
            </GuardianPoint>
            <GuardianPoint icon={Trash2}>We keep no new stats about {first}.</GuardianPoint>
          </ul>
        </div>
        <GuardianText muted>
          {decide
            ? "You can change your answer or stop sharing at any time."
            : `You can stop sharing at any time. To change anything else, ask ${club} for a new link.`}
        </GuardianText>
      </GuardianFrame>
    );
  }
  return <About view={view} self={self} />;
}

/**
 * The about step (Step 1): what scouts can and never see, then the full consent wording,
 * shown open. Its form starts the questions and carries the wording version it showed
 * (NFR09).
 */
function About({ view, self }: { view: OpenView; self: string }) {
  const first = view.firstName;
  const club = view.clubName;
  return (
    <form action={self} className="contents">
      <input type="hidden" name="step" value="club" />
      <input type="hidden" name="wording" value={CONSENT_WORDING_VERSION} />
      <GuardianFrame
        club={club}
        step={{ n: 1, of: 4 }}
        actions={
          <Button variant="primary" type="submit" size="xl" block>
            Next
            <ChevronRight {...iconProps} />
          </Button>
        }
      >
        <GuardianTitle>{first}&apos;s club records matches</GuardianTitle>
        <GuardianText>
          We record goals, shots and where your child ran during matches. Scouts from other clubs
          can only see this if you say yes.
        </GuardianText>
        <GuardianText muted>
          {club} would like to record {first}&apos;s match stats. Please read this, then answer 2
          questions. It takes about 2 minutes.
        </GuardianText>
        <div className="flex flex-col border-t border-ink">
          <p className="m-0 pt-3.5 pb-2 font-semibold">If you say yes, scouts can see</p>
          <ul className="m-0 list-none p-0">
            <GuardianPoint icon={Check} tone="text-confirmed">
              Goals, shots and passes
            </GuardianPoint>
            <GuardianPoint icon={Check} tone="text-confirmed">
              A map of where {first} played
            </GuardianPoint>
            <GuardianPoint icon={Check} tone="text-confirmed">
              Short video clips of those moments
            </GuardianPoint>
          </ul>
          <p className="m-0 mt-1.5 border-t border-line pt-3.5 pb-2 font-semibold">
            Scouts never see
          </p>
          <ul className="m-0 list-none p-0">
            <GuardianPoint icon={Lock}>Your name, phone number or address</GuardianPoint>
            <GuardianPoint icon={Lock}>
              {first}&apos;s school or anything outside matches
            </GuardianPoint>
          </ul>
        </div>
        {/* The recorded wording is shown open, never collapsed: the form posts this
            version as the one the guardian saw (NFR09, NFR12). Q-073 asks legal whether
            the design's "one tap away" notice is enough. */}
        <section
          aria-labelledby="guardian-notice"
          className="flex flex-col gap-3 border-t border-line pt-3.5"
        >
          <h2 id="guardian-notice" className="m-0 font-semibold">
            The full privacy notice
          </h2>
          <ConsentWording
            version={CONSENT_WORDING_VERSION}
            audience="guardian"
            headingLevel={3}
            framed={false}
          />
        </section>
      </GuardianFrame>
    </form>
  );
}

function AnswerButtons({ view, self }: { view: OpenView; self: string }) {
  const decide = view.mode === "decide";
  const granted = isGranted(view.state);
  if (!decide && !granted) return null;
  return (
    <div className="flex flex-col gap-2">
      {granted && (
        <ButtonLink
          variant="secondary"
          size="xl"
          block
          icon={ShieldOff}
          className="border-rejected text-rejected"
          href={`${self}?step=withdraw`}
        >
          Stop sharing {view.firstName}&apos;s stats
        </ButtonLink>
      )}
      {decide && (
        <ButtonLink variant="ghost" size="l" block href={`${self}?step=about`}>
          Change my answer
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
  return (
    <GuardianFrame club={club}>
      <GuardianTitle>{title}</GuardianTitle>
      <GuardianText>{body}</GuardianText>
    </GuardianFrame>
  );
}
