/**
 * Seed de demonstração: 1 organização, 4 pessoas e tarefas em todos os
 * estados do ciclo de vida, com ledger de XP consistente (créditos e um
 * estorno) espalhados no tempo para preencher os períodos do ranking.
 *
 * Uso: npm run seed   (idempotente: aborta se a org demo já existe)
 * Login demo: helena@demo.guilda.dev / demo123456 (e demais e-mails)
 */
import "./load-env";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "../src/db";
import { withOrgTx } from "../src/db/org-tx";
import * as schema from "../src/db/schema";
import type { TaskStatus } from "../src/domain/task-state";
import { calculateTaskXp } from "../src/domain/xp";
import { createUserWithPassword } from "../src/lib/auth-admin";

const PASSWORD = "demo123456";
const ORG_SLUG = "guilda-demo";

const PEOPLE = [
  { key: "helena", name: "Helena Prado", email: "helena@demo.guilda.dev", role: "owner" },
  { key: "rafael", name: "Rafael Dias", email: "rafael@demo.guilda.dev", role: "admin" },
  { key: "juliana", name: "Juliana Melo", email: "juliana@demo.guilda.dev", role: "member" },
  { key: "tiago", name: "Tiago Alves", email: "tiago@demo.guilda.dev", role: "member" },
] as const;

type PersonKey = (typeof PEOPLE)[number]["key"];

const CLANS = [
  { name: "Fiscal", slug: "fiscal" },
  { name: "Contabilidade", slug: "contabilidade" },
  { name: "RH", slug: "rh" },
  { name: "Societário", slug: "societario" },
  { name: "Financeiro", slug: "financeiro" },
] as const;

type ClanSlug = (typeof CLANS)[number]["slug"];

interface PersonClan {
  slug: ClanSlug;
  isLeader: boolean;
  isPrimary: boolean;
}

const PERSON_CLANS: Record<PersonKey, readonly PersonClan[]> = {
  helena: CLANS.map(({ slug }) => ({
    slug,
    isLeader: true,
    isPrimary: slug === "contabilidade",
  })),
  rafael: [
    { slug: "fiscal", isLeader: true, isPrimary: true },
    { slug: "financeiro", isLeader: false, isPrimary: false },
  ],
  juliana: [
    { slug: "rh", isLeader: true, isPrimary: true },
    { slug: "financeiro", isLeader: false, isPrimary: false },
  ],
  tiago: [
    { slug: "societario", isLeader: true, isPrimary: true },
    { slug: "fiscal", isLeader: false, isPrimary: false },
  ],
};

function daysAgo(days: number, hours = 0): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000);
}

async function ensureUser(name: string, email: string): Promise<string> {
  const existing = await db.query.user.findFirst({
    where: eq(schema.user.email, email),
  });
  if (existing) return existing.id;
  // O endpoint publico de cadastro esta desligado (auth.ts: disableSignUp);
  // o seed cria pelo mesmo caminho administrativo da tela de Membros.
  const criado = await createUserWithPassword({
    name,
    email,
    password: PASSWORD,
    mustChangePassword: false,
  });
  if (!criado.ok) throw new Error(`falha ao criar usuário ${email}: ${criado.reason}`);
  const created = await db.query.user.findFirst({
    where: eq(schema.user.email, email),
  });
  if (!created) throw new Error(`falha ao criar usuário ${email}`);
  return created.id;
}

async function main() {
  const existingOrg = await db.query.organization.findFirst({
    where: eq(schema.organization.slug, ORG_SLUG),
  });
  if (existingOrg) {
    console.log(`Org demo já existe (${existingOrg.id}) — nada a fazer.`);
    console.log(`Logins: helena@demo.guilda.dev / ${PASSWORD}`);
    return;
  }

  console.log("Criando usuários…");
  const ids = {} as Record<PersonKey, string>;
  for (const person of PEOPLE) {
    ids[person.key] = await ensureUser(person.name, person.email);
  }

  console.log("Criando organização e membros…");
  const orgId = randomUUID();
  await db.insert(schema.organization).values({
    id: orgId,
    name: "Guilda Demo",
    slug: ORG_SLUG,
    createdAt: daysAgo(45),
  });
  for (const person of PEOPLE) {
    await db.insert(schema.member).values({
      id: randomUUID(),
      organizationId: orgId,
      userId: ids[person.key],
      role: person.role,
      createdAt: daysAgo(44),
    });
  }

  interface SeedTask {
    title: string;
    description?: string;
    creator: PersonKey;
    assignee: PersonKey;
    priority: 1 | 2 | 3;
    difficulty: 1 | 2 | 3 | 4 | 5;
    status: TaskStatus;
    /** dias atrás em que a tarefa foi criada */
    createdDaysAgo: number;
    /** dias atrás da conclusão (para completed/revertida) */
    completedDaysAgo?: number;
    rejectionNote?: string;
    dueInDays?: number;
    reverted?: boolean;
  }

  const TASKS: SeedTask[] = [
    // Concluídas na última semana (ranking semanal)
    { title: "Publicar landing page da campanha", creator: "helena", assignee: "juliana", priority: 3, difficulty: 4, status: "completed", createdDaysAgo: 6, completedDaysAgo: 2 },
    { title: "Corrigir bug do fechamento de caixa", creator: "rafael", assignee: "tiago", priority: 3, difficulty: 3, status: "completed", createdDaysAgo: 5, completedDaysAgo: 1 },
    { title: "Responder tickets acumulados do suporte", creator: "helena", assignee: "juliana", priority: 2, difficulty: 2, status: "completed", createdDaysAgo: 4, completedDaysAgo: 3 },
    // Concluídas no último mês (ranking mensal)
    { title: "Migrar planilha de clientes para o CRM", creator: "helena", assignee: "rafael", priority: 2, difficulty: 5, status: "completed", createdDaysAgo: 20, completedDaysAgo: 12 },
    { title: "Organizar onboarding de novos membros", creator: "rafael", assignee: "juliana", priority: 1, difficulty: 3, status: "completed", createdDaysAgo: 18, completedDaysAgo: 10 },
    { title: "Revisar contrato com fornecedor", creator: "helena", assignee: "tiago", priority: 2, difficulty: 2, status: "completed", createdDaysAgo: 15, completedDaysAgo: 9 },
    // Concluída há mais de 30 dias (aparece só no geral)
    { title: "Definir identidade visual da guilda", creator: "helena", assignee: "rafael", priority: 2, difficulty: 4, status: "completed", createdDaysAgo: 42, completedDaysAgo: 35 },
    // Revertida: crédito + estorno no ledger, volta a in_progress
    { title: "Atualizar catálogo de produtos", creator: "rafael", assignee: "tiago", priority: 2, difficulty: 3, status: "in_progress", createdDaysAgo: 8, completedDaysAgo: 4, reverted: true },
    // Em fluxo
    { title: "Preparar apresentação para o conselho", creator: "helena", assignee: "rafael", priority: 3, difficulty: 4, status: "awaiting_approval", createdDaysAgo: 3, dueInDays: 2 },
    { title: "Mapear processos do financeiro", creator: "rafael", assignee: "juliana", priority: 2, difficulty: 3, status: "in_progress", createdDaysAgo: 2, dueInDays: 5 },
    { title: "Cotar novos notebooks para a equipe", creator: "helena", assignee: "tiago", priority: 1, difficulty: 1, status: "pending", createdDaysAgo: 1, dueInDays: 7 },
    { title: "Escrever post de lançamento no blog", creator: "helena", assignee: "juliana", priority: 2, difficulty: 2, status: "rejected", createdDaysAgo: 4, rejectionNote: "Faltou incluir os depoimentos dos clientes beta.", dueInDays: 1 },
    { title: "Auditar acessos antigos do sistema", creator: "rafael", assignee: "rafael", priority: 1, difficulty: 2, status: "cancelled", createdDaysAgo: 12 },
  ];

  console.log("Criando clãs, vínculos, tarefas, eventos e ledger…");
  await withOrgTx(orgId, async (tx) => {
    const clanIds = {} as Record<ClanSlug, string>;
    for (const clan of CLANS) {
      const clanId = randomUUID();
      clanIds[clan.slug] = clanId;
      await tx.insert(schema.clans).values({
        id: clanId,
        orgId,
        name: clan.name,
        slug: clan.slug,
        createdAt: daysAgo(43),
        updatedAt: daysAgo(43),
      });
    }

    for (const person of PEOPLE) {
      for (const membership of PERSON_CLANS[person.key]) {
        await tx.insert(schema.clanMemberships).values({
          id: randomUUID(),
          orgId,
          clanId: clanIds[membership.slug],
          userId: ids[person.key],
          isLeader: membership.isLeader,
          isPrimary: membership.isPrimary,
          createdAt: daysAgo(42),
          updatedAt: daysAgo(42),
        });
      }
    }

    for (const seed of TASKS) {
      const taskId = randomUUID();
      const creatorId = ids[seed.creator];
      const assigneeId = ids[seed.assignee];
      const primaryClan = PERSON_CLANS[seed.assignee].find(
        (membership) => membership.isPrimary,
      );
      if (!primaryClan) {
        throw new Error(`pessoa ${seed.assignee} sem clã principal no seed`);
      }
      const xpValue = calculateTaskXp(seed.difficulty, seed.priority);
      const createdAt = daysAgo(seed.createdDaysAgo, 6);
      const completedAt =
        seed.completedDaysAgo !== undefined ? daysAgo(seed.completedDaysAgo, 3) : null;

      await tx.insert(schema.tasks).values({
        id: taskId,
        orgId,
        creatorId,
        assigneeId,
        clanId: clanIds[primaryClan.slug],
        title: seed.title,
        description: seed.description ?? null,
        priority: seed.priority,
        difficulty: seed.difficulty,
        xpValue,
        status: seed.status,
        dueDate: seed.dueInDays !== undefined ? daysAgo(-seed.dueInDays) : null,
        createdAt,
        updatedAt: completedAt ?? createdAt,
        completedAt: seed.status === "completed" ? completedAt : null,
      });

      const events: {
        from: TaskStatus | null;
        to: TaskStatus;
        actor: string;
        at: Date;
        note?: string;
      }[] = [{ from: null, to: "pending", actor: creatorId, at: createdAt }];

      const wasStarted = seed.status !== "pending" && seed.status !== "cancelled";
      if (wasStarted) {
        events.push({
          from: "pending",
          to: "in_progress",
          actor: assigneeId,
          at: daysAgo(seed.createdDaysAgo, 2),
        });
      }
      if (
        seed.status === "awaiting_approval" ||
        seed.status === "completed" ||
        seed.status === "rejected" ||
        seed.reverted
      ) {
        events.push({
          from: "in_progress",
          to: "awaiting_approval",
          actor: assigneeId,
          at: completedAt ? new Date(completedAt.getTime() - 60 * 60 * 1000) : daysAgo(seed.createdDaysAgo, 1),
        });
      }
      if (seed.status === "completed" || seed.reverted) {
        events.push({
          from: "awaiting_approval",
          to: "completed",
          actor: creatorId,
          at: completedAt ?? createdAt,
        });
      }
      if (seed.reverted && completedAt) {
        events.push({
          from: "completed",
          to: "in_progress",
          actor: ids.helena,
          at: new Date(completedAt.getTime() + 12 * 60 * 60 * 1000),
          note: "Catálogo publicado com preços desatualizados.",
        });
      }
      if (seed.status === "rejected") {
        events.push({
          from: "awaiting_approval",
          to: "rejected",
          actor: creatorId,
          at: daysAgo(seed.createdDaysAgo - 1, 1),
          note: seed.rejectionNote,
        });
      }
      if (seed.status === "cancelled") {
        events.push({
          from: "pending",
          to: "cancelled",
          actor: creatorId,
          at: daysAgo(seed.createdDaysAgo - 1, 5),
        });
      }

      let completionEventId: string | null = null;
      let reversalEventId: string | null = null;
      for (const event of events) {
        const eventId = randomUUID();
        if (event.to === "completed") completionEventId = eventId;
        if (event.from === "completed" && event.to === "in_progress") {
          reversalEventId = eventId;
        }
        await tx.insert(schema.taskEvents).values({
          id: eventId,
          orgId,
          taskId,
          actorId: event.actor,
          fromStatus: event.from,
          toStatus: event.to,
          note: event.note ?? null,
          createdAt: event.at,
        });
      }

      if ((seed.status === "completed" || seed.reverted) && completedAt) {
        if (!completionEventId) {
          throw new Error(`evento de conclusão ausente para ${seed.title}`);
        }
        await tx.insert(schema.xpLedger).values({
          id: randomUUID(),
          orgId,
          userId: assigneeId,
          taskId,
          taskEventId: completionEventId,
          amount: xpValue,
          reason: "task_completed",
          createdAt: completedAt,
        });
      }
      if (seed.reverted && completedAt) {
        if (!reversalEventId) {
          throw new Error(`evento de reversão ausente para ${seed.title}`);
        }
        await tx.insert(schema.xpLedger).values({
          id: randomUUID(),
          orgId,
          userId: assigneeId,
          taskId,
          taskEventId: reversalEventId,
          amount: -xpValue,
          reason: "reversal",
          createdAt: new Date(completedAt.getTime() + 12 * 60 * 60 * 1000),
        });
      }
    }

    // Missão coletiva para exercitar o fluxo de adoção por alguém do clã.
    const clanOnlyTaskId = randomUUID();
    const clanOnlyCreatedAt = daysAgo(1, 4);
    await tx.insert(schema.tasks).values({
      id: clanOnlyTaskId,
      orgId,
      creatorId: ids.helena,
      assigneeId: null,
      clanId: clanIds.financeiro,
      title: "Conferir pendências financeiras da semana",
      description: "Missão aberta para qualquer integrante do clã Financeiro assumir.",
      priority: 2,
      difficulty: 2,
      xpValue: calculateTaskXp(2, 2),
      status: "pending",
      dueDate: daysAgo(-4),
      createdAt: clanOnlyCreatedAt,
      updatedAt: clanOnlyCreatedAt,
    });
    await tx.insert(schema.taskEvents).values({
      id: randomUUID(),
      orgId,
      taskId: clanOnlyTaskId,
      actorId: ids.helena,
      fromStatus: null,
      toStatus: "pending",
      createdAt: clanOnlyCreatedAt,
    });

    // ── Mesa do Líder: um informativo confirmado com o pacote de uma empresa.
    // As missões nascem DO CLÃ, sem responsável, e o "Att." fica registrado
    // como sugestão — é exatamente a fila que o líder distribui.
    const clientId = randomUUID();
    const informativeCreatedAt = daysAgo(1, 9);
    await tx.insert(schema.clients).values({
      id: clientId,
      orgId,
      name: "PICCOLI AGRO SERVIÇOS LTDA",
      cnpj: "68100490000131",
      taxRegime: "simples",
      createdAt: informativeCreatedAt,
    });

    const informativeId = randomUUID();
    await tx.insert(schema.informatives).values({
      id: informativeId,
      orgId,
      requestedBy: ids.helena,
      connectionId: null,
      source: "panel",
      sourceText:
        "INFORMATIVO — NOVO CLIENTE\n\nRazão social: PICCOLI AGRO SERVIÇOS LTDA\nCNPJ: 68.100.490/0001-31\nEnquadramento: Simples Nacional\n\nAÇÕES\nFiscal - Camila - parametrizar o faturamento médio e controlar o Fator R\nRH - cadastrar o pró-labore a partir da competência 07/2026\nContabilidade - abrir a contabilidade da empresa\n\nOBSERVAÇÕES\nCamila responde por todos os informativos da empresa.",
      model: "seed",
      payload: { seeded: true },
      status: "confirmed",
      createdTaskIds: [],
      expiresAt: new Date(informativeCreatedAt.getTime() + 30 * 60 * 1000),
      decidedAt: informativeCreatedAt,
      createdAt: informativeCreatedAt,
    });

    const INFORMATIVE_TASKS = [
      {
        title: "Parametrizar o faturamento médio e controlar o Fator R",
        clan: "fiscal" as ClanSlug,
        difficulty: 3,
        priority: 3,
        suggestions: [{ rawName: "Camila", userId: null }],
      },
      {
        title: "Cadastrar o pró-labore a partir da competência 07/2026",
        clan: "rh" as ClanSlug,
        difficulty: 2,
        priority: 2,
        suggestions: [{ rawName: "Juliana Melo", userId: ids.juliana }],
      },
      {
        title: "Abrir a contabilidade da empresa",
        clan: "contabilidade" as ClanSlug,
        difficulty: 4,
        priority: 2,
        suggestions: [],
      },
    ];

    const informativeTaskIds: string[] = [];
    for (const seed of INFORMATIVE_TASKS) {
      const taskId = randomUUID();
      informativeTaskIds.push(taskId);
      await tx.insert(schema.tasks).values({
        id: taskId,
        orgId,
        creatorId: ids.helena,
        assigneeId: null,
        clanId: clanIds[seed.clan],
        clientId,
        informativeId,
        title: `${seed.title} — PICCOLI AGRO SERVIÇOS LTDA`,
        description: "Missão gerada pelo informativo de novo cliente.",
        priority: seed.priority,
        difficulty: seed.difficulty,
        xpValue: calculateTaskXp(seed.difficulty, seed.priority),
        // Sem prazo: o informativo não trouxe data e o sistema nunca inventa.
        status: "pending",
        dueDate: null,
        createdAt: informativeCreatedAt,
        updatedAt: informativeCreatedAt,
      });
      await tx.insert(schema.taskEvents).values({
        id: randomUUID(),
        orgId,
        taskId,
        actorId: ids.helena,
        fromStatus: null,
        toStatus: "pending",
        createdAt: informativeCreatedAt,
      });
      for (const suggestion of seed.suggestions) {
        await tx.insert(schema.taskAssigneeSuggestions).values({
          id: randomUUID(),
          orgId,
          taskId,
          userId: suggestion.userId,
          rawName: suggestion.rawName,
          createdAt: informativeCreatedAt,
        });
      }
    }
    await tx
      .update(schema.informatives)
      .set({ createdTaskIds: informativeTaskIds })
      .where(eq(schema.informatives.id, informativeId));

    // ── Mural: o aviso automático da empresa nova e um recado da equipe.
    const newClientNoticeId = randomUUID();
    await tx.insert(schema.guildNotices).values({
      id: newClientNoticeId,
      orgId,
      authorId: ids.helena,
      kind: "new_client",
      title: "Nova empresa: PICCOLI AGRO SERVIÇOS LTDA",
      body: "Dados cadastrais\nRazão social: PICCOLI AGRO SERVIÇOS LTDA\nCNPJ: 68100490000131\nEnquadramento: Simples Nacional\n\nObservações e combinados\n• Camila responde por todos os informativos da empresa.\n\n3 missões foram criadas a partir deste informativo.",
      clientId,
      informativeId,
      requiresAck: true,
      pinned: true,
      publishedAt: informativeCreatedAt,
      createdAt: informativeCreatedAt,
      updatedAt: informativeCreatedAt,
    });
    // Uma confirmação já registrada, para a tela mostrar "1 de 4 confirmaram".
    await tx.insert(schema.guildNoticeReads).values({
      id: randomUUID(),
      orgId,
      noticeId: newClientNoticeId,
      userId: ids.rafael,
      acknowledgedAt: daysAgo(1, 2),
    });

    await tx.insert(schema.guildNotices).values({
      id: randomUUID(),
      orgId,
      authorId: ids.tiago,
      kind: "notice",
      title: "Servidor de arquivos fora do ar na sexta à noite",
      body: "A manutenção começa às 19h e deve durar duas horas. Salvem os documentos antes disso.",
      requiresAck: false,
      pinned: false,
      publishedAt: daysAgo(2, 3),
      createdAt: daysAgo(2, 3),
      updatedAt: daysAgo(2, 3),
    });
  });

  console.log("\nSeed concluído! Organização: Guilda Demo");
  console.log(`Senha de todos: ${PASSWORD}`);
  for (const person of PEOPLE) {
    console.log(`  ${person.role.padEnd(6)} ${person.email}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
