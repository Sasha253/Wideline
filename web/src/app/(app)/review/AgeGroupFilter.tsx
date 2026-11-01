"use client";

import { ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { iconProps } from "@/components/ui/icons";

/**
 * "All age groups" (Floodlight, Screens B "Review queue"): narrows the rows already on the
 * page by age group. Kept in the URL (?age=U15) so it survives a refresh; the queue's order
 * and the server query do not change.
 */
export function AgeGroupFilter({ value, options }: { value: string; options: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="wl-control wl-control--select w-44">
      <select
        aria-label="Age group"
        className="wl-control__input"
        value={value}
        onChange={(e) => {
          const age = e.target.value;
          router.replace(age ? `${pathname}?age=${encodeURIComponent(age)}` : pathname, {
            scroll: false,
          });
        }}
      >
        <option value="">All age groups</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <span className="wl-control__icon" aria-hidden="true">
        <ChevronDown {...iconProps} />
      </span>
    </div>
  );
}
