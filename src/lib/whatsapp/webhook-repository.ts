import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { withOrgTx } from "@/db/org-tx";
import * as schema from "@/db/schema";

import type { SanitizedWhatsAppChange } from "./webhook";

type ChannelRouteRow = { channel_id: string; org_id: string };

export type WhatsAppChannelRoute = Readonly<{
  channelId: string;
  orgId: string;
}>;

/** Exceção estreita anterior ao tenant; a função SQL não expõe segredos. */
export async function lookupWhatsAppChannel(
  phoneNumberId: string,
): Promise<WhatsAppChannelRoute | null> {
  if (!/^[0-9]{1,32}$/.test(phoneNumberId)) return null;
  const result = await db.execute<ChannelRouteRow>(
    sql`SELECT channel_id, org_id
        FROM public.lookup_support_whatsapp_channel(${phoneNumberId})`,
  );
  const row = result.rows[0];
  return row ? { channelId: row.channel_id, orgId: row.org_id } : null;
}

export async function enqueueWhatsAppChange(input: {
  route: WhatsAppChannelRoute;
  fingerprint: string;
  change: SanitizedWhatsAppChange;
}): Promise<"queued" | "duplicate"> {
  return withOrgTx(input.route.orgId, async (tx) => {
    const inserted = await tx
      .insert(schema.supportInboundEvents)
      .values({
        orgId: input.route.orgId,
        channelId: input.route.channelId,
        fingerprint: input.fingerprint,
        webhookField: input.change.field,
        payload: input.change.payload,
      })
      .onConflictDoNothing({ target: schema.supportInboundEvents.fingerprint })
      .returning({ id: schema.supportInboundEvents.id });

    await tx
      .update(schema.supportWhatsAppChannels)
      .set({ lastWebhookAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.supportWhatsAppChannels.id, input.route.channelId));

    return inserted.length ? "queued" : "duplicate";
  });
}
