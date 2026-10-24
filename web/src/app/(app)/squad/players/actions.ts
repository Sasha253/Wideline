"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { fieldErrorsFrom, UNEXPECTED_ERROR, type ActionResult } from "@/lib/action-result";
import { teamLabel } from "@/lib/labels";
import { requireRole, SQUAD_ADMIN_ROLES } from "@/server/auth/session";
import { log } from "@/server/log";
import { requireSquadOrg } from "@/server/squad/access";
import type { PlayerInput } from "@/server/squad/fields";
import {
  createPlayer,
  markDeparted,
  PlayerError,
  undoDeparture,
  updatePlayer,
} from "@/server/squad/players";

// Server actions for /squad/players (SQUAD02, SQUAD04, SQUAD09;
// docs/build/design/C04.md, Surface 5). Owners and admins only.

const PLAYER_GONE = "This player no longer exists. Go back to the squad.";

function playerInput(formData: FormData): PlayerInput {
  const text = (name: string) => String(formData.get(name) ?? "");
  return {
    teamId: text("teamId"),
    firstName: text("firstName"),
    lastName: text("lastName"),
    dateOfBirth: text("dateOfBirth"),
    position: text("position"),
    preferredFoot: text("preferredFoot"),
    heightCm: text("heightCm"),
    squadNumber: text("squadNumber"),
  };
}

function playerError(err: unknown): ActionResult {
  if (err instanceof ZodError) return { ok: false, fieldErrors: fieldErrorsFrom(err.issues) };
  if (err instanceof PlayerError) {
    if (err.field && err.userMessage) {
      return { ok: false, fieldErrors: { [err.field]: err.userMessage } };
    }
    if (err.code === "departed" && err.userMessage)
      return { ok: false, formError: err.userMessage };
    if (err.code === "not_found") return { ok: false, formError: PLAYER_GONE };
  }
  log.error({ err }, "player save failed");
  return { ok: false, formError: UNEXPECTED_ERROR };
}

export async function createPlayerAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(SQUAD_ADMIN_ROLES));
  let created: Awaited<ReturnType<typeof createPlayer>>;
  try {
    created = await createPlayer(ctx, playerInput(formData));
  } catch (err) {
    return playerError(err);
  }
  revalidatePath("/squad", "layout");
  return {
    ok: true,
    message: created.team
      ? `${created.name} added to ${teamLabel(created.team)}.`
      : `${created.name} added.`,
    href: `/squad/players/${created.id}`,
    key: String(Date.now()),
  };
}

export async function updatePlayerAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(SQUAD_ADMIN_ROLES));
  const playerId = String(formData.get("playerId") ?? "");
  try {
    await updatePlayer(ctx, playerId, playerInput(formData));
  } catch (err) {
    return playerError(err);
  }
  revalidatePath("/squad", "layout");
  return { ok: true, message: "Changes saved.", key: String(Date.now()) };
}

export async function markDepartedAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(SQUAD_ADMIN_ROLES));
  const playerId = String(formData.get("playerId") ?? "");
  try {
    await markDeparted(ctx, playerId);
  } catch (err) {
    if (err instanceof PlayerError && err.code === "departed") {
      return {
        ok: false,
        formError: `${err.userMessage ?? "This player"} has already left the club.`,
      };
    }
    if (err instanceof PlayerError && err.code === "not_found") {
      return { ok: false, formError: PLAYER_GONE };
    }
    log.error({ err }, "player departure failed");
    return { ok: false, formError: "Something went wrong. Nothing changed. Try again." };
  }
  revalidatePath("/squad", "layout");
  redirect(`/squad/players/${playerId}?done=departed`);
}

/**
 * Undoes a departure within the undo window (SQUAD09, Q-012). A taken squad
 * number comes back as a squadNumber field error; success reloads the player
 * page with its banner.
 */
export async function undoDepartureAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const ctx = requireSquadOrg(await requireRole(SQUAD_ADMIN_ROLES));
  const playerId = String(formData.get("playerId") ?? "");
  try {
    await undoDeparture(ctx, playerId);
  } catch (err) {
    if (err instanceof PlayerError) {
      if (err.field && err.userMessage) {
        return { ok: false, fieldErrors: { [err.field]: err.userMessage } };
      }
      if (err.code === "not_found") return { ok: false, formError: PLAYER_GONE };
      if (err.userMessage) return { ok: false, formError: err.userMessage };
    }
    log.error({ err }, "undo departure failed");
    return { ok: false, formError: "Something went wrong. Nothing changed. Try again." };
  }
  revalidatePath("/squad", "layout");
  redirect(`/squad/players/${playerId}?done=restored`);
}
