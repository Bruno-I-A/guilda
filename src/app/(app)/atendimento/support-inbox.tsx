"use client";

import { AlertTriangle, ArrowLeft, Bot, Building2, CheckCheck, Clock, ExternalLink, Hand, ImageOff, LoaderCircle, Maximize2, Paperclip, Plus, RotateCcw, Search, Send, StickyNote, Check as CheckIcon, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj } from "@/domain/cnpj";
import { SUPPORT_UPLOAD_ACCEPT, SUPPORT_UPLOAD_MAX_FILES, validateSupportCaption, validateSupportUpload } from "@/domain/support-upload";
import { contactInitials, DELIVERY_LABELS, elapsedLabel, enterSends, SUPPORT_FILTERS, SUPPORT_STATUS_LABELS, type DeliveryState, type SupportFilter, type SupportStatus } from "@/domain/support-inbox";
import type { ActionResult } from "@/lib/action-context";
import { APP_TIME_ZONE } from "@/lib/date-time";
import type { SupportConversationView, SupportQueueRow, SupportTimelineItem } from "@/lib/support/inbox";
import { cn } from "@/lib/utils";

import { addContactCompany, addNote, markWaiting, removeContactCompany, reopenConversation, resolveConversation, sendReply, setConversationCompany, takeConversation, transferConversation } from "./actions";
import { MessageAudio } from "./message-audio";
import { MessageFile } from "./message-file";
import { ComposerAttachmentList } from "./composer-attachments";
import { VoiceRecorder } from "./voice-recorder";
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

/** Rodada do teste do agente aberta pela palavra-chave: a IA está falando com o cliente. */
function AgentTestChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-xs text-foreground">
      <Bot className="size-3" aria-hidden />
      IA atendendo
    </span>
  );
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

function ContactAvatar({ name, id }: { name: string; id: string }) {
  const tone = ["bg-primary/10 text-primary", "bg-accent text-foreground", "bg-muted text-foreground"][id.charCodeAt(0) % 3];
  return (
    <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-full border border-border/70 text-sm font-medium", tone)}>
      {contactInitials(name)}
    </span>
  );
}

function QueueItem({ row, active, filter, now }: { row: SupportQueueRow; active: boolean; filter: SupportFilter; now: Date }) {
  const attention = row.status === "needs_human";
  const secondary = row.clientName ? companyDisplayName(row.clientName) : null;
  return (
    <li>
      <Link
        href={inboxHref(filter, row.id)}
        scroll={false}
        aria-current={active ? "true" : undefined}
        className={cn("grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] gap-3 border-l-2 px-4 py-3 transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", active ? "border-l-primary bg-primary/10" : "border-l-transparent", attention && !active && "bg-destructive/[0.04]")}
      >
        <ContactAvatar name={row.contactName} id={row.id} />
        <span className="grid min-w-0 gap-1">
          <span className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{row.contactName}</span>
            {row.lastMessageAt ? (
              <span className={cn("shrink-0 font-mono text-xs tabular-nums", row.waitingReply ? "text-foreground" : "text-muted-foreground")}>
                {elapsedLabel(new Date(row.lastMessageAt), now)}
              </span>
            ) : null}
          </span>
          {secondary ? <span className="truncate text-xs text-muted-foreground">{secondary}</span> : null}
          <span className={cn("truncate text-sm", row.waitingReply ? "text-foreground" : "text-muted-foreground")}>{row.lastMessage ?? "Conversa iniciada"}</span>
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {attention ? <span className="inline-flex shrink-0 items-center gap-1 font-medium text-destructive"><span className="size-1.5 rounded-full bg-destructive" /> Precisa de pessoa</span> : null}
            {row.status === "waiting_customer" ? <span className="shrink-0">Aguardando cliente</span> : null}
            {row.agentTest ? <span className="inline-flex shrink-0 items-center gap-1"><Bot className="size-3" aria-hidden /> IA atendendo</span> : null}
            {row.aiUrgent ? <span className="shrink-0 text-warning">Urgente pela IA</span> : null}
            <span className="truncate">{row.assignedToMe ? "Com você" : (row.assigneeName ?? row.clanName ?? "Sem setor")}</span>
          </span>
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
        ) : item.file ? (
          <MessageFile file={item.file} />
        ) : item.audio ? (
          <MessageAudio audio={item.audio} outbound={outbound} />
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

function Composer({ conversation }: { conversation: SupportConversationView }) {
  const { pending, run } = useCommand();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"reply" | "note">(conversation.replyBlocked ? "note" : "reply");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Array<{ file: File; requestId: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  // Chave do envio: clicar duas vezes não manda a mensagem em dobro.
  const [textRequestId, setTextRequestId] = useState(() => crypto.randomUUID());
  const canReply = !conversation.replyBlocked;
  const effective = canReply ? mode : "note";
  // Gravando ou com áudio por enviar: o texto espera, para não sair nada pela metade.
  const [voiceActive, setVoiceActive] = useState(false);

  async function submit() {
    if (voiceActive || uploading || pending) return;
    const body = text.trim();
    if (!body && files.length === 0) return;
    if (effective === "reply" && files.length > 0) {
      const caption = validateSupportCaption(body);
      if (caption === null) {
        toast.error("Legenda muito longa (até 1024 caracteres).");
        return;
      }
      setUploading(true);
      setUploadProgress({ current: 1, total: files.length });
      let sent = 0;
      try {
        for (const [index, attachment] of files.entries()) {
          setUploadProgress({ current: index + 1, total: files.length });
          const form = new FormData();
          form.set("file", attachment.file);
          // O WhatsApp envia cada mídia como uma mensagem. A legenda acompanha
          // somente a primeira, como no envio múltiplo do aplicativo.
          form.set("caption", index === 0 ? caption : "");
          form.set("requestId", attachment.requestId);
          const response = await fetch(`/api/atendimento/conversations/${conversation.id}/media`, { method: "POST", body: form, cache: "no-store" });
          // Recusa do proxy (arquivo grande demais, por exemplo) vem em HTML, não em JSON.
          const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (!response.ok || !result?.ok) {
            const reason = result?.error ?? (response.status === 413 ? "O arquivo passou do tamanho aceito." : "Não foi possível enviar o arquivo.");
            toast.error(sent > 0 ? `${sent} de ${files.length} arquivo(s) enviado(s). ${reason}` : reason);
            return;
          }
          sent += 1;
          setFiles((current) => current.filter((item) => item.requestId !== attachment.requestId));
          if (index === 0) setText("");
        }
        toast.success(files.length === 1 ? "Arquivo enviado." : `${files.length} arquivos enviados.`);
      } catch {
        toast.error(sent > 0
          ? `${sent} de ${files.length} arquivo(s) enviado(s). A conexão falhou no próximo; tente novamente.`
          : "Falha de conexão. Tente novamente; o arquivo não será enviado em dobro.");
      } finally {
        setUploading(false);
        setUploadProgress(null);
        // Mesmo se um arquivo do meio falhou, os que já saíram aparecem na conversa.
        if (sent > 0) router.refresh();
      }
      return;
    }
    const done = () => {
      setText("");
      setTextRequestId(crypto.randomUUID());
    };
    if (effective === "reply") run(() => sendReply({ conversationId: conversation.id, requestId: textRequestId, text: body }), done);
    else run(() => addNote({ conversationId: conversation.id, text: body }), done);
  }

  return (
    <div className="grid shrink-0 gap-2 border-t bg-card p-3 sm:px-5 sm:py-3">
      {conversation.replyBlocked ? <p className="text-xs text-muted-foreground">{conversation.replyBlocked} Você ainda pode deixar uma nota para a equipe.</p> : null}
      <div className="flex gap-1" role="group" aria-label="Tipo de texto">
        <Button type="button" size="sm" variant={effective === "reply" ? "secondary" : "ghost"} disabled={!canReply || voiceActive || uploading} aria-pressed={effective === "reply"} onClick={() => setMode("reply")}>Responder</Button>
        <Button type="button" size="sm" variant={effective === "note" ? "secondary" : "ghost"} disabled={voiceActive || uploading} aria-pressed={effective === "note"} onClick={() => { setMode("note"); setFiles([]); if (fileInput.current) fileInput.current.value = ""; }}><StickyNote aria-hidden /> Nota interna</Button>
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={SUPPORT_UPLOAD_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (selected.length === 0) return;
          const available = SUPPORT_UPLOAD_MAX_FILES - files.length;
          if (available <= 0) {
            toast.error(`Envie no máximo ${SUPPORT_UPLOAD_MAX_FILES} arquivos por vez.`);
            return;
          }
          const accepted: Array<{ file: File; requestId: string }> = [];
          for (const selectedFile of selected.slice(0, available)) {
            const checked = validateSupportUpload(selectedFile);
            if (!checked.ok) {
              toast.error(`${selectedFile.name}: ${checked.error}`);
              continue;
            }
            accepted.push({ file: selectedFile, requestId: crypto.randomUUID() });
          }
          if (selected.length > available) toast.error(`Só os primeiros ${available} arquivo(s) couberam. O limite é ${SUPPORT_UPLOAD_MAX_FILES}.`);
          if (accepted.length > 0) setFiles((current) => [...current, ...accepted]);
        }}
      />
      {effective === "reply" && files.length > 0 ? (
        <ComposerAttachmentList
          attachments={files}
          disabled={uploading}
          onRemove={(requestId) => setFiles((current) => current.filter((item) => item.requestId !== requestId))}
        />
      ) : null}
      <Textarea
        rows={2}
        disabled={voiceActive || uploading}
        maxLength={effective === "reply" ? files.length > 0 ? 1024 : 4096 : 4000}
        aria-label={effective === "reply" ? "Mensagem para o cliente" : "Nota interna para a equipe"}
        placeholder={effective === "reply" ? files.length > 0 ? "Legenda opcional para o primeiro arquivo" : "Escreva para o cliente" : "Só a equipe vê esta nota"}
        className={cn(effective === "note" && "border-warning/40")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          const sends = enterSends({
            key: event.key,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            isComposing: event.nativeEvent.isComposing,
            coarsePointer: window.matchMedia("(pointer: coarse)").matches,
          });
          if (sends) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex min-w-0 items-center justify-between gap-2">
        {voiceActive ? null : <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block" title="Enter envia · Shift + Enter quebra a linha">Enter envia · Shift + Enter quebra a linha</span>}
        <div className={cn("flex min-w-0 items-center gap-2", voiceActive ? "flex-1" : "ml-auto")}>
          {effective === "reply" ? <VoiceRecorder conversationId={conversation.id} onActiveChange={setVoiceActive} disabled={files.length > 0 || uploading || pending} /> : null}
          {voiceActive ? null : (
            <>
              {effective === "reply" ? <Button type="button" size="sm" variant="outline" disabled={pending || uploading || files.length >= SUPPORT_UPLOAD_MAX_FILES} onClick={() => fileInput.current?.click()}><Paperclip aria-hidden /> {files.length > 0 ? "Anexar mais" : "Anexar"}</Button> : null}
              <Button type="button" size="sm" disabled={pending || uploading || (!text.trim() && files.length === 0)} onClick={() => void submit()}>
                {pending || uploading ? <LoaderCircle className="animate-spin" aria-hidden /> : effective === "reply" ? <Send aria-hidden /> : <StickyNote aria-hidden />}
                {uploadProgress ? `Enviando ${uploadProgress.current} de ${uploadProgress.total}…` : effective === "reply" ? "Enviar ao cliente" : "Salvar nota"}
              </Button>
            </>
          )}
        </div>
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
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background" aria-label={`Conversa com ${conversation.contactName}`}>
      <header className="grid shrink-0 border-b bg-card">
        <div className="flex min-h-16 min-w-0 items-center gap-3 px-4 py-2.5">
          <Button asChild size="icon-sm" variant="ghost" className="touch-target lg:hidden">
            <Link href={inboxHref(filter)} aria-label="Voltar para a fila"><ArrowLeft aria-hidden /></Link>
          </Button>
          <ContactAvatar name={conversation.contactName} id={conversation.id} />
          <div className="grid min-w-0 flex-1 gap-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-base font-semibold">{conversation.contactName}</span>
              <StatusChip status={conversation.status} />
              {conversation.agentTest ? <AgentTestChip /> : null}
            </span>
            <span className="truncate text-xs text-muted-foreground">{conversation.phone ?? "Número não informado"} · {conversation.client?.name ?? "Empresa não vinculada"}{conversation.assigneeName ? ` · ${conversation.assignedToMe ? "com você" : `com ${conversation.assigneeName}`}` : ""}</span>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onContext}><Building2 aria-hidden /> Contexto</Button>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-1 overflow-x-auto border-t px-3 py-2">
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
      <ol className="mx-auto grid min-h-0 w-full max-w-5xl flex-1 content-start gap-3 overflow-y-auto bg-muted/35 p-4 sm:p-6 lg:px-8" aria-label="Histórico da conversa">
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
      {suggestion.directAnswer && suggestion.sources.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Fontes: {suggestion.sources.map((source) => `${source.title} · v${source.version}`).join(" · ")}
        </p>
      ) : null}
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

/**
 * Empresas do número que escreveu (2026-11-23): uma empresa tem vários números e
 * um número várias empresas. Vale para as próximas conversas dele.
 */
export function ContactCompanies({ conversation, clients }: { conversation: SupportConversationView; clients: readonly ClientOption[] }) {
  const { pending, run } = useCommand();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const linked = conversation.contactClients;
  const matches = useMemo(() => {
    const needle = normalize(query.trim());
    const digits = query.replace(/\D/g, "");
    if (needle.length < 2) return [];
    const taken = new Set(linked.map((client) => client.id));
    return clients
      .filter((client) => !taken.has(client.id) && (normalize(client.name).includes(needle) || (digits.length >= 3 && client.cnpj?.includes(digits))))
      .slice(0, 6);
  }, [clients, linked, query]);
  const searching = adding || linked.length === 0;

  return (
    <div className="grid gap-2">
      {linked.length === 0 ? (
        <p className="text-xs text-muted-foreground">De quais empresas é este número? Vale para as próximas conversas dele.</p>
      ) : (
        <ul className="grid gap-1.5">
          {linked.map((client) => (
            <li key={client.id} className="flex min-w-0 items-start justify-between gap-2 rounded-md border px-2.5 py-2">
              <span className="grid min-w-0 gap-0.5">
                <Link href={`/clients/${client.id}`} className="text-sm font-medium [overflow-wrap:anywhere] underline-offset-4 hover:underline">{companyDisplayName(client.name)}</Link>
                <span className="font-mono text-xs text-muted-foreground">{client.cnpj ? formatCnpj(client.cnpj) : "sem CNPJ"}</span>
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="touch-target shrink-0"
                disabled={pending}
                aria-label={`Tirar ${companyDisplayName(client.name)} deste número`}
                onClick={() => run(() => removeContactCompany({ conversationId: conversation.id, clientId: client.id }))}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {searching ? (
        <div className="grid gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" className="pl-8" autoComplete="off" data-1p-ignore data-lpignore="true" aria-label="Buscar empresa para este número" placeholder="Nome ou CNPJ" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          {matches.length > 0 ? (
            <ul className="grid divide-y rounded-md border">
              {matches.map((client) => (
                <li key={client.id}>
                  <button
                    type="button"
                    disabled={pending}
                    className="grid min-h-11 w-full min-w-0 gap-0.5 px-2 py-1.5 text-left text-sm hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => run(() => addContactCompany({ conversationId: conversation.id, clientId: client.id }), () => { setQuery(""); setAdding(false); })}
                  >
                    <span className="[overflow-wrap:anywhere]">{companyDisplayName(client.name)}</span>
                    <span className="font-mono text-xs text-muted-foreground">{client.cnpj ? formatCnpj(client.cnpj) : "sem CNPJ"}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : query.trim().length >= 2 ? <p className="text-xs text-muted-foreground">Nenhuma empresa ativa com esse nome ou CNPJ.</p> : null}
        </div>
      ) : (
        <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => setAdding(true)}>
          <Plus aria-hidden /> Adicionar empresa
        </Button>
      )}
    </div>
  );
}

/** A empresa desta conversa: com uma empresa no número já vem marcada; com várias, escolhe-se. */
export function ConversationCompany({ conversation }: { conversation: SupportConversationView }) {
  const { pending, run } = useCommand();
  const { client, contactClients } = conversation;
  return (
    <div className="grid gap-1.5 text-sm">
      {contactClients.length > 1 ? (
        <select
          className="h-9 w-full min-w-0 rounded-md border bg-transparent px-2 text-sm"
          aria-label="Empresa desta conversa"
          disabled={pending}
          value={client?.id ?? ""}
          onChange={(event) => run(() => setConversationCompany({ conversationId: conversation.id, clientId: event.target.value || null }))}
        >
          <option value="">Ainda não escolhida</option>
          {contactClients.map((option) => <option key={option.id} value={option.id}>{companyDisplayName(option.name)}</option>)}
        </select>
      ) : null}
      {client ? (
        <span className="text-xs text-muted-foreground">
          {contactClients.length > 1 ? null : <span className="font-medium text-foreground">{companyDisplayName(client.name)} · </span>}
          Regime: {client.taxRegime}
        </span>
      ) : (
        <p className="text-xs text-muted-foreground">
          {contactClients.length > 1 ? "Este número é de mais de uma empresa: escolha a desta conversa." : "Adicione a empresa do número para a Carteira encaminhar certo."}
        </p>
      )}
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
        <p className="hud-label">Empresas deste número</p>
        <ContactCompanies conversation={conversation} clients={clients} />
      </section>
      <section className="grid gap-1.5">
        <p className="hud-label">Empresa desta conversa</p>
        <ConversationCompany conversation={conversation} />
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
 * tela; no celular, um passo de cada vez. Quem vê a conversa responde sem
 * assumir (2026-11-24); assumir continua sendo como se pega a conversa para si.
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

  if (channels === 0 && queue.length === 0 && counts.open === 0) {
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
    <div className="grid h-full min-h-0 min-w-0 overflow-hidden border-y bg-card lg:grid-cols-[22rem_minmax(0,1fr)] lg:border-t-0">
      <section className={cn("min-h-0 min-w-0 flex-col bg-card lg:flex lg:border-r", selected ? "hidden" : "flex")} aria-label="Fila de conversas">
        <nav className="grid shrink-0 grid-cols-3 gap-1 border-b bg-background/45 p-2" aria-label="Filtrar conversas">
          {SUPPORT_FILTERS.map((item) => (
            <Link
              key={item.key}
              href={inboxHref(item.key)}
              aria-current={filter === item.key ? "page" : undefined}
              className={cn("flex min-h-12 min-w-0 flex-col items-start justify-center gap-0.5 rounded-md border px-2 py-1 text-xs leading-tight transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", filter === item.key ? "border-primary/40 bg-primary/10 text-foreground" : "border-transparent text-muted-foreground")}
            >
              <span className="truncate">{item.key === "needs_human" ? <><span className="sm:hidden">Pessoas</span><span className="hidden sm:inline">{item.label}</span></> : item.label}</span><span className="font-mono text-sm font-medium tabular-nums">{counts[item.key]}</span>
            </Link>
          ))}
        </nav>
        {queue.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{filter === "open" ? "Nenhuma conversa aguardando um atendente. As de outros setores aparecem para quem atende neles." : "Nenhuma conversa nesta situação."}</p>
        ) : (
          <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
            {queue.map((row) => <QueueItem key={row.id} row={row} active={conversation?.id === row.id} filter={filter} now={clock} />)}
          </ul>
        )}
      </section>

      {conversation ? (
        <>
          <div className="grid min-h-0 min-w-0">
            <ConversationPanel key={conversation.id} conversation={conversation} filter={filter} onContext={() => setContextOpen(true)} />
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
