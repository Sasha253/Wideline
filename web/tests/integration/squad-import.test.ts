import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb } from "@/server/db/raw";
import type { AuthContext } from "@/server/auth/session";
import {
  commitImport,
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  ImportError,
  importDigest,
  previewImport,
} from "@/server/squad/import";
import { createPlayer } from "@/server/squad/players";
import { createTeam } from "@/server/squad/teams";
import { fixtures } from "./helpers/fixtures";

// SQUAD03: the CSV import previews with per-row errors and commits nothing
// until confirmed (docs/build/design/C04.md, Surface 6).

const f = fixtures();
let ctx: AuthContext;
let ctxB: AuthContext;
let orgId: string;
let team: { id: string; name: string; season: string };
let other: { id: string };
let opposition: { id: string };

beforeAll(async () => {
  const org = await f.org("Squad import FC");
  const orgB = await f.org("Squad import B FC");
  orgId = org.id;
  const owner = await f.user("Import Owner");
  const ownerB = await f.user("Import Owner B");
  await f.member(org.id, owner.id, "owner");
  await f.member(orgB.id, ownerB.id, "owner");
  ctx = await f.ctx(owner, org.id);
  ctxB = await f.ctx(ownerB, orgB.id);
  team = await createTeam(ctx, { name: "U15 Boys", season: "2026" });
  other = await createTeam(ctx, { name: "U17 Boys", season: "2026" });
  opposition = await createTeam(ctx, { name: "Rivals", season: "2026" }, "opposition");
  await createPlayer(ctx, {
    firstName: "Thabo",
    lastName: "Nkosi",
    dateOfBirth: "2011-03-14",
    teamId: team.id,
    squadNumber: "7",
  });
  await createPlayer(ctx, {
    firstName: "Lerato",
    lastName: "Mokoena",
    dateOfBirth: "2010-01-02",
    teamId: other.id,
  });
});

afterAll(async () => {
  await f.cleanup();
});

const counts = async () => ({
  players: await rawDb.player.count({ where: { organisationId: orgId } }),
  audits: await rawDb.auditLog.count({ where: { organisationId: orgId } }),
});

// Line 1 header; 2 valid; 3 bad date; 4 and 6 share 9; 5 clashes with Thabo's 7;
// 7 is already in the club (on U17 Boys); 8 valid.
const CSV = [
  "First name;Surname;DOB;Position;Foot;Height;Shirt;Email",
  "Sipho;Dlamini;14/03/2011;RW;L;165;10;sipho@example.com",
  "Kagiso;Molefe;31/02/2012;;;;;",
  "Ayanda;Zulu;2011-05-01;ST;R;;9;",
  "Neo;Khumalo;2011/06/01;;;;7;",
  "Musa;Ngcobo;01/07/2011;CM;B;;9;",
  "lerato;MOKOENA;02/01/2010;;;;;",
  '"Mthembu-Van der Merwe";"Bongani";2011-08-01;GK;;180;1;',
].join("\r\n");

const messages = (
  rows: { line: number; errors: { label: string; message: string }[] }[],
  line: number,
) => rows.find((r) => r.line === line)!.errors.map((e) => `${e.label}: ${e.message}`);

describe("previewImport", () => {
  it("writes nothing and reports errors per row with line numbers", async () => {
    const before = await counts();
    const p = await previewImport(ctx, team.id, CSV, new Date("2026-10-24T10:00:00+02:00"));
    expect(await counts()).toEqual(before);

    expect(p.ignoredColumns).toEqual(["Email"]);
    expect(p.validCount).toBe(2);
    expect(p.errorCount).toBe(5);
    expect(p.rows.map((r) => r.line)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(messages(p.rows, 2)).toEqual([]);
    expect(messages(p.rows, 3)).toEqual(["Date of birth: 31/02/2012 is not a real date."]);
    expect(messages(p.rows, 4)).toEqual([
      "Squad number: 9 is also on line 6. Use each number once.",
    ]);
    expect(messages(p.rows, 6)).toEqual([
      "Squad number: 9 is also on line 4. Use each number once.",
    ]);
    expect(messages(p.rows, 5)).toEqual([
      "Squad number: Number 7 is already taken in U15 Boys (2026) by Thabo Nkosi. Choose another number.",
    ]);
    expect(messages(p.rows, 7)).toEqual([
      "Player: Someone with this name and date of birth is already in U17 Boys (2026).",
    ]);
    expect(p.rows[0]!.values).toMatchObject({ firstName: "Sipho", dateOfBirth: "14/03/2011" });
    expect(p.digest).toBe(importDigest(team.id, CSV));
    expect(p.csvText).not.toContain("\r");
  });

  it("refuses whole-file problems before any row", async () => {
    const code = (text: string, teamId = team.id, c = ctx) =>
      previewImport(c, teamId, text).then(
        () => "ok",
        (e: unknown) => (e instanceof ImportError ? e.code : String(e)),
      );
    expect(await code("First name,Last name\nA,B")).toBe("missing_columns");
    const missing = await previewImport(ctx, team.id, "First name\nA").catch((e: ImportError) => e);
    expect((missing as ImportError).detail.missing).toEqual(["Last name", "Date of birth"]);
    expect(await code("")).toBe("empty");
    expect(await code("First name,Last name,DOB\n\n")).toBe("empty");
    expect(await code("First name,Last name,DOB\nJos�,B,2011-01-01")).toBe("unreadable");
    const big = `First name,Last name,DOB\n${"x".repeat(CSV_MAX_BYTES)}`;
    expect(await code(big)).toBe("too_large");
    const many = [
      "First name,Last name,DOB",
      ...Array.from({ length: CSV_MAX_ROWS + 1 }, (_, i) => `A${i},B,2011-01-01`),
    ];
    const tooMany = await previewImport(ctx, team.id, many.join("\n")).catch((e: ImportError) => e);
    expect((tooMany as ImportError).code).toBe("too_many_rows");
    expect((tooMany as ImportError).detail.rows).toBe(CSV_MAX_ROWS + 1);
    // The target is one own team of this organisation.
    expect(await code(CSV, opposition.id)).toBe("team");
    expect(await code(CSV, team.id, ctxB)).toBe("team");
    expect(await code(CSV, "")).toBe("team");
  });
});

describe("commitImport", () => {
  it("commits nothing when the digest or the valid count differs, and returns the fresh preview", async () => {
    const before = await counts();
    const p = await previewImport(ctx, team.id, CSV);
    const wrongDigest = await commitImport(ctx, team.id, CSV, "0".repeat(64), p.validCount);
    expect(wrongDigest.status).toBe("stale");
    const wrongCount = await commitImport(ctx, team.id, CSV, p.digest, p.validCount + 1);
    expect(wrongCount.status).toBe("stale");
    if (wrongCount.status === "stale") expect(wrongCount.preview.validCount).toBe(2);
    const otherTeam = await commitImport(ctx, other.id, CSV, p.digest, p.validCount);
    expect(otherTeam.status).toBe("stale");
    expect(await counts()).toEqual(before);
  });

  it("creates only the valid rows and writes one squad.import audit row", async () => {
    const p = await previewImport(ctx, team.id, CSV);
    const before = await counts();
    // The text comes back through a form field with CRLF line ends: same digest.
    const res = await commitImport(ctx, team.id, p.csvText.replace(/\n/g, "\r\n"), p.digest, 2);
    expect(res).toEqual({
      status: "done",
      created: 2,
      skipped: 5,
      team: { id: team.id, name: "U15 Boys", season: "2026" },
    });
    const after = await counts();
    expect(after.players - before.players).toBe(2);
    expect(after.audits - before.audits).toBe(1);
    const [audit] = await rawDb.auditLog.findMany({
      where: { organisationId: orgId, action: "squad.import" },
    });
    expect(audit?.metadata).toEqual({ teamId: team.id, created: 2, skipped: 5 });
    const added = await rawDb.player.findMany({
      where: {
        organisationId: orgId,
        teamId: team.id,
        firstName: { in: ["Sipho", "Mthembu-Van der Merwe"] },
      },
      orderBy: { firstName: "asc" },
    });
    expect(
      added.map((a) => [a.firstName, a.lastName, a.squadNumber, a.position, a.preferredFoot]),
    ).toEqual([
      ["Mthembu-Van der Merwe", "Bongani", 1, "GK", null],
      ["Sipho", "Dlamini", 10, "RW", "left"],
    ]);

    // Importing the same file again flags those players as already in the club.
    const again = await previewImport(ctx, team.id, CSV);
    expect(again.validCount).toBe(0);
    expect(messages(again.rows, 2)).toContain(
      "Player: Someone with this name and date of birth is already in U15 Boys (2026).",
    );
  });

  it("rolls the whole commit back when a number is taken between preview and commit", async () => {
    const csv = "First name,Last name,DOB,Number\nAmo,One,2011-01-01,40\nBo,Two,2011-01-02,41";
    const p = await previewImport(ctx, team.id, csv);
    expect(p.validCount).toBe(2);
    // Someone takes 41 meanwhile: the re-check sees it, so the counts differ.
    await createPlayer(ctx, {
      firstName: "Late",
      lastName: "Comer",
      dateOfBirth: "2011-02-02",
      teamId: team.id,
      squadNumber: "41",
    });
    const before = await counts();
    const res = await commitImport(ctx, team.id, csv, p.digest, p.validCount);
    expect(res.status).toBe("stale");
    if (res.status === "stale") {
      expect(messages(res.preview.rows, 3)[0]).toContain("Number 41 is already taken");
    }
    expect(await counts()).toEqual(before);
  });

  it("rolls back on a unique violation inside the transaction", async () => {
    const csv = "First name,Last name,DOB,Number\nCee,Three,2011-01-03,50\nDee,Four,2011-01-04,51";
    const p = await previewImport(ctx, team.id, csv);
    // A trigger inserts number 51 just before the import's rows, as a concurrent write would.
    await rawDb.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION wl_test_race() RETURNS trigger AS $$ BEGIN
        IF NEW."firstName" = 'Cee' THEN
          INSERT INTO "Player" (id, "organisationId", "teamId", "firstName", "lastName", "squadNumber", "updatedAt")
          VALUES ('race-${p.digest.slice(0, 8)}', NEW."organisationId", NEW."teamId", 'Race', 'Row', 51, now());
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await rawDb.$executeRawUnsafe(
      `CREATE TRIGGER wl_test_race BEFORE INSERT ON "Player" FOR EACH ROW EXECUTE FUNCTION wl_test_race()`,
    );
    const before = await counts();
    let res;
    try {
      res = await commitImport(ctx, team.id, csv, p.digest, 2);
    } finally {
      await rawDb.$executeRawUnsafe(`DROP TRIGGER IF EXISTS wl_test_race ON "Player"`);
      await rawDb.$executeRawUnsafe(`DROP FUNCTION IF EXISTS wl_test_race()`);
    }
    expect(res.status).toBe("stale");
    // The trigger's own row rolled back with the transaction, so nothing changed.
    expect(await counts()).toEqual(before);
  });
});
