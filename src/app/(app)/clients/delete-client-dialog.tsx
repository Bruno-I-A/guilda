"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  deleteClientPermanently,
  getClientDeletionSummary,
  type ClientDeletionSummary,
} from "./actions";

/**
 * Botão + dialog de exclusão permanente. O resumo (quantas missões,
 * fechamentos, compromissos, quem tem a carteira) é buscado ANTES de abrir o
 * dialog — mesmo padrão do GitHub para apagar repositório: mostra o estrago,
 * só então pede o nome exato para habilitar o botão destrutivo.
 */
export function DeleteClientButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<ClientDeletionSummary | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [loadingSummary, startLoadingSummary] = useTransition();
  const [deleting, startDeleting] = useTransition();

  function openDialog() {
    startLoadingSummary(async () => {
      const result = await getClientDeletionSummary({ clientId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSummary(result.data ?? null);
      setConfirmText("");
      setOpen(true);
    });
  }

  function handleDelete() {
    startDeleting(async () => {
      const result = await deleteClientPermanently({
        clientId,
        confirmName: confirmText,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Empresa excluída permanentemente.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Excluir ${clientName} permanentemente`}
        disabled={loadingSummary}
        onClick={openDialog}
      >
        {loadingSummary ? (
          <LoaderCircle className="animate-spin" aria-hidden />
        ) : (
          <Trash2 aria-hidden />
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Excluir &quot;{clientName}&quot; permanentemente</DialogTitle>
            <DialogDescription>
              Esta ação não pode ser desfeita. Apaga a empresa e tudo relacionado a
              ela.
            </DialogDescription>
          </DialogHeader>
          {summary ? (
            <div className="grid gap-3 text-sm">
              <ul className="grid gap-1 text-muted-foreground">
                <li>{summary.taskCount} missão(ões)</li>
                <li>{summary.closingCount} fechamento(s)</li>
                <li>{summary.commitmentCount} compromisso(s)</li>
                {summary.portfolioHolderName ? (
                  <li>Carteira com {summary.portfolioHolderName}</li>
                ) : null}
              </ul>
              <p className="text-muted-foreground">
                XP já creditado por missões desta empresa é preservado no histórico
                de quem o ganhou — só o nome da missão some.
              </p>
              <div className="grid gap-2">
                <Label htmlFor="confirm-client-name">
                  Digite{" "}
                  <span className="font-medium text-foreground">
                    {summary.clientName}
                  </span>{" "}
                  para confirmar
                </Label>
                <Input
                  id="confirm-client-name"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!summary || confirmText !== summary.clientName || deleting}
              onClick={handleDelete}
            >
              {deleting ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              Excluir permanentemente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
