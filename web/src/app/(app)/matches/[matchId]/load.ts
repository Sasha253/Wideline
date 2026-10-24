import "server-only";
import { cache } from "react";
import type { AuthContext } from "@/server/auth/session";
import { getMatch, MatchError, type MatchDetail } from "@/server/matches/matches";

/** One read per request, shared by generateMetadata and the page. Unknown or foreign: null. */
export const loadMatch = cache(
  async (ctx: AuthContext, matchId: string): Promise<MatchDetail | null> => {
    try {
      return await getMatch(ctx, matchId);
    } catch (err) {
      if (err instanceof MatchError && err.code === "not_found") return null;
      throw err;
    }
  },
);
