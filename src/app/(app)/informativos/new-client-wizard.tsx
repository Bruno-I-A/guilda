"use client";

import { AlertTriangle, ArrowLeft, ScanText, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCnpj } from "@/domain/cnpj";
import { TAX_REGIME_LABELS, TAX_REGIMES, type TaxRegime } from "@/lib/clients-ui";

import { analyzeInformative, lookupClientCnpj } from "./actions";

interface CnpjActivity {
  code: string;
  description: string;
}

interface CompanyForm {
  legalName: string;
  normalizedCnpj: string;
  taxRegime: TaxRegime | "";
  cnaeCode: string | null;
  cnaeDescription: string | null;
  secondaryCnaes: CnpjActivity[] | null;
  openedAt: string | null;
  cadastralSituation: string | null;
}

/**
 * Fluxo "Novo cliente" dos Informativos: CNPJ → confirma dados da Receita →
 * descreve o que precisa ser feito. Nada é criado aqui — o "Analisar" final
 * só monta a mesma prévia que o caminho de texto livre já usa; quem confirma
 * e cria o cliente é o painel, como sempre.
 */
export function NewClientWizard({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [pending, startTransition] = useTransition();
  const [cnpjInput, setCnpjInput] = useState("");
  const [company, setCompany] = useState<CompanyForm | null>(null);
  const [taskText, setTaskText] = useState("");

  const digits = cnpjInput.replace(/\D/g, "");

  function handleLookup() {
    startTransition(async () => {
      const result = await lookupClientCnpj({ cnpj: cnpjInput });
      if (!result.ok || !result.data) {
        if (!result.ok) toast.error(result.error);
        // Mesmo sem achar nada, deixa preencher à mão — a consulta nunca tranca.
        setCompany({
          legalName: "",
          normalizedCnpj: digits,
          taxRegime: "",
          cnaeCode: null,
          cnaeDescription: null,
          secondaryCnaes: null,
          openedAt: null,
          cadastralSituation: null,
        });
        return;
      }
      if (result.data.kind === "existing") {
        setCompany(null);
        toast.error(
          `Este CNPJ já está cadastrado como ${result.data.legalName}${result.data.active ? "" : " (empresa inativa)"}. Use a empresa existente em vez de criar outra.`,
        );
        return;
      }
      setCompany({
        legalName: result.data.legalName,
        normalizedCnpj: result.data.normalizedCnpj,
        taxRegime: result.data.suggestedTaxRegime ?? "",
        cnaeCode: result.data.cnaeCode,
        cnaeDescription: result.data.cnaeDescription,
        secondaryCnaes: result.data.secondaryCnaes,
        openedAt: result.data.openedAt,
        cadastralSituation: result.data.cadastralSituation,
      });
    });
  }

  function handleAnalyze() {
    if (!company || !company.taxRegime) return;
    startTransition(async () => {
      const result = await analyzeInformative({
        sourceText: taskText,
        resolvedCompany: {
          legalName: company.legalName,
          normalizedCnpj: company.normalizedCnpj,
          taxRegime: company.taxRegime as TaxRegime,
          cnaeCode: company.cnaeCode,
          cnaeDescription: company.cnaeDescription,
          secondaryCnaes: company.secondaryCnaes,
          openedAt: company.openedAt,
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Prévia gerada. Confira antes de confirmar.");
      router.refresh();
      onDone();
    });
  }

  const notActive =
    company?.cadastralSituation && company.cadastralSituation !== "ATIVA";
  const canAdvance = Boolean(company?.legalName.trim() && company?.taxRegime);

  return (
    <div className="panel-cut grid gap-4 p-4">
      <div className="flex items-center justify-between">
        <p className="hud-label">Novo cliente · passo {step} de 2</p>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          <X className="size-4" aria-hidden /> Fechar
        </Button>
      </div>

      {step === 1 ? (
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="wizard-cnpj">CNPJ</Label>
            <div className="flex gap-2">
              <Input
                id="wizard-cnpj"
                value={cnpjInput}
                onChange={(event) => setCnpjInput(event.target.value)}
                placeholder="00.000.000/0000-00"
                inputMode="numeric"
                className="font-mono"
              />
              <Button
                onClick={handleLookup}
                disabled={pending || digits.length !== 14}
              >
                <Search className="size-4" aria-hidden /> Buscar
              </Button>
            </div>
          </div>

          {company ? (
            <div className="grid gap-3 rounded-md border p-3">
              {notActive ? (
                <p className="flex max-w-prose items-start gap-2 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  A Receita mostra esta empresa como {company.cadastralSituation}.
                  Confira antes de cadastrar como cliente novo.
                </p>
              ) : null}

              <div className="grid gap-2">
                <Label htmlFor="wizard-legal-name">Razão social</Label>
                <Input
                  id="wizard-legal-name"
                  value={company.legalName}
                  onChange={(event) =>
                    setCompany({ ...company, legalName: event.target.value })
                  }
                  placeholder="Nome cadastrado na Receita"
                />
                <p className="font-mono text-xs text-muted-foreground">
                  {formatCnpj(company.normalizedCnpj)}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="wizard-tax-regime">Regime tributário</Label>
                <Select
                  value={company.taxRegime}
                  onValueChange={(value) =>
                    setCompany({ ...company, taxRegime: value as TaxRegime })
                  }
                >
                  <SelectTrigger id="wizard-tax-regime" className="w-full">
                    <SelectValue placeholder="Escolha o regime" />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_REGIMES.map((regime) => (
                      <SelectItem key={regime} value={regime}>
                        {TAX_REGIME_LABELS[regime]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!company.cadastralSituation ? null : (
                  <p className="text-xs text-muted-foreground">
                    {company.taxRegime === "mei"
                      ? "Sugerido pela Receita — a empresa é optante pelo MEI."
                      : company.taxRegime === "simples"
                        ? "Sugerido pela Receita — a empresa é optante do Simples Nacional."
                        : "A Receita não indica opção pelo Simples; escolha o regime."}
                  </p>
                )}
              </div>

              {company.cnaeDescription ? (
                <div className="grid gap-1">
                  <p className="hud-label">Atividade principal</p>
                  <p className="text-sm">
                    {company.cnaeCode} — {company.cnaeDescription}
                  </p>
                </div>
              ) : null}

              {company.secondaryCnaes && company.secondaryCnaes.length > 0 ? (
                <div className="grid gap-1">
                  <p className="hud-label">Atividades secundárias</p>
                  <div className="flex flex-wrap gap-1.5">
                    {company.secondaryCnaes.map((activity) => (
                      <Badge key={activity.code} variant="outline" className="font-normal">
                        {activity.description}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              {company.openedAt ? (
                <div className="grid gap-1">
                  <p className="hud-label">Data de abertura</p>
                  <p className="text-sm">
                    {new Date(`${company.openedAt}T12:00:00Z`).toLocaleDateString(
                      "pt-BR",
                      { timeZone: "UTC" },
                    )}
                  </p>
                </div>
              ) : null}

              <div className="flex justify-end">
                <Button onClick={() => setStep(2)} disabled={!canAdvance}>
                  Próximo
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => setStep(1)}
            disabled={pending}
          >
            <ArrowLeft className="size-4" aria-hidden /> Voltar
          </Button>
          <Label htmlFor="wizard-tasks">O que precisa ser feito</Label>
          <Textarea
            id="wizard-tasks"
            value={taskText}
            onChange={(event) => setTaskText(event.target.value)}
            rows={8}
            maxLength={12_000}
            placeholder={
              "AÇÕES\nFiscal - Camila - parametrizar o simples nacional\nRH - cadastrar o pró-labore do sócio"
            }
            className="font-mono text-xs"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {taskText.length}/12.000
            </span>
            <Button
              onClick={handleAnalyze}
              disabled={pending || taskText.trim().length < 10}
            >
              <ScanText className="size-4" aria-hidden /> Analisar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
