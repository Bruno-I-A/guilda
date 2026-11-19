"use client";

import { CheckCircle2, MessageCircleMore, Save, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { createMemberWhatsAppUtilityTemplate, saveMemberWhatsAppSettings } from "./whatsapp-actions";

export function WhatsAppSettings({ connection, templateStatus, canManageTemplate }: { connection: { phone: string; enabled: boolean; lastInboundAt: string | null } | null; templateStatus: string | null; canManageTemplate: boolean }) {
  const [phone, setPhone] = useState(connection?.phone ?? "");
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  const [pending, start] = useTransition();
  const [templatePending, startTemplate] = useTransition();
  return <Card className="panel-cut rounded-none border-0 ring-0">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><MessageCircleMore className="size-5 text-whatsapp" />WhatsApp de trabalho</CardTitle>
      <CardDescription>Receba no seu número o aviso quando um novo cliente chegar ao seu clã.</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4">
      <div className="grid gap-2"><Label htmlFor="member-whatsapp">Seu WhatsApp</Label><Input id="member-whatsapp" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="55 54 99999-0000" inputMode="tel" /></div>
      <label className="flex items-center justify-between gap-3 rounded-lg border p-3"><div><p className="text-sm font-medium">Avisos ativos</p><p className="text-xs text-muted-foreground">Você pode desligar quando estiver fora.</p></div><input className="size-4 accent-primary" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /></label>
      <p className="text-xs text-muted-foreground">Depois de salvar, mande uma mensagem para o WhatsApp do escritório. Isso abre por 24 horas a janela para avisos comuns, sem uso de template.</p>
      {connection?.lastInboundAt ? <p className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="size-3" />Janela identificada pela última mensagem enviada ao escritório.</p> : null}
      <Button disabled={pending || !phone.trim()} onClick={() => start(async () => { const result = await saveMemberWhatsAppSettings({ phone, enabled }); if (result.ok) toast.success("WhatsApp conectado aos avisos."); else toast.error(result.error); })}><Save />Salvar meu WhatsApp</Button>
      {canManageTemplate ? <div className="grid gap-2 border-t pt-4"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-medium">Modelo de utilidade</p><p className="text-xs text-muted-foreground">Usado apenas quando a janela estiver fechada.</p></div><Badge variant={templateStatus === "APPROVED" ? "default" : "secondary"}>{templateStatus ?? "não criado"}</Badge></div><Button variant="outline" disabled={templatePending} onClick={() => startTemplate(async () => { const result = await createMemberWhatsAppUtilityTemplate(); if (result.ok) toast.success(`Modelo enviado à Meta: ${String((result.data as { status?: string } | undefined)?.status ?? "pendente")}.`); else toast.error(result.error); })}><ShieldCheck />Preparar modelo Utility</Button></div> : null}
    </CardContent>
  </Card>;
}
