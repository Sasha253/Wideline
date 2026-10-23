// The reviewer confidentiality terms (AUTH09). Both /register and /scout render
// them through TermsText (src/app/register/TermsText.tsx), so the text lives
// here only. Pure data, safe in any component.
//
// Draft copy: legal review (Q-004)
// Draft for legal review. Any change to the wording needs a new
// REVIEWER_TERMS_VERSION: every scout is then blocked from review
// (requireReviewer) until they accept the new version on /scout.

export const REVIEWER_TERMS_VERSION = "2026-10-draft-1";

export type TermsSection = { heading: string; body: string };

export const REVIEWER_TERMS: readonly TermsSection[] = [
  {
    heading: "Keep footage confidential",
    body: "Watch match footage only inside Wideline, and only to review the match you claimed. Do not describe or share what you see with anyone outside Wideline.",
  },
  {
    heading: "Do not download or record",
    body: "Do not download, screen-record, photograph or copy any footage, clip or stat. Every review session is logged.",
  },
  {
    heading: "Do not contact players or clubs",
    body: "Do not contact a player, their family or their club about anything you saw while reviewing, unless you do it through Wideline.",
  },
  {
    heading: "Declare your conflicts",
    body: "Tell us about every club you work for or with, and every player you represent. Keep the list up to date on your scout profile. You cannot review matches involving them.",
  },
  {
    heading: "Who can review",
    body: "You must be 18 or older. Your account is for you alone; do not let anyone else use it.",
  },
  {
    heading: "If you break these terms",
    body: "We can suspend your review access straight away and remove you from Wideline.",
  },
];
