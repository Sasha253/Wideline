import { PageHeader } from "@/components/templates/PageHeader";
import { StateMessage } from "@/components/ui/StateMessage";

// The squad while it loads (Floodlight, "State · loading"): the header stays, static rows
// the shape of the table, "Loading squad" for screen readers and the 8 s "Still loading".
export default function SquadLoading() {
  return (
    <>
      <PageHeader title="Squad" />
      <StateMessage kind="loading" title="Loading squad" className="mt-6" />
    </>
  );
}
