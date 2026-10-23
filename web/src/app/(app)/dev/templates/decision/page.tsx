import { DecisionChoice, DecisionFlow } from "@/components/templates/DecisionFlow";
import { DEV_ROLES, requirePageRole } from "@/server/auth/session";

export const metadata = { title: "Decision flow" };

// The form posts nowhere: it GETs this page again, so the showcase has no server action.
export default async function DecisionTemplatePage() {
  await requirePageRole(DEV_ROLES);
  return (
    <DecisionFlow
      step="Step 1 of 2"
      question="Can scouts see Lebo's stats?"
      explainer="We record goals, shots and where Lebo ran during matches. Scouts can only see this if you say yes."
      action="/dev/templates/decision"
      submitLabel="Save my answer"
      secondary={{ href: "/dev/templates", label: "Back" }}
    >
      <DecisionChoice name="answer" value="yes" label="Yes, scouts can see them" />
      <DecisionChoice name="answer" value="no" label="No, keep them inside the club" />
    </DecisionFlow>
  );
}
