import "server-only";
import { formatDate } from "@/lib/labels";
import type { Email } from "./organisation";

// The guardian link email for C05 (Q-019; docs/build/design/C05.md, "Guardian
// link email"). Wideline emails the link when the club gives the guardian's
// address. Plain language at a reading age of about 12, sentence case, British
// and South African spelling, no exclamation marks, no emoji. Sent through
// sendMail (src/server/mail.ts) as plain text plus simple HTML; Mailpit catches
// it locally.
//
// Draft copy: legal review (Q-004 pattern)
// Draft for the privacy lawyer's review, like the consent wording
// (src/server/consent/wording.ts). It informs only: the guardian decides on the
// consent screens, never by replying to this email. It names the player by
// first name only: never the full name or the date of birth.

export type HtmlEmail = Email & { html: string };

const SIGN_OFF = "The Wideline team";

type Block = { heading?: string; body: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Draft copy: legal review
export function guardianLinkEmail({
  clubName,
  firstName,
  url,
  expiresAt,
}: {
  clubName: string;
  /** The player's first name only. */
  firstName: string;
  url: string;
  expiresAt: Date;
}): HtmlEmail {
  const until = formatDate(expiresAt);
  const before: Block[] = [
    { body: "Hello," },
    {
      body: `${clubName} uses Wideline to turn its match videos into football stats. ${clubName} is asking if Wideline may record ${firstName}'s stats.`,
    },
    {
      heading: "What we record",
      body: "We record goals, shots and where your child ran during matches. Scouts look for players for other clubs and academies. They can only see your child's stats if you say yes.",
    },
    {
      heading: "Who checks the video",
      body: "Independent scouts who are registered with Wideline watch the match video to check the stats are right. They must keep what they see private.",
    },
    {
      heading: "Where the data is kept",
      body: "Your child's data is stored and used outside South Africa, on computers in the European Union.",
    },
    {
      heading: "Your choice",
      body: "Open the link below to read more. You choose on the next screen, not in this email. You can change your mind at any time, and it costs nothing.",
    },
  ];
  const after: Block[] = [
    { body: `This link works until ${until}. After that, ask ${clubName} for a new one.` },
    {
      body: `If you are not ${firstName}'s parent or guardian, you can ignore this email. If you have questions, ask ${clubName}.`,
    },
    { body: SIGN_OFF },
  ];

  const textBlock = (b: Block) => (b.heading ? `${b.heading}\n${b.body}` : b.body);
  const htmlBlock = (b: Block) =>
    (b.heading ? `<p><strong>${escapeHtml(b.heading)}</strong><br>` : "<p>") +
    `${escapeHtml(b.body)}</p>`;

  return {
    subject: `${clubName} is asking about ${firstName}'s football stats`,
    text: [...before.map(textBlock), url, ...after.map(textBlock)].join("\n\n"),
    html: [
      "<!doctype html>",
      '<html lang="en-ZA"><body style="font-family: sans-serif; line-height: 1.5;">',
      ...before.map(htmlBlock),
      `<p><a href="${escapeHtml(url)}">Open the link to choose</a></p>`,
      `<p>Or copy this link into your browser:<br>${escapeHtml(url)}</p>`,
      ...after.map(htmlBlock),
      "</body></html>",
    ].join("\n"),
  };
}
