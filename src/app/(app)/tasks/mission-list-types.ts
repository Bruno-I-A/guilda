import type { TriageTask } from "@/domain/mission-triage";

/**
 * A linha de missão como a lista a consome: os campos de triagem mais o
 * que a `MissionRow` precisa mostrar. Montada uma vez no `page.tsx` a
 * partir do resultado do Drizzle, para as visões não conhecerem o schema.
 */
/** A entrega mais recente de uma missão que espera aprovação. */
export interface MissionDelivery {
  note: string | null;
  actorName: string;
  at: Date;
}

export interface MissionListRow extends TriageTask {
  xpValue: number;
  priority: number;
  difficulty: number;
  informativeId: string | null;
  clanName: string | null;
  clientName: string | null;
  assigneeName: string | null;
  creatorName: string | null;
}
