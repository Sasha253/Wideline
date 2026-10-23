// No "server-only" import: prisma/seed.ts runs this under plain Node.
import { Prisma } from "@/generated/prisma/client";
import { rawDb } from "../db/raw";

/**
 * The scout network (AUTH08): one shared organisation, "Wideline scouts", that
 * holds an accepted scout Membership for every independent scout. It lets
 * requireRole(), the nav and the org switcher work unchanged for a scout who
 * belongs to no club. It has no owners or admins, so nobody can invite into it
 * or list its members, and its type cannot be set from a scoped client.
 */

export const SCOUT_NETWORK_ORG_ID = "scout-network";
export const SCOUT_NETWORK_NAME = "Wideline scouts";

type Db = Pick<typeof rawDb, "organisation">;

/** Creates the scout network organisation if it is missing. Idempotent and safe to race. */
export async function ensureScoutNetwork(db: Db = rawDb): Promise<void> {
  try {
    await db.organisation.upsert({
      where: { id: SCOUT_NETWORK_ORG_ID },
      update: {},
      create: {
        id: SCOUT_NETWORK_ORG_ID,
        name: SCOUT_NETWORK_NAME,
        type: "scout_network",
        country: "ZA",
        status: "active",
      },
    });
  } catch (err) {
    // Two first registrations at once: the other one created it.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
}
