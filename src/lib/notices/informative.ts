import "server-only";

import type { OrgTx } from "@/db/org-tx";

import { enqueueMemberNotice } from "./enqueue";
import { groupInformativeNotices, type InformativeNoticeTask } from "./informative-groups";

export type { InformativeNoticeTask } from "./informative-groups";

/**
 * Missão de Informativo avisa quem a recebeu (2026-11-24): antes só o Mural
 * avisava, e a missão pedida pelo WhatsApp não chegava a ninguém. Um aviso por
 * pessoa; quem pediu não é avisado do próprio pedido.
 */
export async function enqueueInformativeAssignmentNotices(
  tx: OrgTx,
  input: {
    orgId: string;
    informativeId: string;
    requesterId: string;
    companyName: string | null;
    tasks: readonly InformativeNoticeTask[];
  },
): Promise<void> {
  for (const group of groupInformativeNotices(input)) {
    await enqueueMemberNotice(tx, {
      orgId: input.orgId,
      userId: group.userId,
      dedupeKey: `informative:${input.informativeId}:assigned:user:${group.userId}`,
      preference: "tasks",
      notice: group.notice,
    });
  }
}
