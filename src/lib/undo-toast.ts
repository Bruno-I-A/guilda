import { toast } from "sonner";

import type { ActionResult } from "@/lib/action-context";

/**
 * O aviso de ação concluída com um "Desfazer" ao lado.
 *
 * O desfazer NÃO é otimista: a ação original já foi para o banco quando este
 * aviso aparece. O botão chama a ação inversa de verdade — que passa pelas
 * mesmas permissões e deixa o mesmo rastro (no caso da conclusão, o estorno
 * entra como novo lançamento no ledger). É o que faz o desfazer sobreviver a
 * um F5 no meio do caminho e não mentir sobre o que já aconteceu.
 *
 * A janela do servidor é maior que a do aviso de propósito: se a pessoa
 * perder o toast, o caminho normal de reverter ainda funciona por alguns
 * minutos (ver UNDO_COMPLETION_WINDOW_MS).
 */
export function toastWithUndo({
  message,
  undo,
  onUndone,
  undoneMessage = "Ação desfeita.",
  duration = 10_000,
}: {
  /** O que acabou de acontecer. */
  message: string;
  /** A ação inversa. Recebe o clique em "Desfazer". */
  undo: () => Promise<ActionResult>;
  /** Chamado depois de desfazer com sucesso — normalmente `router.refresh()`. */
  onUndone: () => void;
  undoneMessage?: string;
  duration?: number;
}): void {
  toast.success(message, {
    duration,
    action: {
      label: "Desfazer",
      onClick: () => {
        // O aviso fecha no clique; o resultado vem no aviso seguinte, para a
        // pessoa não ficar sem resposta se a reversão for recusada.
        const carregando = toast.loading("Desfazendo…");
        void undo().then((resultado) => {
          toast.dismiss(carregando);
          if (!resultado.ok) {
            toast.error(resultado.error);
            return;
          }
          toast.success(undoneMessage);
          onUndone();
        });
      },
    },
  });
}
