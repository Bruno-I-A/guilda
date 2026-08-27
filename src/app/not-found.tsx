import { Compass } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <Compass className="size-10 text-muted-foreground" aria-hidden />
      {/* Herda a escala display (24px Cinzel), igual ao error.tsx. */}
      <h1>Página não encontrada</h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        O conteúdo pode ter sido movido, cancelado ou pertencer a outra
        organização.
      </p>
      <Button asChild>
        <Link href="/dashboard">Voltar ao início</Link>
      </Button>
    </div>
  );
}
