// Field error copy shared by server schemas and client checks
// (docs/build/design/C01.md, C02.md). Client-safe: no zod, no server code.

export const EMAIL_ERROR = "Enter an email address, for example name@club.co.za.";
export const NAME_TOO_LONG = "Use 120 characters or fewer.";
