"use client";

import { KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CREDENTIAL_MODE_LABELS, PROXY_STATUS_LABELS, type CredentialMode } from "@/domain/nfse-credentials";
import type { XmlCompanyView, XmlCredentialsView } from "@/lib/nfse/xml-requests";
import { cn } from "@/lib/utils";

import { requestProxyTest, setClientCredentialMode, setDefaultCredentialMode } from "./nfse-credential-actions";

/**
 * Procuração na aba XML (decisão de 2026-11-18): o padrão do escritório, o A1
 * dele, o teste em lote e, em cada empresa, o selo e a exceção.
 */

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const segmentClass =
  "touch-target min-h-9 px-3 text-sm transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default";

/** A empresa está pronta para ler: procuração confirmada ou o próprio certificado em dia. */
export function credentialReady(company: XmlCompanyView, certificateOk: boolean): boolean {
  return company.credential.mode === "proxy" ? company.credential.proxyStatus === "confirmed" : certificateOk;
}

/** Procuração que o Sistema Nacional recusou, para ler ou para emitir. */
export function proxyRefused(company: XmlCompanyView): boolean {
  return company.credential.mode === "proxy" && (company.credential.proxyStatus === "invalid" || company.credential.proxyStatus === "no_emission");
}

/** Passo "Credenciais": padrão do escritório, A1 do escritório e o teste para todas. */
export function CredentialsPanel({
  clanId,
  credentials,
  companies,
  isAdmin,
  canManage,
}: {
  clanId: string;
  credentials: XmlCredentialsView;
  /** As empresas de serviço: é delas o resumo do teste. */
  companies: readonly XmlCompanyView[];
  isAdmin: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const proxied = companies.filter((company) => company.credential.mode === "proxy");
  const count = (status: XmlCompanyView["credential"]["proxyStatus"]) => proxied.filter((company) => company.credential.proxyStatus === status).length;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Não foi possível.");
        return;
      }
      toast.success(success);
      router.refresh();
    });
  }

  return (
    <section className="grid gap-3 rounded-md border bg-card/40 p-4" aria-label="Credenciais">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" aria-hidden /> Credenciais
        </h3>
        {credentials.office.error ? (
          <span className="text-sm text-destructive">A1 do escritório: {credentials.office.error}</span>
        ) : credentials.office.validUntil ? (
          <span className="text-sm text-muted-foreground">A1 do escritório válido até {dateLabel(credentials.office.validUntil)}</span>
        ) : (
          <span className="text-sm text-warning">O serviço fiscal ainda não informou o A1 do escritório.</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Ler e emitir por</span>
        <span className="inline-flex border border-border/70" role="group" aria-label="Padrão do escritório">
          {(["proxy", "certificate"] as const).map((mode) => {
            const selected = credentials.defaultMode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={selected}
                disabled={!isAdmin || pending || selected}
                onClick={() => run(() => setDefaultCredentialMode({ clanId, mode }), `Padrão do escritório: ${mode === "proxy" ? "procuração" : "certificado de cada empresa"}.`)}
                className={cn(segmentClass, mode === "proxy" && "border-r border-border/70", selected && "bg-primary/10 text-primary")}
              >
                {mode === "proxy" ? "Procuração" : "Certificado de cada empresa"}
              </button>
            );
          })}
        </span>
        {!isAdmin ? <span className="text-xs text-muted-foreground">Só admins mudam o padrão.</span> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Trocar a credencial de uma empresa faz a leitura dela recomeçar do início uma vez. Nada é apagado: nota já guardada não se repete.
      </p>
      {proxied.length > 0 ? (
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {count("confirmed")} confirmada(s) · {count("invalid") + count("no_emission")} recusada(s) · {count("untested")} não testada(s) ·{" "}
          {count("technical_failure")} com falha no teste
        </p>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending || credentials.testRequested}
            onClick={() => run(() => requestProxyTest({ clanId }), "Teste pedido. O serviço fiscal testa na próxima volta, em instantes.")}
          >
            {credentials.testRequested ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            {credentials.testRequested ? "Testando a procuração…" : "Testar procuração das empresas de serviço"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** O selo da procuração na linha da empresa, com "Testar" desta. */
export function ProxyStatusLine({ clanId, company, canManage }: { clanId: string; company: XmlCompanyView; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { proxyStatus, proxyCheckedAt, proxyMessage, testRequested } = company.credential;
  const tone = proxyStatus === "confirmed" ? "text-success" : proxyRefused(company) ? "text-destructive" : proxyStatus === "technical_failure" ? "text-warning" : "text-muted-foreground";
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={tone}>
        {PROXY_STATUS_LABELS[proxyStatus]}
        {proxyCheckedAt ? ` · ${dateLabel(proxyCheckedAt)}` : ""}
        {proxyMessage && proxyStatus !== "confirmed" ? `: ${proxyMessage}` : ""}
      </span>
      {canManage ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending || testRequested}
          aria-label={`Testar a procuração de ${company.name}`}
          onClick={() =>
            startTransition(async () => {
              const result = await requestProxyTest({ clanId, clientId: company.clientId });
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              router.refresh();
            })
          }
        >
          {testRequested ? "Testando…" : "Testar"}
        </Button>
      ) : null}
    </span>
  );
}

const MODE_OPTIONS: { value: CredentialMode | null; label: string }[] = [
  { value: null, label: "Padrão" },
  { value: "proxy", label: "Procuração" },
  { value: "certificate", label: "Certificado da empresa" },
];

/** "Ler e emitir por: Padrão · Procuração · Certificado da empresa", no detalhe da linha. */
export function CredentialModeField({ clanId, company, canManage }: { clanId: string; company: XmlCompanyView; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = company.credential.explicitMode;

  function choose(mode: CredentialMode | null, label: string) {
    startTransition(async () => {
      const result = await setClientCredentialMode({ clanId, clientId: company.clientId, mode });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${company.name}: ${label.toLowerCase()}.`);
      router.refresh();
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Ler e emitir por</span>
      {canManage ? (
        <span className="inline-flex flex-wrap border border-border/70" role="group" aria-label={`Credencial de ${company.name}`}>
          {MODE_OPTIONS.map((option, index) => {
            const selected = current === option.value;
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={selected}
                disabled={pending || selected}
                onClick={() => choose(option.value, option.label)}
                className={cn(segmentClass, "min-h-8 px-2.5 text-xs", index < MODE_OPTIONS.length - 1 && "border-r border-border/70", selected && "bg-primary/10 text-primary")}
              >
                {option.label}
              </button>
            );
          })}
        </span>
      ) : (
        <span>{current ? CREDENTIAL_MODE_LABELS[current] : "Padrão"}</span>
      )}
      <span className="text-muted-foreground">(vale agora: {CREDENTIAL_MODE_LABELS[company.credential.mode].toLowerCase()})</span>
    </span>
  );
}
