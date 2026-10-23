import Link from "next/link";
import { PageHeader } from "@/components/templates/PageHeader";
import { DEV_ROLES, requirePageRole } from "@/server/auth/session";

export const metadata = { title: "Page templates" };

const PAGES = [
  { href: "/dev/templates/list", label: "List page" },
  { href: "/dev/templates/detail", label: "Detail page" },
  { href: "/dev/templates/workspace", label: "Workspace" },
  { href: "/dev/templates/decision", label: "Decision flow" },
  { href: "/dev/templates/states", label: "States" },
];

/** The template showcase (docs/build/design/D02.md, Surface 9). Wideline staff only. */
export default async function TemplatesIndex() {
  await requirePageRole(DEV_ROLES);
  return (
    <>
      <PageHeader
        title="Page templates"
        intro="Every page template and shared state, inside the app shell. Sample data only."
      />
      <ul role="list" className="mt-6 flex flex-col gap-1">
        {PAGES.map((p) => (
          <li key={p.href}>
            <Link href={p.href} className="wl-link-row body text-pitch underline">
              {p.label}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
