import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { hasMcpScope, type McpActor, type McpScope } from "@/lib/mcp/access";
import {
  acknowledgeNoticeCommand,
  addClosingObservationCommand,
  createClosingCommand,
  createInformativeCommand,
  decideInformativeCommand,
  deleteClosingCommand,
  publishNoticeCommand,
  resolveClosingObservationCommand,
  setClosingStatusCommand,
  setClosingYearCommand,
  setDefisCommand,
  setNoticeArchivedCommand,
  setNoticeWorkCommand,
  updateClosingCommand,
} from "@/lib/mcp/operational-commands";
import {
  closingDetails,
  informativeDetails,
  listClosings,
  listInformatives,
  listMuralNotices,
} from "@/lib/mcp/operational-queries";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string) {
  return { ...text({ error: message }), isError: true };
}

function requireOperationalAccess(actor: McpActor, scope: McpScope) {
  if (!hasMcpScope(actor, scope)) return failure(`Esta chave não possui o escopo ${scope}.`);
  if (actor.role !== "owner" && actor.role !== "admin") {
    return failure("Estas ferramentas operacionais exigem o papel admin ou owner.");
  }
  return null;
}

const idempotency = z.string().trim().min(8).max(100);
const expectedUpdatedAt = z.iso.datetime();
const money = z.string().regex(/^-?\d+(?:\.\d{1,2})?$/).max(18).nullable().optional();
const nonnegativeMoney = z.string().regex(/^\d+(?:\.\d{1,2})?$/).max(18).nullable().optional();

export function registerOperationalTools(server: McpServer, actor: McpActor) {
  server.registerTool(
    "listar_fechamentos",
    {
      title: "Listar fechamentos",
      description: "Lista períodos contábeis e o estado anual das empresas. Disponível somente para admin e owner.",
      inputSchema: z.object({
        year: z.number().int().min(2000).max(2100),
        statuses: z.array(z.enum(["pending", "blocked", "completed"])).max(3).optional(),
        client_id: z.uuid().optional(),
        search: z.string().trim().min(1).max(120).optional(),
        limit: z.number().int().min(1).max(100).default(30),
        offset: z.number().int().min(0).max(10000).default(0),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ year, statuses, client_id, search, limit, offset }) => {
      const denied = requireOperationalAccess(actor, "closings:read");
      if (denied) return denied;
      return text(await listClosings(actor, { year, statuses, clientId: client_id, search, limit, offset }));
    },
  );

  server.registerTool(
    "detalhar_fechamento",
    {
      title: "Detalhar fechamento",
      description: "Mostra valores, período, controle anual e observações de um fechamento.",
      inputSchema: z.object({ closing_id: z.uuid() }),
      annotations: { readOnlyHint: true },
    },
    async ({ closing_id }) => {
      const denied = requireOperationalAccess(actor, "closings:read");
      if (denied) return denied;
      const result = await closingDetails(actor, closing_id);
      return result ? text(result) : failure("Fechamento não encontrado.");
    },
  );

  server.registerTool(
    "criar_fechamento",
    {
      title: "Registrar fechamento",
      description: "Registra um período mensal concluído para uma empresa.",
      inputSchema: z.object({
        idempotency_key: idempotency,
        client_id: z.uuid(),
        year: z.number().int().min(2000).max(2100),
        period_month: z.number().int().min(1).max(12),
        notes: z.string().trim().max(3000).optional(),
        cash_balance: money,
        period_result: money,
        shareholder_loan: nonnegativeMoney,
      }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, client_id, year, period_month, notes, cash_balance, period_result, shareholder_loan }) => {
      const denied = requireOperationalAccess(actor, "closings:write");
      if (denied) return denied;
      const result = await createClosingCommand({ actor, idempotencyKey: idempotency_key, clientId: client_id, year, periodMonth: period_month, notes, cashBalance: cash_balance, periodResult: period_result, shareholderLoan: shareholder_loan });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "editar_fechamento",
    {
      title: "Editar fechamento",
      description: "Edita período, valores e observações com controle de concorrência.",
      inputSchema: z.object({
        idempotency_key: idempotency,
        closing_id: z.uuid(),
        expected_updated_at: expectedUpdatedAt,
        year: z.number().int().min(2000).max(2100),
        period_month: z.number().int().min(1).max(12),
        notes: z.string().trim().max(3000).optional(),
        cash_balance: money,
        period_result: money,
        shareholder_loan: nonnegativeMoney,
      }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, closing_id, expected_updated_at, year, period_month, notes, cash_balance, period_result, shareholder_loan }) => {
      const denied = requireOperationalAccess(actor, "closings:write");
      if (denied) return denied;
      const result = await updateClosingCommand({ actor, idempotencyKey: idempotency_key, closingId: closing_id, expectedUpdatedAt: expected_updated_at, year, periodMonth: period_month, notes, cashBalance: cash_balance, periodResult: period_result, shareholderLoan: shareholder_loan });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "alterar_status_fechamento",
    {
      title: "Alterar situação do fechamento",
      description: "Conclui, bloqueia ou reabre um período contábil.",
      inputSchema: z.object({
        idempotency_key: idempotency,
        closing_id: z.uuid(),
        status: z.enum(["pending", "blocked", "completed"]),
        expected_updated_at: expectedUpdatedAt.optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, closing_id, status, expected_updated_at }) => {
      const denied = requireOperationalAccess(actor, "closings:write");
      if (denied) return denied;
      const result = await setClosingStatusCommand({ actor, idempotencyKey: idempotency_key, closingId: closing_id, status, expectedUpdatedAt: expected_updated_at });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "excluir_fechamento",
    {
      title: "Excluir fechamento",
      description: "Exclui permanentemente um período após confirmar a versão lida.",
      inputSchema: z.object({ idempotency_key: idempotency, closing_id: z.uuid(), expected_updated_at: expectedUpdatedAt }),
      annotations: { idempotentHint: true, destructiveHint: true },
    },
    async ({ idempotency_key, closing_id, expected_updated_at }) => {
      const denied = requireOperationalAccess(actor, "closings:write");
      if (denied) return denied;
      const result = await deleteClosingCommand({ actor, idempotencyKey: idempotency_key, closingId: closing_id, expectedUpdatedAt: expected_updated_at });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "alterar_ano_fechamento",
    {
      title: "Encerrar ou reabrir ano",
      description: "Altera o encerramento anual e reconcilia o XP de forma idempotente.",
      inputSchema: z.object({ idempotency_key: idempotency, client_id: z.uuid(), year: z.number().int().min(2000).max(2100), closed: z.boolean() }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, client_id, year, closed }) => {
      const denied = requireOperationalAccess(actor, "closings:write");
      if (denied) return denied;
      const result = await setClosingYearCommand({ actor, idempotencyKey: idempotency_key, clientId: client_id, year, closed });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "alterar_defis",
    {
      title: "Concluir ou reabrir DEFIS",
      description: "Altera a DEFIS de uma empresa do Simples cujo ano já esteja fechado.",
      inputSchema: z.object({ idempotency_key: idempotency, client_id: z.uuid(), year: z.number().int().min(2000).max(2100), completed: z.boolean() }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, client_id, year, completed }) => {
      const denied = requireOperationalAccess(actor, "closings:write");
      if (denied) return denied;
      const result = await setDefisCommand({ actor, idempotencyKey: idempotency_key, clientId: client_id, year, completed });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "adicionar_observacao_fechamento",
    {
      title: "Adicionar observação de fechamento",
      description: "Cria um item auditável no período, no ano ou na DEFIS.",
      inputSchema: z.object({
        idempotency_key: idempotency,
        client_id: z.uuid(),
        year: z.number().int().min(2000).max(2100),
        scope: z.enum(["year", "defis", "closing"]),
        closing_id: z.uuid().optional(),
        body: z.string().trim().min(3).max(3000),
      }).refine((value) => value.scope !== "closing" || Boolean(value.closing_id), { message: "closing_id é obrigatório para observação do período." }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, client_id, year, scope, closing_id, body }) => {
      const denied = requireOperationalAccess(actor, "closings:write");
      if (denied) return denied;
      const result = await addClosingObservationCommand({ actor, idempotencyKey: idempotency_key, clientId: client_id, year, scope, closingId: closing_id, body });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "resolver_observacao_fechamento",
    {
      title: "Resolver observação de fechamento",
      description: "Marca uma observação como resolvida ou a reabre.",
      inputSchema: z.object({ idempotency_key: idempotency, observation_id: z.uuid(), resolved: z.boolean() }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, observation_id, resolved }) => {
      const denied = requireOperationalAccess(actor, "closings:write");
      if (denied) return denied;
      const result = await resolveClosingObservationCommand({ actor, idempotencyKey: idempotency_key, observationId: observation_id, resolved });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "listar_informativos",
    {
      title: "Listar informativos",
      description: "Lista prévias e pacotes confirmados da organização.",
      inputSchema: z.object({
        statuses: z.array(z.enum(["pending", "confirmed", "cancelled"])).max(3).optional(),
        mine_only: z.boolean().default(false),
        search: z.string().trim().min(1).max(120).optional(),
        limit: z.number().int().min(1).max(100).default(30),
        offset: z.number().int().min(0).max(10000).default(0),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ statuses, mine_only, search, limit, offset }) => {
      const denied = requireOperationalAccess(actor, "informatives:read");
      if (denied) return denied;
      return text(await listInformatives(actor, { statuses, mineOnly: mine_only, search, limit, offset }));
    },
  );

  server.registerTool(
    "detalhar_informativo",
    {
      title: "Detalhar informativo",
      description: "Mostra texto, prévia, missões planejadas, revisão e resultado de um Informativo.",
      inputSchema: z.object({ informative_id: z.uuid() }),
      annotations: { readOnlyHint: true },
    },
    async ({ informative_id }) => {
      const denied = requireOperationalAccess(actor, "informatives:read");
      if (denied) return denied;
      const result = await informativeDetails(actor, informative_id);
      return result ? text(result) : failure("Informativo não encontrado.");
    },
  );

  server.registerTool(
    "criar_informativo",
    {
      title: "Preparar informativo",
      description: "Cria uma prévia estruturada com aviso e missões por clã. Nada é publicado antes de confirmar.",
      inputSchema: z.object({
        idempotency_key: idempotency,
        title: z.string().trim().min(3).max(160),
        body: z.string().trim().min(3).max(5000),
        client_id: z.uuid().nullable().optional(),
        missions: z.array(z.object({ clan_id: z.uuid(), description: z.string().trim().min(3).max(5000) })).max(60).default([]),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, title, body, client_id, missions }) => {
      const denied = requireOperationalAccess(actor, "informatives:write");
      if (denied) return denied;
      const result = await createInformativeCommand({ actor, idempotencyKey: idempotency_key, title, body, clientId: client_id, missions: missions.map((mission) => ({ clanId: mission.clan_id, description: mission.description })) });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "confirmar_informativo",
    {
      title: "Confirmar informativo",
      description: "Publica o Informativo no Mural e cria suas missões após conferir a revisão.",
      inputSchema: z.object({
        idempotency_key: idempotency,
        informative_id: z.uuid(),
        expected_revision: z.string().regex(/^[a-f0-9]{64}$/),
        decisions: z.array(z.object({ index: z.number().int().min(0).max(59), clan_id: z.uuid().nullable().optional(), assignee_id: z.string().min(1).nullable().optional() })).max(60).optional(),
      }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, informative_id, expected_revision, decisions }) => {
      const denied = requireOperationalAccess(actor, "informatives:write");
      if (denied) return denied;
      const result = await decideInformativeCommand({ actor, idempotencyKey: idempotency_key, informativeId: informative_id, action: "confirm", expectedRevision: expected_revision, decisions: decisions?.map((item) => ({ index: item.index, clanId: item.clan_id, assigneeId: item.assignee_id })) });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "cancelar_informativo",
    {
      title: "Cancelar prévia de informativo",
      description: "Cancela uma prévia sem publicar aviso nem criar missões.",
      inputSchema: z.object({ idempotency_key: idempotency, informative_id: z.uuid() }),
      annotations: { idempotentHint: true, destructiveHint: true },
    },
    async ({ idempotency_key, informative_id }) => {
      const denied = requireOperationalAccess(actor, "informatives:write");
      if (denied) return denied;
      const result = await decideInformativeCommand({ actor, idempotencyKey: idempotency_key, informativeId: informative_id, action: "cancel" });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "listar_mural",
    {
      title: "Listar Mural",
      description: "Lista avisos, confirmações de leitura e andamento das missões vinculadas.",
      inputSchema: z.object({
        archived: z.boolean().default(false),
        search: z.string().trim().min(1).max(120).optional(),
        limit: z.number().int().min(1).max(100).default(30),
        offset: z.number().int().min(0).max(10000).default(0),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ archived, search, limit, offset }) => {
      const denied = requireOperationalAccess(actor, "mural:read");
      if (denied) return denied;
      return text(await listMuralNotices(actor, { archived, search, limit, offset }));
    },
  );

  server.registerTool(
    "publicar_no_mural",
    {
      title: "Publicar no Mural",
      description: "Publica um aviso livre, opcionalmente fixado e com confirmação obrigatória.",
      inputSchema: z.object({ idempotency_key: idempotency, title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(5000), requires_ack: z.boolean().default(false), pinned: z.boolean().default(false) }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, title, body, requires_ack, pinned }) => {
      const denied = requireOperationalAccess(actor, "mural:write");
      if (denied) return denied;
      const result = await publishNoticeCommand({ actor, idempotencyKey: idempotency_key, title, body, requiresAck: requires_ack, pinned });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "confirmar_leitura_mural",
    {
      title: "Confirmar leitura no Mural",
      description: "Registra a ciência da pessoa representada; nunca confirma por outra pessoa.",
      inputSchema: z.object({ idempotency_key: idempotency, notice_id: z.uuid() }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, notice_id }) => {
      const denied = requireOperationalAccess(actor, "mural:write");
      if (denied) return denied;
      const result = await acknowledgeNoticeCommand({ actor, idempotencyKey: idempotency_key, noticeId: notice_id });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "alterar_trabalho_mural",
    {
      title: "Concluir ou reabrir trabalho do Mural",
      description: "Confirma a parte da pessoa representada depois de encerrar suas missões, ou a reabre.",
      inputSchema: z.object({ idempotency_key: idempotency, notice_id: z.uuid(), resolved: z.boolean() }),
      annotations: { idempotentHint: true },
    },
    async ({ idempotency_key, notice_id, resolved }) => {
      const denied = requireOperationalAccess(actor, "mural:write");
      if (denied) return denied;
      const result = await setNoticeWorkCommand({ actor, idempotencyKey: idempotency_key, noticeId: notice_id, resolved });
      return result.ok ? text(result) : failure(result.error);
    },
  );

  server.registerTool(
    "alterar_arquivamento_mural",
    {
      title: "Arquivar ou devolver aviso do Mural",
      description: "Arquiva ou desarquiva um aviso com controle opcional de versão.",
      inputSchema: z.object({ idempotency_key: idempotency, notice_id: z.uuid(), archived: z.boolean(), expected_updated_at: expectedUpdatedAt.optional() }),
      annotations: { idempotentHint: true, destructiveHint: true },
    },
    async ({ idempotency_key, notice_id, archived, expected_updated_at }) => {
      const denied = requireOperationalAccess(actor, "mural:write");
      if (denied) return denied;
      const result = await setNoticeArchivedCommand({ actor, idempotencyKey: idempotency_key, noticeId: notice_id, archived, expectedUpdatedAt: expected_updated_at });
      return result.ok ? text(result) : failure(result.error);
    },
  );
}
