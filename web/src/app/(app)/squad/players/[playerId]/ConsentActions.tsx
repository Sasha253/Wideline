"use client";

import { Check, Clock, Copy, Mail, Printer, Share2, ShieldCheck, ShieldOff } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RadioGroup } from "@/components/consent/RadioGroup";
import { Banner, Field, fieldError } from "@/components/forms";
import { useSectionAction } from "@/components/section-result";
import { Button, ButtonLink } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icons";
import type { ActionResult } from "@/lib/action-result";
import {
  CLUB_CONSENT_METHODS,
  CONSENT_LINK_DAYS,
  CONSENT_METHOD_LABELS,
  CONSENT_NAME_MAX,
  GUARDIAN_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
} from "@/lib/consent-rules";
import {
  emailConsentRequestAction,
  requestConsentAction,
  revokeConsentRequestAction,
  withdrawConsentAction,
} from "./consent/actions";

type BannerState = { tone: "ok" | "warn" | "danger"; text: string } | null;

/**
 * The live parts of the Consent section on the player page (CONS02, CONS03,
 * NFR11; docs/build/design/C05.md, Surface 4): the result banners, the guardian
 * link copy box, and the actions with their dialogs. The state line and facts
 * are rendered on the server and passed in as children. The link URL lives in
 * client state only, from the action result: never in a URL. The guardian's
 * email address (Q-019) is typed here and sent once; it comes back masked only.
 */
export function ConsentActions({
  playerId,
  name,
  firstName,
  admin,
  active,
  minor,
  granted,
  changeLabel,
  openLink,
  initialBanner,
  children,
  notes,
}: {
  playerId: string;
  name: string;
  firstName: string;
  admin: boolean;
  active: boolean;
  minor: boolean;
  granted: boolean;
  changeLabel: string;
  /**
   * The open link, when there is one: its creation and expiry dates, formatted,
   * and the stored guardian address, masked ("t***@example.com"), or null.
   */
  openLink: { createdOn: string; until: string; emailMasked: string | null } | null;
  initialBanner: string | null;
  children: ReactNode;
  notes?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const [banner, setBanner] = useState<BannerState>(
    initialBanner ? { tone: "ok", text: initialBanner } : null,
  );
  const [link, setLink] = useState<{ url: string; until: string } | null>(null);
  // A new object per request, so the same target can be focused twice.
  const [focus, setFocus] = useState<{ target: "heading" | "copy" } | null>(
    initialBanner ? { target: "heading" } : null,
  );
  const setFocusTarget = (target: "heading" | "copy") => setFocus({ target });

  // After a result, focus the section h2 (or Copy link after a new link), so it
  // is never left on a closed dialog or a trigger that is gone.
  useEffect(() => {
    if (focus?.target === "copy") copyRef.current?.focus();
    if (focus?.target === "heading") {
      const h2 = rootRef.current?.closest("section")?.querySelector<HTMLElement>("h2");
      if (h2) {
        h2.tabIndex = -1;
        h2.focus();
      }
    }
  }, [focus]);

  // Errors stay in the dialogs (okOnly): the email field shows its own.
  const onLink = (r: ActionResult) => {
    if (r?.ok && r.values?.url) {
      setLink({ url: r.values.url, until: r.values.until ?? "" });
      setBanner({ tone: r.tone ?? "ok", text: r.message });
      setFocusTarget("copy");
    }
  };
  const ask = useSectionAction(requestConsentAction, onLink, { okOnly: true });
  const renew = useSectionAction(requestConsentAction, onLink, { okOnly: true });
  const resend = useSectionAction(emailConsentRequestAction, onLink, { okOnly: true });
  const revoke = useSectionAction(
    revokeConsentRequestAction,
    (r) => {
      if (!r?.ok) return;
      setLink(null);
      setBanner({ tone: "ok", text: r.message });
      setFocusTarget("heading");
    },
    { okOnly: true },
  );
  const withdraw = useSectionAction(
    withdrawConsentAction,
    (r) => {
      if (!r?.ok) return;
      setBanner({ tone: "ok", text: r.message });
      setFocusTarget("heading");
    },
    { okOnly: true },
  );

  const hidden = { playerId };

  return (
    <div ref={rootRef} className="wl-card max-w-3xl">
      <div aria-live="polite" className="mb-4 empty:mb-0">
        {banner && <Banner tone={banner.tone}>{banner.text}</Banner>}
      </div>
      {children}
      {link && (
        <CopyBox firstName={firstName} url={link.url} until={link.until} copyRef={copyRef} />
      )}

      <div className="wl-row mt-6">
        {admin && active && (
          <ButtonLink
            variant="secondary"
            icon={ShieldCheck}
            href={`/squad/players/${playerId}/consent`}
            block
            className="justify-center"
          >
            {changeLabel}
          </ButtonLink>
        )}
        {admin && active && minor && !openLink && (
          <ConfirmDialog
            trigger={{ label: "Ask a guardian", variant: "secondary", block: true }}
            title={`Ask ${firstName}'s parent or guardian`}
            body={`We make a link where they answer on their phone. It works for ${CONSENT_LINK_DAYS} days. Anyone with the link can answer, so send it only to them.`}
            form={ask}
            hidden={hidden}
            submit={{ label: "Create link", pendingLabel: "Creating link…", variant: "primary" }}
          >
            {(visible) => (
              <GuardianEmailField
                label="Guardian's email address (optional)"
                hint="We email them the link. Leave it empty to copy the link and send it yourself."
                error={fieldError(visible, "guardianEmail")}
              />
            )}
          </ConfirmDialog>
        )}
        {admin && active && minor && openLink && (
          <ConfirmDialog
            trigger={{ label: "Create a new link", variant: "secondary", block: true }}
            title="Create a new guardian link?"
            body={`The link you made on ${openLink.createdOn} stops working. Send the new link to ${firstName}'s parent or guardian.`}
            form={renew}
            hidden={hidden}
            submit={{
              label: "Create new link",
              pendingLabel: "Creating link…",
              variant: "primary",
            }}
          >
            {(visible) => (
              <GuardianEmailField
                label="Guardian's email address (optional)"
                hint="We email them the new link. Leave it empty to copy the link and send it yourself."
                error={fieldError(visible, "guardianEmail")}
              />
            )}
          </ConfirmDialog>
        )}
        {admin && active && minor && openLink && (
          <ConfirmDialog
            trigger={{
              label: "Email the link again",
              variant: "secondary",
              icon: Mail,
              block: true,
            }}
            title="Email the link again?"
            body={
              openLink.emailMasked
                ? `We email a new link to ${openLink.emailMasked}. The link you made before stops working, so they should use the newest one. It works until ${openLink.until}.`
                : `We email a new link to ${firstName}'s parent or guardian. The link you made before stops working. It works until ${openLink.until}.`
            }
            form={resend}
            hidden={hidden}
            submit={{ label: "Email the link", pendingLabel: "Sending…", variant: "primary" }}
          >
            {(visible) => (
              <GuardianEmailField
                label={
                  openLink.emailMasked
                    ? "Send to a different email address (optional)"
                    : "Guardian's email address"
                }
                hint={
                  openLink.emailMasked
                    ? `Leave it empty to use ${openLink.emailMasked}.`
                    : undefined
                }
                error={fieldError(visible, "guardianEmail")}
              />
            )}
          </ConfirmDialog>
        )}
        {admin && openLink && (
          <ConfirmDialog
            trigger={{ label: "Turn off link", variant: "ghost", block: true }}
            title="Turn off the guardian link?"
            body={`The link stops working at once. ${firstName}'s consent stays as it is.`}
            form={revoke}
            hidden={hidden}
            submit={{ label: "Turn off link", pendingLabel: "Turning off…", variant: "danger" }}
          />
        )}
        {active && (
          <ButtonLink
            variant="ghost"
            icon={Printer}
            href={`/squad/players/${playerId}/consent/print`}
            block
            className="justify-center"
          >
            Print paper form
          </ButtonLink>
        )}
        {admin && granted && (
          <ConfirmDialog
            trigger={{ label: "Withdraw consent", variant: "danger", icon: ShieldOff, block: true }}
            title={`Withdraw consent for ${name}?`}
            body={`The club and scouts stop seeing ${firstName}'s stats straight away. Wideline keeps no new stats for ${firstName}, and removes ${firstName} from clips, searches and saved lists within 24 hours.${active ? " You can record consent again later." : ""}`}
            form={withdraw}
            hidden={hidden}
            submit={{ label: "Withdraw consent", pendingLabel: "Withdrawing…", variant: "danger" }}
          >
            {(visible) => (
              <>
                <Field
                  label="Who asked to withdraw?"
                  hint={`The parent or guardian, or ${firstName} if 18 or over.`}
                  error={fieldError(visible, "requestedBy")}
                >
                  {(p) => (
                    <input
                      {...p}
                      name="requestedBy"
                      className="wl-input"
                      autoComplete="off"
                      maxLength={CONSENT_NAME_MAX}
                    />
                  )}
                </Field>
                {minor && (
                  <RadioGroup
                    name="relationship"
                    legend={`How are they related to ${firstName}? (optional)`}
                    options={GUARDIAN_RELATIONSHIPS.map((r) => ({
                      value: r,
                      label: RELATIONSHIP_LABELS[r],
                    }))}
                    error={fieldError(visible, "relationship")}
                  />
                )}
                <RadioGroup
                  name="method"
                  legend="How did they ask?"
                  options={CLUB_CONSENT_METHODS.map((m) => ({
                    value: m,
                    label: CONSENT_METHOD_LABELS[m],
                  }))}
                  error={fieldError(visible, "method")}
                />
              </>
            )}
          </ConfirmDialog>
        )}
      </div>
      {notes}
      {!admin && (
        <p className="caption mt-2 text-ink-muted">
          Only owners and admins can record or withdraw consent.
        </p>
      )}
    </div>
  );
}

/** The guardian's email address in the link dialogs (Q-019). Validated on the server. */
function GuardianEmailField({
  label,
  hint,
  error,
}: {
  label: string;
  hint?: string;
  error?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(p) => (
        <input
          {...p}
          type="email"
          name="guardianEmail"
          className="wl-input"
          autoComplete="off"
          spellCheck={false}
          maxLength={254}
        />
      )}
    </Field>
  );
}

const noSubscribe = () => () => {};

/** The guardian link, shown once after it is created (Surface 4, item 5). */
function CopyBox({
  firstName,
  url,
  until,
  copyRef,
}: {
  firstName: string;
  url: string;
  until: string;
  copyRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [copied, setCopied] = useState(false);
  // navigator.share exists only in some browsers, and only after hydration.
  const canShare = useSyncExternalStore(
    noSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );
  const [announce, setAnnounce] = useState("");
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  useEffect(
    () => () => {
      if (announceTimer.current) clearTimeout(announceTimer.current);
    },
    [],
  );

  // Clear the live region, then set the message after a moment, so a second
  // click announces again even when the words are the same.
  function say(text: string) {
    if (announceTimer.current) clearTimeout(announceTimer.current);
    setAnnounce("");
    announceTimer.current = setTimeout(() => setAnnounce(text), 100);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      say("Link copied.");
    } catch {
      say("The link was not copied. Select it and copy it yourself.");
    }
  }

  return (
    <div className="wl-card mt-4 bg-surface-sunken">
      <h3 className="body-strong">Guardian link for {firstName}</h3>
      <div className="wl-copybox mt-2">
        <label htmlFor="consent-link" className="sr-only">
          Guardian link
        </label>
        <input
          id="consent-link"
          className="wl-input data"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          ref={copyRef}
          variant="secondary"
          icon={copied ? Check : Copy}
          block
          className="justify-center"
          onClick={copy}
        >
          {copied ? "Copied" : "Copy link"}
        </Button>
        {canShare && (
          <Button
            variant="secondary"
            icon={Share2}
            block
            className="justify-center"
            onClick={() => void navigator.share({ url }).catch(() => {})}
          >
            Share link
          </Button>
        )}
      </div>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      <p className="body mt-2 text-ink-muted">
        Send this link to {firstName}&apos;s parent or guardian by WhatsApp or SMS, or hand them
        your phone to answer now. Anyone with the link can answer, so send it only to them. It works
        until {until}.
      </p>
      <p className="caption wl-inline-status wl-inline-status--warn mt-2">
        <Clock {...iconProps} />
        You will not see this link again after you leave this page. If it is lost, create a new one.
      </p>
    </div>
  );
}
