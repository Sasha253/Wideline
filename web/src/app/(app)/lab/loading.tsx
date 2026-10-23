import { ListSkeleton } from "@/components/states/Skeleton";
import { ThemeScope } from "@/components/ui/theme";

// Inside the Lab's dark scope, so the Lab never flashes light while it loads.
export default function LabLoading() {
  return (
    <ThemeScope theme="dark" className="rounded-lg p-4 md:p-6">
      <ListSkeleton />
    </ThemeScope>
  );
}
