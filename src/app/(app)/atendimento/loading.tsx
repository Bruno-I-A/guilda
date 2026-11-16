import { Skeleton } from "@/components/ui/skeleton";

/** Mesma moldura da caixa de entrada: cabeçalho compacto, fila à esquerda e conversa. */
export default function Loading() {
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <Skeleton className="h-14 w-full rounded-none" />
      <div className="grid min-h-0 gap-px lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="grid content-start gap-2 p-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
        <Skeleton className="hidden rounded-none lg:block" />
      </div>
    </div>
  );
}
