"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { prepareMemberWhatsAppTemplates, type TemplateStatusView } from "./whatsapp-actions";

const LABELS: Record<string, string> = {
  nova_missao: "Nova missão",
  aprovacao: "Entrega para aprovação",
  missao_atualizada: "Missão atualizada",
  prazo: "Prazo",
  resumo: "Resumo diário",
  aviso: "Mural e fechamentos",
  novo_cliente: "Novo cliente",
};

const ORDER = ["nova_missao", "aprovacao", "missao_atualizada", "prazo", "resumo", "aviso", "novo_cliente"];

function statusLabel(status: string): { text: string; tone: string } {
  switch (status) {
    case "APPROVED": return { text: "Aprovado", tone: "text-success" };
    case "PENDING":
    case "IN_APPEAL": return { text: "Em análise", tone: "text-warning" };
    case "REJECTED": return { text: "Recusado", tone: "text-destructive" };
    case "PAUSED":
    case "DISABLED": return { text: "Pausado", tone: "text-destructive" };
    case "not_created": return { text: "Não criado", tone: "text-muted-foreground" };
    default: return { text: status, tone: "text-muted-foreground" };
  }
}

/**
 * Modelos Utility que levam o aviso a quem está fora das 24 horas. Um botão só:
 * cria na Meta o que falta e atualiza a situação do resto. Só admin e dono.
 */
export function WhatsAppTemplates({ templates }: { templates: TemplateStatusView[] }) {
  const [pending, start] = useTransition();
  const byKey = new Map(templates.map((template) => [template.key, template]));

  function prepare() {
    start(async () => {
      const result = await prepareMemberWhatsAppTemplates();
      if (result.ok) toast.success("Modelos enviados à Meta. A situação de cada um aparece abaixo.");
      else toast.error(result.error);
    });
  }

  return (
    <Card className="panel-cut rounded-none border-0 ring-0">
      <CardHeader className="border-b">
        <CardTitle asChild>
          <h2>Modelos do WhatsApp</h2>
        </CardTitle>
        <CardDescription>
          Fora das 24 horas depois da última mensagem da pessoa, o aviso só sai por modelo aprovado pela Meta. Cada envio por modelo custa alguns centavos.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="grid gap-1">
          {ORDER.map((key) => {
            const template = byKey.get(key);
            const status = statusLabel(template?.status ?? "not_created");
            return (
              <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b py-2 text-sm last:border-b-0">
                <span className="font-medium">{LABELS[key]}</span>
                <span className={cn("text-xs", status.tone)}>
                  {status.text}
                  {template?.category === "MARKETING" ? " · classificado como Marketing" : ""}
                </span>
                {template?.rejectedReason && template.rejectedReason !== "NONE" ? (
                  <span className="basis-full text-xs text-muted-foreground">Motivo: {template.rejectedReason}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div>
          <Button variant="outline" disabled={pending} onClick={prepare}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <ShieldCheck aria-hidden />}
            Preparar modelos
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
