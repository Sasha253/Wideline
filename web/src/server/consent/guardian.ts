import "server-only";
import type { ConsentRelationship, ConsentState } from "@/generated/prisma/enums";
import { GRANTED_STATES, isGranted, isMinorOn, stateFor } from "@/lib/consent-rules";
import { audit } from "../audit";
import { findConsentRequestByToken, lockConsentPlayer } from "../db/consent";
import { scopedDb } from "../db/scoped";
import { asTransactionClient } from "../squad/tx";
import { GuardianLinkError } from "./errors";
import { guardianDecisionSchema, type GuardianDecisionInput } from "./fields";
import { enqueueConsentWithdrawn } from "./jobs";
import { losesVisibility } from "./records";
import { hashConsentToken } from "./requests";
import { consentVisibleTo } from "./visibility";
import { CONSENT_WORDING_VERSION } from "./wording";

/**
 * Guardian links, guardian side (CONS02, CONS03, NFR11; docs/build/design/C05.md,
 * Surface 1). Public: the token is the capability. The token lookup is the
 * only unscoped read (src/server/db/consent.ts); everything after it runs
 * through scopedDb(organisationId) of the link's organisation. Every action
 * re-checks the link. Decisions are recorded with method guardian_link and no
 * recording user, and audited with actorUserId null.
 */

export { GuardianLinkError };

/**
 * What a link may do now:
 *  - decide: open, not expired, the player current and still under 18;
 *  - withdraw_only: expired, the player departed or now 18, with a grant to
 *    stop (withdrawing stays as easy as granting until the link is revoked
 *    or replaced);
 *  - closed: anything else, with the reason for the copy. Also once the
 *    newest grant is the player's own ("self"): an adult's decision is theirs,
 *    and a guardian's old link may no longer undo it (reason "adult").
 */
export type GuardianMode = "decide" | "withdraw_only" | "closed";
/** inactive: the organisation is suspended or not approved; it has its own copy. */
export type ClosedReason = "unknown" | "expired" | "revoked" | "adult" | "departed" | "inactive";

export type GuardianView =
  | { mode: "closed"; reason: "unknown" }
  | {
      mode: GuardianMode;
      reason: ClosedReason | null;
      requestId: string;
      organisationId: string;
      playerId: string;
      clubName: string;
      firstName: string;
      /** Under 18 today, or no date of birth. */
      minor: boolean;
      state: ConsentState;
      /** The newest decision (not a request), for the answer summary. */
      lastDecision: { clubStats: boolean; scoutVisible: boolean; at: Date } | null;
      expiresAt: Date;
    };

export async function guardianView(token: string, now = new Date()): Promise<GuardianView> {
  const req = token ? await findConsentRequestByToken(hashConsentToken(token)) : null;
  if (!req) return { mode: "closed", reason: "unknown" };
  const db = scopedDb(req.organisationId);
  const [org, player, decision, newestGrant] = await Promise.all([
    db.organisation.findFirst({ select: { name: true, status: true } }),
    db.player.findFirst({
      where: { id: req.playerId, ...consentVisibleTo({ kind: "club" }) },
      select: {
        firstName: true,
        dateOfBirth: true,
        clubStatus: true,
        consentState: true,
      },
    }),
    db.consent.findFirst({
      where: { playerId: req.playerId, state: { not: "requested" } },
      orderBy: { createdAt: "desc" },
      select: {
        clubStats: true,
        scoutVisible: true,
        grantedAt: true,
        withdrawnAt: true,
        createdAt: true,
      },
    }),
    newestGrantOf(db, req.playerId),
  ]);
  if (!org || !player) return { mode: "closed", reason: "unknown" };

  const granted = isGranted(player.consentState);
  const minor = isMinorOn(player.dateOfBirth, now);
  const selfGrant = granted && newestGrant?.relationship === "self";
  let blocked: ClosedReason | null = null;
  if (req.revokedAt || req.superseded) blocked = "revoked";
  else if (org.status !== "active") blocked = "inactive";
  else if (player.clubStatus === "departed") blocked = "departed";
  else if (req.expiresAt.getTime() <= now.getTime()) blocked = "expired";
  else if (!minor || selfGrant) blocked = "adult";

  let mode: GuardianMode;
  if (blocked === null) mode = "decide";
  else if (blocked !== "revoked" && granted && !selfGrant) mode = "withdraw_only";
  else mode = "closed";

  return {
    mode,
    reason: blocked,
    requestId: req.requestId,
    organisationId: req.organisationId,
    playerId: req.playerId,
    clubName: org.name,
    firstName: player.firstName ?? "your child",
    minor,
    state: player.consentState,
    lastDecision: decision && {
      clubStats: decision.clubStats,
      scoutVisible: decision.scoutVisible,
      at: decision.grantedAt ?? decision.withdrawnAt ?? decision.createdAt,
    },
    expiresAt: req.expiresAt,
  };
}

/**
 * The newest grant of a player (club_only or scout_visible), with who gave it.
 * A "self" grant is the adult player's own: no guardian link may withdraw it.
 */
function newestGrantOf(
  db: Pick<ReturnType<typeof scopedDb>, "consent">,
  playerId: string,
): Promise<{ relationship: ConsentRelationship | null } | null> {
  return db.consent.findFirst({
    where: { playerId, state: { in: [...GRANTED_STATES] } },
    orderBy: { createdAt: "desc" },
    select: { relationship: true },
  });
}

/**
 * The error code for each guardian form field (docs/build/design/C05.md, "Server errors").
 * wording: the form did not carry the current wording version from the about
 * step, so there is no proof the guardian was shown it (NFR09); the page sends
 * them back to the about step.
 */
export type GuardianFieldCode = "name" | "relationship" | "confirm" | "answers" | "wording";

export class GuardianInputError extends Error {
  constructor(readonly code: GuardianFieldCode) {
    super(`Guardian input: ${code}`);
    this.name = "GuardianInputError";
  }
}

const FIELD_CODES: Record<string, GuardianFieldCode> = {
  guardianName: "name",
  relationship: "relationship",
  confirm: "confirm",
  club: "answers",
  scouts: "answers",
};

/** The first failing field as its code, in the order the page asks: answers, then name, relationship, confirm. */
function inputCode(issues: { path: PropertyKey[] }[]): GuardianFieldCode {
  const codes = issues.map((i) => FIELD_CODES[String(i.path[0])] ?? "answers");
  for (const c of ["answers", "name", "relationship", "confirm"] as const) {
    if (codes.includes(c)) return c;
  }
  return "answers";
}

/**
 * Saves a guardian's answer through an open link: one row with the guardian's
 * name and relationship, method guardian_link, the current wording version and
 * no recording user; the link's lastUsedAt; and an audit row with actorUserId
 * null, all in one transaction. Throws GuardianLinkError("closed") unless the
 * link may decide, GuardianInputError("wording") unless the form carries the
 * current wording version from the about step (NFR09), and GuardianInputError
 * for an unclear form.
 *
 * The link is checked twice: by guardianView before, and again under the
 * player row lock, where the player must still be current and under 18 (no
 * date of birth counts as a minor), the organisation active and the link
 * neither revoked nor expired. A departure, a date of birth edit, a suspension
 * or a new link that lands in between closes the link, and nothing is written.
 */
export async function guardianDecide(
  token: string,
  input: GuardianDecisionInput,
  now = new Date(),
): Promise<{ consentId: string; state: ConsentState }> {
  const view = await guardianView(token, now);
  if (view.mode !== "decide") throw new GuardianLinkError("closed");
  if (input.wordingVersion !== CONSENT_WORDING_VERSION) throw new GuardianInputError("wording");
  const parsed = guardianDecisionSchema.safeParse(input);
  if (!parsed.success) throw new GuardianInputError(inputCode(parsed.error.issues));
  const data = parsed.data;
  const db = scopedDb(view.organisationId);

  const result = await db.$transaction(async (tx) => {
    const locked = await lockConsentPlayer(tx, view.organisationId, view.playerId);
    if (locked === null || locked.clubStatus !== "active") throw new GuardianLinkError("closed");
    const playerWasMinor = isMinorOn(locked.dateOfBirth, now);
    if (!playerWasMinor) throw new GuardianLinkError("closed");
    const org = await tx.organisation.findFirst({ select: { status: true } });
    if (org?.status !== "active") throw new GuardianLinkError("closed");
    const from = locked.consentState;
    const req = await tx.consentRequest.updateMany({
      where: { id: view.requestId, revokedAt: null, expiresAt: { gt: now } },
      data: { lastUsedAt: now },
    });
    if (req.count === 0) throw new GuardianLinkError("closed");
    const state = stateFor({ clubStats: data.club, scoutVisible: data.scouts }, from);
    const withdrawn = state === "withdrawn";
    const row = await tx.consent.create({
      data: {
        organisationId: view.organisationId,
        playerId: view.playerId,
        state,
        clubStats: data.club,
        scoutVisible: data.scouts,
        grantedBy: data.guardianName,
        relationship: data.relationship,
        method: "guardian_link",
        wordingVersion: CONSENT_WORDING_VERSION,
        playerWasMinor,
        grantedAt: withdrawn ? null : now,
        withdrawnAt: withdrawn ? now : null,
        recordedById: null,
        requestId: view.requestId,
      },
      select: { id: true },
    });
    await audit(
      {
        organisationId: view.organisationId,
        actorUserId: null,
        action: withdrawn ? "consent.withdraw" : "consent.record",
        targetType: "Player",
        targetId: view.playerId,
        metadata: {
          consentId: row.id,
          requestId: view.requestId,
          from,
          to: state,
          method: "guardian_link",
          relationship: data.relationship,
          wordingVersion: CONSENT_WORDING_VERSION,
          playerWasMinor,
        },
      },
      asTransactionClient(tx),
    );
    return { consentId: row.id, state, from };
  });
  if (losesVisibility(result.from, result.state)) {
    await enqueueConsentWithdrawn({
      organisationId: view.organisationId,
      playerId: view.playerId,
      consentId: result.consentId,
    });
  }
  return { consentId: result.consentId, state: result.state };
}

/**
 * Stops sharing through a link (Surface 1, "withdraw"): allowed while the link
 * is not revoked or replaced, also after it expired or the player left or
 * turned 18, as long as there is a grant to stop and it is not the adult
 * player's own ("self"). One withdrawn row (method guardian_link, no recording
 * user), audited with actorUserId null, then the consent-withdrawn job.
 */
export async function guardianWithdraw(
  token: string,
  now = new Date(),
): Promise<{ consentId: string }> {
  const view = await guardianView(token, now);
  if (view.mode === "closed") throw new GuardianLinkError("closed");
  if (!isGranted(view.state)) throw new GuardianLinkError("not_granted");
  const db = scopedDb(view.organisationId);

  const result = await db.$transaction(async (tx) => {
    const locked = await lockConsentPlayer(tx, view.organisationId, view.playerId);
    if (locked === null) throw new GuardianLinkError("closed");
    const from = locked.consentState;
    if (!isGranted(from)) throw new GuardianLinkError("not_granted");
    // Re-read under the lock: an adult's own grant that landed meanwhile is theirs.
    if ((await newestGrantOf(tx, view.playerId))?.relationship === "self") {
      throw new GuardianLinkError("closed");
    }
    const playerWasMinor = isMinorOn(locked.dateOfBirth, now);
    const req = await tx.consentRequest.updateMany({
      where: { id: view.requestId, revokedAt: null },
      data: { lastUsedAt: now },
    });
    if (req.count === 0) throw new GuardianLinkError("closed");
    const row = await tx.consent.create({
      data: {
        organisationId: view.organisationId,
        playerId: view.playerId,
        state: "withdrawn",
        clubStats: false,
        scoutVisible: false,
        method: "guardian_link",
        playerWasMinor,
        withdrawnAt: now,
        recordedById: null,
        requestId: view.requestId,
      },
      select: { id: true },
    });
    await audit(
      {
        organisationId: view.organisationId,
        actorUserId: null,
        action: "consent.withdraw",
        targetType: "Player",
        targetId: view.playerId,
        metadata: {
          consentId: row.id,
          requestId: view.requestId,
          from,
          to: "withdrawn",
          method: "guardian_link",
          playerWasMinor,
        },
      },
      asTransactionClient(tx),
    );
    return { consentId: row.id };
  });
  await enqueueConsentWithdrawn({
    organisationId: view.organisationId,
    playerId: view.playerId,
    consentId: result.consentId,
  });
  return result;
}
