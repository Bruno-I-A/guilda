import { Skeleton } from "@/components/ui/skeleton";

export default function MuralLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Carregando Mural" className="grid gap-5">
      <span className="sr-only">Carregando Mural…</span>
      <div aria-hidden className="grid gap-5">
        <div className="grid gap-2">
          <Skeleton className="h-7 w-28 rounded-none" />
          <Skeleton className="h-4 w-96 max-w-full rounded-none" />
        </div>
        <div className="flex gap-4 border-b pb-3">
          <Skeleton className="h-4 w-20 rounded-none" />
          <Skeleton className="h-4 w-36 rounded-none" />
          <Skeleton className="h-4 w-24 rounded-none" />
        </div>
        <Skeleton className="h-9 w-full rounded-none" />
        {[0, 1, 2].map((index) => (
          <div key={index} className="panel-cut grid gap-3 border p-4">
            <Skeleton className="h-5 w-2/3 rounded-none" />
            <Skeleton className="h-3 w-1/3 rounded-none" />
            <Skeleton className="h-12 w-full rounded-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
