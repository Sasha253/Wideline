// Off unless NEXT_PUBLIC_SENTRY_DSN is set at build time. Loaded lazily so the
// SDK is not in the bundle path when Sentry is off.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => Sentry.init({ dsn, tracesSampleRate: 0.1 }));
}
