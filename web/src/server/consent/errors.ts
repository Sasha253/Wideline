// Errors for the consent module (docs/build/design/C05.md), on the PlayerError
// pattern: a code, the copy to show when the code alone does not say it, and
// the form field it belongs on.

export type ConsentErrorCode =
  "not_found" | "placeholder" | "departed" | "invalid" | "not_granted" | "adult" | "no_link";

export class ConsentError extends Error {
  constructor(
    readonly code: ConsentErrorCode,
    /** The copy to show, when the code alone does not say it. */
    readonly userMessage?: string,
    /** The form field the message belongs on. */
    readonly field?: string,
  ) {
    super(`Consent: ${code}`);
    this.name = "ConsentError";
  }
}

/** Why a guardian link cannot do what was asked: the page re-renders its closed view. */
export class GuardianLinkError extends Error {
  constructor(readonly code: "closed" | "not_granted") {
    super(`Guardian link: ${code}`);
    this.name = "GuardianLinkError";
  }
}
