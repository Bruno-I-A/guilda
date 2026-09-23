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
  Undo2,
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
import type { MuralSection } from "@/domain/mural-work";
import type { ActionResult } from "@/lib/action-context";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/task-ui";

import { toastWithUndo } from "@/lib/undo-toast";

import {
  acknowledgeNotice,
  archiveNotice,
  confirmNoticeWork,
  publishNotice,
  reopenNoticeWork,
  unarchiveNotice,
} from "./actions";

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
  work: { section: MuralSection; total: number; closed: number };
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
      isMine: boolean;
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
  returnTo,
}: {
  summary: NonNullable<NoticeView["missionSummary"]>;
  returnTo: string;
}) {
  const open = summary.total - summary.completed - summary.cancelled;
  const progress = summary.total > 0
    ? Math.round((summary.completed / summary.total) * 100)
    : 100;
  const allCompleted = summary.total > 0 && summary.completed === summary.total;

  return (
    <section className="mt-4 grid gap-3 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium">
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

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span><strong className="font-mono text-success">{summary.completed}</strong> concluídas</span>
        <span><strong className="font-mono text-primary">{open}</strong> em aberto</span>
        {summary.unassigned > 0 ? (
          <span className="inline-flex items-center gap-1 text-warning">
            <UserRoundX className="size-3.5" aria-hidden />
            <strong className="font-mono">{summary.unassigned}</strong> sem responsável
          </span>
        ) : null}
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
            {[...summary.items].sort((a, b) => Number(b.isMine) - Number(a.isMine)).map((task) => (
              <li key={task.id}>
                <Link
                  href={`/tasks/${task.id}?returnTo=${encodeURIComponent(returnTo)}`}
                  className={task.isMine
                    ? "flex flex-wrap items-center justify-between gap-2 border-l-2 border-primary bg-primary/5 px-3 py-2.5 text-sm hover:bg-primary/10"
                    : "flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-muted/25"}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{task.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[task.clanName, task.isMine ? "Você" : task.assigneeName ?? "Sem responsável"]
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
  section,
  returnTo,
  teamCount,
  hasSearch,
}: {
  notices: NoticeView[];
  canEmphasize: boolean;
  section: MuralSection;
  returnTo: string;
  teamCount: number;
  hasSearch: boolean;
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

  /**
   * Arquivar tira o aviso da tela na hora e some com ele: antes disto não
   * havia confirmação, nem lista de arquivados, nem ação de voltar. O desfazer
   * chama o desarquivar de verdade, então sobrevive a um F5 — e a lista de
   * arquivados continua sendo a rede de segurança para quem perder o aviso.
   */
  function arquivarComDesfazer(noticeId: string) {
    startTransition(async () => {
      const result = await archiveNotice({ noticeId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toastWithUndo({
        message: "Aviso arquivado.",
        undo: () => unarchiveNotice({ noticeId }),
        undoneMessage: "Aviso devolvido ao mural.",
        onUndone: () => router.refresh(),
      });
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
      router.push("/mural?aba=team");
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
        <div className="panel-cut grid gap-2 border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>{hasSearch
            ? "Nenhum informativo nesta aba corresponde à busca. Limpe a busca ou escolha outra aba."
            : section === "mine"
              ? "Nenhum Informativo com missão atribuída a você está pendente."
              : section === "team"
                ? "Nenhum Informativo para acompanhar na equipe."
                : section === "resolved"
                  ? "Você ainda não confirmou sua parte em nenhum Informativo."
                  : "Nenhum aviso arquivado."}</p>
          {!hasSearch && section === "mine" && teamCount > 0 ? (
            <Button asChild variant="outline" className="mx-auto mt-1">
              <Link href="/mural?aba=team">Acompanhar equipe · {teamCount}</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-3">
          {notices.map((notice) => {
            const needsMyAck = notice.requiresAck && !notice.acknowledged;
            const nextTask = notice.missionSummary?.items.find(
              (task) => task.isMine && task.status !== "completed" && task.status !== "cancelled",
            );

            return (
              <li
                key={notice.id}
                id={`aviso-${notice.id}`}
                className={section === "resolved"
                  ? "panel-cut border border-success/30 bg-card/50 p-4"
                  : section === "mine" || needsMyAck
                    ? "panel-cut border border-primary/45 bg-card/70 p-4"
                    : "panel-cut border bg-card/50 p-4"}
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
                      {needsMyAck ? (
                        <Badge variant="outline" className="border-warning/35 bg-warning/10 text-warning">
                          Leitura pendente
                        </Badge>
                      ) : null}
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
                        section === "archived"
                          ? run(
                              () => unarchiveNotice({ noticeId: notice.id }),
                              "Aviso devolvido ao mural.",
                            )
                          : arquivarComDesfazer(notice.id)
                      }
                    >
                      {section === "archived" ? (
                        <>
                          <Undo2 className="size-4" aria-hidden /> Devolver ao mural
                        </>
                      ) : (
                        <>
                          <Archive className="size-4" aria-hidden /> Arquivar
                        </>
                      )}
                    </Button>
                  ) : null}
                </div>

                {notice.work.total > 0 && section !== "archived" ? (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-l-2 border-primary bg-primary/5 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium">
                        {section === "resolved" ? "Sua parte concluída" :
                          notice.work.closed === notice.work.total ? "Suas missões encerradas" : "Sua parte neste Informativo"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {notice.work.closed} de {notice.work.total} {notice.work.total === 1 ? "missão sua encerrada" : "missões suas encerradas"}
                        {section === "mine" && notice.work.closed === notice.work.total ? " · confirme para mover a Resolvidos" : ""}
                      </p>
                    </div>
                    {section === "mine" && notice.work.closed === notice.work.total ? (
                      <Button size="sm" disabled={pending} onClick={() => run(() => confirmNoticeWork({ noticeId: notice.id }), "Sua parte foi movida para Resolvidos.")}>
                        <Check className="size-4" aria-hidden /> Confirmar minha parte
                      </Button>
                    ) : section === "mine" && nextTask ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/tasks/${nextTask.id}?returnTo=${encodeURIComponent(returnTo)}`}>
                          Abrir minha próxima missão
                        </Link>
                      </Button>
                    ) : section === "resolved" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => reopenNoticeWork({ noticeId: notice.id }), "Informativo devolvido à sua fila.")}>
                        <Undo2 className="size-4" aria-hidden /> Reabrir minha parte
                      </Button>
                    ) : null}
                  </div>
                ) : section === "team" ? (
                  <p className="mt-3 border-l-2 border-border px-3 py-1 text-xs text-muted-foreground">
                    Sem missão atribuída a você. Acompanhe o andamento da equipe abaixo.
                  </p>
                ) : null}

                <details className="mt-3 rounded-md border bg-background/20">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">{notice.missionSummary ? "Ler Informativo completo" : "Ler aviso completo"}</summary>
                  <p className="whitespace-pre-wrap border-t px-3 py-3 text-sm text-muted-foreground">{notice.body}</p>
                </details>

                {notice.missionSummary ? (
                  <InformativeMissionSummary summary={notice.missionSummary} returnTo={returnTo} />
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
