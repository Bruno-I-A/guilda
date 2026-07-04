import { ListTodo } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Tarefas" };

export default function TasksPage() {
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Tarefas</h1>
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
        <ListTodo className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-medium">Tarefas chegam na Fase 2</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Criação, atribuição e fluxo de aprovação com XP estão a caminho.
        </p>
      </div>
    </div>
  );
}
