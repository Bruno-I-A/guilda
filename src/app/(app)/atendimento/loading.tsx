import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-14 w-72" />
      <div className="grid gap-3 lg:h-[calc(100dvh-13rem)] lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_17rem]">
        <Skeleton className="h-96 lg:h-auto" />
        <Skeleton className="hidden lg:block" />
        <Skeleton className="hidden xl:block" />
      </div>
    </div>
  );
}
