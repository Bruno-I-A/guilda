"use client";

import { AlertTriangle, Bot, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeTestKeyword } from "@/domain/support-agent";

import { saveAgentTest } from "./agent-test-actions";

function closedMessage(closed: number): string {
  if (closed === 0) return "Teste do agente desligado.";
  return closed === 1
    ? "Teste desligado. A conversa em teste foi para a equipe."
    : `Teste desligado. ${closed} conversas em teste foram para a equipe.`;
}

/**
 * Teste do agente (2026-11-19): quem começa a mensagem com a palavra-chave
 * conversa com a IA de verdade. Desligar é o freio de emergência.
 */
export function AgentTestPanel({ initial, aiReady }: { initial: { enabled: boolean; keyword: string }; aiReady: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [keyword, setKeyword] = useState(initial.keyword);
  const [pending, start] = useTransition();
  // O servidor grava a palavra sem acento e em minúscula: "Batata" já é a salva.
  const normalized = normalizeTestKeyword(keyword) ?? keyword.trim();
  const changed = enabled !== initial.enabled || normalized !== initial.keyword;

  function save() {
    start(async () => {
      const result = await saveAgentTest({ enabled, keyword });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setKeyword(normalized);
      toast.success(enabled ? "Teste do agente ligado." : closedMessage(result.data?.closedRounds ?? 0));
      router.refresh();
    });
  }

  return (
    <section className="panel-cut grid min-w-0 grid-cols-1 gap-5 border border-border bg-card p-5" aria-busy={pending}>
      <div className="flex min-w-0 gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
          <Bot className="size-5" aria-hidden />
        </div>
        <div>
          <h2>Teste do agente</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Quem começa a mensagem com a palavra-chave conversa com a IA de verdade, como um cliente: ela pergunta,
            responde pela base aprovada e encaminha ao clã. As outras conversas continuam só com a leitura interna.
          </p>
        </div>
      </div>

      {!aiReady ? (
        <div className="flex gap-3 border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="font-medium text-foreground">A IA do atendimento está desligada no servidor</p>
            <p className="mt-1 max-w-prose text-muted-foreground">
              Sem a leitura da IA ligada neste ambiente, o teste não responde ninguém.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid max-w-md gap-2">
        <Label htmlFor="agent-test-keyword">Palavra-chave</Label>
        <Input
          id="agent-test-keyword"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="batata"
          autoComplete="off"
          maxLength={40}
        />
        <p className="text-xs text-muted-foreground">
          Uma palavra só, no começo da mensagem: &quot;batata, preciso da guia&quot;. Mandar de novo reinicia o teste.
        </p>
      </div>

      <label className="flex max-w-md cursor-pointer items-center justify-between gap-3 border border-border p-3">
        <span>
          <span className="block text-sm font-medium">Teste ligado</span>
          <span className="block text-xs text-muted-foreground">
            Ao desligar, o teste para na hora: a conversa em teste vai para a equipe e a fala da IA que estava na fila não sai.
          </span>
        </span>
        <input className="size-4 shrink-0 accent-primary" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      </label>

      <div>
        <Button type="button" onClick={save} disabled={pending || !changed}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Salvar
        </Button>
      </div>
    </section>
  );
}
