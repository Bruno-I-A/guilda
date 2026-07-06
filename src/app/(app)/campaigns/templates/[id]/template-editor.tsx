"use client";

import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { DifficultyPips } from "@/components/difficulty-pips-input";
import { Pips } from "@/components/pips";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TAX_REGIME_LABELS, TAX_REGIMES, type TaxRegime } from "@/lib/clients-ui";

import type { ActionResult } from "@/lib/action-context";

import {
  addTemplateItem,
  deleteTemplate,
  deleteTemplateItem,
  moveTemplateItem,
  updateTemplate,
  updateTemplateItem,
} from "../actions";

interface ItemView {
  id: string;
  title: string;
  difficulty: number;
  xpValue: number;
}

interface TemplateView {
  id: string;
  name: string;
  taxRegime: TaxRegime;
}

export function TemplateHeaderActions({ template }: { template: TemplateView }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [taxRegime, setTaxRegime] = useState<TaxRegime>(template.taxRegime);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" disabled={pending} onClick={() => setEditOpen(true)}>
        <Pencil aria-hidden /> Editar
      </Button>
      <Button
        variant="ghost"
        className="text-destructive hover:text-destructive"
        disabled={pending}
        onClick={() => setDeleteOpen(true)}
      >
        <Trash2 aria-hidden /> Excluir
      </Button>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar template</DialogTitle>
            <DialogDescription>
              Mudanças aqui não afetam campanhas já instanciadas — os itens são
              copiados na criação.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              startTransition(async () => {
                const result = await updateTemplate({
                  templateId: template.id,
                  name: String(form.get("name") ?? ""),
                  taxRegime,
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Template atualizado!");
                setEditOpen(false);
                router.refresh();
              });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="edit-template-name">Nome</Label>
              <Input
                id="edit-template-name"
                name="name"
                defaultValue={template.name}
                maxLength={120}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-template-regime">Regime tributário</Label>
              <Select
                value={taxRegime}
                onValueChange={(v) => setTaxRegime(v as TaxRegime)}
              >
                <SelectTrigger id="edit-template-regime" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAX_REGIMES.map((regime) => (
                    <SelectItem key={regime} value={regime}>
                      {TAX_REGIME_LABELS[regime]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Salvar alterações
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir este template?</DialogTitle>
            <DialogDescription>
              O checklist inteiro é apagado. Campanhas já instanciadas não são
              afetadas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteTemplate({ templateId: template.id });
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Template excluído.");
                  router.push("/campaigns/templates");
                  router.refresh();
                })
              }
            >
              Excluir template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function TemplateItemsEditor({
  templateId,
  items,
}: {
  templateId: string;
  items: ItemView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newDifficulty, setNewDifficulty] = useState(2);
  const [editing, setEditing] = useState<ItemView | null>(null);
  const [editDifficulty, setEditDifficulty] = useState(2);

  function run(action: () => Promise<ActionResult>, successMessage?: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (successMessage) toast.success(successMessage);
      setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhuma etapa ainda — adicione abaixo, na ordem de execução. A etapa
          2 de uma empresa só poderá começar quando a 1 for concluída.
        </p>
      ) : (
        <ol className="grid gap-1.5">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="panel-cut panel-cut-sm flex items-center gap-3 px-4 py-2.5"
            >
              <span className="w-6 shrink-0 text-center font-mono text-sm text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium leading-snug">
                  {item.title}
                </p>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                  <Pips value={item.difficulty} max={5} label="Dificuldade" />
                  <span className="font-mono text-gold">{item.xpValue} XP</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Subir ${item.title}`}
                  disabled={pending || index === 0}
                  onClick={() =>
                    run(() => moveTemplateItem({ itemId: item.id, direction: "up" }))
                  }
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Descer ${item.title}`}
                  disabled={pending || index === items.length - 1}
                  onClick={() =>
                    run(() =>
                      moveTemplateItem({ itemId: item.id, direction: "down" }),
                    )
                  }
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Editar ${item.title}`}
                  disabled={pending}
                  onClick={() => {
                    setEditing(item);
                    setEditDifficulty(item.difficulty);
                  }}
                >
                  <Pencil aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  aria-label={`Excluir ${item.title}`}
                  disabled={pending}
                  onClick={() =>
                    run(() => deleteTemplateItem({ itemId: item.id }), "Etapa excluída.")
                  }
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Nova etapa */}
      <form
        className="panel-cut panel-cut-sm grid gap-3 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          run(
            () =>
              addTemplateItem({
                templateId,
                title: String(data.get("title") ?? ""),
                difficulty: newDifficulty,
              }),
            "Etapa adicionada!",
          );
          form.reset();
        }}
      >
        <p className="hud-label">Nova etapa</p>
        <div className="grid gap-2">
          <Label htmlFor="item-title">Título</Label>
          <Input
            id="item-title"
            name="title"
            placeholder="Ex.: Conciliar extratos bancários"
            maxLength={200}
            required
          />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-2">
            <Label>Dificuldade</Label>
            <DifficultyPips value={newDifficulty} onChange={setNewDifficulty} />
          </div>
          <Button type="submit" disabled={pending}>
            <Plus aria-hidden /> Adicionar etapa
          </Button>
        </div>
      </form>

      {/* Editar etapa */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar etapa</DialogTitle>
            <DialogDescription>
              A dificuldade define o XP das missões materializadas.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                run(
                  () =>
                    updateTemplateItem({
                      itemId: editing.id,
                      title: String(data.get("title") ?? ""),
                      difficulty: editDifficulty,
                    }),
                  "Etapa atualizada!",
                );
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="edit-item-title">Título</Label>
                <Input
                  id="edit-item-title"
                  name="title"
                  defaultValue={editing.title}
                  maxLength={200}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label>Dificuldade</Label>
                <DifficultyPips value={editDifficulty} onChange={setEditDifficulty} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  Salvar etapa
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
