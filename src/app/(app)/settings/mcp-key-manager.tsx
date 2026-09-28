"use client";

import { Check, Copy, KeyRound, ShieldX } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MCP_SCOPES, type McpScope } from "@/domain/mcp-access";

import { createMcpKeyAction, revokeMcpKeyAction } from "./mcp-actions";

const SCOPE_LABELS: Record<McpScope, string> = {
  "missions:read": "Analisar missões",
  "directory:read": "Consultar empresas e pessoas",
  "missions:create": "Criar missões",
  "missions:write": "Editar e executar",
  "missions:assign": "Atribuir e transferir",
  "missions:review": "Aprovar e rejeitar",
  "missions:cancel": "Cancelar missões",
};

type KeyRow = {
  id: string;
  name: string;
  userId: string;
  userName: string;
  lastFour: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

export function McpKeyManager({
  members,
  keys,
}: {
  members: Array<{ userId: string; name: string; role: string }>;
  keys: KeyRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("Codex");
  const [targetUserId, setTargetUserId] = useState(members[0]?.userId ?? "");
  const [scopes, setScopes] = useState<McpScope[]>([...MCP_SCOPES]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function toggleScope(scope: McpScope) {
    setScopes((current) => current.includes(scope)
      ? current.filter((item) => item !== scope)
      : [...current, scope]);
  }

  function createKey() {
    startTransition(async () => {
      const result = await createMcpKeyAction({ name, targetUserId, scopes });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setNewToken(result.data?.token ?? null);
      setCopied(false);
      toast.success("Chave criada. Copie agora: ela não será mostrada de novo.");
    });
  }

  function revoke(keyId: string) {
    startTransition(async () => {
      const result = await revokeMcpKeyAction({ keyId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Chave revogada.");
    });
  }

  async function copyToken() {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    setCopied(true);
  }

  return (
    <section className="panel-cut grid gap-5 border bg-card p-5">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 text-primary" aria-hidden />
        <div>
          <h2>Acesso de agentes</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Cada chave atua como a pessoa escolhida. O papel e os vínculos dela
            continuam valendo; as permissões abaixo só podem reduzir esse acesso.
          </p>
        </div>
      </div>

      <div className="grid gap-4 border-y py-4 lg:grid-cols-[1fr_1fr]">
        <div className="grid content-start gap-3">
          <label className="grid gap-1 text-sm font-medium">
            Nome da conexão
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Pessoa representada
            <select
              value={targetUserId}
              onChange={(event) => setTargetUserId(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name} · {member.role}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Permissões da chave</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {MCP_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  className="size-4 accent-primary"
                />
                {SCOPE_LABELS[scope]}
              </label>
            ))}
          </div>
        </fieldset>
        <Button onClick={createKey} disabled={pending || !targetUserId || scopes.length === 0} className="lg:col-span-2 lg:w-fit">
          <KeyRound aria-hidden /> Gerar chave
        </Button>
      </div>

      {newToken ? (
        <div className="grid gap-2 border border-warning/50 bg-warning/5 p-4">
          <p className="text-sm font-medium text-warning">Copie agora. Esta chave aparece somente uma vez.</p>
          <code className="break-all rounded-sm bg-background p-3 text-xs">{newToken}</code>
          <Button variant="outline" onClick={copyToken} className="w-fit">
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Copiada" : "Copiar chave"}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-2">
        <h3>Chaves criadas</h3>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conexão criada.</p>
        ) : keys.map((key) => (
          <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0">
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{key.name}</span>
                <Badge variant={key.revokedAt ? "outline" : "secondary"}>{key.revokedAt ? "Revogada" : "Ativa"}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {key.userName} · final {key.lastFour} · {key.scopes.length} permissões
                {key.lastUsedAt ? ` · último uso ${key.lastUsedAt.toLocaleString("pt-BR")}` : " · ainda não usada"}
              </p>
            </div>
            {!key.revokedAt ? (
              <Button variant="ghost" size="sm" onClick={() => revoke(key.id)} disabled={pending} className="text-destructive">
                <ShieldX aria-hidden /> Revogar
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
