"use client";

import { Check, LoaderCircle, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONTACT_NAME_MAX } from "@/domain/support-inbox";

import { renameContact } from "./actions";

/**
 * Nome do contato dado pela equipe (2026-11-24, pedido do Bruno): o lápis ao
 * lado do nome edita ali mesmo. Vale para o número em todas as conversas e não
 * muda nada no WhatsApp do cliente; vazio volta ao nome do perfil.
 */
export function ContactNameEditor({
  conversationId,
  name,
  customName,
  whatsAppName,
  defaultEditing = false,
}: {
  conversationId: string;
  name: string;
  customName: string | null;
  whatsAppName: string | null;
  /** Começa aberto (para medir a tela renderizada). */
  defaultEditing?: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(defaultEditing);
  const [value, setValue] = useState(customName ?? "");
  const [pending, start] = useTransition();

  function open() {
    setValue(customName ?? whatsAppName ?? "");
    setEditing(true);
  }

  function save() {
    start(async () => {
      const result = await renameContact({ conversationId, name: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditing(false);
      toast.success(value.trim() ? "Nome do contato salvo." : "O contato voltou ao nome do WhatsApp.");
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate text-base font-semibold">{name}</span>
        <Button type="button" size="icon-sm" variant="ghost" className="shrink-0 text-muted-foreground" aria-label={`Trocar o nome de ${name}`} title="Trocar o nome do contato" onClick={open}>
          <Pencil aria-hidden />
        </Button>
      </span>
    );
  }

  return (
    <form
      className="flex min-w-0 items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <Input
        autoFocus
        aria-label="Nome do contato"
        className="h-8 min-w-0 max-w-64 text-sm"
        value={value}
        maxLength={CONTACT_NAME_MAX}
        placeholder={whatsAppName ?? "Nome do contato"}
        disabled={pending}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setEditing(false);
        }}
      />
      <Button type="submit" size="icon-sm" variant="ghost" aria-label="Salvar o nome" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Check aria-hidden />}
      </Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancelar" disabled={pending} onClick={() => setEditing(false)}>
        <X aria-hidden />
      </Button>
    </form>
  );
}
