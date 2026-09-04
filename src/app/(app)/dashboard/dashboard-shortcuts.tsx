"use client";

import {
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  Building2,
  CalendarRange,
  CalendarCheck,
  ChevronRight,
  HandCoins,
  Inbox,
  ListTodo,
  LoaderCircle,
  Pencil,
  Plus,
  ReceiptText,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  WalletCards,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_DASHBOARD_SHORTCUTS,
  type DashboardShortcutIcon,
  type DashboardShortcutOption,
} from "@/lib/dashboard-shortcuts";

import { saveDashboardShortcuts } from "./actions";

const SHORTCUT_ICONS: Record<DashboardShortcutIcon, LucideIcon> = {
  tasks: ListTodo,
  "new-task": Plus,
  mural: ScrollText,
  informatives: Inbox,
  clients: Building2,
  missions: ShieldCheck,
  members: Users,
  commitments: HandCoins,
  portfolio: BriefcaseBusiness,
  mei: CalendarCheck,
  installments: ReceiptText,
  fees: WalletCards,
  closings: CalendarRange,
  flow: Workflow,
};

interface ShortcutDraft {
  target: string;
  label: string;
}

export function DashboardShortcuts({
  shortcuts,
  options,
}: {
  shortcuts: readonly DashboardShortcutOption[];
  options: readonly DashboardShortcutOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<ShortcutDraft[]>([]);
  const [selectedTarget, setSelectedTarget] = useState("");
  const groups = useMemo(() => {
    const grouped = new Map<string, DashboardShortcutOption[]>();
    for (const option of options) {
      const current = grouped.get(option.group) ?? [];
      current.push(option);
      grouped.set(option.group, current);
    }
    return [...grouped.entries()];
  }, [options]);
  const usedTargets = new Set(drafts.map((draft) => draft.target));

  function beginEditing() {
    setDrafts(shortcuts.map((shortcut) => ({
      target: shortcut.target,
      label: shortcut.label,
    })));
    setSelectedTarget("");
    setOpen(true);
  }

  function addShortcut() {
    const option = options.find((item) => item.target === selectedTarget);
    if (!option || usedTargets.has(option.target)) return;
    setDrafts((current) => [...current, { target: option.target, label: option.label }]);
    setSelectedTarget("");
  }

  function move(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= drafts.length) return;
    setDrafts((current) => {
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveDashboardShortcuts({ items: drafts });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Atalhos atualizados.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-center gap-3">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="hud-label">Atalhos rápidos</h2>
        <div className="divider-rune flex-1" />
        <Button type="button" variant="ghost" size="sm" onClick={beginEditing}>
          <Pencil aria-hidden /> {shortcuts.length > 0 ? "Editar" : "Configurar"}
        </Button>
      </div>

      {shortcuts.length === 0 ? (
        <button
          type="button"
          onClick={beginEditing}
          className="panel-cut grid min-h-28 place-items-center gap-1 border border-dashed p-5 text-center transition-colors hover:border-primary/50 hover:bg-primary/5"
        >
          <span className="grid size-9 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <Plus className="size-4" aria-hidden />
          </span>
          <span className="font-medium">Monte seus atalhos</span>
          <span className="text-sm text-muted-foreground">
            Fixe aqui as áreas que você mais usa no dia a dia.
          </span>
        </button>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {shortcuts.map((shortcut) => {
            const Icon = SHORTCUT_ICONS[shortcut.icon];
            return (
              <Link
                key={shortcut.target}
                href={shortcut.href}
                className="panel-cut group flex min-h-24 items-center gap-3 border-l-2 border-l-primary/50 bg-card/45 p-4 transition-all hover:-translate-y-0.5 hover:border-l-primary hover:bg-accent/35"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/8 text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">{shortcut.label}</strong>
                  <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                    {shortcut.description}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden />
              </Link>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Editar atalhos rápidos</DialogTitle>
            <DialogDescription>
              Escolha até {MAX_DASHBOARD_SHORTCUTS} destinos, personalize os nomes e organize a ordem.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Select value={selectedTarget || undefined} onValueChange={setSelectedTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha uma área para adicionar" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map(([group, groupOptions]) => (
                    <Fragment key={group}>
                      <SelectGroup>
                        <SelectLabel>{group}</SelectLabel>
                        {groupOptions.map((option) => (
                          <SelectItem
                            key={option.target}
                            value={option.target}
                            disabled={usedTargets.has(option.target)}
                          >
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </Fragment>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                disabled={!selectedTarget || drafts.length >= MAX_DASHBOARD_SHORTCUTS}
                onClick={addShortcut}
              >
                <Plus aria-hidden /> Adicionar
              </Button>
            </div>

            {drafts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nenhum atalho selecionado. Você pode deixar esta área vazia.
              </div>
            ) : (
              <div className="grid max-h-[45vh] gap-2 overflow-y-auto pr-1">
                {drafts.map((draft, index) => {
                  const option = options.find((item) => item.target === draft.target);
                  return (
                    <div key={draft.target} className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                      <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                      <div className="grid gap-1">
                        <Input
                          value={draft.label}
                          maxLength={80}
                          aria-label={`Nome do atalho ${index + 1}`}
                          onChange={(event) => setDrafts((current) => current.map((item, currentIndex) =>
                            currentIndex === index ? { ...item, label: event.target.value } : item,
                          ))}
                        />
                        <span className="truncate text-xs text-muted-foreground">
                          {option?.description ?? "Destino indisponível"}
                        </span>
                      </div>
                      <div className="flex justify-end gap-1">
                        <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} aria-label="Mover atalho para cima" onClick={() => move(index, -1)}><ArrowUp aria-hidden /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" disabled={index === drafts.length - 1} aria-label="Mover atalho para baixo" onClick={() => move(index, 1)}><ArrowDown aria-hidden /></Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover atalho" onClick={() => setDrafts((current) => current.filter((_, currentIndex) => currentIndex !== index))}><Trash2 aria-hidden /></Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="button" disabled={pending || drafts.some((draft) => !draft.label.trim())} onClick={save}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              Salvar atalhos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
