import { ListSkeleton } from "@/components/states/Skeleton";

// The shell stays; only the content swaps to a skeleton.
export default function Loading() {
  return <ListSkeleton />;
}
