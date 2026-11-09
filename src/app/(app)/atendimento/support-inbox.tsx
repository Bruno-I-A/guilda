"use client";

import { AlertTriangle, ArrowLeft, Bot, Building2, CheckCheck, Clock, ExternalLink, Hand, LoaderCircle, RotateCcw, Search, Send, StickyNote, Check as CheckIcon, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj } from "@/domain/cnpj";
import { DELIVERY_LABELS, elapsedLabel, SUPPORT_FILTERS, SUPPORT_STATUS_LABELS, type DeliveryState, type SupportFilter, type SupportStatus } from "@/domain/support-inbox";
import type { ActionResult } from "@/lib/action-context";
import { APP_TIME_ZONE } from "@/lib/date-time";
import type { SupportConversationView, SupportQueueRow, SupportTimelineItem } from "@/lib/support/inbox";
import { cn } from "@/lib/utils";

import { addNote, linkContact, markWaiting, reopenConversation, resolveConversation, sendReply, takeConversation, transferConversation } from "./actions";

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

function inboxHref(filter: SupportFilter, conversationId?: string): string {
  const params = new URLSearchParams();
  if (filter !== "open") params.set("f", filter);
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

function QueueItem({ row, active, filter, now }: { row: SupportQueueRow; active: boolean; filter: SupportFilter; now: Date }) {
  return (
    <li>
      <Link
        href={inboxHref(filter, row.id)}
        scroll={false}
        aria-current={active ? "true" : undefined}
        className={cn("grid min-w-0 gap-1 border-l-2 px-3 py-2.5 transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", active ? "border-l-primary bg-primary/10" : "border-l-transparent")}
      >
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium">{row.contactName}</span>
          {row.lastMessageAt ? (
            <span className={cn("flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums", row.waitingReply ? "text-foreground" : "text-muted-foreground")}>
              {row.waitingReply ? <Clock className="size-3" aria-label="Sem resposta há" /> : null}
              {elapsedLabel(new Date(row.lastMessageAt), now)}
            </span>
          ) : null}
        </span>
        {row.clientName ? <span className="truncate text-xs text-muted-foreground">{row.clientName}</span> : null}
        {row.lastMessage ? <span className="truncate text-xs text-muted-foreground">{row.lastMessage}</span> : null}
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

function TimelineItem({ item }: { item: SupportTimelineItem }) {
  if (item.kind === "event") {
    return <li className="py-1 text-center text-xs text-muted-foreground">{item.text} · {shortTime(item.at)}</li>;
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
      <div className={cn("grid max-w-[85%] gap-1 rounded-md border px-3 py-2 text-sm sm:max-w-[70%]", outbound ? "border-primary/30 bg-primary/10" : "bg-card")}>
        <span className="text-xs text-muted-foreground">{item.author} · {shortTime(item.at)}</span>
        <p className={cn("whitespace-pre-wrap break-words", !item.isText && "italic text-muted-foreground")}>{item.text}</p>
        {item.delivery ? (
          <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            {DELIVERY_ICONS[item.delivery]} {item.failure ?? DELIVERY_LABELS[item.delivery]}
          </span>
        ) : null}
      </div>
    </li>
  );
}

function Composer({ conversation }: { conversation: SupportConversationView }) {
  const { pending, run } = useCommand();
  const [mode, setMode] = useState<"reply" | "note">(conversation.replyBlocked ? "note" : "reply");
  const [text, setText] = useState("");
  // Chave do envio: clicar duas vezes não manda a mensagem em dobro.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const canReply = !conversation.replyBlocked;
  const effective = canReply ? mode : "note";

  function submit() {
    const body = text.trim();
    if (!body) return;
    const done = () => {
      setText("");
      setRequestId(crypto.randomUUID());
    };
    if (effective === "reply") run(() => sendReply({ conversationId: conversation.id, requestId, text: body }), done);
    else run(() => addNote({ conversationId: conversation.id, text: body }), done);
  }

  return (
    <div className="grid gap-2 border-t p-3">
      {conversation.replyBlocked ? <p className="text-xs text-muted-foreground">{conversation.replyBlocked} Você ainda pode deixar uma nota para a equipe.</p> : null}
      <div className="flex gap-1" role="group" aria-label="Tipo de texto">
        <Button type="button" size="sm" variant={effective === "reply" ? "secondary" : "ghost"} disabled={!canReply} aria-pressed={effective === "reply"} onClick={() => setMode("reply")}>Responder</Button>
        <Button type="button" size="sm" variant={effective === "note" ? "secondary" : "ghost"} aria-pressed={effective === "note"} onClick={() => setMode("note")}><StickyNote aria-hidden /> Nota interna</Button>
      </div>
      <Textarea
        rows={2}
        maxLength={effective === "reply" ? 4096 : 4000}
        aria-label={effective === "reply" ? "Mensagem para o cliente" : "Nota interna para a equipe"}
        placeholder={effective === "reply" ? "Escreva para o cliente" : "Só a equipe vê esta nota"}
        className={cn(effective === "note" && "border-warning/40")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl + Enter envia</span>
        <Button type="button" size="sm" className="ml-auto" disabled={pending || !text.trim()} onClick={submit}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : effective === "reply" ? <Send aria-hidden /> : <StickyNote aria-hidden />}
          {effective === "reply" ? "Enviar ao cliente" : "Salvar nota"}
        </Button>
      </div>
    </div>
  );
}

function ConversationPanel({ conversation, filter, onContext }: { conversation: SupportConversationView; filter: SupportFilter; onContext: () => void }) {
  const { pending, run } = useCommand();
  const end = useRef<HTMLLIElement>(null);
  const size = conversation.timeline.length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [size, conversation.id]);
  const id = { conversationId: conversation.id };
  const resolved = conversation.status === "resolved";

  return (
    <section className="panel-cut flex min-h-0 min-w-0 flex-col" aria-label={`Conversa com ${conversation.contactName}`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
        <Button asChild size="icon-sm" variant="ghost" className="touch-target lg:hidden">
          <Link href={inboxHref(filter)} aria-label="Voltar para a fila"><ArrowLeft aria-hidden /></Link>
        </Button>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{conversation.contactName}</span>
            <StatusChip status={conversation.status} />
          </span>
          <span className="truncate text-xs text-muted-foreground">{conversation.client?.name ?? "Empresa não vinculada"}{conversation.assigneeName ? ` · ${conversation.assignedToMe ? "com você" : `com ${conversation.assigneeName}`}` : ""}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" className="xl:hidden" onClick={onContext}><Building2 aria-hidden /> Empresa</Button>
          {conversation.phone ? (
            // Fora das 24 horas, só o aparelho do escritório responde (coexistência). Abre o
            // WhatsApp logado neste navegador: precisa ser o do escritório, não o pessoal.
            <Button asChild size="sm" variant="ghost">
              <a href={`https://web.whatsapp.com/send?phone=${conversation.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" title="Abre a conversa no WhatsApp Web logado neste navegador. Confira se é o do escritório.">
                <ExternalLink aria-hidden /> WhatsApp Web
              </a>
            </Button>
          ) : null}
          {resolved ? (
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => reopenConversation(id))}><RotateCcw aria-hidden /> Reabrir</Button>
          ) : (
            <>
              {!conversation.assignedToMe ? <Button type="button" size="sm" disabled={pending} onClick={() => run(() => takeConversation(id))}><Hand aria-hidden /> Assumir</Button> : null}
              {conversation.assignedToMe && conversation.status === "human_active" ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => markWaiting(id))}><Clock aria-hidden /> Aguardar cliente</Button> : null}
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveConversation(id))}><CheckIcon aria-hidden /> Resolver</Button>
            </>
          )}
        </div>
      </header>
      <ol className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-3" aria-label="Histórico da conversa">
        {conversation.timeline.map((item) => <TimelineItem key={`${item.kind}-${item.id}`} item={item} />)}
        <li ref={end} aria-hidden />
      </ol>
      <Composer key={`${conversation.id}-${conversation.replyBlocked ?? "ok"}`} conversation={conversation} />
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
  const alreadyThere = suggestion.clan && conversation.assignedClanId === suggestion.clan.id;
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
      {suggestion.clan && !alreadyThere && conversation.status !== "resolved" ? (
        <Button type="button" size="sm" variant="outline" className="justify-self-start" disabled={pending} onClick={() => run(() => transferConversation({ conversationId: conversation.id, clanId: suggestion.clan!.id, userId: null }))}>
          Passar para {suggestion.clan.name}
        </Button>
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
        <Link href={`/clients/${client.id}`} className="font-medium underline-offset-4 hover:underline">{client.name}</Link>
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
                <span className="truncate">{client.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{client.cnpj ? formatCnpj(client.cnpj) : "sem CNPJ"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : query.trim().length >= 2 ? <p className="text-xs text-muted-foreground">Nenhuma empresa ativa com esse nome ou CNPJ.</p> : null}
    </div>
  );
}

function TransferForm({ conversation, clans, members }: { conversation: SupportConversationView; clans: readonly Option[]; members: readonly Option[] }) {
  const { pending, run } = useCommand();
  const selectClass = "h-9 w-full min-w-0 rounded-md border bg-transparent px-2 text-sm";
  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-xs text-muted-foreground">
        Passar para o clã
        <select
          className={selectClass}
          disabled={pending}
          value={conversation.assignedClanId ?? ""}
          onChange={(event) => { if (event.target.value) run(() => transferConversation({ conversationId: conversation.id, clanId: event.target.value, userId: null })); }}
        >
          <option value="" disabled>Sem setor</option>
          {clans.map((clan) => <option key={clan.id} value={clan.id}>{clan.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Passar para a pessoa
        <select
          className={selectClass}
          disabled={pending}
          value={conversation.assignedUserId ?? ""}
          onChange={(event) => { if (event.target.value) run(() => transferConversation({ conversationId: conversation.id, clanId: null, userId: event.target.value })); }}
        >
          <option value="" disabled>Ninguém</option>
          {members.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>
      </label>
    </div>
  );
}

function ContextPanel({ conversation, clients, clans, members, onClose }: { conversation: SupportConversationView; clients: readonly ClientOption[]; clans: readonly Option[]; members: readonly Option[]; onClose: () => void }) {
  const summary = conversation.lastCustomerText?.slice(0, 1000) ?? "";
  const params = new URLSearchParams({ title: `Atendimento: ${conversation.client?.name ?? conversation.contactName}`.slice(0, 200), description: summary ? `Pedido do cliente no WhatsApp:\n${summary}` : "" });
  if (conversation.client) params.set("clientId", conversation.client.id);

  return (
    <aside className="panel-cut grid min-h-0 min-w-0 content-start gap-4 overflow-y-auto p-3" aria-label="Contexto da conversa">
      <div className="flex items-center justify-between gap-2 xl:hidden">
        <span className="text-sm font-semibold">Empresa e setor</span>
        <Button type="button" size="icon-sm" variant="ghost" className="touch-target" aria-label="Voltar para a conversa" onClick={onClose}><X aria-hidden /></Button>
      </div>
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
        <p className="hud-label">Setor e responsável</p>
        <TransferForm conversation={conversation} clans={clans} members={members} />
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
        {isAdmin ? <Button asChild size="sm" variant="outline"><Link href="/settings">Abrir Configurações</Link></Button> : null}
      </div>
    );
  }

  const selected = conversation !== null;
  return (
    <div className="grid min-w-0 gap-3 lg:h-[calc(100dvh-13rem)] lg:min-h-[32rem] lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[19rem_minmax(0,1fr)_17rem]">
      <section className={cn("panel-cut min-h-0 min-w-0 flex-col lg:flex", selected ? "hidden" : "flex")} aria-label="Fila de conversas">
        <nav className="flex flex-wrap gap-1 border-b p-2" aria-label="Filtrar conversas">
          {SUPPORT_FILTERS.map((item) => (
            <Link
              key={item.key}
              href={inboxHref(item.key)}
              aria-current={filter === item.key ? "page" : undefined}
              className={cn("rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent/30", filter === item.key ? "border-primary bg-primary/10" : "border-transparent text-muted-foreground")}
            >
              {item.label} <span className="font-mono tabular-nums">{counts[item.key]}</span>
            </Link>
          ))}
        </nav>
        {queue.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{filter === "open" ? "Nenhuma conversa aberta para você. As de outros setores aparecem para quem atende neles." : "Nenhuma conversa nesta situação."}</p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
            {queue.map((row) => <QueueItem key={row.id} row={row} active={conversation?.id === row.id} filter={filter} now={clock} />)}
          </ul>
        )}
      </section>

      {conversation ? (
        <>
          <div className={cn("min-h-0 min-w-0", contextOpen ? "hidden xl:contents" : "contents")}>
            <div className="grid h-[calc(100dvh-11rem)] min-h-0 min-w-0 lg:h-auto">
              <ConversationPanel key={conversation.id} conversation={conversation} filter={filter} onContext={() => setContextOpen(true)} />
            </div>
          </div>
          <div className={cn("min-h-0 min-w-0", contextOpen ? "grid" : "hidden xl:grid", "lg:col-start-2 xl:col-start-3")}>
            <ContextPanel conversation={conversation} clients={clients} clans={clans} members={members} onClose={() => setContextOpen(false)} />
          </div>
        </>
      ) : (
        <div className="hidden min-w-0 place-items-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground lg:col-span-1 lg:grid xl:col-span-2">
          {notFound ? "Esta conversa não existe ou é de outro setor." : "Escolha uma conversa na fila."}
        </div>
      )}
    </div>
  );
}
