"use client";

import { FileKey2, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCnpj } from "@/domain/cnpj";
import { certificateState } from "@/domain/nfse-xml";
import { sealCertificate } from "@/lib/nfse/vault-browser";
import type { ClientCertificateView } from "@/lib/nfse/xml-requests";

import { listClientXmlMonths, removeClientCertificate, uploadClientCertificate } from "./nfse-xml-actions";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Selo da Carteira: só quando há o que fazer (vence em < 30 dias, venceu, problema). */
export function CertificateBadge({ certificate }: { certificate: ClientCertificateView | null }) {
  const { state, daysLeft } = certificateState({
    status: certificate?.status ?? null,
    validUntil: certificate?.validUntil ? new Date(certificate.validUntil) : null,
    now: new Date(),
  });
  if (state === "expiring") return <Badge variant="outline" className="border-warning/40 text-xs text-warning">certificado vence em {daysLeft} d</Badge>;
  if (state === "expired") return <Badge variant="outline" className="border-destructive/40 text-xs text-destructive">certificado vencido</Badge>;
  if (state === "invalid") return <Badge variant="outline" className="border-destructive/40 text-xs text-destructive">certificado com problema</Badge>;
  return null;
}

export function ClientCertificateDialog({
  clanId,
  clientId,
  clientName,
  certificate,
  vaultKey,
  canManage,
}: {
  clanId: string;
  clientId: string;
  clientName: string;
  certificate: ClientCertificateView | null;
  vaultKey: { keyId: string; publicKeySpki: string } | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [months, setMonths] = useState<{ year: number; month: number; total: number; cancelled: number }[] | null>(null);
  const [monthsError, setMonthsError] = useState(false);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!open || certificate?.status !== "pending") return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [open, certificate?.status, router]);
  const { state } = certificateState({
    status: certificate?.status ?? null,
    validUntil: certificate?.validUntil ? new Date(certificate.validUntil) : null,
    now: new Date(),
  });

  const summary =
    state === "missing" ? "Nenhum certificado enviado."
    : state === "pending" ? "Certificado enviado; o serviço fiscal está conferindo."
    : state === "invalid" ? `Problema: ${certificate?.statusMessage ?? "envie de novo"}.`
    : state === "expired" ? `Vencido em ${dateLabel(certificate!.validUntil!)}.`
    : `Válido até ${dateLabel(certificate!.validUntil!)} · ${formatCnpj(certificate!.certificateCnpj!)}`;

  function loadMonths() {
    startTransition(async () => {
      try {
        const result = await listClientXmlMonths({ clanId, clientId });
        setMonthsError(!result.ok);
        if (result.ok) setMonths(result.data ?? []);
        else toast.error(result.error);
      } catch {
        setMonthsError(true);
      }
    });
  }

  function upload() {
    if (!file || !vaultKey) return;
    if (file.size > 100_000) { toast.error("O certificado deve ter até 100 KB."); return; }
    startTransition(async () => {
      try {
      const envelope = await sealCertificate({ ...vaultKey, pfx: new Uint8Array(await file.arrayBuffer()), password });
      const result = await uploadClientCertificate({ clanId, clientId, envelope });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFile(null);
      setPassword("");
      if (fileInput.current) fileInput.current.value = "";
      toast.success("Certificado enviado. O serviço fiscal confere em instantes.");
      router.refresh();
      } catch {
        toast.error("Não foi possível enviar o certificado. Confira o arquivo e tente de novo por HTTPS.");
      }
    });
  }

  function remove() {
    if (!window.confirm(`Remover o certificado de ${clientName}? A rotina deixa de ler as notas dela.`)) return;
    startTransition(async () => {
      const result = await removeClientCertificate({ clanId, clientId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Certificado removido.");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadMonths();
        else { setFile(null); setPassword(""); }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <FileKey2 aria-hidden /> XML
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto break-words sm:max-w-lg" aria-busy={pending}>
        <DialogHeader className="pr-8">
          <DialogTitle>Certificado e XML · {clientName}</DialogTitle>
          <DialogDescription>
            Com o certificado A1 da empresa, a rotina guarda aqui os XML das NFS-e que ela emitiu.
          </DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <h3>Certificado A1</h3>
          <p className="text-sm text-muted-foreground">{summary}</p>
          {canManage ? (
            vaultKey ? (
              <div className="grid gap-2">
                <Label htmlFor={`${clientId}-pfx`}>Arquivo .pfx ou .p12</Label>
                <Input ref={fileInput} id={`${clientId}-pfx`} type="file" accept=".pfx,.p12" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
                <Label htmlFor={`${clientId}-password`}>Senha do certificado</Label>
                <Input id={`${clientId}-password`} type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} />
                <p className="text-xs text-muted-foreground">O arquivo e a senha são cifrados neste navegador; só o serviço fiscal consegue abri-los.</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={!file || !password || pending} onClick={upload}>
                    {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
                    {certificate ? "Trocar certificado" : "Enviar certificado"}
                  </Button>
                  {certificate ? (
                    <Button type="button" size="sm" variant="ghost" className="touch-target" disabled={pending} onClick={remove}>
                      <Trash2 aria-hidden /> Remover
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">O serviço fiscal ainda não está pronto para receber certificados.</p>
            )
          ) : null}
        </section>

        <section className="grid gap-2">
          <h3>Pasta de XML</h3>
          {monthsError ? (
            <div className="grid gap-2"><p className="text-sm text-destructive">Não foi possível carregar a pasta.</p><Button size="sm" variant="outline" disabled={pending} onClick={loadMonths}>Tentar novamente</Button></div>
          ) : months === null ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : months.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma nota guardada ainda.</p>
          ) : (
            <ul className="grid gap-1">
              {months.map((item) => (
                <li key={`${item.year}-${item.month}`} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {MONTHS[item.month - 1]}/{item.year} — <span className="font-mono">{item.total}</span> nota(s)
                    {item.cancelled > 0 ? `, ${item.cancelled} cancelada(s)` : ""}
                  </span>
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/nfse/xml?clanId=${clanId}&year=${item.year}&month=${item.month}&clientId=${clientId}`}>Baixar</a>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
