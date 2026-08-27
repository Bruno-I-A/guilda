"use client";

import { Archive, Building2, Check, Megaphone, Pin, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-context";
import { cn } from "@/lib/utils";

import { acknowledgeNotice, archiveNotice, publishNotice } from "./actions";

export interface NoticeView {
  id: string;
  kind: "notice" | "new_client";
  title: string;
  body: string;
  authorName: string;
  clientName: string | null;
  publishedAt: string;
  requiresAck: boolean;
  pinned: boolean;
  acknowledged: boolean;
  canManage: boolean;
  ackCount: number;
  totalMembers: number;
  pendingNames: string[];
}

function formatPublished(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export function NoticeBoard({
  notices,
  canEmphasize,
}: {
  notices: NoticeView[];
  canEmphasize: boolean;
  currentUserName: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [requiresAck, setRequiresAck] = useState(false);
  const [pinned, setPinned] = useState(false);

  function run(action: () => Promise<ActionResult<unknown>>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  function handlePublish() {
    startTransition(async () => {
      const result = await publishNotice({ title, body, requiresAck, pinned });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Aviso publicado.");
      setTitle("");
      setBody("");
      setRequiresAck(false);
      setPinned(false);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button className="w-fit">
            <Plus className="size-4" aria-hidden /> Publicar aviso
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publicar aviso</DialogTitle>
            <DialogDescription>
              Vai para a Guilda inteira. Escreva o que a equipe precisa saber.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="notice-title">Título</Label>
              <Input
                id="notice-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={160}
                placeholder="Ex.: Prazo do Simples antecipado"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="notice-body">Aviso</Label>
              <Textarea
                id="notice-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={6}
                maxLength={5000}
              />
            </div>

            {canEmphasize ? (
              <div className="grid gap-2 rounded-md border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requiresAck}
                    onChange={(event) => setRequiresAck(event.target.checked)}
                  />
                  Exigir confirmação de leitura
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={pinned}
                    onChange={(event) => setPinned(event.target.checked)}
                  />
                  Fixar no topo
                </label>
                <p className="text-xs text-muted-foreground">
                  Aviso que exige confirmação notifica todo mundo. Use quando
                  realmente precisar de ciência.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Fixar e exigir confirmação são ações de líder de clã ou admin.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              onClick={handlePublish}
              disabled={pending || title.trim().length < 3 || body.trim().length < 3}
            >
              Publicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {notices.length === 0 ? (
        <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nenhum aviso no mural. Quando uma empresa nova for cadastrada, ela
          aparece aqui automaticamente.
        </p>
      ) : (
        <ul className="grid gap-3">
          {notices.map((notice) => {
            const needsMyAck = notice.requiresAck && !notice.acknowledged;

            return (
              <li
                key={notice.id}
                id={`aviso-${notice.id}`}
                className={cn(
                  // `panel-cut` já desenha a superfície e a aresta; borda
                  // arredondada por cima só devolvia o canto que o chanfro corta.
                  "panel-cut p-4",
                  // Destaque de "falta a sua confirmação": o anel vai POR DENTRO,
                  // senão o clip-path cisalha os cantos dele.
                  needsMyAck &&
                    "shadow-[inset_0_0_0_1px_var(--primary),inset_0_1px_0_oklch(1_0_0/5%)]",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {notice.pinned ? (
                        <Pin className="size-3.5 text-primary" aria-label="Fixado" />
                      ) : null}
                      <h2>{notice.title}</h2>
                      {notice.kind === "new_client" ? (
                        <Badge variant="secondary" className="gap-1">
                          <Building2 className="size-3" aria-hidden /> Empresa nova
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <Megaphone className="size-3" aria-hidden /> Aviso
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {notice.authorName} · {formatPublished(notice.publishedAt)}
                      {notice.clientName ? ` · ${notice.clientName}` : ""}
                    </p>
                  </div>

                  {notice.canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => archiveNotice({ noticeId: notice.id }),
                          "Aviso arquivado.",
                        )
                      }
                    >
                      <Archive className="size-4" aria-hidden /> Arquivar
                    </Button>
                  ) : null}
                </div>

                <p className="mt-3 max-w-prose whitespace-pre-wrap text-sm text-muted-foreground">
                  {notice.body}
                </p>

                {notice.requiresAck ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    {notice.acknowledged ? (
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Check className="size-4 text-primary" aria-hidden /> Você
                        confirmou
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () => acknowledgeNotice({ noticeId: notice.id }),
                            "Leitura confirmada.",
                          )
                        }
                      >
                        <Check className="size-4" aria-hidden /> Confirmar leitura
                      </Button>
                    )}

                    {notice.canManage ? (
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {notice.ackCount} de {notice.totalMembers} confirmaram
                        {notice.pendingNames.length > 0
                          ? ` · falta ${notice.pendingNames.slice(0, 4).join(", ")}${
                              notice.pendingNames.length > 4
                                ? ` +${notice.pendingNames.length - 4}`
                                : ""
                            }`
                          : ""}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
