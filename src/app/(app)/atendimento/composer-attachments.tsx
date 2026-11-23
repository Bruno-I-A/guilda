import { FileText, ImageIcon, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ComposerAttachment = { file: Pick<File, "name" | "size" | "type">; requestId: string };

function sizeLabel(bytes: number): string {
  return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/**
 * Arquivos escolhidos para mandar ao cliente (até 10 por vez, um por mensagem
 * no WhatsApp). Só exibição: separado para medir na tela sem escolher arquivo.
 */
export function ComposerAttachmentList({ attachments, disabled, onRemove }: { attachments: readonly ComposerAttachment[]; disabled: boolean; onRemove: (requestId: string) => void }) {
  return (
    <ul className="grid max-h-40 gap-1 overflow-y-auto rounded-md border bg-muted/40 p-2" aria-label={`${attachments.length} arquivo(s) para enviar`}>
      {attachments.map(({ file, requestId }) => {
        const Icon = file.type.startsWith("image/") ? ImageIcon : FileText;
        return (
          <li key={requestId} className="flex min-w-0 items-center gap-2 rounded-sm px-1 py-1 text-sm">
            <Icon className="size-4 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{sizeLabel(file.size)}</span>
            <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remover ${file.name}`} disabled={disabled} onClick={() => onRemove(requestId)}><X aria-hidden /></Button>
          </li>
        );
      })}
    </ul>
  );
}
