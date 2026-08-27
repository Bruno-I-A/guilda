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
      {/* Sem classe de tamanho: o h1 herda a escala display (24px Cinzel).
          Antes era `text-xl`, um passo que não existia em nenhuma outra tela. */}
      <h1>Algo deu errado</h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        Um erro inesperado aconteceu. Tente novamente — se persistir, saia e
        entre de novo na sua conta.
      </p>
      {error.digest ? (
        <p className="hud-label">
          Código: <span className="font-mono normal-case">{error.digest}</span>
        </p>
      ) : null}
      <Button onClick={reset}>
        <RotateCcw aria-hidden /> Tentar novamente
      </Button>
    </div>
  );
}
