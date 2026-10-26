import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { minutesPlayed } from "@/lib/match-clock";
import { rawDb } from "@/server/db/raw";
import { MatchError, PLAYERS_UNAVAILABLE } from "@/server/matches/errors";
import {
  addSubstitution,
  getLineups,
  removeSubstitution,
  saveLineup,
} from "@/server/matches/lineups";
import { addPlaceholders, markDeparted } from "@/server/squad/players";
import { fixtures } from "./helpers/fixtures";
import { match, player, setupClub } from "./helpers/matches";

// SQUAD04, SQUAD05, SQUAD06, SQUAD09 and AUTH06 for lineups
// (docs/build/design/C06.md, Surface 4). Every refusal is the server's, not
// the picker's: the service is called directly with ids a picker would hide.

const f = fixtures();
let club: Awaited<ReturnType<typeof setupClub>>;
let other: Awaited<ReturnType<typeof setupClub>>;

beforeAll(async () => {
  club = await setupClub(f, "Lineups FC");
  other = await setupClub(f, "Lineups Other FC");
});

afterAll(async () => {
  await f.cleanup();
});

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) =>
      e instanceof MatchError
        ? { code: e.code, message: e.userMessage, field: e.field, fieldErrors: e.fieldErrors }
        : e,
  );

const starter = (playerId: string, shirtNumber: number, position: string | null = null) => ({
  playerId,
  isStarter: true,
  shirtNumber,
  position,
});
const sub = (playerId: string, shirtNumber: number) => ({
  playerId,
  isStarter: false,
  shirtNumber,
  position: null,
});

describe("saveLineup", () => {
  it("refuses departed, foreign and other-team players on the server", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const departed = await player(club.ctx, club.own.id, 4);
    await markDeparted(club.ctx, departed.id);
    const foreign = await player(other.ctx, other.own.id, 5);
    const otherTeam = await player(club.ctx, club.other.id, 6);
    for (const p of [departed, foreign, otherTeam]) {
      expect(
        await refusal(saveLineup(club.ctx, id, club.own.id, [starter(p.id, 10)])),
      ).toMatchObject({
        code: "player_unavailable",
        message: PLAYERS_UNAVAILABLE,
      });
    }
    expect(await rawDb.lineup.count({ where: { matchId: id } })).toBe(0);
  });

  it("stores a shirt number that differs from the squad number (SQUAD04)", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const p = await player(club.ctx, club.own.id, 7);
    await saveLineup(club.ctx, id, club.own.id, [starter(p.id, 17, "CM")]);
    const row = await rawDb.lineup.findFirstOrThrow({ where: { matchId: id, playerId: p.id } });
    expect(row).toMatchObject({ shirtNumber: 17, position: "CM", isStarter: true, startedAt: 0 });
    const squad = await rawDb.player.findUniqueOrThrow({ where: { id: p.id } });
    expect(squad.squadNumber).toBe(7);
  });

  it("gives a duplicate shirt number on one side a field error on both rows", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const a = await player(club.ctx, club.own.id);
    const b = await player(club.ctx, club.own.id);
    const r = await refusal(
      saveLineup(club.ctx, id, club.own.id, [starter(a.id, 9), sub(b.id, 9)]),
    );
    expect(r).toMatchObject({ code: "invalid", message: "Check the highlighted rows." });
    const errors = (r as { fieldErrors: Record<string, string> }).fieldErrors;
    expect(Object.keys(errors).sort()).toEqual(
      [`${a.id}.shirtNumber`, `${b.id}.shirtNumber`].sort(),
    );
    expect(errors[`${a.id}.shirtNumber`]).toMatch(
      /^Shirt number 9 is already used by Thabo Nkosi\d+\.$/,
    );
  });

  it("refuses more than 11 starters and out-of-range shirt numbers", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const players = await Promise.all(
      Array.from({ length: 12 }, () => player(club.ctx, club.own.id)),
    );
    expect(
      await refusal(
        saveLineup(
          club.ctx,
          id,
          club.own.id,
          players.map((p, i) => starter(p.id, i + 1)),
        ),
      ),
    ).toMatchObject({ message: "A side can start with 11 players at most. You chose 12." });
    expect(
      await refusal(saveLineup(club.ctx, id, club.own.id, [starter(players[0]!.id, 100)])),
    ).toMatchObject({
      fieldErrors: { [`${players[0]!.id}.shirtNumber`]: "Enter a shirt number from 1 to 99." },
    });
  });

  it("swaps shirt numbers between two players in one save", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const a = await player(club.ctx, club.own.id);
    const b = await player(club.ctx, club.own.id);
    await saveLineup(club.ctx, id, club.own.id, [starter(a.id, 3), starter(b.id, 4)]);
    await saveLineup(club.ctx, id, club.own.id, [starter(a.id, 4), starter(b.id, 3)]);
    const rows = await rawDb.lineup.findMany({
      where: { matchId: id },
      orderBy: { shirtNumber: "asc" },
    });
    expect(rows.map((r) => r.playerId)).toEqual([b.id, a.id]);
  });

  it("keeps a departed player's existing row on a later save (SQUAD09)", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const leaving = await player(club.ctx, club.own.id);
    const staying = await player(club.ctx, club.own.id);
    await saveLineup(club.ctx, id, club.own.id, [starter(leaving.id, 2), starter(staying.id, 3)]);
    await markDeparted(club.ctx, leaving.id);
    // The page leaves departed players out of the form; the save must not remove them.
    await saveLineup(club.ctx, id, club.own.id, [starter(staying.id, 3)]);
    const rows = await rawDb.lineup.findMany({ where: { matchId: id } });
    expect(rows.map((r) => r.playerId).sort()).toEqual([leaving.id, staying.id].sort());
    // Their number still counts on this side.
    const clash = await refusal(saveLineup(club.ctx, id, club.own.id, [starter(staying.id, 2)]));
    expect(clash).toMatchObject({ code: "invalid" });
  });

  it("gives opposition placeholders their placeholder number", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    await addPlaceholders(club.ctx, club.opposition.id, [21]);
    const ph = await rawDb.player.findFirstOrThrow({
      where: { teamId: club.opposition.id, squadNumber: 21 },
    });
    await saveLineup(club.ctx, id, club.opposition.id, [starter(ph.id, 99)]);
    const row = await rawDb.lineup.findFirstOrThrow({ where: { matchId: id, playerId: ph.id } });
    expect(row.shirtNumber).toBe(21);
  });

  it("locks lineups once the match is in review", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const p = await player(club.ctx, club.own.id);
    await rawDb.match.update({ where: { id }, data: { status: "in_review" } });
    expect(await refusal(saveLineup(club.ctx, id, club.own.id, [starter(p.id, 1)]))).toMatchObject({
      code: "locked",
      message: "Lineups are locked while this match is in review.",
    });
  });

  it("writes an audit row with ids and counts only", async () => {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const p = await player(club.ctx, club.own.id);
    await saveLineup(club.ctx, id, club.own.id, [starter(p.id, 1)]);
    const audit = await rawDb.auditLog.findFirstOrThrow({
      where: { action: "lineup.updated", targetId: id },
    });
    expect(audit.metadata).toEqual({
      teamId: club.own.id,
      added: 1,
      removed: 0,
      updated: 0,
      substitutionsRemoved: 0,
    });
  });
});

describe("substitutions", () => {
  async function lineupWithBench() {
    const { id } = await match(club.ctx, club.own.id, club.opposition.id);
    const nine = await player(club.ctx, club.own.id);
    const ten = await player(club.ctx, club.own.id);
    const fourteen = await player(club.ctx, club.own.id);
    const fifteen = await player(club.ctx, club.own.id);
    await saveLineup(club.ctx, id, club.own.id, [
      starter(nine.id, 9),
      starter(ten.id, 10),
      sub(fourteen.id, 14),
      sub(fifteen.id, 15),
    ]);
    const rows = await rawDb.lineup.findMany({ where: { matchId: id } });
    const row = (playerId: string) => rows.find((r) => r.playerId === playerId)!;
    return {
      id,
      nine: row(nine.id),
      ten: row(ten.id),
      fourteen: row(fourteen.id),
      fifteen: row(fifteen.id),
    };
  }

  it("sets endedAt, startedAt and the replacement link, and remove reverses it", async () => {
    const l = await lineupWithBench();
    await addSubstitution(club.coachCtx, l.id, {
      teamId: club.own.id,
      offLineupId: l.nine.id,
      onLineupId: l.fourteen.id,
      minute: 60,
    });
    const off = await rawDb.lineup.findUniqueOrThrow({ where: { id: l.nine.id } });
    const on = await rawDb.lineup.findUniqueOrThrow({ where: { id: l.fourteen.id } });
    expect(off.endedAt).toBe(3600);
    expect(on).toMatchObject({ startedAt: 3600, replacesLineupId: l.nine.id });
    expect(minutesPlayed(off, 45)).toBe(60);
    expect(minutesPlayed(on, 45)).toBe(30);

    const lineups = await getLineups(club.ctx, l.id);
    expect(lineups.home.substitutions).toHaveLength(1);
    expect(lineups.home.substitutions[0]).toMatchObject({ minute: 60 });

    await removeSubstitution(club.ctx, l.id, { teamId: club.own.id, offLineupId: l.nine.id });
    expect(await rawDb.lineup.findUniqueOrThrow({ where: { id: l.nine.id } })).toMatchObject({
      endedAt: null,
    });
    expect(await rawDb.lineup.findUniqueOrThrow({ where: { id: l.fourteen.id } })).toMatchObject({
      startedAt: null,
      replacesLineupId: null,
    });
    const actions = await rawDb.auditLog.findMany({
      where: { targetId: l.id, action: { startsWith: "lineup.substitution" } },
      orderBy: { createdAt: "asc" },
    });
    expect(actions.map((a) => a.action)).toEqual([
      "lineup.substitution_added",
      "lineup.substitution_removed",
    ]);
  });

  it("refuses a player who was not on the pitch, and a substitute who already came on", async () => {
    const l = await lineupWithBench();
    // An unused substitute cannot go off.
    expect(
      await refusal(
        addSubstitution(club.ctx, l.id, {
          teamId: club.own.id,
          offLineupId: l.fifteen.id,
          onLineupId: l.fourteen.id,
          minute: 50,
        }),
      ),
    ).toMatchObject({ code: "not_on_pitch", field: "offLineupId" });
    await addSubstitution(club.ctx, l.id, {
      teamId: club.own.id,
      offLineupId: l.nine.id,
      onLineupId: l.fourteen.id,
      minute: 60,
    });
    expect(
      await refusal(
        addSubstitution(club.ctx, l.id, {
          teamId: club.own.id,
          offLineupId: l.ten.id,
          onLineupId: l.fourteen.id,
          minute: 70,
        }),
      ),
    ).toMatchObject({
      code: "already_on",
      field: "onLineupId",
      message: expect.stringMatching(/^#14 .* has already come on\.$/),
    });
    // #9 already went off at 60'.
    expect(
      await refusal(
        addSubstitution(club.ctx, l.id, {
          teamId: club.own.id,
          offLineupId: l.nine.id,
          onLineupId: l.fifteen.id,
          minute: 75,
        }),
      ),
    ).toMatchObject({ code: "not_on_pitch" });
    // The substitute who came on at 60' was not on the pitch at 55'.
    expect(
      await refusal(
        addSubstitution(club.ctx, l.id, {
          teamId: club.own.id,
          offLineupId: l.fourteen.id,
          onLineupId: null,
          minute: 55,
        }),
      ),
    ).toMatchObject({ code: "not_on_pitch" });
  });

  it("records off with no replacement, and checks the minute range", async () => {
    const l = await lineupWithBench();
    expect(
      await refusal(
        addSubstitution(club.ctx, l.id, {
          teamId: club.own.id,
          offLineupId: l.ten.id,
          onLineupId: null,
          minute: 106,
        }),
      ),
    ).toMatchObject({ field: "minute", message: "Enter a minute from 1 to 105." });
    await addSubstitution(club.ctx, l.id, {
      teamId: club.own.id,
      offLineupId: l.ten.id,
      onLineupId: null,
      minute: 38,
    });
    const lineups = await getLineups(club.ctx, l.id);
    expect(lineups.home.substitutions[0]).toMatchObject({ minute: 38, on: null });
  });

  it("removes the substitutions of a player taken out of the lineup", async () => {
    const l = await lineupWithBench();
    await addSubstitution(club.ctx, l.id, {
      teamId: club.own.id,
      offLineupId: l.nine.id,
      onLineupId: l.fourteen.id,
      minute: 60,
    });
    const rows = await rawDb.lineup.findMany({ where: { matchId: l.id } });
    const keep = rows.filter((r) => r.id !== l.fourteen.id);
    const { substitutionsRemoved } = await saveLineup(
      club.ctx,
      l.id,
      club.own.id,
      keep.map((r) => ({
        playerId: r.playerId,
        isStarter: r.isStarter,
        shirtNumber: r.shirtNumber,
        position: r.position,
      })),
    );
    expect(substitutionsRemoved).toBe(1);
    expect(await rawDb.lineup.findUniqueOrThrow({ where: { id: l.nine.id } })).toMatchObject({
      endedAt: null,
    });
  });

  it("refuses a lineup row pointing at another organisation's row (composite FK)", async () => {
    const l = await lineupWithBench();
    const { id: otherMatch } = await match(other.ctx, other.own.id, other.opposition.id);
    const p = await player(other.ctx, other.own.id);
    await saveLineup(other.ctx, otherMatch, other.own.id, [starter(p.id, 1)]);
    const foreignRow = await rawDb.lineup.findFirstOrThrow({ where: { matchId: otherMatch } });
    await expect(
      rawDb.lineup.update({
        where: { id: l.fourteen.id },
        data: { replacesLineupId: foreignRow.id },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
