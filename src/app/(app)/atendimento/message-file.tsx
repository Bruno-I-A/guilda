import { Download, ExternalLink, FileText } from "lucide-react";

/**
 * Documento recebido no Atendimento (2026-11-23): PDF abre numa aba nova, o
 * resto baixa. O nome quebra em qualquer ponto em vez de truncar: nome longo
 * sem espaço dentro de grade sem trilha explícita empurraria a bolha.
 */
export function MessageFile({ file }: { file: { href: string; name: string; caption: string | null; isPdf: boolean } }) {
  return (
    <>
      <a
        href={file.href}
        target={file.isPdf ? "_blank" : undefined}
        rel={file.isPdf ? "noopener" : undefined}
        download={file.isPdf ? undefined : file.name}
        className="touch-target flex min-w-0 items-center gap-2.5 rounded-md border border-border bg-background/60 px-3 py-2 text-sm transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{file.name}</span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {file.isPdf ? <ExternalLink className="size-3.5" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
          {file.isPdf ? "Abrir" : "Baixar"}
        </span>
      </a>
      {file.caption ? <p className="whitespace-pre-wrap break-words">{file.caption}</p> : null}
    </>
  );
}
