import "server-only";
import type {
  ClubStatus,
  ConsentMethod,
  ConsentRelationship,
  ConsentState,
} from "@/generated/prisma/enums";
import { playerName } from "@/lib/labels";
import type { AuthContext } from "../auth/session";
import { audit } from "../audit";
import { lockConsentPlayer, lockConsentState } from "../db/consent";
import { requireSquadOrg } from "../squad/access";
import { asTransactionClient, type AuditTx } from "../squad/tx";
import { ConsentError } from "./errors";
import {
  ALREADY_WITHDRAWN,
  consentDeparted,
  decisionBeforeBirth,
  DOB_CHANGED_WHILE_RECORDING,
  GUARDIAN_NAME_REQUIRED,
  isGranted,
  isMinorOn,
  minorOnDecisionDate,
  playerIsAdult,
  recordConsentSchema,
  relationshipRequired,
  stateFor,
  withdrawSchema,
  type RecordConsentInput,
  type WithdrawInput,
} from "./fields";
import { enqueueConsentWithdrawn } from "./jobs";
import { consentVisibleTo } from "./visibility";
import { CONSENT_WORDING_VERSION } from "./wording";

/**
 * Consent records, club side (CONS01 to CONS03, NFR09 to NFR11, NFR20;
 * docs/build/design/C05.md, Surfaces 2, 4 and 5). Every function goes through
 * the caller's scoped client. A change inserts one Consent row (never an
 * update: the table is append-only) and its audit row in one transaction; the
 * insert trigger moves Player.consentState in the same statement. Audit
 * metadata carries ids, states, the method, the relationship, the wording
 * version and playerWasMinor: never a name.
 */

export { ConsentError };

export type ConsentRecord = {
  id: string;
  state: ConsentState;
  clubStats: boolean;
  scoutVisible: boolean;
  grantedBy: string | null;
  relationship: ConsentRelationship | null;
  method: ConsentMethod | null;
  wordingVersion: string | null;
  playerWasMinor: boolean;
  grantedAt: Date | null;
  withdrawnAt: Date | null;
  requestId: string | null;
  recordedById: string | null;
  /** The recording user's name; null when the guardian decided by link, or the user is gone. */
  recordedByName: string | null;
  createdAt: Date;
};

const RECORD_SELECT = {
  id: true,
  state: true,
  clubStats: true,
  scoutVisible: true,
  grantedBy: true,
  relationship: true,
  method: true,
  wordingVersion: true,
  playerWasMinor: true,
  grantedAt: true,
  withdrawnAt: true,
  requestId: true,
  recordedById: true,
  createdAt: true,
  recordedBy: { select: { name: true } },
} as const;

type SelectedRecord = Omit<ConsentRecord, "recordedByName"> & {
  recordedBy: { name: string } | null;
};

function toRecord({ recordedBy, ...row }: SelectedRecord): ConsentRecord {
  return { ...row, recordedByName: recordedBy?.name ?? null };
}

export type ConsentPlayer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  isPlaceholder: boolean;
  squadNumber: number | null;
  dateOfBirth: Date | null;
  clubStatus: ClubStatus;
  consentState: ConsentState;
  isOpposition: boolean;
};

/** A player of this organisation, for consent. Throws ConsentError("not_found"). */
export async function consentPlayer(ctx: AuthContext, playerId: string): Promise<ConsentPlayer> {
  const p = await ctx.db.player.findFirst({
    where: { id: playerId, ...consentVisibleTo({ kind: "club" }) },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      isPlaceholder: true,
      squadNumber: true,
      dateOfBirth: true,
      clubStatus: true,
      consentState: true,
      team: { select: { isOpposition: true } },
    },
  });
  if (!p) throw new ConsentError("not_found");
  const { team, ...rest } = p;
  return { ...rest, isOpposition: team?.isOpposition ?? false };
}

/** Named, own-team players only: placeholders and opposition players never hold consent. */
function assertNamed(p: ConsentPlayer): void {
  if (p.isPlaceholder || p.isOpposition) throw new ConsentError("placeholder");
}

const firstNameOf = (p: ConsentPlayer) => p.firstName ?? playerName(p);

/**
 * The newest row, or a synthetic "none" with no id when the player has none.
 * Its state always equals Player.consentState (the trigger writes both).
 */
export async function currentConsent(
  ctx: AuthContext,
  playerId: string,
): Promise<ConsentRecord | { id: null; state: "none" }> {
  requireSquadOrg(ctx);
  await consentPlayer(ctx, playerId);
  const row = await ctx.db.consent.findFirst({
    where: { playerId },
    orderBy: { createdAt: "desc" },
    select: RECORD_SELECT,
  });
  return row ? toRecord(row) : { id: null, state: "none" };
}

/** Every row for one player, newest first (Surface 5). Throws ConsentError("not_found"). */
export async function consentHistory(ctx: AuthContext, playerId: string): Promise<ConsentRecord[]> {
  requireSquadOrg(ctx);
  await consentPlayer(ctx, playerId);
  const rows = await ctx.db.consent.findMany({
    where: { playerId },
    orderBy: { createdAt: "desc" },
    select: RECORD_SELECT,
  });
  return rows.map(toRecord);
}

/** True when a change from `from` to `to` takes visibility away (NFR11): the purge job runs. */
export function losesVisibility(from: ConsentState, to: ConsentState): boolean {
  return (isGranted(from) && !isGranted(to)) || (from === "scout_visible" && to === "club_only");
}

/**
 * Records a decision made on paper, in person or by email (Surface 2). The
 * player must be named, on an own team and current. A player under 18 on the
 * decision date (or with no date of birth) needs a parent or guardian, with a
 * name and relationship (CONS02); an adult decides for themselves (relationship
 * "self", their own name). The choices give the state (stateFor): club no
 * after a grant is a withdrawal, otherwise a refusal (none). Stamps
 * CONSENT_WORDING_VERSION. Audited as consent.record, or consent.withdraw when
 * the answer withdraws a grant.
 */
export async function recordConsent(
  ctx: AuthContext,
  playerId: string,
  input: RecordConsentInput,
  now = new Date(),
): Promise<{ consentId: string; state: ConsentState; from: ConsentState }> {
  requireSquadOrg(ctx);
  const player = await consentPlayer(ctx, playerId);
  assertNamed(player);
  const first = firstNameOf(player);
  if (player.clubStatus === "departed") {
    throw new ConsentError("departed", consentDeparted(first));
  }
  const dob = player.dateOfBirth;
  const data = recordConsentSchema(first, now, { guardianForm: isMinorOn(dob, now) }).parse(input);
  if (dob && data.grantedAt.getTime() < dob.getTime()) {
    throw new ConsentError("invalid", decisionBeforeBirth(first), "grantedAt");
  }
  const minorThen = isMinorOn(dob, data.grantedAt);
  let grantedBy: string;
  if (data.relationship === "self") {
    if (isMinorOn(dob, now)) {
      throw new ConsentError("invalid", relationshipRequired(first), "relationship");
    }
    if (minorThen) throw new ConsentError("invalid", minorOnDecisionDate(first), "grantedAt");
    grantedBy = playerName(player);
  } else {
    if (!minorThen) throw new ConsentError("adult", playerIsAdult(first), "relationship");
    if (!data.grantedBy) throw new ConsentError("invalid", GUARDIAN_NAME_REQUIRED, "grantedBy");
    grantedBy = data.grantedBy;
  }

  const result = await ctx.db.$transaction(async (tx) => {
    const locked = await lockConsentPlayer(tx, ctx.organisationId, playerId);
    if (locked === null) throw new ConsentError("not_found");
    // Who may decide was settled on the date of birth read before the lock. An
    // edit that landed since may make a "self" grant a minor's (CONS02).
    if ((locked.dateOfBirth?.getTime() ?? null) !== (dob?.getTime() ?? null)) {
      throw new ConsentError("invalid", DOB_CHANGED_WHILE_RECORDING);
    }
    const from = locked.consentState;
    const state = stateFor(data, from);
    const withdrawn = state === "withdrawn";
    const row = await tx.consent.create({
      data: {
        organisationId: ctx.organisationId,
        playerId,
        state,
        clubStats: data.clubStats,
        scoutVisible: data.scoutVisible,
        grantedBy,
        relationship: data.relationship,
        method: data.method,
        wordingVersion: CONSENT_WORDING_VERSION,
        playerWasMinor: minorThen,
        grantedAt: withdrawn ? null : data.grantedAt,
        withdrawnAt: withdrawn ? data.grantedAt : null,
        recordedById: ctx.user.id,
      },
      select: { id: true },
    });
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: withdrawn ? "consent.withdraw" : "consent.record",
        targetType: "Player",
        targetId: playerId,
        metadata: {
          consentId: row.id,
          from,
          to: state,
          method: data.method,
          relationship: data.relationship,
          wordingVersion: CONSENT_WORDING_VERSION,
          playerWasMinor: minorThen,
        },
      },
      asTransactionClient(tx),
    );
    return { consentId: row.id, state, from };
  });
  if (losesVisibility(result.from, result.state)) {
    await enqueueConsentWithdrawn({
      organisationId: ctx.organisationId,
      playerId,
      consentId: result.consentId,
    });
  }
  return result;
}

/**
 * Withdraws a grant (Surface 4, NFR11): one withdrawn row with who asked and
 * how, audited as consent.withdraw, then the consent-withdrawn job. Allowed for
 * current and departed players (a departed player's family can still say
 * stop), only from club_only or scout_visible. The state is re-read under a
 * row lock, so a second withdrawal at the same time is refused.
 */
export async function withdrawConsent(
  ctx: AuthContext,
  playerId: string,
  input: WithdrawInput,
  now = new Date(),
): Promise<{ consentId: string; from: ConsentState; firstName: string }> {
  requireSquadOrg(ctx);
  const player = await consentPlayer(ctx, playerId);
  assertNamed(player);
  const first = firstNameOf(player);
  if (!isGranted(player.consentState)) throw new ConsentError("not_granted", ALREADY_WITHDRAWN);
  const data = withdrawSchema(first).parse(input);
  const minor = isMinorOn(player.dateOfBirth, now);

  const result = await ctx.db.$transaction(async (tx) => {
    const from = await lockConsentState(tx, ctx.organisationId, playerId);
    if (from === null) throw new ConsentError("not_found");
    if (!isGranted(from)) throw new ConsentError("not_granted", ALREADY_WITHDRAWN);
    const relationship = minor ? data.relationship : null;
    const row = await tx.consent.create({
      data: {
        organisationId: ctx.organisationId,
        playerId,
        state: "withdrawn",
        clubStats: false,
        scoutVisible: false,
        grantedBy: data.requestedBy,
        relationship,
        method: data.method,
        playerWasMinor: minor,
        withdrawnAt: now,
        recordedById: ctx.user.id,
      },
      select: { id: true },
    });
    await audit(
      {
        organisationId: ctx.organisationId,
        actorUserId: ctx.user.id,
        action: "consent.withdraw",
        targetType: "Player",
        targetId: playerId,
        metadata: {
          consentId: row.id,
          from,
          to: "withdrawn",
          method: data.method,
          relationship,
          playerWasMinor: minor,
        },
      },
      asTransactionClient(tx),
    );
    return { consentId: row.id, from };
  });
  await enqueueConsentWithdrawn({
    organisationId: ctx.organisationId,
    playerId,
    consentId: result.consentId,
  });
  return { ...result, firstName: first };
}

/**
 * A date of birth edit (updatePlayer) can show that a player who gave consent
 * themselves (relationship "self") was under 18 on the decision date. That
 * grant never had a guardian behind it (CONS02, NFR08), so it ends here: one
 * withdrawn row, audited as consent.withdraw with reason dob_corrected, in the
 * caller's transaction. The caller enqueues the consent-withdrawn job after
 * commit (NFR11). A guardian's grant, or a self grant still adult on its date,
 * is left alone. Locks the player row first, so a consent change at the same
 * time runs before or after, never between. Null when nothing was withdrawn.
 */
export async function withdrawSelfConsentOfMinor(
  tx: AuditTx,
  ctx: AuthContext,
  playerId: string,
  dateOfBirth: Date | null,
  now = new Date(),
): Promise<{ consentId: string; from: ConsentState } | null> {
  const locked = await lockConsentPlayer(tx, ctx.organisationId, playerId);
  if (!locked || !isGranted(locked.consentState)) return null;
  const newest = await tx.consent.findFirst({
    where: { organisationId: ctx.organisationId, playerId },
    orderBy: { createdAt: "desc" },
    select: { relationship: true, grantedAt: true },
  });
  if (newest?.relationship !== "self") return null;
  if (!isMinorOn(dateOfBirth, newest.grantedAt ?? now)) return null;
  const from = locked.consentState;
  const playerWasMinor = isMinorOn(dateOfBirth, now);
  const row = await tx.consent.create({
    data: {
      organisationId: ctx.organisationId,
      playerId,
      state: "withdrawn",
      clubStats: false,
      scoutVisible: false,
      playerWasMinor,
      withdrawnAt: now,
      recordedById: ctx.user.id,
    },
    select: { id: true },
  });
  await audit(
    {
      organisationId: ctx.organisationId,
      actorUserId: ctx.user.id,
      action: "consent.withdraw",
      targetType: "Player",
      targetId: playerId,
      metadata: {
        consentId: row.id,
        from,
        to: "withdrawn",
        reason: "dob_corrected",
        playerWasMinor,
      },
    },
    tx,
  );
  return { consentId: row.id, from };
}
