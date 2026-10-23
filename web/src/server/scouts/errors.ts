import { Prisma } from "@/generated/prisma/client";

/** True for a unique-constraint violation that names the field. */
export function isUniqueViolation(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  return JSON.stringify(err.meta ?? {}).includes(field) || err.message.includes(field);
}
