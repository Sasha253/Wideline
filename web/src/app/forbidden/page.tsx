import Link from "next/link";

export const metadata = { title: "No access" };

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="heading-1">No access</h1>
      <p className="body-lg mt-4 text-ink-muted">
        Your account does not have access to this page. The CV Lab is open to platform admins only.
      </p>
      <Link className="wl-btn wl-btn--secondary mt-6" href="/login">
        Sign in as someone else
      </Link>
    </main>
  );
}
