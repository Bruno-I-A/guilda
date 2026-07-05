"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <TriangleAlert className="size-10 text-destructive" aria-hidden />
      <h1 className="text-xl font-semibold">Algo deu errado</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Um erro inesperado aconteceu. Tente novamente — se persistir, saia e
        entre de novo na sua conta.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">Código: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>
        <RotateCcw aria-hidden /> Tentar novamente
      </Button>
    </div>
  );
}
