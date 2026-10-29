// No "server-only" marker: the worker (plain Node, src/worker/) sends mail
// too (C08 platform-admin alerts). It reads the SMTP settings straight from
// the environment; the web app's sendMail (src/server/mail.ts) uses it.
import { createTransport, type Transporter } from "nodemailer";

let transport: Transporter | undefined;

function getTransport(): Transporter {
  const port = Number(process.env.SMTP_PORT ?? 1025);
  transport ??= createTransport({
    host: process.env.SMTP_HOST ?? "localhost",
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  return transport;
}

/** Sends one email. `html` is an optional HTML part next to the plain text. */
export async function deliverMail(
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<void> {
  await getTransport().sendMail({
    from: process.env.MAIL_FROM || "Wideline <no-reply@wideline.localhost>",
    to,
    subject,
    text,
    ...(html && { html }),
  });
}
