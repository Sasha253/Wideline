import { Clock, ShieldCheck, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { iconProps } from "@/components/ui/icons";
import { ConfirmModal, Modal, Sheet } from "@/components/ui/Modal";
import { SegmentedFilter } from "@/components/ui/SegmentedFilter";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { SearchSelect, Select, TextField } from "@/components/ui/TextField";
import { Toast } from "@/components/ui/Toast";

// Floodlight core components added in the redesign (design/Wideline Components.dc.html).
const html = (el: ReactElement) => renderToStaticMarkup(el);

describe("Tabs", () => {
  const items = [
    { value: "overview", label: "Overview" },
    { value: "log", label: "Match log", count: 8 },
    { value: "clips", label: "Clips", count: 26, disabled: true },
  ];
  it("is a tablist with one Tab stop and mono counts", () => {
    const out = html(<Tabs id="p" items={items} value="log" aria-label="Player" />);
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-label="Player"');
    expect(out).toMatch(
      /aria-selected="true" tabindex="0"[^>]*>Match log<span class="wl-tabset__count">8<\/span>/,
    );
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out).toContain('aria-controls="p-panel-log"');
    expect(out).toContain('aria-disabled="true"');
  });
  it("pairs a panel with its tab", () => {
    const out = html(
      <TabPanel tabsId="p" value="log" selected>
        Log
      </TabPanel>,
    );
    expect(out).toContain('role="tabpanel"');
    expect(out).toContain('aria-labelledby="p-tab-log"');
    expect(out).toContain('tabindex="0"');
  });
  it("renders links with aria-current when every tab has an href", () => {
    const out = html(
      <Tabs
        items={[
          { value: "a", label: "Overview", href: "/a" },
          { value: "b", label: "Clips", href: "/b" },
        ]}
        value="b"
        aria-label="Player"
      />,
    );
    expect(out).toMatch(/^<nav/);
    expect(out).toMatch(/<a [^>]*aria-current="page"[^>]*href="\/b"/);
    expect(out).not.toMatch(/<a [^>]*aria-current="page"[^>]*href="\/a"/);
    expect(out).not.toContain('role="tab"');
  });
});

describe("SegmentedFilter", () => {
  const options = [
    { value: "all", label: "All", count: 38 },
    { value: "pending", label: "Pending", count: 32 },
    { value: "confirmed", label: "Confirmed", count: 5 },
  ];
  it("is a radiogroup with the checked option as the Tab stop", () => {
    const out = html(
      <SegmentedFilter options={options} value="pending" aria-label="Event status" name="s" />,
    );
    expect(out).toContain('role="radiogroup"');
    expect(out).toMatch(
      /aria-checked="true" tabindex="0"[^>]*>Pending<span class="wl-segmented__count">32<\/span>/,
    );
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out).toContain('<input type="hidden" name="s" value="pending"/>');
  });
  it("takes an icon element", () => {
    const out = html(
      <SegmentedFilter
        options={[{ value: "given", label: "Given", icon: <ShieldCheck {...iconProps} /> }]}
        value="given"
        aria-label="Consent"
      />,
    );
    expect(out).toContain("<svg");
  });
});

describe("TextField and Select", () => {
  it("labels the field above it and describes it with the help", () => {
    const out = html(
      <TextField
        id="t"
        label="Event time"
        help="Match clock, from kickoff"
        mono
        placeholder="mm:ss"
        trailing={<Clock {...iconProps} />}
      />,
    );
    expect(out).toMatch(/<label for="t"[^>]*class="wl-field__label">Event time<\/label>/);
    expect(out).toContain('aria-describedby="t-note"');
    expect(out).toContain("wl-control__input wl-mono");
    expect(out).toContain("Match clock, from kickoff");
    expect(out).toContain('class="wl-control__icon"');
  });
  it("replaces the help with the error and marks the field invalid", () => {
    const out = html(
      <TextField
        id="t"
        label="Event time"
        help="Match clock"
        error="Use a time between 00:00 and 92:10"
      />,
    );
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('data-invalid="true"');
    expect(out).toContain('class="wl-field__error"');
    expect(out).toContain("Use a time between 00:00 and 92:10");
    expect(out).not.toContain("Match clock");
  });
  it("draws a select with its placeholder option and chevron", () => {
    const out = html(
      <Select
        label="Position"
        placeholder="Choose a position"
        options={[{ value: "cm", label: "Central midfield" }]}
      />,
    );
    expect(out).toContain("wl-control wl-control--select");
    expect(out).toContain('<option value="">Choose a position</option>');
    expect(out).toContain('<option value="cm">Central midfield</option>');
  });
});

describe("SearchSelect", () => {
  it("is a combobox over a hidden listbox, posting the value", () => {
    const out = html(
      <SearchSelect
        id="p"
        label="Player"
        name="playerId"
        defaultValue="9"
        options={[
          { value: "9", label: "Ayanda Zulu", prefix: "9" },
          { value: "8", label: "Sipho Ndlovu", prefix: "8" },
        ]}
      />,
    );
    expect(out).toContain('role="combobox"');
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain('value="Ayanda Zulu"');
    expect(out).toContain('<span class="wl-control__prefix" aria-hidden="true">9</span>');
    expect(out).toContain('<input type="hidden" name="playerId" value="9"/>');
    expect(out).toMatch(/role="listbox"[^>]*hidden=""/);
    expect(out).toMatch(/role="option" aria-selected="true"/);
  });
});

describe("Toast", () => {
  it("is a polite status, or an alert for errors, with a named dismiss", () => {
    const ok = html(<Toast tone="success" title="Correction saved" onDismiss={() => {}} />);
    expect(ok).toContain('role="status"');
    expect(ok).toContain('aria-label="Dismiss"');
    const err = html(<Toast tone="error" title="Couldn't save the correction" />);
    expect(err).toContain('role="alert"');
    expect(err).toContain("wl-toast--error");
  });
  it("shows at most one action", () => {
    const out = html(
      <Toast title="Correction saved" action={{ label: "Undo", onClick: () => {} }} />,
    );
    expect(out.match(/wl-toast__action/g)).toHaveLength(1);
  });
});

describe("Modal, Sheet and ConfirmModal", () => {
  it("names the dialog by its title and labels the close button", () => {
    const out = html(
      <Modal
        open={false}
        onClose={() => {}}
        title="Add missed event"
        subtitle="Video paused at 31:24"
      >
        Fields
      </Modal>,
    );
    expect(out).toMatch(/^<dialog aria-labelledby="([^"]+)" class="wl-modal"/);
    expect(out).toContain('aria-label="Close"');
    expect(out).toContain("Video paused at 31:24");
  });
  it("is always a bottom sheet as a Sheet", () => {
    expect(html(<Sheet open={false} onClose={() => {}} title="Edit event" />)).toContain(
      'class="wl-modal wl-modal--sheet"',
    );
  });
  it("puts the safe button first in a confirm dialog", () => {
    const out = html(
      <ConfirmModal
        open={false}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete this upload?"
        icon={Trash2}
        confirmLabel="Delete upload"
        cancelLabel="Keep upload"
      >
        This can&apos;t be undone.
      </ConfirmModal>,
    );
    expect(out).toContain('role="alertdialog"');
    expect(out.indexOf("Keep upload")).toBeLessThan(out.indexOf("Delete upload"));
    expect(out).toContain("wl-btn--danger");
  });
});
