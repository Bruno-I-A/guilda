"use client";

import { Plus } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TAX_REGIME_LABELS, TAX_REGIMES, type TaxRegime } from "@/lib/clients-ui";

import { createTemplate } from "./actions";

export function NewTemplateButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [taxRegime, setTaxRegime] = useState<TaxRegime>("simples");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden /> Novo template
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo template de campanha</DialogTitle>
            <DialogDescription>
              O regime define a quais empresas-cliente o checklist se aplica.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              startTransition(async () => {
                const result = await createTemplate({
                  name: String(form.get("name") ?? ""),
                  taxRegime,
                });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Template criado — agora adicione as etapas!");
                setOpen(false);
                router.push(`/campaigns/templates/${result.data?.templateId}`);
                router.refresh();
              });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="template-name">Nome</Label>
              <Input
                id="template-name"
                name="name"
                placeholder="Ex.: Fechamento — Simples Nacional"
                maxLength={120}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="template-regime">Regime tributário</Label>
              <Select
                value={taxRegime}
                onValueChange={(v) => setTaxRegime(v as TaxRegime)}
              >
                <SelectTrigger id="template-regime" className="w-full">
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
                Criar template
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
