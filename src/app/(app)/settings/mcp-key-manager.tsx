"use client";

import { Check, Copy, KeyRound, ShieldX, Terminal } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MCP_SCOPES, type McpScope } from "@/domain/mcp-access";
import {
  buildMcpConnectionCommand,
  MCP_AGENT_LABELS,
  type McpAgentKind,
} from "@/domain/mcp-connection";

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

const SCOPE_TOOLS: Record<McpScope, string> = {
  "missions:read": "contexto, resumo, listar e detalhar missões",
  "directory:read": "buscar empresas, listar clãs e integrantes",
  "missions:create": "criar missão",
  "missions:write": "editar, iniciar, entregar e concluir",
  "missions:assign": "transferir responsável",
  "missions:review": "aprovar e rejeitar",
  "missions:cancel": "cancelar missão",
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
  selfService = false,
}: {
  members: Array<{ userId: string; name: string; role: string }>;
  keys: KeyRow[];
  selfService?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [agent, setAgent] = useState<McpAgentKind>("codex");
  const [targetUserId, setTargetUserId] = useState(members[0]?.userId ?? "");
  const [scopes, setScopes] = useState<McpScope[]>([...MCP_SCOPES]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);

  function toggleScope(scope: McpScope) {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  function createKey() {
    startTransition(async () => {
      const result = await createMcpKeyAction({
        name: MCP_AGENT_LABELS[agent],
        targetUserId,
        scopes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setNewToken(result.data?.token ?? null);
      setCopied(false);
      setCommandCopied(false);
      toast.success(
        "Chave criada. Copie agora: ela não será mostrada de novo.",
      );
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

  function connectionCommand() {
    return buildMcpConnectionCommand({
      agent,
      endpoint: `${window.location.origin}/api/mcp`,
    });
  }

  async function copyCommand() {
    if (!newToken) return;
    await navigator.clipboard.writeText(connectionCommand());
    setCommandCopied(true);
  }

  return (
    <section className="panel-cut grid gap-5 border bg-card p-5">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 text-primary" aria-hidden />
        <div>
          <h2>{selfService ? "Meus agentes" : "Acesso de agentes"}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {selfService
              ? "Conecte seu Codex ou Claude à Guilda. A chave representa somente você e respeita seu papel e seus vínculos."
              : "Cada chave atua como a pessoa escolhida. O papel e os vínculos dela continuam valendo; os grupos abaixo só podem reduzir esse acesso."}
          </p>
        </div>
      </div>

      <div className="grid gap-4 border-y py-4 lg:grid-cols-[1fr_1fr]">
        <div className="grid content-start gap-3">
          <label className="grid gap-1 text-sm font-medium">
            Qual IA vai conectar?
            <select
              value={agent}
              onChange={(event) => {
                setAgent(event.target.value as McpAgentKind);
                setNewToken(null);
              }}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
            </select>
          </label>
          {selfService ? (
            <div className="grid gap-1 text-sm">
              <span className="font-medium">Pessoa representada</span>
              <span className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground">
                {members[0]?.name} · acesso pessoal
              </span>
            </div>
          ) : (
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
          )}
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">
            Grupos de permissão (7)
          </legend>
          <p className="text-xs text-muted-foreground">
            Eles liberam até 16 ferramentas, sempre limitadas pelo acesso da
            pessoa representada na Guilda.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {MCP_SCOPES.map((scope) => (
              <label
                key={scope}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="grid">
                  <span>{SCOPE_LABELS[scope]}</span>
                  <span className="text-xs text-muted-foreground/80">
                    {SCOPE_TOOLS[scope]}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button
          onClick={createKey}
          disabled={pending || !targetUserId || scopes.length === 0}
          className="lg:col-span-2 lg:w-fit"
        >
          <KeyRound aria-hidden /> Gerar chave e ver comando
        </Button>
      </div>

      {newToken ? (
        <div className="grid gap-3 border border-warning/50 bg-warning/5 p-4">
          <p className="text-sm font-medium text-warning">
            Copie agora. Esta chave aparece somente uma vez.
          </p>
          <code className="break-all rounded-sm bg-background p-3 text-xs">
            {newToken}
          </code>
          <Button variant="outline" onClick={copyToken} className="w-fit">
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? "Chave copiada" : "Copiar chave"}
          </Button>
          <div className="grid gap-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-primary" aria-hidden />
              <p className="text-sm font-medium">
                Comando pronto para {MCP_AGENT_LABELS[agent]}
              </p>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-sm bg-background p-3 text-xs">
              <code>{connectionCommand()}</code>
            </pre>
            <Button variant="outline" onClick={copyCommand} className="w-fit">
              {commandCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {commandCopied ? "Comando copiado" : "Copiar comando"}
            </Button>
            {agent === "codex" ? (
              <p className="text-xs text-muted-foreground">
                Copie a chave acima, execute o comando no PowerShell e cole a
                chave quando ele pedir. A variável fica salva para as próximas
                sessões do Codex.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Copie a chave acima, execute o comando no PowerShell e cole a
                chave quando ele pedir.
              </p>
            )}
          </div>
        </div>
      ) : null}

      <div className="grid gap-2">
        <h3>Chaves criadas</h3>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma conexão criada.
          </p>
        ) : (
          keys.map((key) => (
            <div
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-0"
            >
              <div className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{key.name}</span>
                  <Badge variant={key.revokedAt ? "outline" : "secondary"}>
                    {key.revokedAt ? "Revogada" : "Ativa"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {key.userName} · final {key.lastFour} · {key.scopes.length}{" "}
                  grupos de permissão
                  {key.lastUsedAt
                    ? ` · último uso ${key.lastUsedAt.toLocaleString("pt-BR")}`
                    : " · ainda não usada"}
                </p>
              </div>
              {!key.revokedAt ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revoke(key.id)}
                  disabled={pending}
                  className="text-destructive"
                >
                  <ShieldX aria-hidden /> Revogar
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
