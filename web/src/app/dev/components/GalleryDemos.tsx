"use client";

import { Clock, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import { ConfirmModal, Modal, Sheet } from "@/components/ui/Modal";
import { PlayerCard } from "@/components/ui/PlayerCard";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { TextField } from "@/components/ui/TextField";
import { thaboFigures } from "./fixtures";

// The interactive gallery pieces: they need state, so they live in this client file.
// Ids carry the theme prefix, so the light and dark bands stay unique.

type Theme = "light" | "dark";

/** Page tabs with real panels: arrow keys, Home and End move and select. */
export function TabsDemo({ theme }: { theme: Theme }) {
  const [tab, setTab] = useState("overview");
  const id = `${theme}-tabs-demo`;
  const items = [
    { value: "overview", label: "Overview" },
    { value: "log", label: "Match log", count: 8 },
    { value: "clips", label: "Clips", count: 26 },
    { value: "reports", label: "Reports", disabled: true },
  ];
  // Navigation mode: every item is a link (AdminNav, SettingsNav, LabNav). The current one
  // is aria-current="page".
  const anchor = `#${theme}-tabs`;
  const links = [
    { value: "organisations", label: "Organisations", href: anchor },
    { value: "scouts", label: "Scouts", href: anchor, count: 3 },
    { value: "users", label: "Users", href: anchor },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="m-0 font-mono text-overline uppercase text-ink-muted">In-page panels</p>
        <div>
          <Tabs
            id={id}
            aria-label="Player profile"
            items={items}
            value={tab}
            onValueChange={setTab}
          />
          {items.map((t) => (
            <TabPanel key={t.value} tabsId={id} value={t.value} selected={tab === t.value}>
              <p className="m-0 pt-3 text-body-s text-ink-muted">
                {t.label} panel. Sample content only.
              </p>
            </TabPanel>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="m-0 font-mono text-overline uppercase text-ink-muted">Navigation</p>
        <Tabs aria-label={`Admin sample (${theme})`} items={links} value="organisations" />
      </div>
    </div>
  );
}

/** The squad consent filter: a radiogroup with counts and icons. */
export function SegmentedDemo() {
  const [value, setValue] = useState("all");
  return (
    <SegmentedFilter
      aria-label="Consent"
      value={value}
      onValueChange={setValue}
      options={[
        { value: "all", label: "All", count: 24 },
        {
          value: "given",
          label: "Given",
          count: 18,
          icon: <ShieldCheck {...iconProps} className="text-confirmed" />,
        },
        {
          value: "awaiting",
          label: "Awaiting",
          count: 4,
          icon: <Clock {...iconProps} className="text-pending" />,
        },
        {
          value: "withdrawn",
          label: "Withdrawn",
          count: 2,
          icon: <ShieldOff {...iconProps} className="text-rejected" />,
        },
      ]}
    />
  );
}

/** Modal, bottom sheet and confirm dialog, each opened from its own trigger. */
export function ModalDemo() {
  const [open, setOpen] = useState<"modal" | "sheet" | "confirm" | null>(null);
  const close = () => setOpen(null);
  return (
    <div className="wl-row">
      <Button variant="secondary" onClick={() => setOpen("modal")}>
        Edit event
      </Button>
      <Button variant="secondary" onClick={() => setOpen("sheet")}>
        Open sheet
      </Button>
      <Button variant="secondary" icon={Trash2} onClick={() => setOpen("confirm")}>
        Delete upload
      </Button>
      <Modal
        open={open === "modal"}
        onClose={close}
        title="Edit event"
        subtitle="31:24 · Shot on target"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={close}>
              Save
            </Button>
          </>
        }
      >
        <TextField label="Match time" mono defaultValue="31:24" help="Match clock, from kickoff" />
      </Modal>
      <Sheet
        open={open === "sheet"}
        onClose={close}
        title="Who took the shot?"
        footer={
          <Button variant="primary" block onClick={close}>
            Save
          </Button>
        }
      >
        <p className="m-0 text-ink-muted">The nearest players to the ball at 31:24.</p>
      </Sheet>
      <ConfirmModal
        open={open === "confirm"}
        onClose={close}
        onConfirm={close}
        icon={Trash2}
        title="Delete this upload?"
        confirmLabel="Delete upload"
        confirmIcon={Trash2}
        cancelLabel="Keep upload"
      >
        The recording and its lineup are removed. This can&apos;t be undone.
      </ConfirmModal>
    </div>
  );
}

/** The scout view, with a working shortlist toggle (aria-pressed). */
export function ShortlistCardDemo({ href }: { href: string }) {
  const [on, setOn] = useState(true);
  return (
    <PlayerCard
      name="Thabo Nkosi"
      position="Winger"
      ageGroup="U17"
      number={7}
      currentClub="Orlando Pirates Academy"
      viewer="scout"
      figures={thaboFigures}
      matches={8}
      href={href}
      shortlisted={on}
      shortlistName="Wingers 2026"
      onToggleShortlist={setOn}
    />
  );
}
