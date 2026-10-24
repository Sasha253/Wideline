import { CLUB_ROLES, withRole } from "@/server/auth/session";
import { isSquadOrg, SQUAD_ORG_REQUIRED } from "@/server/squad/access";

// The CSV template for the squad import (SQUAD03; docs/build/design/C04.md,
// Surface 6): the headers and one example row, comma-separated, CRLF, no BOM.

const TEMPLATE = [
  "First name,Last name,Date of birth,Position,Preferred foot,Height,Squad number",
  "Thabo,Nkosi,14/03/2011,RW,Left,165,7",
  "",
].join("\r\n");

export const GET = withRole(CLUB_ROLES, async (_req, ctx) => {
  if (!isSquadOrg(ctx.organisationType)) {
    return Response.json({ error: SQUAD_ORG_REQUIRED }, { status: 403 });
  }
  return new Response(TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="wideline-squad-template.csv"',
      "Cache-Control": "no-store",
    },
  });
});
