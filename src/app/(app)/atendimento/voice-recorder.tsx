"use client";

import { LoaderCircle, Mic, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatVoiceDuration, pickRecorderMimeType, VOICE_NOTE_MAX_SECONDS } from "@/domain/support-voice-note";

type Phase = "idle" | "starting" | "recording" | "ready" | "sending";
type Recording = { blob: Blob; requestId: string };

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Nota de voz gravada na conversa (2026-11-23, pedido do Bruno). O navegador
 * grava no formato que souber (WebM, OGG ou MP4); o servidor converte para
 * OGG/Opus, o único que o WhatsApp mostra como nota de voz. "Enviar áudio"
 * durante a gravação para e envia, como no WhatsApp. Em 5 minutos a gravação
 * para e espera o clique: microfone esquecido ligado não vira áudio enviado.
 */
export function VoiceRecorder({ conversationId, onActiveChange }: { conversationId: string; onActiveChange: (active: boolean) => void }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recording = useRef<Recording | null>(null);
  const discard = useRef(false);
  const sendWhenStopped = useRef(false);

  const active = phase !== "idle";
  useEffect(() => onActiveChange(active), [active, onActiveChange]);

  // Trocar de conversa desmonta o gravador: nada gravado vai para a conversa errada.
  useEffect(() => () => {
    discard.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stopTracks(stream.current);
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(Math.min(elapsed, VOICE_NOTE_MAX_SECONDS));
      if (elapsed >= VOICE_NOTE_MAX_SECONDS && recorder.current?.state === "recording") recorder.current.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase]);

  async function send(audio: Recording) {
    setPhase("sending");
    const form = new FormData();
    form.set("audio", audio.blob, "gravacao");
    // A mesma chave em toda nova tentativa: a nota nunca sai em dobro.
    form.set("requestId", audio.requestId);
    try {
      const response = await fetch(`/api/atendimento/conversations/${conversationId}/audio`, { method: "POST", body: form });
      const result = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !result?.ok) {
        toast.error(result?.error ?? "Não foi possível enviar o áudio.");
        setPhase("ready");
        return;
      }
    } catch {
      toast.error("Sem conexão com a Guilda. O áudio continua aqui para enviar de novo.");
      setPhase("ready");
      return;
    }
    recording.current = null;
    setPhase("idle");
    router.refresh();
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Este navegador não grava áudio.");
      return;
    }
    setPhase("starting");
    let input: MediaStream;
    try {
      input = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setPhase("idle");
      toast.error("O navegador não liberou o microfone. Permita o microfone para a Guilda e tente de novo.");
      return;
    }
    const mimeType = pickRecorderMimeType((type) => MediaRecorder.isTypeSupported(type));
    const next = new MediaRecorder(input, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
    const requestId = crypto.randomUUID();
    stream.current = input;
    chunks.current = [];
    discard.current = false;
    sendWhenStopped.current = false;
    next.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    next.onstop = () => {
      stopTracks(input);
      if (discard.current) return;
      const blob = new Blob(chunks.current, { type: next.mimeType || mimeType || "audio/webm" });
      if (blob.size === 0) {
        setPhase("idle");
        toast.error("A gravação veio vazia.");
        return;
      }
      recording.current = { blob, requestId };
      if (sendWhenStopped.current) void send(recording.current);
      else setPhase("ready");
    };
    recorder.current = next;
    next.start(1000);
    setSeconds(0);
    setPhase("recording");
  }

  function sendNow() {
    if (recorder.current?.state === "recording") {
      sendWhenStopped.current = true;
      setPhase("sending");
      recorder.current.stop();
    } else if (recording.current) {
      void send(recording.current);
    }
  }

  function cancel() {
    discard.current = true;
    recording.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stopTracks(stream.current);
    setPhase("idle");
  }

  if (phase === "idle" || phase === "starting") {
    return (
      <Button type="button" size="sm" variant="ghost" disabled={phase === "starting"} onClick={start} aria-label="Gravar nota de voz">
        {phase === "starting" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Mic aria-hidden />}
        <span className="hidden sm:inline">Gravar áudio</span>
      </Button>
    );
  }

  return <VoiceRecordingBar phase={phase} seconds={seconds} onCancel={cancel} onSend={sendNow} />;
}

/** A barra da gravação, só exibição: separada para medir na tela sem microfone. */
export function VoiceRecordingBar({ phase, seconds, onCancel, onSend }: { phase: "recording" | "ready" | "sending"; seconds: number; onCancel: () => void; onSend: () => void }) {
  const live = phase === "recording";
  const status = live ? "Gravando" : phase === "sending" ? "Enviando" : seconds >= VOICE_NOTE_MAX_SECONDS ? "Limite" : "Não enviado";
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2" role="group" aria-label="Nota de voz">
      <span className="mr-auto flex min-w-0 items-center gap-2 text-sm">
        <span className={live ? "size-2.5 shrink-0 animate-pulse rounded-full bg-destructive" : "size-2.5 shrink-0 rounded-full bg-muted-foreground"} aria-hidden />
        <span className="font-mono tabular-nums">{formatVoiceDuration(seconds)}</span>
        <span className="text-muted-foreground" aria-live="polite">{status}</span>
      </span>
      <Button type="button" size="sm" variant="ghost" disabled={phase === "sending"} onClick={onCancel} aria-label="Descartar áudio">
        <Trash2 aria-hidden />
        <span className="hidden sm:inline">Descartar</span>
      </Button>
      <Button type="button" size="sm" disabled={phase === "sending"} onClick={onSend}>
        {phase === "sending" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        Enviar áudio
      </Button>
    </div>
  );
}
