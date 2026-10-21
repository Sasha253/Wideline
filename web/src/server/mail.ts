import "server-only";
import { createTransport, type Transporter } from "nodemailer";
import { env } from "./env";

let transport: Transporter | undefined;

function getTransport(): Transporter {
  const e = env();
  transport ??= createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
  });
  return transport;
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await getTransport().sendMail({ from: env().MAIL_FROM, to, subject, text });
}
