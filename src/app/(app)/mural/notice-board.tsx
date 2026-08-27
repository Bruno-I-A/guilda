"use client";

import {
  Archive,
  Building2,
  Check,
  CircleCheckBig,
  ListChecks,
  Megaphone,
  Pin,
  Plus,
  UserRoundX,
} from "lucide-react";
import Link from "next/link";
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
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import type { TaskStatus } from "@/domain/task-state";
import type { ActionResult } from "@/lib/action-context";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/task-ui";

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
  missionSummary: {
    total: number;
    completed: number;
    cancelled: number;
    unassigned: number;
    items: Array<{
      id: string;
      title: string;
      status: TaskStatus;
      clanName: string | null;
      assigneeName: string | null;
    }>;
  } | null;
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

function InformativeMissionSummary({
  summary,
}: {
  summary: NonNullable<NoticeView["missionSummary"]>;
}) {
  const open = summary.total - summary.completed - summary.cancelled;
  const progress = summary.total > 0
    ? Math.round((summary.completed / summary.total) * 100)
    : 100;
  const allCompleted = summary.total > 0 && summary.completed === summary.total;

  return (
    <section className="mt-4 grid gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <ListChecks className="size-4 text-primary" aria-hidden />
          Missões deste Informativo
        </h3>
        <Badge
          variant="outline"
          className={allCompleted
            ? "border-success/35 bg-success/10 text-success"
            : "border-primary/30 text-primary"}
        >
          {allCompleted ? "Todas concluídas" : `${summary.completed} de ${summary.total} concluídas`}
        </Badge>
      </div>

      <Progress value={progress} className="h-2" />

      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <span className="rounded-md bg-muted/35 px-2.5 py-2">
          <strong className="block font-mono text-base">{summary.total}</strong>
          Geradas
        </span>
        <span className="rounded-md bg-muted/35 px-2.5 py-2">
          <strong className="block font-mono text-base text-success">{summary.completed}</strong>
          Concluídas
        </span>
        <span className="rounded-md bg-muted/35 px-2.5 py-2">
          <strong className="block font-mono text-base text-primary">{open}</strong>
          Em aberto
        </span>
        <span className="rounded-md bg-muted/35 px-2.5 py-2">
          <strong className="flex items-center gap-1 font-mono text-base text-warning">
            {summary.unassigned > 0 ? <UserRoundX className="size-3.5" aria-hidden /> : null}
            {summary.unassigned}
          </strong>
          Sem responsável
        </span>
      </div>

      {summary.total === 0 ? (
        <p className="text-xs text-muted-foreground">
          Este Informativo não gerou missões.
        </p>
      ) : (
        <details className="group rounded-md border bg-background/25">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
            Ver resumo das {summary.total} {summary.total === 1 ? "missão" : "missões"}
          </summary>
          <ul className="divide-y border-t">
            {summary.items.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/tasks/${task.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-muted/25"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{task.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[task.clanName, task.assigneeName ?? "Sem responsável"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <Badge className={STATUS_BADGE_CLASSES[task.status]}>
                    {task.status === "completed" ? <CircleCheckBig aria-hidden /> : null}
                    {STATUS_LABELS[task.status]}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
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
                className={
                  needsMyAck
                    ? "panel-cut rounded-lg border border-primary/50 bg-card/70 p-4"
                    : "panel-cut rounded-lg border bg-card/50 p-4"
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {notice.pinned ? (
                        <Pin className="size-3.5 text-primary" aria-label="Fixado" />
                      ) : null}
                      <h2 className="font-medium">{notice.title}</h2>
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

                <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                  {notice.body}
                </p>

                {notice.missionSummary ? (
                  <InformativeMissionSummary summary={notice.missionSummary} />
                ) : null}

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
                      <span className="font-mono text-xs text-muted-foreground">
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
