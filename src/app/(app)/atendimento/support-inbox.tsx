"use client";

import { AlertTriangle, ArrowDown, ArrowLeft, Bot, Building2, CheckCheck, Clock, ExternalLink, Hand, ImageOff, LoaderCircle, Maximize2, RotateCcw, Search, Send, Settings, StickyNote, Check as CheckIcon, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { SegmentedNav } from "@/components/segmented-nav";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj } from "@/domain/cnpj";
import {
  characterCount,
  DELIVERY_LABELS,
  elapsedLabel,
  handoffPlan,
  isScrolledToEnd,
  NOTE_MAX_LENGTH,
  queueLimitNotice,
  REPLY_MAX_LENGTH,
  SUPPORT_FILTERS,
  SUPPORT_STATUS_LABELS,
  takeIntent,
  timelineUpdate,
  type DeliveryState,
  type SupportFilter,
  type SupportNextActionKind,
  type SupportStatus,
} from "@/domain/support-inbox";
import type { ActionResult } from "@/lib/action-context";
import { APP_TIME_ZONE } from "@/lib/date-time";
import type { SupportConversationView, SupportQueueRow, SupportTimelineItem } from "@/lib/support/inbox";
import { cn } from "@/lib/utils";

import { addNote, linkContact, markWaiting, reopenConversation, resolveConversation, sendReply, takeConversation, transferConversation } from "./actions";
import { companyDisplayName } from "@/domain/company-display-name";

const STATUS_CLASSES: Record<SupportStatus, string> = {
  ai_active: "border-border text-muted-foreground",
  needs_human: "border-destructive bg-destructive/15 text-foreground",
  human_active: "border-primary/50 bg-primary/10 text-foreground",
  waiting_customer: "border-warning/40 bg-warning/10 text-warning",
  resolved: "border-success/40 bg-success/10 text-success",
};

function StatusChip({ status }: { status: SupportStatus }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-xs", STATUS_CLASSES[status])}>{SUPPORT_STATUS_LABELS[status]}</span>;
}

const TIME_FORMAT = new Intl.DateTimeFormat("pt-BR", { timeZone: APP_TIME_ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function shortTime(value: string): string {
  return TIME_FORMAT.format(new Date(value)).replace(",", "");
}

function inboxHref(filter: SupportFilter, conversationId?: string, page = 1): string {
  const params = new URLSearchParams();
  if (filter !== "open") params.set("f", filter);
  if (page > 1) params.set("p", String(page));
  if (conversationId) params.set("c", conversationId);
  const query = params.toString();
  return query ? `/atendimento?${query}` : "/atendimento";
}

/** Toda ação da conversa: mostra o erro do servidor e atualiza a tela. */
function useCommand() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }
  return { pending, run };
}

/** Rótulos curtos dos filtros abaixo de sm: em 320px os cinco cabem melhor. */
const FILTER_SHORT_LABELS: Record<SupportFilter, string> = {
  open: "Agir",
  needs_human: "Pessoa",
  mine: "Minhas",
  waiting: "Aguardando",
  resolved: "Resolvidas",
};

/** O sinal dominante da linha é o texto da próxima ação; a cor só reforça. */
const NEXT_ACTION_CLASSES: Record<SupportNextActionKind, string> = {
  take: "border-destructive bg-destructive/15 text-foreground",
  reply: "border-primary bg-primary/20 text-foreground",
  review_ai: "border-warning/50 bg-warning/10 text-warning",
  waiting: "border-border text-muted-foreground",
  follow: "border-border text-muted-foreground",
  done: "border-success/40 text-success",
};

function QueueItem({ row, active, filter, page, now }: { row: SupportQueueRow; active: boolean; filter: SupportFilter; page: number; now: Date }) {
  return (
    <li>
      <Link
        href={inboxHref(filter, row.id, page)}
        scroll={false}
        aria-current={active ? "true" : undefined}
        className={cn("grid min-w-0 gap-1.5 border-l-2 px-4 py-3.5 transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", active ? "border-l-primary bg-primary/20" : "border-l-transparent")}
      >
        <span className={cn("inline-flex max-w-full items-center justify-self-start truncate rounded-md border px-2 py-0.5 text-sm font-medium", NEXT_ACTION_CLASSES[row.nextAction.kind])}>
          {row.nextAction.label}
        </span>
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="truncate text-base font-semibold">{row.contactName}</span>
          {row.lastMessageAt ? (
            <span className={cn("flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums", row.waitingReply ? "text-foreground" : "text-muted-foreground")}>
              {row.waitingReply ? <Clock className="size-3" aria-label="Sem resposta há" /> : null}
              {elapsedLabel(new Date(row.lastMessageAt), now)}
            </span>
          ) : null}
        </span>
        {row.clientName ? <span className="truncate text-sm text-muted-foreground">{companyDisplayName(row.clientName)}</span> : null}
        {row.lastMessage ? <span className="truncate text-sm text-muted-foreground">{row.lastMessage}</span> : null}
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <StatusChip status={row.status} />
          {row.aiUrgent ? <span className="inline-flex shrink-0 items-center rounded-md border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-xs text-warning">Urgente (IA)</span> : null}
          <span className="truncate text-xs text-muted-foreground">{row.assignedToMe ? "Com você" : (row.assigneeName ?? row.clanName ?? "Sem setor")}</span>
        </span>
      </Link>
    </li>
  );
}

const DELIVERY_ICONS: Record<DeliveryState, React.ReactNode> = {
  sending: <LoaderCircle className="size-3 animate-spin" aria-hidden />,
  sent: <CheckIcon className="size-3" aria-hidden />,
  delivered: <CheckCheck className="size-3" aria-hidden />,
  read: <CheckCheck className="size-3 text-primary" aria-hidden />,
  failed: <AlertTriangle className="size-3 text-destructive" aria-hidden />,
};

function MessageImage({ src, caption }: { src: string; caption: string | null }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="grid min-h-32 place-items-center gap-2 rounded-md border border-dashed bg-muted/20 p-5 text-center text-muted-foreground">
        <ImageOff className="size-6" aria-hidden />
        <span className="text-xs">Esta foto não está mais disponível na Meta.</span>
      </div>
    );
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="group relative block max-w-full overflow-hidden rounded-md border bg-muted/20 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {/* A rota é autenticada; o otimizador do Next não receberia a sessão. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={caption || "Foto recebida pelo WhatsApp"} loading="lazy" className="max-h-80 w-auto max-w-full object-contain" onError={() => setFailed(true)} />
          <span className="absolute right-2 bottom-2 inline-flex size-9 items-center justify-center rounded-md border bg-background/90 text-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 className="size-4" aria-hidden />
            <span className="sr-only">Ampliar foto</span>
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[min(96vw,72rem)] overflow-hidden rounded-none border bg-background p-3 sm:max-w-[min(96vw,72rem)]">
        <DialogTitle className="sr-only">Foto recebida pelo WhatsApp</DialogTitle>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={caption || "Foto recebida pelo WhatsApp"} className="max-h-[calc(100dvh-4rem)] w-full object-contain" />
      </DialogContent>
    </Dialog>
  );
}

function TimelineItem({ item }: { item: SupportTimelineItem }) {
  if (item.kind === "event") {
    return <li className="py-2 text-center text-xs text-muted-foreground"><span className="inline-flex rounded-md border bg-background/70 px-2 py-1">{item.text} · {shortTime(item.at)}</span></li>;
  }
  if (item.kind === "note") {
    return (
      <li className="mx-auto w-full max-w-prose rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <StickyNote className="size-3 text-warning" aria-hidden /> Nota interna · {item.author} · {shortTime(item.at)}
        </span>
        <p className="mt-1 whitespace-pre-wrap break-words">{item.text}</p>
      </li>
    );
  }
  const outbound = item.direction === "outbound";
  return (
    <li className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div className={cn("grid max-w-[88%] gap-2 rounded-md border px-3.5 py-2.5 text-[0.95rem] leading-relaxed shadow-sm sm:max-w-[74%]", outbound ? "border-primary/60 bg-primary/20" : "border-silver/25 bg-accent/70")}>
        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{item.author}</span><span className="font-mono tabular-nums">{shortTime(item.at)}</span></span>
        {item.image ? (
          <>
            <MessageImage src={item.image.src} caption={item.image.caption} />
            {item.image.caption ? <p className="whitespace-pre-wrap break-words">{item.image.caption}</p> : null}
          </>
        ) : (
          <p className={cn("whitespace-pre-wrap break-words", !item.isText && "italic text-muted-foreground")}>{item.text}</p>
        )}
        {item.delivery ? (
          <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            {DELIVERY_ICONS[item.delivery]} {item.failure ?? DELIVERY_LABELS[item.delivery]}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Ação que muda de quem é a conversa: diz o efeito ANTES de mutar. Sem
 * `effects`, é um clique só (não tira a conversa de ninguém).
 */
function ConfirmAction({
  label,
  icon,
  title,
  effects,
  confirmLabel,
  disabled,
  variant = "default",
  className,
  onConfirm,
}: {
  label: string;
  icon?: React.ReactNode;
  title: string;
  effects: readonly string[] | null;
  confirmLabel: string;
  disabled?: boolean;
  variant?: "default" | "outline";
  className?: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!effects) {
    return <Button type="button" size="sm" variant={variant} className={className} disabled={disabled} onClick={onConfirm}>{icon}{label}</Button>;
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={variant} className={className} disabled={disabled}>{icon}{label}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>O que acontece ao confirmar:</DialogDescription>
        </DialogHeader>
        <ul className="grid list-disc gap-1 pl-5 text-sm">
          {effects.map((effect) => <li key={effect}>{effect}</li>)}
        </ul>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancelar</Button></DialogClose>
          <Button type="button" disabled={disabled} onClick={() => { setOpen(false); onConfirm(); }}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Assumir com rótulo do contexto: da IA e de outra pessoa pedem confirmação. */
function TakeButton({ conversation, pending, run, variant = "default" }: { conversation: SupportConversationView; pending: boolean; run: ReturnType<typeof useCommand>["run"]; variant?: "default" | "outline" }) {
  const intent = takeIntent(conversation);
  if (!intent) return null;
  return (
    <ConfirmAction
      label={intent.label}
      icon={<Hand aria-hidden />}
      title={intent.confirm?.title ?? intent.label}
      effects={intent.confirm?.effects ?? null}
      confirmLabel="Assumir"
      variant={variant}
      disabled={pending}
      onConfirm={() => run(() => takeConversation({ conversationId: conversation.id }))}
    />
  );
}

function whatsappWebHref(phone: string): string {
  return `https://web.whatsapp.com/send?phone=${phone.replace(/\D/g, "")}`;
}

/** Bloqueado: o motivo e o caminho de saída, lado a lado. */
function ReplyRecovery({ conversation, pending, run }: { conversation: SupportConversationView; pending: boolean; run: ReturnType<typeof useCommand>["run"] }) {
  const block = conversation.replyBlock;
  if (!block) return null;
  return (
    <div className="grid gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="note" aria-label="Resposta ao cliente bloqueada">
      <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /><span><span className="font-medium">Não dá para responder ao cliente agora.</span> {block.message}</span></p>
      <div className="flex flex-wrap items-center gap-2">
        {block.kind === "resolved" ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => reopenConversation({ conversationId: conversation.id }))}><RotateCcw aria-hidden /> Reabrir</Button> : null}
        {block.kind === "not_assigned" ? <TakeButton conversation={conversation} pending={pending} run={run} variant="outline" /> : null}
        {block.kind === "channel_inactive" ? <Button asChild size="sm" variant="outline"><Link href="/atendimento/configuracoes"><Settings aria-hidden /> Configurações do Atendimento</Link></Button> : null}
        {block.kind === "window_closed" && conversation.phone ? (
          <Button asChild size="sm" variant="outline">
            <a href={whatsappWebHref(conversation.phone)} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden /> Abrir no WhatsApp Web</a>
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">A nota interna continua liberada.</span>
      </div>
    </div>
  );
}

function Composer({ conversation, onSent }: { conversation: SupportConversationView; onSent: () => void }) {
  const { pending, run } = useCommand();
  const [mode, setMode] = useState<"reply" | "note">(conversation.replyBlock ? "note" : "reply");
  // Rascunho só em memória: pode conter dado pessoal, então nada vai para o navegador.
  const [text, setText] = useState("");
  // Chave do envio: clicar duas vezes não manda a mensagem em dobro.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const canReply = !conversation.replyBlock;
  const effective = canReply ? mode : "note";
  const isReply = effective === "reply";
  const counter = characterCount(text, effective);

  function submit() {
    const body = text.trim();
    if (!body) return;
    const done = () => {
      setText("");
      setRequestId(crypto.randomUUID());
      onSent();
    };
    if (isReply) run(() => sendReply({ conversationId: conversation.id, requestId, text: body }), done);
    else run(() => addNote({ conversationId: conversation.id, text: body }), done);
  }

  const hintId = `composer-hint-${conversation.id}`;
  const countId = `composer-count-${conversation.id}`;
  return (
    <div className={cn("grid shrink-0 gap-2 border-t p-3 sm:px-5 sm:py-3", isReply ? "bg-card" : "bg-warning/5")}>
      <ReplyRecovery conversation={conversation} pending={pending} run={run} />
      <div className="grid grid-cols-2 gap-1 sm:flex" role="group" aria-label="Para quem é o texto">
        <Button type="button" size="sm" variant={isReply ? "secondary" : "ghost"} disabled={!canReply} aria-pressed={isReply} onClick={() => setMode("reply")}><Send aria-hidden /> Responder ao cliente</Button>
        <Button type="button" size="sm" variant={!isReply ? "secondary" : "ghost"} aria-pressed={!isReply} onClick={() => setMode("note")}><StickyNote aria-hidden /> Nota interna</Button>
      </div>
      <p id={hintId} className={cn("text-xs", isReply ? "text-muted-foreground" : "text-warning")}>
        {isReply ? "Vai para o cliente pelo WhatsApp do escritório." : "Só a equipe vê. Não vai para o cliente."}
      </p>
      <Textarea
        rows={2}
        maxLength={isReply ? REPLY_MAX_LENGTH : NOTE_MAX_LENGTH}
        aria-label={isReply ? "Mensagem para o cliente" : "Nota interna para a equipe"}
        aria-describedby={`${hintId} ${countId}`}
        placeholder={isReply ? "Escreva para o cliente" : "Escreva a nota para a equipe"}
        className={cn(!isReply && "border-warning/50")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={countId} className={cn("font-mono text-xs tabular-nums", counter.nearLimit ? "text-warning" : "text-muted-foreground")}>
          {counter.text}<span className="sr-only"> caracteres</span>
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl + Enter envia</span>
        <Button type="button" size="sm" className="ml-auto" variant={isReply ? "default" : "outline"} disabled={pending || !text.trim()} onClick={submit}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : isReply ? <Send aria-hidden /> : <StickyNote aria-hidden />}
          {isReply ? "Enviar ao cliente" : "Salvar nota interna"}
        </Button>
      </div>
    </div>
  );
}

function HeaderFact({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <span className="truncate">{value}</span>
    </span>
  );
}

/**
 * Histórico que respeita a leitura: a atualização de 5 s só desce sozinha
 * quando a pessoa já está no fim. Lendo mensagens antigas, aparece
 * "Novas mensagens" para voltar quando ela quiser.
 */
function useTimelineFollow(lastId: string | null) {
  const scroller = useRef<HTMLOListElement>(null);
  // Espelho do "no fim" para o efeito (que roda depois do DOM mudar); o estado é para a tela.
  const atEndRef = useRef(true);
  const previousLastId = useRef<string | null>(null);
  const forceFollow = useRef(true);
  const [atEnd, setAtEnd] = useState(true);
  // Última mensagem que a pessoa viu (estando no fim). Diferente disso e fora do fim: há novidade.
  const [seenLastId, setSeenLastId] = useState(lastId);
  const hasNew = !atEnd && lastId !== seenLastId;

  // Só mexe na rolagem; quem atualiza o estado é o evento de rolagem que isto dispara.
  useLayoutEffect(() => {
    const decision = forceFollow.current ? "follow" : timelineUpdate({ previousLastId: previousLastId.current, nextLastId: lastId, atEnd: atEndRef.current });
    previousLastId.current = lastId;
    forceFollow.current = false;
    const node = scroller.current;
    if (decision === "follow" && node) {
      node.scrollTop = node.scrollHeight;
      atEndRef.current = true;
    }
  }, [lastId]);

  function onScroll() {
    const node = scroller.current;
    if (!node) return;
    const end = isScrolledToEnd(node);
    atEndRef.current = end;
    setAtEnd(end);
    if (end) setSeenLastId(lastId);
  }

  function scrollToEnd() {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
    atEndRef.current = true;
    setAtEnd(true);
    setSeenLastId(lastId);
  }

  // Quem acabou de enviar quer ver a própria mensagem, mesmo lendo o histórico.
  function followNext() {
    forceFollow.current = true;
  }

  return { scroller, hasNew, onScroll, scrollToEnd, followNext };
}

function ConversationPanel({ conversation, filter, page, onContext }: { conversation: SupportConversationView; filter: SupportFilter; page: number; onContext: () => void }) {
  const { pending, run } = useCommand();
  const last = conversation.timeline[conversation.timeline.length - 1];
  const lastId = last ? `${last.kind}-${last.id}` : null;
  const { scroller, hasNew, onScroll, scrollToEnd, followNext } = useTimelineFollow(lastId);
  const id = { conversationId: conversation.id };
  const resolved = conversation.status === "resolved";
  const owner = conversation.assignedToMe ? "você" : (conversation.assigneeName ?? "ninguém");
  const replyState = conversation.replyBlock?.short ?? "Pode responder";

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" aria-label={`Conversa com ${conversation.contactName}`}>
      <header className="grid shrink-0 border-b bg-card">
        <div className="flex min-h-16 min-w-0 items-center gap-3 px-4 py-2.5">
          <Button asChild size="icon-sm" variant="ghost" className="touch-target lg:hidden">
            <Link href={inboxHref(filter, undefined, page)} aria-label="Voltar para a fila"><ArrowLeft aria-hidden /></Link>
          </Button>
          <div className="grid min-w-0 flex-1 gap-1">
            <span className="truncate text-base font-semibold">{conversation.contactName}</span>
            <span className="truncate text-xs text-muted-foreground">{conversation.phone ?? "Número não informado"} · {conversation.client ? companyDisplayName(conversation.client.name) : "Empresa não vinculada"}</span>
          </div>
          <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={onContext}><Building2 aria-hidden /> Contexto</Button>
        </div>
        {/* Status, dono, setor e resposta sempre à vista: nada disso exige abrir o Contexto. */}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 border-t px-4 py-2" aria-label="Situação da conversa">
          <StatusChip status={conversation.status} />
          <HeaderFact label="Responsável" value={owner} />
          <HeaderFact label="Setor" value={conversation.clanName ?? "sem setor"} />
          <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs", conversation.replyBlock ? "border-warning/40 bg-warning/10 text-warning" : "border-success/40 text-success")}>
            {conversation.replyBlock ? <AlertTriangle className="size-3" aria-hidden /> : <CheckIcon className="size-3" aria-hidden />}
            Resposta: {replyState}
          </span>
        </div>
        {/* Quebra de linha, não rolagem: em 320px nenhuma ação fica escondida. */}
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 border-t px-3 py-2">
          {conversation.phone ? (
            // Fora das 24 horas, só o aparelho do escritório responde (coexistência). Abre o
            // WhatsApp logado neste navegador: precisa ser o do escritório, não o pessoal.
            <Button asChild size="sm" variant="ghost">
              <a href={whatsappWebHref(conversation.phone)} target="_blank" rel="noopener noreferrer" title="Abre a conversa no WhatsApp Web logado neste navegador. Confira se é o do escritório.">
                <ExternalLink aria-hidden /> WhatsApp Web
              </a>
            </Button>
          ) : null}
          {resolved ? (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => reopenConversation(id))}><RotateCcw aria-hidden /> Reabrir</Button>
          ) : (
            <>
              <TakeButton conversation={conversation} pending={pending} run={run} />
              {conversation.assignedToMe && conversation.status === "human_active" ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => markWaiting(id))}><Clock aria-hidden /> Aguardar cliente</Button> : null}
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveConversation(id))}><CheckIcon aria-hidden /> Resolver</Button>
            </>
          )}
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ol ref={scroller} onScroll={onScroll} className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 content-start gap-3 overflow-y-auto bg-muted/35 p-4 sm:p-6 lg:px-8" aria-label="Histórico da conversa">
          {conversation.timeline.map((item) => <TimelineItem key={`${item.kind}-${item.id}`} item={item} />)}
        </ol>
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center" aria-live="polite">
          {hasNew ? (
            <Button type="button" size="sm" className="pointer-events-auto shadow-md" onClick={scrollToEnd}>
              <ArrowDown aria-hidden /> Novas mensagens
            </Button>
          ) : null}
        </div>
      </div>
      <Composer key={`${conversation.id}-${conversation.replyBlock?.kind ?? "ok"}`} conversation={conversation} onSent={followNext} />
    </section>
  );
}

const URGENCY_LABELS = { alta: "alta", media: "média", baixa: "baixa" } as const;

/**
 * O que a IA faria, em sombra. Nada disto foi enviado: serve para a equipe
 * comparar com o que fez antes de qualquer resposta automática.
 */
function AiSuggestion({ conversation }: { conversation: SupportConversationView }) {
  const { pending, run } = useCommand();
  const suggestion = conversation.aiSuggestion;
  if (!suggestion) return null;
  const plan = suggestion.clan
    ? handoffPlan({ clanId: suggestion.clan.id, userId: null, current: { clanId: conversation.assignedClanId, userId: conversation.assignedUserId }, clans: [suggestion.clan], people: [] })
    : null;
  return (
    <section className="grid gap-1.5 rounded-md border border-dashed p-2.5 text-sm" aria-label="Leitura da IA">
      <p className="flex items-center gap-1.5 hud-label"><Bot className="size-3.5" aria-hidden /> Leitura da IA · teste</p>
      <p className="text-xs text-muted-foreground">Nada disto foi enviado ao cliente.</p>
      {suggestion.fallbackReason === "confianca_baixa" ? (
        <p>Não entendeu o assunto. Perguntaria ao cliente do que se trata.</p>
      ) : (
        <>
          <p><span className="text-muted-foreground">Setor:</span> {suggestion.sectorLabel}{suggestion.clan ? ` → ${suggestion.clan.name}` : ""}</p>
          <p><span className="text-muted-foreground">Urgência:</span> {URGENCY_LABELS[suggestion.urgency]} · <span className="font-mono tabular-nums">{Math.round(suggestion.confidence * 100)}%</span> de certeza</p>
          {suggestion.summary ? <p>{suggestion.summary}</p> : null}
        </>
      )}
      {suggestion.question ? <p className="rounded-sm bg-muted/40 px-2 py-1"><span className="text-muted-foreground">Perguntaria:</span> {suggestion.question}</p> : null}
      {suggestion.directAnswer ? <p className="rounded-sm bg-muted/40 px-2 py-1"><span className="text-muted-foreground">Responderia:</span> {suggestion.directAnswer}</p> : null}
      {plan?.ok && conversation.status !== "resolved" ? (
        <ConfirmAction
          label={`Passar para ${suggestion.clan!.name}`}
          title={`Passar para ${suggestion.clan!.name}?`}
          effects={[plan.summary]}
          confirmLabel="Confirmar passagem"
          variant="outline"
          className="justify-self-start"
          disabled={pending}
          onConfirm={() => run(() => transferConversation({ conversationId: conversation.id, clanId: plan.clanId, userId: plan.userId }))}
        />
      ) : null}
    </section>
  );
}

type ClientOption = { id: string; name: string; cnpj: string | null };
type Option = { id: string; name: string };

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function ClientLink({ conversation, clients }: { conversation: SupportConversationView; clients: readonly ClientOption[] }) {
  const { pending, run } = useCommand();
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const needle = normalize(query.trim());
    const digits = query.replace(/\D/g, "");
    if (needle.length < 2) return [];
    return clients.filter((client) => normalize(client.name).includes(needle) || (digits.length >= 3 && client.cnpj?.includes(digits))).slice(0, 6);
  }, [clients, query]);

  if (conversation.client) {
    const { client } = conversation;
    return (
      <div className="grid gap-1 text-sm">
        <Link href={`/clients/${client.id}`} className="font-medium underline-offset-4 hover:underline">{companyDisplayName(client.name)}</Link>
        <span className="font-mono text-xs text-muted-foreground">{client.cnpj ? formatCnpj(client.cnpj) : "sem CNPJ"}</span>
        <span className="text-xs text-muted-foreground">Regime: {client.taxRegime}</span>
        <Button type="button" size="sm" variant="ghost" className="justify-self-start" disabled={pending} onClick={() => run(() => linkContact({ conversationId: conversation.id, clientId: null }))}><X aria-hidden /> Desfazer vínculo</Button>
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      <p className="text-xs text-muted-foreground">Quem é esta pessoa? O vínculo é manual, para não misturar empresas.</p>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" className="pl-8" autoComplete="off" data-1p-ignore data-lpignore="true" aria-label="Buscar empresa para vincular" placeholder="Nome ou CNPJ" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {matches.length > 0 ? (
        <ul className="grid divide-y rounded-md border">
          {matches.map((client) => (
            <li key={client.id}>
              <button type="button" disabled={pending} className="grid min-h-11 w-full gap-0.5 px-2 py-1.5 text-left text-sm hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" onClick={() => run(() => linkContact({ conversationId: conversation.id, clientId: client.id }))}>
                <span className="truncate">{companyDisplayName(client.name)}</span>
                <span className="font-mono text-xs text-muted-foreground">{client.cnpj ? formatCnpj(client.cnpj) : "sem CNPJ"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim().length >= 2 ? <p className="text-xs text-muted-foreground">Nenhuma empresa ativa com esse nome ou CNPJ.</p> : null}
    </div>
  );
}

/**
 * Passar adiante em um passo só: escolher não muda nada; o resumo diz o que vai
 * acontecer e só "Confirmar passagem" chama o servidor, que confere tudo de novo.
 */
function HandoffForm({ conversation, clans, members }: { conversation: SupportConversationView; clans: readonly Option[]; members: readonly Option[] }) {
  const { pending, run } = useCommand();
  const [clanId, setClanId] = useState("");
  const [userId, setUserId] = useState("");
  const selectClass = "h-9 w-full min-w-0 rounded-md border bg-transparent px-2 text-sm text-foreground";
  const touched = clanId !== "" || userId !== "";
  const plan = handoffPlan({
    clanId: clanId || null,
    userId: userId || null,
    current: { clanId: conversation.assignedClanId, userId: conversation.assignedUserId },
    clans,
    people: members,
  });

  if (conversation.status === "resolved") return <p className="text-xs text-muted-foreground">Conversa resolvida. Reabra para passar adiante.</p>;

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">Agora: {conversation.clanName ?? "sem setor"} · {conversation.assignedToMe ? "com você" : (conversation.assigneeName ?? "sem responsável")}</p>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Clã
        <select className={selectClass} disabled={pending} value={clanId} onChange={(event) => setClanId(event.target.value)}>
          <option value="">Manter o clã</option>
          {clans.map((clan) => <option key={clan.id} value={clan.id}>{clan.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Pessoa
        <select className={selectClass} disabled={pending} value={userId} onChange={(event) => setUserId(event.target.value)}>
          <option value="">Ninguém (fila do clã)</option>
          {members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
      </label>
      <p className={cn("rounded-md border px-2 py-1.5 text-sm", plan.ok ? "border-primary/40 bg-primary/10" : "border-dashed text-muted-foreground")} aria-live="polite">
        {plan.ok ? plan.summary : touched ? plan.reason : "Escolha para onde a conversa vai. Nada muda até confirmar."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !plan.ok}
          onClick={() => {
            if (!plan.ok) return;
            run(() => transferConversation({ conversationId: conversation.id, clanId: plan.clanId, userId: plan.userId }), () => { setClanId(""); setUserId(""); });
          }}
        >
          Confirmar passagem
        </Button>
        {touched ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setClanId(""); setUserId(""); }}>Limpar</Button> : null}
      </div>
    </div>
  );
}

function ContextPanel({ conversation, clients, clans, members }: { conversation: SupportConversationView; clients: readonly ClientOption[]; clans: readonly Option[]; members: readonly Option[] }) {
  const summary = conversation.lastCustomerText?.slice(0, 1000) ?? "";
  const params = new URLSearchParams({ title: `Atendimento: ${conversation.client?.name ?? conversation.contactName}`.slice(0, 200), description: summary ? `Pedido do cliente no WhatsApp:\n${summary}` : "" });
  if (conversation.client) params.set("clientId", conversation.client.id);

  return (
    <aside className="grid min-h-0 min-w-0 flex-1 content-start gap-5 overflow-y-auto px-5 pb-6" aria-label="Contexto da conversa">
      <AiSuggestion conversation={conversation} />
      <section className="grid gap-1 text-sm">
        <p className="hud-label">Contato</p>
        <span className="font-medium">{conversation.contactName}</span>
        {conversation.phone ? <span className="font-mono text-xs text-muted-foreground">{conversation.phone}</span> : null}
      </section>
      <section className="grid gap-1.5">
        <p className="hud-label">Empresa</p>
        <ClientLink conversation={conversation} clients={clients} />
      </section>
      <section className="grid gap-1.5">
        <p className="hud-label">Passar adiante</p>
        <HandoffForm conversation={conversation} clans={clans} members={members} />
      </section>
      <section className="grid gap-1.5">
        <p className="hud-label">Missões abertas da empresa</p>
        {!conversation.client ? <p className="text-xs text-muted-foreground">Vincule a empresa para ver as missões dela.</p> : conversation.openTasks.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma missão aberta.</p> : (
          <ul className="grid gap-1 text-sm">
            {conversation.openTasks.map((task) => <li key={task.id}><Link href={`/tasks/${task.id}`} className="line-clamp-2 underline-offset-4 hover:underline">{task.title}</Link></li>)}
          </ul>
        )}
        <Button asChild size="sm" variant="outline" className="justify-self-start"><Link href={`/tasks/new?${params.toString()}`}>Criar missão</Link></Button>
      </section>
    </aside>
  );
}

/**
 * Caixa de entrada (decisão de 2026-11-06): fila, conversa e empresa na mesma
 * tela; no celular, um passo de cada vez. Só uma pessoa responde por vez:
 * assumir é o que libera o envio.
 */
export function SupportInbox({
  now,
  filter,
  page,
  hasMore,
  queue,
  counts,
  conversation,
  notFound,
  clients,
  clans,
  members,
  channels,
  isAdmin,
}: {
  now: string;
  filter: SupportFilter;
  page: number;
  hasMore: boolean;
  queue: readonly SupportQueueRow[];
  counts: Record<SupportFilter, number>;
  conversation: SupportConversationView | null;
  notFound: boolean;
  clients: readonly ClientOption[];
  clans: readonly Option[];
  members: readonly Option[];
  channels: number;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [contextOpen, setContextOpen] = useState(false);
  const clock = useMemo(() => new Date(now), [now]);

  // A resposta chega pelo processo em segundo plano: a tela busca enquanto está à vista.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 5_000);
    return () => clearInterval(timer);
  }, [router]);

  if (channels === 0 && queue.length === 0 && counts.resolved === 0) {
    return (
      <div className="grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm">
        <p className="font-medium">Nenhum WhatsApp conectado ainda.</p>
        <p className="max-w-prose text-muted-foreground">
          {isAdmin ? "Conecte o número do escritório em Configurações. As conversas passam a aparecer aqui assim que o cliente escrever." : "Peça a um administrador para conectar o número do escritório. As conversas passam a aparecer aqui."}
        </p>
        {isAdmin ? <Button asChild size="sm" variant="outline"><Link href="/atendimento/configuracoes">Abrir Configurações do Atendimento</Link></Button> : null}
      </div>
    );
  }

  const selected = conversation !== null;
  const limitNotice = queueLimitNotice(queue.length, counts[filter], page);
  return (
    <div className="grid h-full min-h-0 min-w-0 overflow-hidden border-y bg-card lg:grid-cols-[22rem_minmax(0,1fr)] lg:border-t-0">
      <section className={cn("min-h-0 min-w-0 flex-col bg-card lg:flex lg:border-r", selected ? "hidden" : "flex")} aria-label="Fila de conversas">
        <SegmentedNav
          label="Filtrar conversas"
          active={filter}
          className="shrink-0 bg-background/45 px-1"
          items={SUPPORT_FILTERS.map((item) => ({ key: item.key, label: item.label, shortLabel: FILTER_SHORT_LABELS[item.key], href: inboxHref(item.key), count: counts[item.key] }))}
        />
        {limitNotice ? <p className="shrink-0 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning" role="status">{limitNotice}</p> : null}
        {filter === "open" && queue.length > 0 ? <p className="shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">Primeiro quem precisa de pessoa, depois as suas para responder, depois urgência da IA.</p> : null}
        {queue.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{filter === "open" ? "Nenhuma conversa aberta para você. As de outros setores aparecem para quem atende neles." : "Nenhuma conversa nesta situação."}</p>
        ) : (
          <>
            <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
              {queue.map((row) => <QueueItem key={row.id} row={row} active={conversation?.id === row.id} filter={filter} page={page} now={clock} />)}
            </ul>
            {(page > 1 || hasMore) ? (
              <nav className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2" aria-label="Páginas da fila">
                {page > 1 ? <Button asChild size="sm" variant="outline"><Link href={inboxHref(filter, undefined, page - 1)}>Página anterior</Link></Button> : <span />}
                <span className="font-mono text-xs text-muted-foreground">Página {page}</span>
                {hasMore ? <Button asChild size="sm" variant="outline"><Link href={inboxHref(filter, undefined, page + 1)}>Próxima página</Link></Button> : <span />}
              </nav>
            ) : null}
          </>
        )}
      </section>

      {conversation ? (
        <>
          <div className="grid min-h-0 min-w-0">
            <ConversationPanel key={conversation.id} conversation={conversation} filter={filter} page={page} onContext={() => setContextOpen(true)} />
          </div>
          <Sheet open={contextOpen} onOpenChange={setContextOpen}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
              <SheetHeader className="border-b px-5 py-4">
                <SheetTitle>Empresa e setor</SheetTitle>
              </SheetHeader>
              <ContextPanel conversation={conversation} clients={clients} clans={clans} members={members} />
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <div className="hidden min-w-0 place-items-center bg-muted/10 p-8 text-center text-base text-muted-foreground lg:grid">
          {notFound ? "Esta conversa não existe ou é de outro setor." : "Escolha uma conversa na fila."}
        </div>
      )}
    </div>
  );
}
