import Link from "next/link";

import { ClanStatusStrip } from "@/app/(app)/clans/[id]/clan-ui";
import { MissionRow } from "@/components/mission-row";
import {
  isTaskOverdue,
  splitOpenAndClosed,
  triageStandaloneTasks,
  type MissionScope,
} from "@/domain/mission-triage";

import { ClosedMissions, MissionEmpty, MissionSection } from "./mission-sections";
import type { MissionListRow } from "./mission-list-types";

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function Rows({
  tasks,
  taskHref,
}: {
  tasks: readonly MissionListRow[];
  taskHref: (taskId: string) => string;
}) {
  return (
    <ul className="grid gap-1.5">
      {tasks.map((task) => (
        <li key={task.id}>
          <MissionRow task={task} href={taskHref(task.id)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Missões avulsas: pedido de uma pessoa para outra (ou para si mesma).
 *
 * Na visão pessoal, a lista é dividida pelo PAPEL de quem lê em cada
 * missão — fazer, aprovar, pediu, enviou — porque é o papel que decide a
 * próxima ação, não o status. Nos escopos amplos (clã, pessoa, Guilda) não
 * há papel: fica aberto/encerrado, com atrasadas no topo.
 */
export function StandaloneView({
  scope,
  viewerId,
  open,
  closed,
  now,
  taskHref,
}: {
  scope: MissionScope;
  viewerId: string;
  open: readonly MissionListRow[];
  closed: readonly MissionListRow[];
  now: Date;
  taskHref: (taskId: string) => string;
}) {
  if (scope === "mine") {
    const sections = triageStandaloneTasks([...open, ...closed], viewerId, now);
    const overdue = sections.todo.filter((task) => isTaskOverdue(task, now)).length;

    return (
      <div className="grid gap-6">
        <ClanStatusStrip
          items={[
            {
              label: "para você fazer",
              value: sections.todo.length,
              detail:
                overdue > 0
                  ? `${overdue} ${plural(overdue, "atrasada", "atrasadas")}`
                  : sections.todo.length === 0
                    ? "nada esperando por você"
                    : "nenhuma vencida",
              tone: overdue > 0 ? "danger" : sections.todo.length === 0 ? "positive" : "neutral",
            },
            {
              label: "para você aprovar",
              value: sections.approve.length === 0 ? "✓" : sections.approve.length,
              detail:
                sections.approve.length === 0
                  ? "nenhuma entrega parada"
                  : "entregas esperando o seu ok",
              tone: sections.approve.length === 0 ? "positive" : "warning",
            },
            {
              label: "você pediu",
              value: sections.requested.length,
              detail:
                sections.requested.length === 0
                  ? "nenhum pedido em aberto"
                  : "ainda não voltaram",
            },
          ]}
        />

        <MissionSection
          title="Para você fazer"
          count={sections.todo.length}
          hint="iniciar, concluir ou enviar"
        >
          {sections.todo.length === 0 ? (
            <MissionEmpty title="Nada esperando por você">
              Missões atribuídas a você aparecem aqui assim que alguém pedir —
              ou assim que você criar uma para si.
            </MissionEmpty>
          ) : (
            <Rows tasks={sections.todo} taskHref={taskHref} />
          )}
        </MissionSection>

        {sections.approve.length > 0 ? (
          <MissionSection
            title="Para você aprovar"
            count={sections.approve.length}
            hint="quem entregou espera o seu retorno"
          >
            <Rows tasks={sections.approve} taskHref={taskHref} />
          </MissionSection>
        ) : null}

        {sections.requested.length > 0 ? (
          <MissionSection
            title="Você pediu"
            count={sections.requested.length}
            hint="em mãos de outra pessoa"
          >
            <Rows tasks={sections.requested} taskHref={taskHref} />
          </MissionSection>
        ) : null}

        {sections.submitted.length > 0 ? (
          <MissionSection
            title="Enviadas para aprovação"
            count={sections.submitted.length}
            hint="esperando quem pediu"
          >
            <Rows tasks={sections.submitted} taskHref={taskHref} />
          </MissionSection>
        ) : null}

        {sections.closed.length > 0 ? (
          <ClosedMissions count={sections.closed.length}>
            <Rows tasks={sections.closed} taskHref={taskHref} />
          </ClosedMissions>
        ) : null}
      </div>
    );
  }

  const split = splitOpenAndClosed([...open, ...closed], now);
  const unassigned = split.open.filter((task) => !task.assigneeId).length;
  const overdue = split.open.filter((task) => isTaskOverdue(task, now)).length;

  return (
    <div className="grid gap-6">
      <ClanStatusStrip
        items={[
          {
            label: plural(split.open.length, "missão aberta", "missões abertas"),
            value: split.open.length,
            detail: split.open.length === 0 ? "nenhum trabalho pendente" : "neste recorte",
          },
          {
            label: unassigned === 0 ? "tudo atribuído" : "sem responsável",
            value: unassigned === 0 ? "✓" : unassigned,
            detail: unassigned === 0 ? "ninguém sem dono" : "aguardando alguém assumir",
            tone: unassigned === 0 ? "positive" : "warning",
          },
          {
            label: overdue === 0 ? "tudo em dia" : "atrasadas",
            value: overdue === 0 ? "✓" : overdue,
            detail: overdue === 0 ? "nenhum prazo vencido" : "exigem atenção",
            tone: overdue === 0 ? "positive" : "danger",
          },
        ]}
      />

      <MissionSection title="Em aberto" count={split.open.length} hint="atrasadas primeiro">
        {split.open.length === 0 ? (
          <MissionEmpty title="Nenhuma missão avulsa em aberto neste recorte">
            Troque o recorte acima ou{" "}
            <Link href="/tasks/new" className="font-medium text-primary hover:underline">
              crie uma missão
            </Link>
            .
          </MissionEmpty>
        ) : (
          <Rows tasks={split.open} taskHref={taskHref} />
        )}
      </MissionSection>

      {split.closed.length > 0 ? (
        <ClosedMissions count={split.closed.length}>
          <Rows tasks={split.closed} taskHref={taskHref} />
        </ClosedMissions>
      ) : null}
    </div>
  );
}
