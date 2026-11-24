"use client";

import { AlertTriangle, Bot, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeTestKeyword, type AgentMode } from "@/domain/support-agent";
import { cn } from "@/lib/utils";

import { saveAgentMode } from "./agent-actions";

const MODES: readonly { mode: AgentMode; label: string; description: string }[] = [
  { mode: "off", label: "Desligado", description: "A IA só lê as conversas para sugerir. Nada vai ao cliente." },
  { mode: "test", label: "Só teste", description: "Só quem começa a mensagem com a palavra-chave conversa com a IA." },
  {
    mode: "live",
    label: "Todos os clientes",
    description: "Toda conversa nova começa com a IA: ela pergunta o assunto, responde pela base aprovada e encaminha ao clã.",
  },
];

export const PRIVACY_WARNING =
  "As mensagens, áudios e arquivos dos clientes vão para a Anthropic e a OpenAI. Ligue só com o aviso de privacidade resolvido.";

function savedMessage(mode: AgentMode, closed: number): string {
  if (mode === "test") return "Teste do agente ligado.";
  if (mode === "live") return "Agente atendendo todos os clientes.";
  if (closed === 0) return "Agente desligado.";
  return closed === 1 ? "Agente desligado. A conversa em andamento foi para a equipe." : `Agente desligado. ${closed} conversas foram para a equipe.`;
}

/**
 * Agente de IA (2026-11-23): desligado, só teste (palavra-chave) ou todos os
 * clientes. Desligar é o freio de emergência; ligar para todos pede confirmação.
 */
export function AgentPanel({ initial, aiReady }: { initial: { mode: AgentMode; keyword: string }; aiReady: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<AgentMode>(initial.mode);
  const [keyword, setKeyword] = useState(initial.keyword);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  // O servidor grava a palavra sem acento e em minúscula: "Batata" já é a salva.
  const normalized = normalizeTestKeyword(keyword) ?? keyword.trim();
  const changed = mode !== initial.mode || normalized !== initial.keyword;

  function save() {
    setConfirming(false);
    start(async () => {
      const result = await saveAgentMode({ mode, keyword });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setKeyword(normalized);
      toast.success(savedMessage(mode, result.data?.closedRounds ?? 0));
      router.refresh();
    });
  }

  function requestSave() {
    if (mode === "live" && initial.mode !== "live") setConfirming(true);
    else save();
  }

  return (
    <section className="panel-cut grid min-w-0 grid-cols-1 gap-5 border border-border bg-card p-5" aria-busy={pending}>
      <div className="flex min-w-0 gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10 text-primary">
          <Bot className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2>Agente de IA</h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Quem fala com o cliente pelo WhatsApp antes de uma pessoa. Fora do expediente, ele avisa quando a equipe volta.
          </p>
        </div>
      </div>

      {!aiReady ? (
        <div className="flex gap-3 border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <p className="font-medium text-foreground">A IA do atendimento está desligada no servidor</p>
            <p className="mt-1 max-w-prose text-muted-foreground">Sem a leitura da IA ligada neste ambiente, o agente não responde ninguém.</p>
          </div>
        </div>
      ) : null}

      <fieldset className="grid min-w-0 gap-2">
        <legend className="sr-only">Modo do agente</legend>
        <div className="grid min-w-0 gap-2 sm:grid-cols-3">
          {MODES.map((option) => (
            <button
              key={option.mode}
              type="button"
              aria-pressed={mode === option.mode}
              onClick={() => setMode(option.mode)}
              className={cn(
                "grid min-w-0 gap-1 border p-3 text-left transition-colors",
                mode === option.mode ? "border-primary bg-primary/10" : "border-border hover:bg-muted/40",
              )}
            >
              <span className="text-sm font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.description}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {mode !== "off" ? (
        <div className="grid max-w-md gap-2">
          <Label htmlFor="agent-keyword">Palavra-chave{mode === "live" ? " (opcional)" : ""}</Label>
          <Input
            id="agent-keyword"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="batata"
            autoComplete="off"
            maxLength={40}
          />
          <p className="text-xs text-muted-foreground">
            {mode === "test"
              ? "Uma palavra só, no começo da mensagem: \"batata, preciso da guia\". Mandar de novo reinicia o teste."
              : "Reinicia a conversa com a IA mesmo numa conversa que já está com a equipe. Serve para testar."}
          </p>
        </div>
      ) : null}

      {mode === "live" ? (
        <p className="flex max-w-prose gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          {PRIVACY_WARNING}
        </p>
      ) : null}

      <div>
        <Button type="button" onClick={requestSave} disabled={pending || !changed}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Save aria-hidden />}
          Salvar
        </Button>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ligar o agente para todos os clientes?</DialogTitle>
            <DialogDescription>
              Toda conversa nova passa a começar com a IA. {PRIVACY_WARNING}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>Cancelar</Button>
            <Button type="button" onClick={save}>Ligar para todos</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
