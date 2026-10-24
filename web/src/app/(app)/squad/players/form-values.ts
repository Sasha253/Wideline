import type { PreferredFoot } from "@/generated/prisma/enums";

// The player form's values as strings, shared by the server pages and the
// client PlayerForm (a "use client" module cannot export plain values to a
// server component).

export type PlayerFormValues = {
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD, or "" */
  dateOfBirth: string;
  position: string;
  preferredFoot: PreferredFoot | "";
  heightCm: string;
  squadNumber: string;
  teamId: string;
};

export const EMPTY_PLAYER: PlayerFormValues = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  position: "",
  preferredFoot: "",
  heightCm: "",
  squadNumber: "",
  teamId: "",
};
