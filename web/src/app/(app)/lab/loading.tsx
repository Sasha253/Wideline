import { ListSkeleton } from "@/components/states/Skeleton";

// Rendered inside the Lab layout, which already supplies the dark scope and
// its padding.
export default function LabLoading() {
  return <ListSkeleton />;
}
