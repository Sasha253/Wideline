// Liveness check for Docker and uptime monitoring. Deliberately touches
// nothing else, so a slow database does not restart the web container.
export function GET() {
  return Response.json({ ok: true });
}

export const dynamic = "force-dynamic";
