import type { BrowserContext } from "@playwright/test";

// Reads emails from Mailpit's API (http://mail.wideline.localhost locally).
// Requests go through a browser page, not Node: Chromium resolves *.localhost
// to loopback, which reaches Caddy both on the host and in the Playwright
// container (see PLAYWRIGHT_RUN in the Makefile).

export const mailpitUrl = process.env.E2E_MAILPIT_URL ?? "http://mail.wideline.localhost";

type Found = { subject: string; text: string; path: string };

/**
 * Waits for the newest email to `to` that holds an /invite/<token> link, and
 * returns its subject, text and the link's path.
 */
export async function findInviteEmail(
  context: BrowserContext,
  to: string,
  { timeout = 20_000, notPath }: { timeout?: number; notPath?: string } = {},
): Promise<Found> {
  const page = await context.newPage();
  try {
    const deadline = Date.now() + timeout;
    const query = encodeURIComponent(`to:"${to}"`);
    while (Date.now() < deadline) {
      const search = await page.goto(`${mailpitUrl}/api/v1/search?query=${query}&limit=1`);
      const { messages } = (await search!.json()) as { messages: { ID: string }[] };
      if (messages.length) {
        const res = await page.goto(`${mailpitUrl}/api/v1/message/${messages[0]!.ID}`);
        const msg = (await res!.json()) as { Subject: string; Text: string };
        const link = msg.Text.match(/https?:\/\/[^\s]+\/invite\/[\w-]+/)?.[0];
        if (link) {
          const path = new URL(link).pathname;
          if (path !== notPath) return { subject: msg.Subject, text: msg.Text, path };
        }
      }
      await page.waitForTimeout(500);
    }
    throw new Error(`No invitation email to ${to} within ${timeout}ms`);
  } finally {
    await page.close();
  }
}

/**
 * Waits for the newest email to `to` with this subject and returns the first
 * link matching `link` (C02: the email confirmation link).
 */
export async function findEmailLink(
  context: BrowserContext,
  to: string,
  subject: string,
  link: RegExp,
  { timeout = 20_000 }: { timeout?: number } = {},
): Promise<{ text: string; url: string }> {
  const page = await context.newPage();
  try {
    const deadline = Date.now() + timeout;
    const query = encodeURIComponent(`to:"${to}" subject:"${subject}"`);
    while (Date.now() < deadline) {
      const search = await page.goto(`${mailpitUrl}/api/v1/search?query=${query}&limit=1`);
      const { messages } = (await search!.json()) as { messages: { ID: string }[] };
      if (messages.length) {
        const res = await page.goto(`${mailpitUrl}/api/v1/message/${messages[0]!.ID}`);
        const msg = (await res!.json()) as { Text: string };
        const url = msg.Text.match(link)?.[0];
        if (url) return { text: msg.Text, url };
      }
      await page.waitForTimeout(500);
    }
    throw new Error(`No "${subject}" email to ${to} within ${timeout}ms`);
  } finally {
    await page.close();
  }
}
