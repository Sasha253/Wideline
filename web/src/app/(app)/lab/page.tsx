import { redirect } from "next/navigation";
import { LAB_ROLES, requirePageRole } from "@/server/auth/session";

export default async function LabHome() {
  await requirePageRole(LAB_ROLES);
  redirect("/lab/matches");
}
