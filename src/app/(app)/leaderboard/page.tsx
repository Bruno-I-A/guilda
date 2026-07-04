import { Trophy } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Ranking" };

export default function LeaderboardPage() {
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Ranking</h1>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
        <Trophy className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-medium">Ranking chega na Fase 3</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Complete tarefas para acumular XP e disputar o topo da guilda.
        </p>
      </div>
    </div>
  );
}
