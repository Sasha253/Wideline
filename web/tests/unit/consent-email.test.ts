import { describe, expect, it } from "vitest";
import { formatDate, maskEmail } from "@/lib/labels";
import { guardianLinkEmail } from "@/server/emails/consent";

// Q-019: the guardian link email and the masked address the club sees
// (docs/build/design/C05.md, "Guardian link email").

describe("maskEmail", () => {
  it.each([
    ["thandi@example.com", "t***@example.com"],
    ["t@example.com", "t***@example.com"],
    ["a.b+c@mail.co.za", "a***@mail.co.za"],
    ["not-an-address", "***"],
    ["@example.com", "***"],
  ])("%s shows as %s", (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });
});

describe("guardianLinkEmail", () => {
  const email = guardianLinkEmail({
    clubName: "Hellenic <FC> & Co",
    firstName: "Lebo",
    url: "http://wideline.localhost/consent/abc_DEF-123",
    expiresAt: new Date("2026-11-07T10:00:00Z"),
  });

  it("has the short subject and no exclamation marks", () => {
    expect(email.subject).toBe("Hellenic <FC> & Co is asking about Lebo's football stats");
    expect(`${email.subject}\n${email.text}`).not.toContain("!");
  });

  it("tells who asks, what is recorded, review, offshore storage, choice and expiry", () => {
    for (const part of [
      "Hellenic <FC> & Co is asking if Wideline may record Lebo's stats.",
      "We record goals, shots and where your child ran during matches.",
      "Independent scouts who are registered with Wideline",
      "outside South Africa",
      "You choose on the next screen",
      "You can change your mind at any time",
      "http://wideline.localhost/consent/abc_DEF-123",
      `This link works until ${formatDate(new Date("2026-11-07T10:00:00Z"))}.`,
    ]) {
      expect(email.text).toContain(part);
    }
  });

  it("escapes the club name in the HTML part and links the URL", () => {
    expect(email.html).toContain("Hellenic &lt;FC&gt; &amp; Co");
    expect(email.html).not.toContain("<FC>");
    expect(email.html).toContain('<a href="http://wideline.localhost/consent/abc_DEF-123">');
  });
});
